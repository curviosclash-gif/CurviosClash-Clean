import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_UNIT_LIMITS,
    normalizeMapUnit,
    normalizeMapUnits,
    resolveMapUnitDefinitions,
} from '../src/shared/contracts/MapUnitContract.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

const PATH = [[0, 2, 0], [40, 2, 0], [40, 2, 40]];

test('a bare tank gets the balance start values', () => {
    const tank = normalizeMapUnit({ id: 'tank_a', path: PATH });
    assert.equal(tank.kind, 'tank');
    assert.equal(tank.speed, 12);
    assert.equal(tank.maxHp, 150);
    assert.equal(tank.respawnSeconds, 30);
    assert.equal(tank.loop, true);
    assert.equal(tank.targetPlayers, 'all');
    assert.deepEqual(tank.allowedModes, ['HUNT', 'ARCADE']);
    assert.deepEqual(tank.weapons.mg, { damage: 3, cooldown: 0.3, range: 60 });
    assert.deepEqual(tank.weapons.rocket, { rocketType: 'ROCKET_MEDIUM', cooldown: 5, range: 90 });
    assert.deepEqual(tank.loot, { ROCKET_MEDIUM: 0.6, ROCKET_HEAVY: 0.3, ROCKET_MEGA: 0.1 });
    assert.deepEqual(tank.path, PATH);
    assert.equal(Object.isFrozen(tank), true);
});

test('authored values are clamped and a weapon can be switched off', () => {
    const tank = normalizeMapUnit({
        path: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }],
        speed: 999,
        maxHp: -5,
        loop: false,
        targetPlayers: 'humans',
        allowedModes: ['arcade', 'CLASSIC'],
        weapons: { mg: false, rocket: { rocketType: 'rocket_mega', cooldown: 0.01 } },
        loot: { ROCKET_WEAK: 1, BOGUS: 1, ROCKET_HEAVY: 0 },
    }, 4);
    assert.equal(tank.id, 'unit_5');
    assert.equal(tank.speed, 60);
    assert.equal(tank.maxHp, 1);
    assert.equal(tank.loop, false);
    assert.equal(tank.targetPlayers, 'humans');
    assert.deepEqual(tank.allowedModes, ['ARCADE']);
    assert.equal(tank.weapons.mg, null);
    assert.deepEqual(tank.weapons.rocket, { rocketType: 'ROCKET_MEGA', cooldown: 0.5, range: 90 });
    assert.deepEqual(tank.loot, { ROCKET_WEAK: 1 });
    assert.deepEqual(tank.path, [[1, 2, 3], [4, 5, 6]]);
});

test('unknown kinds, short or broken paths and duplicate ids are dropped with a warning', () => {
    const warnings = [];
    const units = normalizeMapUnits([
        { id: 'ok', path: PATH },
        { id: 'dragon', kind: 'dragon', path: PATH },
        { id: 'short', path: [[0, 0, 0]] },
        { id: 'broken', path: [[0, 0, 0], [1, 'x', 2]] },
        { id: 'ok', path: PATH },
        null,
    ], { warnings });
    assert.deepEqual(units.map((unit) => unit.id), ['ok']);
    assert.equal(warnings.length, 5);
});

test('the block is capped at the unit and path point limits', () => {
    const warnings = [];
    const many = Array.from({ length: MAP_UNIT_LIMITS.maxUnits + 3 }, (_, index) => ({ id: `t${index}`, path: PATH }));
    assert.equal(normalizeMapUnits(many, { warnings }).length, MAP_UNIT_LIMITS.maxUnits);
    assert.equal(warnings.length, 1);
    const longPath = Array.from({ length: MAP_UNIT_LIMITS.maxPathPoints + 10 }, (_, index) => [index, 0, 0]);
    assert.equal(normalizeMapUnit({ path: longPath }).path.length, MAP_UNIT_LIMITS.maxPathPoints);
});

test('the runtime reads the units of a map definition and tolerates maps without them', () => {
    assert.deepEqual(resolveMapUnitDefinitions({ mapUnits: [{ id: 'a', path: PATH }] }).map((unit) => unit.id), ['a']);
    assert.deepEqual(resolveMapUnitDefinitions({}), []);
    assert.deepEqual(resolveMapUnitDefinitions(null), []);
});

test('map units survive the schema document and reach the runtime definition scaled', () => {
    const raw = { schemaVersion: 4, mapUnits: [{ id: 'patrol', path: [[30, 3, 0], [60, 3, 0]], speed: 10 }] };
    const document = normalizeMapSchemaDocument(raw);
    assert.equal(document.mapUnits?.length, 1, 'the schema keeps the block');
    assert.equal(document.mapUnits[0].speed, 10);

    const runtime = toArenaMapDefinition(document, { mapScale: 3 });
    assert.deepEqual(runtime.map.mapUnits?.[0]?.path, [[10, 1, 0], [20, 1, 0]], 'positions follow the map scale');

    const withoutUnits = normalizeMapSchemaDocument({ schemaVersion: 4 });
    assert.equal('mapUnits' in withoutUnits, false, 'a map without units keeps its old document');
    assert.equal('mapUnits' in toArenaMapDefinition(withoutUnits, { mapScale: 3 }).map, false);
});
