import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { PARCOURS_PACK_V130_MAPS } from '../src/core/config/maps/presets/parcours_pack_v130.js';
import { ARCADE_SECTOR_CATALOG } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { SECTOR_MAP_POOLS } from '../src/state/arcade/ArcadeMapProgression.js';

const V130_MAP_KEYS = Object.freeze([
    'micro_maw',
    'mirror_docks',
    'glass_serpent',
    'storm_switchyard',
    'wind_cathedral',
    'chrono_spillway',
]);

const EXPECTED_ROUTE_IDS = Object.freeze({
    micro_maw: 'micro_maw_v1',
    mirror_docks: 'mirror_docks_v1',
    glass_serpent: 'glass_serpent_v1',
    storm_switchyard: 'storm_switchyard_v1',
    wind_cathedral: 'wind_cathedral_v1',
    chrono_spillway: 'chrono_spillway_v1',
});

const SHORT_AND_MID_MAPS = new Set(['micro_maw', 'mirror_docks', 'glass_serpent']);
const LONG_MAPS = new Set(['storm_switchyard', 'wind_cathedral', 'chrono_spillway']);

function vec3FromSpawn(spawn) {
    return [Number(spawn?.x) || 0, Number(spawn?.y) || 0, Number(spawn?.z) || 0];
}

function distance3(left, right) {
    return Math.hypot(
        (Number(left?.[0]) || 0) - (Number(right?.[0]) || 0),
        (Number(left?.[1]) || 0) - (Number(right?.[1]) || 0),
        (Number(left?.[2]) || 0) - (Number(right?.[2]) || 0)
    );
}

function getCanonicalId(checkpoint) {
    return String(checkpoint?.aliasOf || checkpoint?.id || '').trim();
}

test('V130 map pack registers six desktop parcours presets in catalog and base maps', () => {
    for (const mapKey of V130_MAP_KEYS) {
        assert.ok(PARCOURS_PACK_V130_MAPS[mapKey], `${mapKey} exists in V130 pack export`);
        assert.equal(MAP_PRESET_CATALOG[mapKey], PARCOURS_PACK_V130_MAPS[mapKey], `${mapKey} reaches catalog`);
        assert.equal(MAP_PRESETS_BASE[mapKey], PARCOURS_PACK_V130_MAPS[mapKey], `${mapKey} reaches desktop base maps`);
    }
});

test('V130 parcours routes build with stable ghost and finish contracts', () => {
    const routeIds = new Set();

    for (const mapKey of V130_MAP_KEYS) {
        const mapDef = MAP_PRESET_CATALOG[mapKey];
        const route = buildRouteFromParcours(mapDef?.parcours);

        assert.ok(route, `${mapKey} builds a parcours route`);
        assert.equal(route.routeId, EXPECTED_ROUTE_IDS[mapKey], `${mapKey} keeps routeId policy`);
        assert.equal(route.rules?.showGhost, true, `${mapKey} keeps ghost self-duel enabled`);
        assert.equal(route.rules?.winnerByParcoursComplete, true, `${mapKey} can finish sector on parcours completion`);
        assert.ok(route.finish, `${mapKey} has finish`);
        assert.ok(route.totalCheckpoints >= 7, `${mapKey} has enough route stages`);
        assert.ok(Array.isArray(mapDef?.botSpawns) && mapDef.botSpawns.length > 0, `${mapKey} has bot spawns`);
        assert.ok(Array.isArray(mapDef?.items) && mapDef.items.length > 0, `${mapKey} has item anchors`);
        assert.ok(Array.isArray(mapDef?.missions) && mapDef.missions.some((entry) => entry?.type === 'TIME_TRIAL'), `${mapKey} has a target-time mission`);

        assert.equal(routeIds.has(route.routeId), false, `${mapKey} routeId is unique`);
        routeIds.add(route.routeId);
    }
});

test('V130 branch routes merge forward without cyclic or dangling nextIds', () => {
    for (const mapKey of V130_MAP_KEYS) {
        const route = buildRouteFromParcours(MAP_PRESET_CATALOG[mapKey]?.parcours);
        const stageByCanonicalId = new Map();
        for (const checkpoint of route?.checkpoints || []) {
            const canonicalId = getCanonicalId(checkpoint);
            if (!canonicalId) continue;
            const previous = stageByCanonicalId.get(canonicalId);
            if (!Number.isInteger(previous) || checkpoint.routeIndex < previous) {
                stageByCanonicalId.set(canonicalId, checkpoint.routeIndex);
            }
        }

        for (const checkpoint of route?.checkpoints || []) {
            const currentStage = Number.isInteger(checkpoint?.routeIndex) ? checkpoint.routeIndex : -1;
            for (const nextId of checkpoint?.nextCheckpointIds || []) {
                const targetStage = stageByCanonicalId.get(String(nextId));
                assert.ok(Number.isInteger(targetStage), `${mapKey}:${checkpoint.id} resolves ${nextId}`);
                assert.ok(targetStage > currentStage, `${mapKey}:${checkpoint.id} moves forward to ${nextId}`);
            }
        }

        const branchEntries = (route?.checkpoints || []).filter((checkpoint) => (
            Array.isArray(checkpoint.nextCheckpointIds) && checkpoint.nextCheckpointIds.length > 1
        ));
        for (const branchEntry of branchEntries) {
            const optionMergeIds = branchEntry.nextCheckpointIds.map((optionId) => {
                const option = route.checkpoints.find((checkpoint) => getCanonicalId(checkpoint) === optionId);
                assert.ok(option, `${mapKey}:${branchEntry.id} option ${optionId} exists`);
                assert.equal(option.nextCheckpointIds.length, 1, `${mapKey}:${optionId} declares one merge`);
                return option.nextCheckpointIds[0];
            });
            assert.equal(new Set(optionMergeIds).size, 1, `${mapKey}:${branchEntry.id} options share one merge`);
        }
    }
});

test('V130 authored positions keep spawn, checkpoint radius and segment distances plausible', () => {
    for (const mapKey of V130_MAP_KEYS) {
        const mapDef = MAP_PRESET_CATALOG[mapKey];
        const route = buildRouteFromParcours(mapDef?.parcours);
        const spawn = vec3FromSpawn(mapDef?.playerSpawn);
        const stages = Array.from({ length: route.totalCheckpoints }, () => []);

        for (const checkpoint of route.checkpoints) {
            assert.ok(checkpoint.radius >= 4, `${mapKey}:${checkpoint.id} radius is playable`);
            assert.ok(distance3(spawn, checkpoint.pos) > 1, `${mapKey}:${checkpoint.id} is not on player spawn`);
            stages[checkpoint.routeIndex]?.push(checkpoint);
        }

        for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
            const stage = stages[stageIndex];
            assert.ok(stage.length > 0, `${mapKey} stage ${stageIndex + 1} has checkpoint choices`);
            const previousStage = stageIndex > 0 ? stages[stageIndex - 1] : [{ pos: spawn }];

            for (const checkpoint of stage) {
                const minDistance = Math.min(...previousStage.map((previous) => distance3(previous.pos, checkpoint.pos)));
                assert.ok(minDistance >= 8, `${mapKey}:${checkpoint.id} avoids near-duplicate route points`);
                assert.ok(minDistance <= 90, `${mapKey}:${checkpoint.id} avoids unreadable jumps`);
            }
        }
    }
});

test('V130 arcade pools expose short maps before long routes without changing demo policy', () => {
    const progressionPool = SECTOR_MAP_POOLS.sector_parcours || [];
    const encounterPool = ARCADE_SECTOR_CATALOG.find((entry) => entry.id === 'sector_parcours')?.mapPool || [];
    assert.deepEqual(encounterPool, progressionPool);

    for (const mapKey of V130_MAP_KEYS) {
        assert.ok(progressionPool.includes(mapKey), `${mapKey} is available to arcade parcours sectors`);
    }

    const firstLongIndex = Math.min(...progressionPool
        .map((mapKey, index) => (LONG_MAPS.has(mapKey) ? index : Number.POSITIVE_INFINITY)));
    const lastShortMidIndex = Math.max(...progressionPool
        .map((mapKey, index) => (SHORT_AND_MID_MAPS.has(mapKey) ? index : -1)));
    assert.ok(lastShortMidIndex < firstLongIndex, 'short and medium V130 maps enter pool before long routes');
});
