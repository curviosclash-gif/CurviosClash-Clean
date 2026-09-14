import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { CONFIG_BASE } from '../src/core/Config.js';
import {
    LEGACY_PICKUP_MODEL_TYPES,
    PowerupAuthoredModelCache,
} from '../src/entities/PowerupAuthoredModelCache.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { getPickupTypes } from '../src/entities/PickupRegistry.js';
import { resolveBlenderPickupModel } from '../src/entities/powerup/PowerupVisualCatalog.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const GLB_URL = new URL('../assets/items/glb/pickup_library.glb', import.meta.url);
const BASELINES = Object.freeze({
    SPEED_UP: 1.755, SLOW_DOWN: 2.404, THICK: 1.590, THIN: 1.305,
    SHIELD: 1.860, HEALTH: 1.290, MG_TURRET: 1.874, ROCKET_TURRET: 1.934,
    SLOW_TIME: 1.590, GHOST: 1.860, INVERT: 1.590, FOG: 2.053,
    FAN_3: 2.311, FAN_4: 2.230, FAN_5: 2.311, TRAIL_GAP: 1.603,
    EMP: 1.860, MAGNET: 1.350, DECOY: 1.942, PURGE: 1.590, SWAP: 1.590,
    MINE: 1.739, ROCKET_WEAK: 1.915, ROCKET_MEDIUM: 2.176,
    ROCKET_HEAVY: 2.480, ROCKET_MEGA: 3.206,
});

async function parseLibrary() {
    const bytes = await readFile(GLB_URL);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new GLTFLoader().parseAsync(buffer, '');
}

function metrics(root) {
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(root).getSize(size);
    let triangles = 0;
    let drawCalls = 0;
    const materials = new Set();
    root.traverse((node) => {
        if (!node.isMesh) return;
        drawCalls += 1;
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    return { size, triangles, drawCalls, materials };
}

test('real pickup GLB contains every semantic and legacy root within render budgets', async () => {
    const gltf = await parseLibrary();
    const expected = [...getPickupTypes(), ...LEGACY_PICKUP_MODEL_TYPES];
    assert.equal(gltf.scene.children.filter((child) => child.name.startsWith('pickup_')).length, expected.length);

    for (const identifier of expected) {
        const root = gltf.scene.getObjectByName(`pickup_${identifier}`);
        assert.ok(root, `${identifier} root exists`);
        const { size, triangles, drawCalls, materials } = metrics(root);
        assert.ok(size.toArray().every(Number.isFinite), `${identifier} has finite bounds`);
        assert.ok(Math.max(...size) > 0, `${identifier} has visible geometry`);
        assert.ok(triangles <= 2500, `${identifier} stays below 2500 triangles (${triangles})`);
        assert.ok(drawCalls <= 6, `${identifier} stays at six draw calls (${drawCalls})`);
        assert.ok(materials.size <= 4, `${identifier} stays at four materials (${materials.size})`);
        if (BASELINES[identifier]) {
            const ratio = Math.max(...size) / BASELINES[identifier];
            assert.ok(Math.abs(ratio - 1.75) < 0.015, `${identifier} scale is 1.75x (${ratio})`);
            assert.ok(triangles >= 400, `${identifier} reaches the authored detail target (${triangles})`);
        }
    }

    for (const [type, markerCount] of [['ROCKET_WEAK', 0], ['ROCKET_MEDIUM', 1], ['ROCKET_HEAVY', 2], ['ROCKET_MEGA', 3]]) {
        const root = gltf.scene.getObjectByName(`pickup_${type}`);
        assert.equal(root.userData.rocketTier, type.slice('ROCKET_'.length));
        assert.equal(root.userData.tierMarkers, markerCount);
    }
    for (const count of [3, 4, 5]) {
        const root = gltf.scene.getObjectByName(`pickup_FAN_${count}`);
        assert.equal(root.userData.fanProjectiles, count);
        assert.equal(root.userData.markerText, `×${count}`);
        let label = null;
        root.traverse((node) => { if (node.userData.weaponFanLabel === true) label = node; });
        assert.ok(label, `×${count} exposes a label node`);
        assert.equal(label.userData.weaponFanLabel, true);
        assert.equal(label.userData.markerText, `×${count}`);
        assert.ok(metrics(label).triangles > 0, `×${count} label uses real geometry`);
    }
});

test('GLB cache loads once and shares geometry and semantic materials across clones', async () => {
    const gltf = await parseLibrary();
    let loads = 0;
    const cache = new PowerupAuthoredModelCache(1.5, {
        loader: { loadAsync: async () => { loads += 1; return gltf; } },
        libraryUrl: 'memory://pickup-library.glb',
    });
    try {
        const [first, second] = await Promise.all([
            cache.createModel('pickup_SHIELD', 0x4488ff),
            cache.createModel('pickup_SHIELD', 0x4488ff),
        ]);
        assert.equal(loads, 1);
        assert.equal(first.userData.blenderPickupModel, 'SHIELD');
        const firstMeshes = [];
        const secondMeshes = [];
        first.traverse((node) => { if (node.isMesh) firstMeshes.push(node); });
        second.traverse((node) => { if (node.isMesh) secondMeshes.push(node); });
        assert.deepEqual(firstMeshes.map((mesh) => mesh.geometry), secondMeshes.map((mesh) => mesh.geometry));
        assert.deepEqual(firstMeshes.map((mesh) => mesh.material), secondMeshes.map((mesh) => mesh.material));
        assert.ok([...cache.templates.values()].every((root) => {
            let empty = true;
            root.traverse((node) => { if (node.isMesh && node.material !== null) empty = false; });
            return empty;
        }), 'unused source materials are released');
    } finally {
        cache.dispose();
    }
});

test('visual resolver preserves rocket tiers and honors valid authored shape overrides', () => {
    assert.equal(resolveBlenderPickupModel('ROCKET_HEAVY', { model: 'item_rocket' }), 'pickup_ROCKET_HEAVY');
    assert.equal(resolveBlenderPickupModel('ROCKET_HEAVY', { model: 'item_star' }), 'pickup_item_star');
    assert.equal(resolveBlenderPickupModel('SHIELD', { model: 'unknown', type: 'item_gem' }), 'pickup_item_gem');
    assert.equal(resolveBlenderPickupModel('SHIELD', { model: 'unknown', type: 'unknown' }), 'pickup_SHIELD');
});

test('all manager spawn paths request one authored model and preserve a predicted hidden state', async () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const scene = new THREE.Scene();
    const renderer = { addToScene: (mesh) => scene.add(mesh), removeFromScene: (mesh) => scene.remove(mesh) };
    const manager = new PowerupManager(renderer, {}, entityRuntimeConfig);
    const requested = [];
    let resolveDelayed;
    manager._authoredModelCache = {
        createModel(identifier, _color, metadata) {
            requested.push([identifier, metadata]);
            if (identifier === 'pickup_SHIELD') {
                return new Promise((resolve) => { resolveDelayed = resolve; });
            }
            const model = new THREE.Group();
            model.userData.blenderPickupModel = identifier.slice('pickup_'.length);
            return Promise.resolve(model);
        },
        dispose() {},
    };
    try {
        const anchored = manager.spawnAtAnchor({ type: 'HEALTH', ownerId: 'owner', x: 1, y: 2, z: 3 });
        await Promise.resolve();
        await Promise.resolve();
        assert.ok(requested.some(([name]) => name === 'pickup_HEALTH'));
        assert.equal(anchored.mesh.userData.blenderPickupModel, 'HEALTH');

        manager.arena = { getRandomPosition: () => new THREE.Vector3(30, 0, 0) };
        const beforeRandom = requested.length;
        manager._spawnRandom();
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(requested.length, beforeRandom + 1, 'local random spawn requests its semantic GLB root');

        manager.applyNetworkSnapshot([{ id: 'remote', type: 'FAN_4', pos: [4, 5, 6], visible: true }]);
        await Promise.resolve();
        await Promise.resolve();
        assert.ok(requested.some(([name]) => name === 'pickup_FAN_4'));

        manager.setNetworkReplica(false);
        const shieldConfig = entityRuntimeConfig.POWERUP.TYPES.SHIELD;
        const fallback = manager._createPowerupMesh('SHIELD', shieldConfig);
        fallback.visible = false;
        fallback.scale.set(.6, .6, .6);
        const shield = {
            mesh: fallback, type: 'SHIELD', box: new THREE.Box3(), baseY: 0, phase: 0,
            telegraphRemaining: 0, predictedCollected: true, predictionAge: 0,
            animationKind: 'pulse', baseScaleX: 1, baseScaleY: 1, baseScaleZ: 1,
        };
        manager.items.push(shield);
        manager._applyAuthoredItemModel(shield, null, shieldConfig);
        const authored = new THREE.Group();
        authored.scale.setScalar(2);
        resolveDelayed(authored);
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(shield.mesh, authored);
        assert.equal(authored.visible, false, 'late authored model cannot reveal a predicted pickup');
        assert.equal(authored.scale.x, 1.2, 'current pulse/telegraph ratio survives the swap');
        assert.equal(shield.baseScaleX, 2);
    } finally {
        manager.dispose();
    }
});

test('a failed GLB request leaves the immediately visible procedural fallback in place', async () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const manager = new PowerupManager({ addToScene() {}, removeFromScene() {} }, {}, entityRuntimeConfig);
    manager._authoredModelCache = { createModel: async () => null, dispose() {} };
    const fallback = manager._createPowerupMesh('HEALTH', entityRuntimeConfig.POWERUP.TYPES.HEALTH);
    const item = { mesh: fallback, type: 'HEALTH' };
    manager.items.push(item);
    manager._applyAuthoredItemModel(item, null, entityRuntimeConfig.POWERUP.TYPES.HEALTH);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(item.mesh, fallback);
    manager.dispose();
});

test('disposing while the shared GLB is pending releases eventual geometry once', async () => {
    let resolveLoad;
    const geometry = new THREE.BoxGeometry();
    let disposals = 0;
    geometry.dispose = () => { disposals += 1; };
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    const template = new THREE.Group();
    template.name = 'pickup_SHIELD';
    template.add(new THREE.Mesh(geometry, material));
    root.add(template);
    const cache = new PowerupAuthoredModelCache(1.5, {
        loader: { loadAsync: () => new Promise((resolve) => { resolveLoad = resolve; }) },
    });
    const pending = cache.createModel('pickup_SHIELD', 0x4488ff);
    cache.dispose();
    resolveLoad({ scene: root });
    assert.equal(await pending, null);
    assert.equal(disposals, 1);
});
