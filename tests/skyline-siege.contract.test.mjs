import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { loadGLBMap, loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { MapBreakSceneController } from '../src/entities/arena/MapBreakSceneController.js';
import { resolveMapAssetJobs } from '../scripts/map-asset-jobs.mjs';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const KEY = 'skyline_siege';
const MAP = MAP_PRESET_CATALOG[KEY];

function readGlb(path) {
    const bytes = readFileSync(path);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${path} has the GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${path} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${path} starts with a JSON chunk`);
    return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

test('Skyline Siege is registered with three valid HUNT destructible buildings', () => {
    assert.ok(MAP);
    assert.equal(MAP_PRESETS_BASE[KEY], MAP, 'the map picker/runtime base list exposes the preset');
    const definition = normalizeMapDestructibles(MAP.destructibles);
    assert.ok(definition);
    assert.deepEqual(definition.gameModes, ['HUNT']);
    assert.deepEqual(definition.segments.map((segment) => segment.id), ['spire', 'crown', 'arcology']);
    assert.deepEqual(definition.breakScenes.map((scene) => scene.trigger.segmentId), ['spire', 'crown', 'arcology']);
    for (const scene of definition.breakScenes) {
        assert.equal(scene.hideModelIds.length, 1);
        assert.ok(MAP.glbModels.some((model) => model.id === scene.modelId && model.hiddenUntilTriggered));
    }
    assert.ok(MAP.singlePlayerScenario.enabled);
    assert.equal(MAP.singlePlayerScenario.gameMode, 'HUNT');
    assert.ok(definition.segments.every((segment) => segment.kind === 'masonry'));
    assert.deepEqual(definition.segments.map((segment) => segment.piece), [
        'spire_tower', 'crown_tower', 'arcology_tower',
    ]);
    assert.deepEqual(resolveMapPickerCollection(KEY).id, 'adventure');
});

test('Skyline Siege resolves to its deterministic Blender asset job', () => {
    const plan = resolveMapAssetJobs({ mapKeys: [KEY], all: false, part: undefined });
    assert.deepEqual(plan.nativeMaps, []);
    assert.equal(plan.jobs.length, 1);
    assert.equal(plan.jobs[0].pack, KEY);
    assert.equal(plan.jobs[0].script, 'generate_skyline_siege_assets.py');
    assert.deepEqual(plan.jobs[0].parts, ['00_static_backdrop', '01_arcology', '01_crown', '01_spire',
        '20_arcology_collapse', '20_crown_collapse', '20_spire_collapse']);
});

test('the static skyline backdrop frames the arena without adding collision bodies', async () => {
    const descriptor = MAP.glbModels.find((model) => model.id === 'skyline-static-backdrop');
    assert.ok(descriptor);
    assert.equal(descriptor.collision, false);
    assert.equal(descriptor.scale, 0.2);
    const blendPath = `assets/maps/${KEY}/blender/00_static_backdrop.blend`;
    const glbPath = `assets/maps/${KEY}/glb/00_static_backdrop.glb`;
    assert.ok(existsSync(blendPath));
    const gltf = readGlb(glbPath);
    assert.equal(gltf.animations?.length || 0, 0, 'the backdrop stays static');
    assert.ok(gltf.nodes.filter((node) => node.name?.includes('skyline_backdrop_')).length >= 60);
    assert.ok(gltf.nodes.filter((node) => node.name?.includes('skyline_backdrop_'))
        .every((node) => node.name.includes('_nocol')));

    const loaded = await loadGLBMapCollection([descriptor], {
        loader: geometryOnlyGlbLoader, colliderMode: 'scene',
    });
    try {
        assert.ok(loaded.scene.getObjectByName('glb-slot-skyline-static-backdrop'));
        assert.equal(loaded.colliders.length, 0);
        const bounds = new THREE.Box3().setFromObject(loaded.scene).getSize(new THREE.Vector3());
        assert.ok(bounds.x > 120 && bounds.x < 170, `backdrop width ${bounds.x} leaves a center arena`);
        assert.ok(bounds.z > 120 && bounds.z < 170, `backdrop depth ${bounds.z} leaves a center arena`);
    } finally {
        disposeObject3DResources(loaded.scene);
    }
});

test('Skyline authoring and runtime assets preserve each part and collapse clip', () => {
    const expected = [
        ['spire', 'SkylineSpireCollapseOnce'], ['crown', 'SkylineCrownCollapseOnce'],
        ['arcology', 'SkylineArcologyCollapseOnce'],
    ];
    for (const [key, clip] of expected) {
        for (const [stem, animated] of [[`01_${key}`, false], [`20_${key}_collapse`, true]]) {
            const blendPath = `assets/maps/${KEY}/blender/${stem}.blend`;
            const glbPath = `assets/maps/${KEY}/glb/${stem}.glb`;
            assert.ok(existsSync(blendPath), `${blendPath} exists`);
            assert.ok(statSync(blendPath).size > 1000, `${blendPath} is a Blender source file`);
            const gltf = readGlb(glbPath);
            assert.ok(gltf.nodes.some((node) => node.name?.startsWith(`skyline_${key}`)), `${glbPath} preserves the building role`);
            assert.equal(gltf.animations?.length > 0, animated, `${glbPath} animation presence`);
            if (animated) assert.ok(gltf.animations.some((action) => action.name === clip), `${clip} is exported`);
        }
    }
});

test('the engine GLB loader keeps tower colliders and plays each fall above street level', async () => {
    for (const [key, label, height] of [
        ['spire', 'Spire', 68], ['crown', 'Crown', 58], ['arcology', 'Arcology', 51],
    ]) {
        const intact = await loadGLBMap(`assets/maps/${KEY}/glb/01_${key}.glb`, {
            loader: geometryOnlyGlbLoader, colliderMode: 'scene', modelId: `skyline-${key}-intact`,
        });
        try {
            assert.ok(intact.colliders.length >= 1, `${key} has a gameplay collider`);
            const initial = new THREE.Box3().setFromObject(intact.scene).getSize(new THREE.Vector3());
            assert.ok(initial.y > initial.x, `${key} starts upright in the engine (x=${initial.x}, y=${initial.y})`);
        } finally {
            disposeObject3DResources(intact.scene);
        }

        const collapse = await loadGLBMap(`assets/maps/${KEY}/glb/20_${key}_collapse.glb`, {
            loader: geometryOnlyGlbLoader, colliderMode: 'scene', modelId: `skyline-${key}-collapse`,
            animationClock: { mode: 'once', clipName: `Skyline${label}CollapseOnce` },
        });
        try {
            const track = collapse.animationTracks[0];
            assert.ok(track, `${key} collapse clip reaches the runtime`);
            assert.equal(track.clipName, `Skyline${label}CollapseOnce`);
            const initial = new THREE.Box3().setFromObject(collapse.scene).getSize(new THREE.Vector3());
            track.action.time = track.durationSeconds;
            track.mixer.update(0);
            collapse.scene.updateMatrixWorld(true);
            const wreck = new THREE.Box3().setFromObject(collapse.scene);
            const final = wreck.getSize(new THREE.Vector3());
            assert.ok(final.y < initial.y * 0.6, `${key} falls below half height`);
            assert.ok(wreck.max.y > -height * 0.5, `${key} wreck remains near the street plane`);
            assert.ok(collapse.colliders.some((collider) => collider.dynamic), `${key} wreck colliders move`);
        } finally {
            disposeObject3DResources(collapse.scene);
        }
    }
});

test('real damage and break-scene controllers break all towers independently and reset', async () => {
    const loaded = await loadGLBMapCollection(MAP.glbModels, {
        loader: geometryOnlyGlbLoader, colliderMode: 'scene',
    });
    const arena = {
        currentMapDefinition: MAP,
        _glbScene: loaded.scene,
        obstacles: loaded.colliders,
        _glbDynamicObstacles: [],
        glbAnimationElapsedSeconds: 0,
        setMapFireState() {},
    };
    const entityManager = {
        arena,
        gameModeStrategy: { modeType: 'HUNT' },
        runtimeRng: { int: () => 0 },
    };
    const driver = { setTrackStart() {} };
    const controller = new MapBreakSceneController(arena, loaded.colliders, driver);
    arena.applyMapDestructibleEvents = (events) => controller.applyEvents(events);
    arena.resetMapDestructibleScenes = () => controller.reset();
    const system = new MapDestructibleSystem(entityManager);
    const slots = (key) => ({
        intact: arena._glbScene.getObjectByName(`glb-slot-skyline-${key}-intact`),
        collapse: arena._glbScene.getObjectByName(`glb-slot-skyline-${key}-collapse`),
    });

    try {
        assert.equal(system.startRound(), 3);
        for (const [step, [key, prefix]] of [
            ['spire', 'skyline_spire_structure'],
            ['crown', 'skyline_crown_structure'],
            ['arcology', 'skyline_arcology_structure'],
        ].entries()) {
            const intactBefore = slots(key);
            assert.equal(intactBefore.intact.visible, true);
            assert.equal(intactBefore.collapse.visible, false);
            const segment = system.getState().segments.find((entry) => entry.id === key);
            const result = system.applyMeshHit(prefix, segment.hp, {
                hitDirection: { x: 1, y: 0, z: 0 }, cause: 'MG_BULLET',
            });
            assert.equal(result?.destroyed, true, `${key} takes lethal damage`);
            assert.equal(result.event.kind, 'masonry', `${key} does not seal the remaining towers`);
            assert.equal(system.getState().sealed, false);
            assert.deepEqual(system.getState().segments.map((entry) => entry.destroyed),
                ['spire', 'crown', 'arcology'].map((_, index) => index <= step));
            assert.equal(controller.appliedSceneCount, system.getState().events.length);
            assert.equal(intactBefore.intact.visible, false);
            assert.equal(intactBefore.collapse.visible, true);
        }

        assert.deepEqual(system.getState().events.map((event) => event.segmentId), [
            'spire', 'crown', 'arcology',
        ]);
        assert.equal(system.startRound(), 3);
        assert.equal(system.getState().sealed, false);
        assert.equal(system.getState().events.length, 0);
        assert.ok(system.getState().segments.every((entry) => !entry.destroyed));
        assert.equal(controller.appliedSceneCount, 0);
        for (const key of ['spire', 'crown', 'arcology']) {
            assert.equal(slots(key).intact.visible, true);
            assert.equal(slots(key).collapse.visible, false);
        }
    } finally {
        disposeObject3DResources(loaded.scene);
    }
});
