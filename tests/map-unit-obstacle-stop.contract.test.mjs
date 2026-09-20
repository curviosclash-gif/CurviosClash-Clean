import assert from 'node:assert/strict';
import test from 'node:test';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { DRIVE_RELEASE_LIMIT } from '../src/entities/systems/map-units/MapUnitDriveOps.js';

/** A world whose only geometry is a wall across the tank's lane at `wallX`. */
function ownerWithWallAt(wallX, drive = undefined, path = [[0, 0, 0], [240, 0, 0]], loop = false) {
    const scene = new Set();
    const arena = {
        collisionCalls: 0,
        currentMapDefinition: {
            mapUnits: [{
                id: 'patrol',
                path,
                loop,
                allowedModes: ['HUNT'],
                ...(drive ? { drive } : {}),
            }],
        },
        raycast: () => ({ hit: false, distance: 0 }),
        checkCollisionFast(position, radius) {
            this.collisionCalls += 1;
            return position.x + radius > wallX;
        },
    };
    return {
        scene,
        arena,
        owner: {
            gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
            arena,
            renderer: { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) },
        },
    };
}

function drive(system, seconds) {
    for (let step = 0; step < Math.round(seconds * 60); step += 1) system.update(1 / 60);
    return system.units[0];
}

test('a tank stops in front of a wall instead of driving through it', () => {
    const { owner } = ownerWithWallAt(100);
    const system = new MapUnitSystem(owner);
    system.startRound();
    const unit = drive(system, 10);
    assert.ok(unit.groundPosition.x < 100, `stopped short of the wall, was ${unit.groundPosition.x}`);
    assert.ok(unit.groundPosition.x > 90, 'it still drove the open stretch before the wall');
});

test('obstacleStop false keeps the old behaviour', () => {
    const { owner, arena } = ownerWithWallAt(100, { obstacleStop: false });
    const system = new MapUnitSystem(owner);
    system.startRound();
    const unit = drive(system, 10);
    assert.equal(Math.round(unit.groundPosition.x), 120, 'speed 12 drives 120 units in ten seconds');
    assert.equal(arena.collisionCalls, 0, 'a switched off probe must not cost a query');
});

test('a tank walled in for good is released instead of freezing forever', () => {
    const { owner } = ownerWithWallAt(100);
    const system = new MapUnitSystem(owner);
    system.startRound();
    const stuck = drive(system, 10);
    assert.equal(stuck.driveReleases, 0, 'it is still waiting at ten seconds');
    const freed = drive(system, 5);
    assert.ok(freed.driveReleases > 0, 'after the blocked timeout the unit is released');
    assert.ok(freed.groundPosition.x > 100, 'a released unit drives on instead of blocking the round');
});

test('a hopeless path gives up probing after a few releases', () => {
    const { owner, arena } = ownerWithWallAt(-1000, undefined, [[0, 0, 0], [12, 0, 0]], true);
    const system = new MapUnitSystem(owner);
    system.startRound();
    const unit = drive(system, 30);
    assert.equal(unit.driveReleases, DRIVE_RELEASE_LIMIT, 'the release counter stops at the limit');
    const calls = arena.collisionCalls;
    drive(system, 5);
    assert.equal(arena.collisionCalls, calls, 'after the limit the unit stops paying for the probe');
});

test('a new round forgets the blocked state', () => {
    const { owner } = ownerWithWallAt(-1000, undefined, [[0, 0, 0], [12, 0, 0]], true);
    const system = new MapUnitSystem(owner);
    system.startRound();
    drive(system, 30);
    system.startRound();
    assert.equal(system.units[0].driveReleases, 0);
    assert.equal(system.units[0].driveBlockedSeconds, 0);
});
