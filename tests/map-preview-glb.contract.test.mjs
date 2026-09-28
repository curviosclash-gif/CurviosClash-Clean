import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import {
    createMapPreviewGlbLayer,
    resolveMapPreviewGlbSource,
} from '../src/ui/start-setup/MapPreviewGlbLayer.js';
import {
    measureVisibleBounds,
    resolvePreviewCameraFit,
} from '../src/ui/start-setup/MapPreviewFraming.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

function fakeScene(name) {
    const scene = new THREE.Group();
    scene.name = name;
    return scene;
}

function assertBoundsInView(bounds, aspect) {
    const fit = resolvePreviewCameraFit(bounds, { fovDegrees: 42, aspect });
    const camera = new THREE.PerspectiveCamera(42, aspect, fit.near, fit.far);
    camera.position.copy(fit.position);
    camera.lookAt(fit.target);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const { min, max } = bounds;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        assert.ok(frustum.containsPoint(new THREE.Vector3(x, y, z)), `corner ${x},${y},${z} leaves the frame`);
    }
    return fit;
}

test('preview loads only models that are drawn before a round starts', () => {
    const source = resolveMapPreviewGlbSource({
        glbModels: [
            { id: 'tower', url: 'assets/maps/a/glb/tower.glb' },
            { id: 'collapse', url: 'assets/maps/a/glb/collapse.glb', hiddenUntilTriggered: true },
            { id: 'trunk', url: 'assets/maps/a/glb/trunk.glb', collisionOnly: true },
            'assets/maps/a/glb/plain.glb',
        ],
    });
    assert.equal(source.kind, 'collection');
    assert.deepEqual(source.models.map((entry) => entry.id || entry), ['tower', 'assets/maps/a/glb/plain.glb']);

    assert.deepEqual(resolveMapPreviewGlbSource({ glbModel: ' assets/maps/b.glb ' }), { kind: 'single', url: 'assets/maps/b.glb' });
    assert.equal(resolveMapPreviewGlbSource({ glbModels: [{ url: 'x.glb', hiddenUntilTriggered: true }] }), null);
    assert.equal(resolveMapPreviewGlbSource({ obstacles: [] }), null);
});

test('every preset with authored models keeps a visible model and drops its break scenes', () => {
    const glbMaps = Object.entries(MAP_PRESET_CATALOG)
        .filter(([, map]) => Array.isArray(map?.glbModels) && map.glbModels.length > 0);
    assert.ok(glbMaps.length >= 20, `expected the GLB map family, found ${glbMaps.length}`);
    for (const [key, map] of glbMaps) {
        const source = resolveMapPreviewGlbSource(map);
        assert.ok(source?.models?.length > 0, `${key} would show no model in the preview`);
        for (const entry of source.models) {
            assert.notEqual(entry?.hiddenUntilTriggered, true, `${key} loads a break scene`);
        }
    }
    const reactorUrls = resolveMapPreviewGlbSource(MAP_PRESET_CATALOG.reactor_site).models.map((entry) => entry.url);
    assert.ok(reactorUrls.every((url) => !/torus_cloud/.test(url)), 'the reactor preview must not download the cloud scenes');
});

test('a newer request makes an unfinished load stale and disposes its scene', async () => {
    const pending = [];
    const disposed = [];
    const layer = createMapPreviewGlbLayer({
        loadCollection: (models) => {
            const entry = deferred();
            pending.push({ models, ...entry });
            return entry.promise;
        },
        disposeScene: (scene) => disposed.push(scene.name),
    });
    const first = layer.load({ glbModels: [{ id: 'old', url: 'old.glb' }] });
    const second = layer.load({ glbModels: [{ id: 'new', url: 'new.glb' }] });
    pending[0].resolve({ scene: fakeScene('old-scene'), warnings: [] });
    pending[1].resolve({ scene: fakeScene('new-scene'), warnings: [] });

    assert.deepEqual(await first, { status: 'stale' });
    const current = await second;
    assert.equal(current.status, 'ready');
    assert.equal(current.scene.name, 'new-scene');
    assert.deepEqual(disposed, ['old-scene']);

    const parent = new THREE.Group();
    parent.add(current.scene);
    layer.release();
    assert.equal(current.scene.parent, null, 'release detaches the scene from the miniature');
    assert.deepEqual(disposed, ['old-scene', 'new-scene']);
});

test('load failures and released requests report their own outcome', async () => {
    const failing = createMapPreviewGlbLayer({ loadCollection: async () => { throw new Error('404'); } });
    assert.deepEqual(await failing.load({ glbModels: ['missing.glb'] }), { status: 'failed' });
    assert.deepEqual(await failing.load({ obstacles: [] }), { status: 'none' });

    const gate = deferred();
    const disposed = [];
    const released = createMapPreviewGlbLayer({
        loadCollection: () => gate.promise,
        disposeScene: (scene) => disposed.push(scene.name),
    });
    const outcome = released.load({ glbModels: ['a.glb'] });
    released.release();
    gate.resolve({ scene: fakeScene('late'), warnings: [] });
    assert.deepEqual(await outcome, { status: 'stale' });
    assert.deepEqual(disposed, ['late'], 'a load finishing after release must not leak its scene');
});

test('single-model maps shrink to authored units and collision-only obstacles follow the game rule', async () => {
    const single = createMapPreviewGlbLayer({
        loadSingle: async () => ({ scene: fakeScene('single') }),
    });
    const outcome = await single.load({ glbModel: 'assets/maps/custom.glb' });
    assert.equal(outcome.status, 'ready');
    assert.ok(Math.abs(outcome.scene.scale.x - 1 / 3) < 1e-9, 'world-scale model is not divided by MAP_SCALE');

    const collection = createMapPreviewGlbLayer({
        loadCollection: async () => ({ scene: fakeScene('c'), warnings: [] }),
    });
    const hides = await collection.load({ glbModels: ['a.glb'], glbAuthoredObstaclesCollisionOnly: true });
    assert.equal(hides.hideAuthoredObstacles, true);
    const keeps = await collection.load({ glbModels: ['a.glb'] });
    assert.equal(keeps.hideAuthoredObstacles, false);
});

test('camera fit keeps flat, tall and narrow views fully in frame', () => {
    const flat = new THREE.Box3(new THREE.Vector3(-2.4, 0, -2.4), new THREE.Vector3(2.4, 0.4, 2.4));
    const tall = new THREE.Box3(new THREE.Vector3(-0.8, 0, -0.8), new THREE.Vector3(0.8, 7, 0.8));
    const flatFit = assertBoundsInView(flat, 1.6);
    const tallFit = assertBoundsInView(tall, 1.6);
    assertBoundsInView(tall, 0.5);
    assert.ok(tallFit.target.y > flatFit.target.y, 'a tall map is framed around its own centre');
    assert.ok(tallFit.maxDistance > tallFit.distance && tallFit.minDistance < tallFit.distance);
    assert.ok(tallFit.far > tallFit.maxDistance, 'zooming out must not clip the map');
});

test('hidden parts stay out of the framed bounds', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    root.add(new THREE.Mesh(geometry));
    const hiddenSlot = new THREE.Group();
    hiddenSlot.visible = false;
    const lyingTower = new THREE.Mesh(geometry);
    lyingTower.position.x = 50;
    hiddenSlot.add(lyingTower);
    root.add(hiddenSlot);
    const arenaOutline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry));
    arenaOutline.scale.set(1, 40, 1);
    root.add(arenaOutline);

    const bounds = measureVisibleBounds(root);
    assert.equal(bounds.max.x, 0.5);
    assert.equal(bounds.max.y, 0.5, 'the empty sky inside the arena outline must not widen the frame');
    assert.ok(measureVisibleBounds(new THREE.Group()).isEmpty());
});

test('a real siege map loads its standing tower for the preview', async () => {
    const map = MAP_PRESET_CATALOG.eiffel_tower_siege;
    const layer = createMapPreviewGlbLayer({
        loadCollection: (models, options) => loadGLBMapCollection(models, { ...options, loader: geometryOnlyGlbLoader }),
    });
    const outcome = await layer.load(map);
    assert.equal(outcome.status, 'ready');
    const bounds = measureVisibleBounds(outcome.scene);
    assert.ok(!bounds.isEmpty());
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.y > size.x * 0.5, `the standing tower should be tall, got ${size.toArray().map((v) => v.toFixed(1))}`);
    assertBoundsInView(bounds, 1.6);
    layer.release();
});
