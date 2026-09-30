import assert from 'node:assert/strict';
import test from 'node:test';

import { isMapUnitCombatActive, normalizeMapUnit, resolveMapUnitDefinitions } from '../src/shared/contracts/MapUnitContract.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';

const PATH = [[-8, 6, 0], [8, 6, 0]];

test('a bare swarm gets the agreed lightweight combat defaults', () => {
    const swarm = normalizeMapUnit({ id: 'vault_swarm', kind: 'swarm', path: PATH });

    assert.equal(swarm.kind, 'swarm');
    assert.equal(swarm.memberCount, 8);
    assert.equal(swarm.memberHp, 8);
    assert.equal(swarm.formationRadius, 5);
    assert.equal(swarm.maxHp, 8);
    assert.equal(swarm.respawnSeconds, 0, 'the map decides whether a defeated swarm returns');
    assert.deepEqual(swarm.weapons.mg, { damage: 2, cooldown: 0.6, range: 40 });
    assert.equal(swarm.weapons.rocket, null);
});

test('swarm size and member values are bounded', () => {
    const swarm = normalizeMapUnit({
        kind: 'swarm',
        path: PATH,
        memberCount: 99,
        memberHp: -2,
        formationRadius: 500,
    });

    assert.equal(swarm.memberCount, 10);
    assert.equal(swarm.memberHp, 1);
    assert.equal(swarm.formationRadius, 20);
});

test('a ten-pigeon dive has bounded spatial values and remains opt-in for other swarms', () => {
    const ordinary = normalizeMapUnit({ kind: 'swarm', path: PATH });
    const pigeons = normalizeMapUnit({
        kind: 'swarm', path: PATH, memberCount: 10,
        attack: { damage: 14, cooldown: 3.2, radius: 0.7, range: 9, diveSpeed: 26 },
    });

    assert.equal(ordinary.attack, undefined);
    assert.equal(pigeons.memberCount, 10);
    assert.deepEqual(pigeons.attack, { damage: 14, cooldown: 3.2, radius: 0.7, range: 9, diveSpeed: 26 });
    assert.equal(normalizeMapUnit({ kind: 'swarm', path: PATH, memberCount: 99 }).memberCount, 10);
});

test('ARENA map units opt into every Arcade arena without enabling ordinary Arcade turrets', () => {
    const arena = { modeType: 'ARCADE', getPickupModeType: () => 'ARCADE' };
    const huntArena = { modeType: 'ARCADE', getPickupModeType: () => 'HUNT' };
    const parcours = { ...arena, isSectorParcours: () => true };

    assert.equal(isMapUnitCombatActive(arena, ['HUNT', 'ARENA']), true);
    assert.equal(isMapUnitCombatActive(huntArena, ['HUNT', 'ARENA']), true);
    assert.equal(isMapUnitCombatActive(parcours, ['HUNT', 'ARENA']), false);
    assert.equal(isMapUnitCombatActive(arena, ['HUNT', 'ARENA'], NOTRE_DAME_MAPS.notre_dame), false,
        'map-owned units stay out of an Arcade round while that map runs its parcours');
    assert.equal(isMapUnitCombatActive(huntArena, ['HUNT', 'ARENA'], NOTRE_DAME_MAPS.notre_dame), false,
        'a Hunt pickup profile does not override the active map route');
    assert.equal(isMapUnitCombatActive(arena, ['HUNT', 'ARENA'], NOTRE_DAME_MAPS.notre_dame_arena), true,
        'the free arena variant has no active route and keeps its opt-in units');
    assert.equal(isMapUnitCombatActive({ modeType: 'HUNT' }, ['HUNT', 'ARENA'], NOTRE_DAME_MAPS.notre_dame), true,
        'the map route is inactive in Hunt, so its combat units remain available');
    assert.equal(isMapUnitCombatActive(arena, ['HUNT', 'ARCADE']), false,
        'existing map units still require the HUNT combat profile in Arcade');
    assert.equal(isMapUnitCombatActive(huntArena, ['HUNT', 'ARCADE']), true);
});

test('swarm fields survive the map schema and its scale boundary', () => {
    const document = normalizeMapSchemaDocument({
        schemaVersion: 4,
        mapUnits: [{
            id: 'custom_swarm',
            kind: 'swarm',
            path: [[-30, 18, 0], [30, 18, 0]],
            memberCount: 6,
            memberHp: 7,
            formationRadius: 9,
            respawnSeconds: 37,
        }],
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 3 });
    const [swarm] = resolveMapUnitDefinitions(runtime.map, { preserveSpatial: true });

    assert.equal(swarm.kind, 'swarm');
    assert.equal(swarm.memberCount, 6);
    assert.equal(swarm.memberHp, 7);
    assert.equal(swarm.formationRadius * 3, 9);
    assert.equal(swarm.respawnSeconds, 37);
    assert.deepEqual(swarm.path, [[-10, 6, 0], [10, 6, 0]]);
});
