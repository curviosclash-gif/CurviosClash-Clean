import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_FIRE_MAPS } from '../src/core/config/maps/presets/notre_dame_fire/index.js';
import { NOTRE_DAME_EVOLUTION_MAPS } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { isMapUnitCombatActive } from '../src/shared/contracts/MapUnitContract.js';
import { isParcoursActiveForGameMode } from '../src/shared/contracts/MapModeContract.js';

const maps = { ...NOTRE_DAME_MAPS, ...NOTRE_DAME_FIRE_MAPS, ...NOTRE_DAME_EVOLUTION_MAPS };

test('the shared Notre-Dame flock is ten pigeons on HUNT and all arena rounds', () => {
    for (const [key, map] of Object.entries(maps)) {
        const [flock] = map.mapUnits || [];
        assert.ok(flock, `${key} inherits the common pigeon flock`);
        assert.equal(flock.id, 'notre_dame_pigeons');
        assert.equal(flock.memberCount, 10);
        assert.deepEqual(flock.allowedModes, ['HUNT', 'ARENA']);
        assert.equal(isMapUnitCombatActive({ modeType: 'HUNT' }, flock.allowedModes, map), true,
            'the map route is inactive in Hunt');
        assert.equal(isMapUnitCombatActive({ modeType: 'CLASSIC' }, flock.allowedModes, map), false);
        const arcadeExpected = !isParcoursActiveForGameMode(map, 'ARCADE');
        assert.equal(isMapUnitCombatActive({ modeType: 'ARCADE', getPickupModeType: () => 'ARCADE' }, flock.allowedModes, map), arcadeExpected,
            'only a map without an active route opts its arena rounds into Arcade');
        assert.equal(isMapUnitCombatActive({ modeType: 'ARCADE', getPickupModeType: () => 'HUNT' }, flock.allowedModes, map), arcadeExpected,
            'the pickup profile cannot override an active map route');
        assert.equal(isMapUnitCombatActive({
            modeType: 'ARCADE', isSectorParcours: () => true,
        }, flock.allowedModes, map), false, 'the arena parcours sector stays free of pigeons');
    }
    assert.equal(isParcoursActiveForGameMode(NOTRE_DAME_MAPS.notre_dame, 'HUNT'), false,
        'the Notre-Dame route is not active in HUNT, where the flock runs');
    assert.equal(isParcoursActiveForGameMode(NOTRE_DAME_MAPS.notre_dame, 'ARCADE'), true,
        'the intact route variant owns an Arcade parcours');
    assert.equal(isParcoursActiveForGameMode(NOTRE_DAME_MAPS.notre_dame_arena, 'ARCADE'), false,
        'the free arena variant deliberately has no parcours');
});

test('the loop uses the nave, west rose, tower perimeter and west parvis', () => {
    const { path } = NOTRE_DAME_MAPS.notre_dame.mapUnits[0];
    assert.equal(path[0][0], -112);
    assert.equal(path[1][0], -83, 'the west portal entry is explicit');
    assert.ok(path.some((point) => point[0] > -70 && Math.abs(point[2]) < 10), 'the flock crosses the nave');
    assert.ok(path.some((point) => point[0] === -83 && point[1] === 45), 'the west rose is the explicit entry and exit');
    assert.ok(path.some((point) => point[0] === -72 && point[1] === 112)
        && path.some((point) => point[0] === -72 && point[2] === -45), 'the east side of both towers clears them above their crowns');
    assert.ok(path.some((point) => point[0] === -105 && point[2] === 45)
        && path.some((point) => point[0] === -105 && point[2] === -45), 'the west facade and both towers are circled');
    assert.deepEqual(path[0], path.at(-1), 'the route is a closed cycle across the parvis');
    assert.equal(path[0][1], 45, 'the loop flies through the existing west rose opening');
    assert.equal(path.slice(0, 9).every((point) => point[1] === 45), true, 'the nave and parvis legs stay high over furnishings');
});

test('MapUnitSystem spawns the flock for Hunt and free arenas, but not the active route', () => {
    const countFor = (map, modeType, pickupModeType = modeType) => {
        const system = new MapUnitSystem({
            gameModeStrategy: { modeType, getPickupModeType: () => pickupModeType },
            arena: { currentMapDefinition: map },
            renderer: { addToScene() {}, removeFromScene() {} },
        });
        return system.startRound();
    };

    assert.equal(countFor(NOTRE_DAME_MAPS.notre_dame, 'HUNT'), 1);
    assert.equal(countFor(NOTRE_DAME_MAPS.notre_dame, 'ARCADE'), 0);
    assert.equal(countFor(NOTRE_DAME_MAPS.notre_dame_arena, 'ARCADE'), 1);
});
