import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { DEMOLITION_RUN_TYPE } from '../src/shared/contracts/DemolitionContract.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { ArenaBuilder } from '../src/entities/arena/ArenaBuilder.js';
import { listSkippedBreakSceneModelIds } from '../src/entities/arena/MapBreakSceneLoadPolicy.js';
import { buildArenaSessionKey } from '../src/state/match-session/MatchSessionMapOps.js';

// A break scene is a baked collapse (or the reactor's mushroom cloud): hidden and intangible until
// the map's destructibles trigger it. Maps like eiffel_tower_siege and reactor_site are only
// destructible in some modes, so in the others the scenes are dead weight in memory and load time.
// The decision must be the very one MapDestructibleSystem takes at round start, and it must be
// part of the arena's reuse keys, or a mode switch would reuse an arena with the wrong models.

const session = (activeGameMode, extra = {}) => ({ session: { activeGameMode, ...extra } });

function sceneModelIds(map) {
    const ids = new Set();
    for (const scene of normalizeMapDestructibles(map.destructibles).breakScenes) {
        ids.add(scene.modelId);
        for (const id of scene.modelVariants || []) ids.add(id);
        for (const attachment of scene.attachedModels) ids.add(attachment.modelId);
    }
    return ids;
}

function builtModelIds(mapKey, runtimeConfig) {
    const arena = {
        runtimeConfig,
        entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, MAPS: { standard: MAP_PRESET_CATALOG.standard, [mapKey]: MAP_PRESET_CATALOG[mapKey] } },
        // Lights, fog and the scene are not under test: any other renderer call does nothing.
        renderer: new Proxy({ getGraphicsStyle: () => 'modern', getMaxAnisotropy: () => 1 }, {
            get: (target, name) => (name in target ? target[name] : () => undefined),
        }),
        portalsEnabled: true,
    };
    const builder = new ArenaBuilder(arena);
    builder.geometryPipeline.beginBuildStage = () => {};
    builder.geometryPipeline.compileWallStage = () => {};
    builder._applyArenaBounds = () => {};
    builder._resolveMaterialBundle = () => ({});
    builder._assignArenaMaterials = () => {};
    builder._compileFloorStage = () => {};
    const context = builder.build(mapKey);
    return { ids: context.glbModels.map((entry) => entry.id), signature: context.buildSignature };
}

test('eiffel_tower_siege skips its collapse scenes outside HUNT and keeps them in HUNT', () => {
    const map = MAP_PRESET_CATALOG.eiffel_tower_siege;
    const scenes = sceneModelIds(map);
    assert.ok(scenes.size > 0, 'the map has break scenes');
    assert.deepEqual([...listSkippedBreakSceneModelIds(map, session('CLASSIC'))].sort(), [...scenes].sort());
    assert.deepEqual([...listSkippedBreakSceneModelIds(map, session('arcade'))].sort(), [...scenes].sort());
    assert.equal(listSkippedBreakSceneModelIds(map, session('HUNT')).size, 0);
});

test('the Arcade demolition run and the vault scenario still get the scenes', () => {
    const map = MAP_PRESET_CATALOG.eiffel_tower_siege;
    const demolition = { ...session('ARCADE'), arcade: { enabled: true, runType: DEMOLITION_RUN_TYPE } };
    assert.equal(listSkippedBreakSceneModelIds(map, demolition).size, 0);
    const vault = { ...session('ARCADE', { mapKey: 'eiffel_tower_siege' }), arcade: { scenarioId: 'vault_breaker' } };
    assert.equal(listSkippedBreakSceneModelIds(map, vault).size, 0);
});

test('an unknown mode loads everything, so editor, hangar and tests are unchanged', () => {
    const map = MAP_PRESET_CATALOG.eiffel_tower_siege;
    assert.equal(listSkippedBreakSceneModelIds(map, null).size, 0);
    assert.equal(listSkippedBreakSceneModelIds(map, session('')).size, 0);
});

test('a map destructible in every mode never skips a scene', () => {
    for (const key of ['notre_dame', 'notre_dame_fire', 'notre_dame_arena']) {
        assert.equal(listSkippedBreakSceneModelIds(MAP_PRESET_CATALOG[key], session('CLASSIC')).size, 0, key);
    }
    assert.equal(listSkippedBreakSceneModelIds(MAP_PRESET_CATALOG.standard, session('CLASSIC')).size, 0);
});

test('only the hidden scene models are skipped, the standing tower is not', () => {
    const map = MAP_PRESET_CATALOG.eiffel_tower_siege;
    const skipped = listSkippedBreakSceneModelIds(map, session('CLASSIC'));
    for (const model of map.glbModels) {
        assert.equal(skipped.has(model.id), model.hiddenUntilTriggered === true, model.id);
    }
});

test('reactor_site loads none of its four cloud variants outside HUNT, all four in HUNT', () => {
    const map = MAP_PRESET_CATALOG.reactor_site;
    const clouds = map.glbModels.filter((model) => /torus_cloud_[1-4]\.glb$/.test(model.url)).map((model) => model.id);
    assert.equal(clouds.length, 4);
    const classic = builtModelIds('reactor_site', session('CLASSIC')).ids;
    const hunt = builtModelIds('reactor_site', session('HUNT')).ids;
    for (const id of clouds) {
        assert.ok(!classic.includes(id), `${id} is not loaded in CLASSIC`);
        assert.ok(hunt.includes(id), `${id} is loaded in HUNT`);
    }
    assert.ok(classic.length < hunt.length);
});

test('ArenaBuilder drops the scenes only for the mode that cannot trigger them', () => {
    const scenes = sceneModelIds(MAP_PRESET_CATALOG.eiffel_tower_siege);
    const classic = builtModelIds('eiffel_tower_siege', session('CLASSIC'));
    const hunt = builtModelIds('eiffel_tower_siege', session('HUNT'));
    for (const id of scenes) {
        assert.ok(!classic.ids.includes(id), `${id} is not built in CLASSIC`);
        assert.ok(hunt.ids.includes(id), `${id} is built in HUNT`);
    }
    assert.notEqual(classic.signature, hunt.signature, 'a mode switch must not reuse the other mode\'s arena');
    const plainClassic = builtModelIds('standard', session('CLASSIC')).signature;
    const plainHunt = builtModelIds('standard', session('HUNT')).signature;
    assert.equal(plainClassic, plainHunt, 'a map without break scenes keeps one build for every mode');
});

test('the prewarmed arena key tells the modes apart only where the models differ', () => {
    const resolve = (effectiveMapKey) => ({ effectiveMapKey, mapDefinition: MAP_PRESET_CATALOG[effectiveMapKey] });
    const key = (mapKey, mode) => buildArenaSessionKey(resolve(mapKey), session(mode), true, 'modern');
    assert.notEqual(key('eiffel_tower_siege', 'CLASSIC'), key('eiffel_tower_siege', 'HUNT'));
    assert.equal(key('eiffel_tower_siege', 'CLASSIC'), key('eiffel_tower_siege', 'ARCADE'));
    assert.equal(key('standard', 'CLASSIC'), key('standard', 'HUNT'));
});
