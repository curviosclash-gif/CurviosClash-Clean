import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { EditorAssetLoader } from '../editor/js/EditorAssetLoader.js';
import { AircraftMesh } from '../src/entities/aircraft-mesh.js';
import { RuntimeModularVehicleMesh } from '../src/entities/runtime-modular-vehicle-mesh.js';
import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';

function createTestAssetObject() {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    ));
    return group;
}

test('EditorAssetLoader soft timeout does not poison a later successful cache fill', async () => {
    const loader = new EditorAssetLoader({ timeoutMs: 10, maxConcurrentLoads: 1 });
    loader.glbModelById.set('demo_asset', { id: 'demo_asset', url: '/demo.obj' });
    let hydratedTarget = null;
    let hydratedReplacement = null;
    loader.setCloneHydrationHandler((target, replacement) => {
        hydratedTarget = target;
        hydratedReplacement = replacement;
    });
    loader.loader = {
        load(_url, onLoad) {
            setTimeout(() => onLoad(createTestAssetObject()), 25);
        },
    };

    const result = await loader._loadModelWithTimeout('demo_asset', '/demo.obj');
    assert.equal(result.status, 'timeout');
    const placedPlaceholder = loader.getClone('demo_asset');
    assert.equal(placedPlaceholder.userData.isEditorPlaceholder, true);

    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(loader.loadStatus.get('demo_asset')?.state, 'loaded');
    assert.equal(loader.getClone('demo_asset').userData.isEditorPlaceholder, false);
    assert.equal(hydratedTarget, placedPlaceholder);
    assert.equal(hydratedReplacement.userData.isEditorPlaceholder, false);
});

test('EditorAssetLoader loadAll respects maxConcurrentLoads', async () => {
    const loader = new EditorAssetLoader({ timeoutMs: 200, maxConcurrentLoads: 2 });
    loader.modelsToLoad = ['asset_a', 'asset_b', 'asset_c', 'asset_d'];
    loader.jetsToLoad = [];
    loader.portalModelsToLoad = [];
    loader.trailModelsToLoad = [];

    let activeLoads = 0;
    let peakLoads = 0;
    loader.loader = {
        load(_url, onLoad) {
            activeLoads += 1;
            peakLoads = Math.max(peakLoads, activeLoads);
            setTimeout(() => {
                activeLoads -= 1;
                onLoad(createTestAssetObject());
            }, 20);
        },
    };

    const summary = await loader.loadAll();
    assert.equal(summary.loaded, 4);
    assert.ok(peakLoads <= 2);
});

test('EditorAssetLoader rejects empty GLB bounds before they reach rendering', () => {
    const loader = new EditorAssetLoader();
    assert.throws(
        () => loader._prepareGLBScene('empty_glb', { scene: new THREE.Group() }),
        /invalid geometry bounds/,
    );
});

test('ModularVehicleMesh rebuild disposes transient compound geometries', () => {
    const mesh = new ModularVehicleMesh({
        parts: [
            { name: 'Engine', geo: 'engine', size: [0.28, 0.28, 0.5] },
            { name: 'Shield', geo: 'forcefield', size: [0.06, 0.06, 1.2] },
            { name: 'Flame', geo: 'flame', size: [0.15, 0.01, 0.5] },
        ],
    });

    const trackedGeometries = Array.from(mesh.dynamicGeometries);
    assert.ok(trackedGeometries.length > 0);

    let disposeCalls = 0;
    for (const geometry of trackedGeometries) {
        const originalDispose = geometry.dispose.bind(geometry);
        geometry.dispose = () => {
            disposeCalls += 1;
            originalDispose();
        };
    }

    mesh.build();

    assert.equal(disposeCalls, trackedGeometries.length);
    assert.ok(mesh.dynamicGeometries.size > 0);
    mesh.dispose();
});

test('runtime product vehicle preserves its base mesh and authored attachments', () => {
    const baseMesh = new AircraftMesh(0x60a5fa);
    const mesh = new RuntimeModularVehicleMesh(0x60a5fa, {
        baseVehicleId: 'aircraft',
        baseTransform: { pos: [1, 2, 3], rot: [0, 15, 0], scale: [1.2, 1.2, 1.2] },
        parts: [{ name: 'Developer Attachment', geo: 'box', pos: [0, 1, 0] }],
    }, { baseMesh });

    assert.equal(mesh.baseMesh, baseMesh);
    assert.deepEqual(baseMesh.position.toArray(), [1, 2, 3]);
    assert.ok(mesh.children.some((child) => child.userData.config?.name === 'Developer Attachment'));
    mesh.build();
    assert.equal(mesh.baseMesh, baseMesh);
    mesh.dispose();
});
