import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { DRIVE_MODES } from '../src/entities/systems/map-units/MapUnitDriveOps.js';

const RING = [[0, 0, 0], [80, 0, 0], [80, 0, 80], [0, 0, 80]];

function createSystem({ players = [], blocked = false, drive = { chase: true }, targetPlayers = 'all' } = {}) {
    const scene = new Set();
    const owner = {
        players,
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            currentMapDefinition: {
                mapUnits: [{ id: 'patrol', path: RING, loop: true, allowedModes: ['HUNT'], targetPlayers, drive }],
            },
            // `blocked` puts a wall between everything: the sight line is never free.
            raycast: () => ({ hit: blocked, distance: 1 }),
        },
        renderer: { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) },
    };
    const system = new MapUnitSystem(owner);
    system.startRound();
    return system;
}

function playerAt(x, z, extra = {}) {
    return { index: 0, alive: true, isBot: false, position: new THREE.Vector3(x, 10, z), ...extra };
}

function run(system, seconds) {
    for (let step = 0; step < Math.round(seconds * 60); step += 1) system.update(1 / 60);
    return system.units[0];
}

test('a tank takes up the chase for a player in reach', () => {
    const player = playerAt(20, 30);
    const unit = run(createSystem({ players: [player] }), 2);
    assert.equal(unit.driveMode, DRIVE_MODES.CHASE);
    assert.ok(unit.groundPosition.z > 1, 'it left its lane towards the player');
});

test('chase is off unless the map asks for it', () => {
    const player = playerAt(20, 30);
    const unit = run(createSystem({ players: [player], drive: {} }), 2);
    assert.equal(unit.driveMode, DRIVE_MODES.PATROL);
    assert.ok(Math.abs(unit.groundPosition.z) < 0.001, 'it stayed exactly on its lane');
});

test('a player behind a wall is not chased', () => {
    const player = playerAt(20, 30);
    const unit = run(createSystem({ players: [player], blocked: true }), 2);
    assert.equal(unit.driveMode, DRIVE_MODES.PATROL);
});

test('the leash keeps the tank near the spot where it left the path', () => {
    const system = createSystem({ players: [playerAt(60, 300)], drive: { chase: true, chaseRange: 400, chaseLeash: 40 } });
    let worst = 0;
    let chased = false;
    for (let step = 0; step < 60 * 40; step += 1) {
        system.update(1 / 60);
        const unit = system.units[0];
        if (unit.driveMode !== DRIVE_MODES.CHASE) continue;
        chased = true;
        worst = Math.max(worst, unit.groundPosition.distanceTo(unit.chaseAnchor));
    }
    assert.ok(chased, 'the far away player was worth a chase');
    assert.ok(worst <= 41, `the leash must hold, worst was ${worst}`);
});

test('a tank on the leash keeps making its rounds instead of tugging', () => {
    const system = createSystem({ players: [playerAt(60, 300)], drive: { chase: true, chaseRange: 400, chaseLeash: 40 } });
    const seen = new Set();
    for (let step = 0; step < 60 * 120; step += 1) {
        system.update(1 / 60);
        seen.add(system.units[0].fromIndex);
    }
    assert.ok(seen.size >= 3, `the circuit carried on, corners seen: ${[...seen]}`);
});

test('a lost player sends the tank back to its circuit', () => {
    const player = playerAt(20, 30);
    const system = createSystem({ players: [player] });
    run(system, 2);
    assert.equal(system.units[0].driveMode, DRIVE_MODES.CHASE);

    player.alive = false;
    const unit = run(system, 20);
    assert.equal(unit.driveMode, DRIVE_MODES.PATROL, 'it picked its patrol up again');
    assert.equal(unit.chaseAnchorIndex, -1, 'the anchor is released');
});

test('a bot is left alone when the map only wants humans hunted', () => {
    const bot = playerAt(20, 30, { isBot: true });
    const system = createSystem({ players: [bot], targetPlayers: 'humans' });
    assert.equal(run(system, 2).driveMode, DRIVE_MODES.PATROL);
});

test('a client never chases on its own, it follows the host', () => {
    const system = createSystem({ players: [playerAt(20, 30)] });
    system.setNetworkReplica(true);
    const unit = run(system, 2);
    assert.equal(unit.driveMode, DRIVE_MODES.PATROL, 'only the host decides where a unit drives');
});
