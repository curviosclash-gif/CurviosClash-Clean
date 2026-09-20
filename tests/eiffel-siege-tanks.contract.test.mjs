import assert from 'node:assert/strict';
import test from 'node:test';

import { EIFFEL_TOWER_SIEGE_MAPS, EIFFEL_SIEGE_HALF_SIZE } from '../src/core/config/maps/presets/eiffel_tower_siege/index.js';
import { EIFFEL_SIEGE_SECRET_ROOM } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeSecretRoom.js';
import { resolveMapUnitDefinitions } from '../src/shared/contracts/MapUnitContract.js';
import { CONFIG_BASE } from '../src/core/Config.js';

const MAP = EIFFEL_TOWER_SIEGE_MAPS.eiffel_tower_siege;
const GROUND = 8;
const TURRET_HEIGHT = 2.1;
const LEG_SQUARE_HALF = 37.5;

function tanks() {
    return resolveMapUnitDefinitions(MAP, { preserveSpatial: MAP.scaleAuthoredAnchors === true })
        .filter((unit) => unit.kind === 'tank');
}

function* samplePath(path, step = 1) {
    for (let index = 0; index < path.length; index += 1) {
        const from = path[index];
        const to = path[(index + 1) % path.length];
        const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
        const count = Math.max(1, Math.ceil(length / step));
        for (let i = 0; i <= count; i += 1) {
            const t = i / count;
            yield [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
        }
    }
}

test('the siege map sends two looping tanks that drive at the tank start speed', () => {
    const entries = tanks();
    assert.deepEqual(entries.map((tank) => tank.id), ['eiffel_siege_tank_north', 'eiffel_siege_tank_south']);
    const scale = CONFIG_BASE.ARENA.MAP_SCALE;
    for (const tank of entries) {
        assert.equal(tank.loop, true);
        assert.equal(tank.speed * scale, 12, 'authored 4 on a scale 3 map is 12 world units per second');
        assert.equal(tank.weapons.mg.range * scale, 60);
        assert.equal(tank.weapons.rocket.range * scale, 90);
        assert.equal(tank.maxHp, 150);
    }
});

test('the patrol stays on the ground, inside the field and clear of legs and portals', () => {
    const portals = [EIFFEL_SIEGE_SECRET_ROOM.entryPortal.pos, EIFFEL_SIEGE_SECRET_ROOM.ejectPoint.pos];
    for (const tank of tanks()) {
        for (const point of samplePath(tank.path)) {
            assert.equal(point[1], GROUND, 'every waypoint sits on the ground slab');
            assert.ok(Math.abs(point[0]) <= EIFFEL_SIEGE_HALF_SIZE - 40 && Math.abs(point[2]) <= EIFFEL_SIEGE_HALF_SIZE - 40, 'inside the field');
            const legClearance = Math.max(Math.abs(point[0]), Math.abs(point[2])) - LEG_SQUARE_HALF;
            assert.ok(legClearance > tank.hitboxRadius * 2, 'clear of the tower legs');
            for (const portal of portals) {
                assert.ok(Math.hypot(point[0] - portal[0], point[2] - portal[2]) > 20, 'clear of the secret room portal and eject point');
            }
        }
    }
});

test('no authored obstacle stands in the patrol route', () => {
    const isGround = (obstacle) => obstacle.pos?.[1] === 4 && obstacle.size?.[1] === 8;
    const boxes = MAP.obstacles.filter((obstacle) => obstacle.pos && obstacle.size && !isGround(obstacle));
    const beams = MAP.obstacles.filter((obstacle) => obstacle.shape === 'beam');
    assert.equal(boxes.length + beams.length + 1, MAP.obstacles.length, 'every obstacle is either the ground, a box or a beam');
    for (const tank of tanks()) {
        for (const point of samplePath(tank.path, 2)) {
            const centre = [point[0], GROUND + TURRET_HEIGHT, point[2]];
            for (const box of boxes) {
                const inside = [0, 1, 2].every((axis) => Math.abs(centre[axis] - box.pos[axis]) <= box.size[axis] / 2 + tank.hitboxRadius);
                assert.equal(inside, false, `tank at ${centre} runs into the box at ${box.pos}`);
            }
            for (const beam of beams) {
                const d = [0, 1, 2].map((axis) => beam.end[axis] - beam.start[axis]);
                const lengthSq = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
                const t = Math.max(0, Math.min(1, [0, 1, 2].reduce((sum, axis) => sum + (centre[axis] - beam.start[axis]) * d[axis], 0) / lengthSq));
                const gap = Math.hypot(...[0, 1, 2].map((axis) => beam.start[axis] + d[axis] * t - centre[axis]));
                assert.ok(gap > beam.radius + tank.hitboxRadius, `tank at ${centre} runs into the beam from ${beam.start}`);
            }
        }
    }
});

test('the chase leash keeps a tank clear of legs, portals and the field edge', () => {
    const portals = [EIFFEL_SIEGE_SECRET_ROOM.entryPortal.pos, EIFFEL_SIEGE_SECRET_ROOM.ejectPoint.pos];
    for (const tank of tanks()) {
        assert.equal(tank.drive.chase, true, 'the siege tanks hunt what they can see');
        const leash = tank.drive.chaseLeash;
        for (const point of samplePath(tank.path)) {
            const reach = leash + tank.hitboxRadius;
            assert.ok(
                Math.abs(point[0]) + reach <= EIFFEL_SIEGE_HALF_SIZE && Math.abs(point[2]) + reach <= EIFFEL_SIEGE_HALF_SIZE,
                'even at the end of its leash the tank stays in the field',
            );
            assert.ok(
                Math.max(Math.abs(point[0]), Math.abs(point[2])) - LEG_SQUARE_HALF > reach,
                'the leash never reaches the tower legs',
            );
            for (const portal of portals) {
                assert.ok(
                    Math.hypot(point[0] - portal[0], point[2] - portal[2]) > reach,
                    'the leash never reaches the secret room portal or eject point',
                );
            }
        }
    }
});
