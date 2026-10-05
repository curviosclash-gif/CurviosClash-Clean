import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FALKENWACHT_MODELS } from '../src/core/config/maps/presets/burg_falkenwacht/FalkenwachtModels.js';
import { FALKENWACHT_PROP_MODELS } from '../src/core/config/maps/presets/burg_falkenwacht/FalkenwachtProps.js';
import { FALKENWACHT_MAPS } from '../src/core/config/maps/presets/burg_falkenwacht/index.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';

test('both Falkenwacht modes expose ivy v01 on the courtyard side of the actual masonry', async () => {
    const ivy = FALKENWACHT_PROP_MODELS.find((model) => model.id === 'falkenwacht-wall-ivy-v01');
    const gltfLoader = new GLTFLoader();
    const collection = await loadGLBMapCollection([...FALKENWACHT_MODELS, ivy], {
        loader: { async loadAsync(url) {
            const bytes = readFileSync(url);
            return gltfLoader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
        } },
        placementScale: 1,
        colliderMode: 'scene',
    });
    assert.equal(collection.warnings.length, 0);
    const plant = collection.scene.getObjectByName(`glb-slot-${ivy.id}`);
    assert.ok(plant);
    collection.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(plant);
    const curtain = collection.scene.getObjectByName('glb-slot-falkenwacht-02_curtain');
    const front = plant.localToWorld(new THREE.Vector3(0, 0, 1))
        .sub(plant.getWorldPosition(new THREE.Vector3())).normalize();
    assert.ok(front.z < -0.99, 'the leaf fronts face into the courtyard');
    assert.ok(bounds.min.x > 46, 'the plant clears the adjoining gatehouse tower and balcony');
    assert.ok(bounds.max.z < 115, 'the entire plant clears the south curtain wall');
    assert.ok(115 - bounds.max.z < 0.1, 'the growth stays attached to its supporting wall face');
    assert.ok(Math.abs(bounds.min.y - 12) < 1e-5, 'the root remains on the original courtyard ground');
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - 14) < 1e-5, 'the original plant size is preserved');

    const castleMeshes = [];
    for (const slot of collection.scene.children) {
        if (slot === plant) continue;
        slot.traverse((node) => { if (node.isMesh) castleMeshes.push(node); });
    }
    const leafMeshes = [];
    plant.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (materials.some((material) => /^Ivy(?:Light|Dry)?$/.test(material.name))) leafMeshes.push(node);
    });
    assert.ok(leafMeshes.length > 0, 'actual exported leaf geometry is loaded');
    const ray = new THREE.Raycaster();
    let visible = 0;
    let samples = 0;
    const blocked = [];
    for (const mesh of leafMeshes) {
        const positions = mesh.geometry.attributes.position;
        for (let index = 0; index < positions.count; index += 7) {
            const point = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index));
            ray.set(point.clone().addScaledVector(front, 10), front.clone().negate());
            ray.far = 10 - 1e-4;
            samples += 1;
            const hits = ray.intersectObjects(castleMeshes, false);
            if (hits.length === 0) visible += 1;
            else if (blocked.length < 8) blocked.push({ plant: point.toArray(), hit: hits[0].point.toArray(), name: hits[0].object.name });
            ray.far = 11;
            const support = ray.intersectObjects(castleMeshes, false)[0];
            assert.ok(support && support.distance >= 10 - 1e-4 && support.distance < 10.4,
                'every sampled leaf remains just in front of actual supporting masonry');
        }
    }
    assert.ok(visible / samples > 0.98, `${visible}/${samples} actual leaf samples are not hidden by masonry ${JSON.stringify(blocked)}`);
    assert.ok(curtain, 'the visibility test includes the real curtain-wall GLB');
    assert.ok(collection.colliders.length > 0);
    assert.ok(collection.colliders.every((entry) => entry.modelId !== ivy.id),
        'the decorative plant does not add gameplay collision');
    for (const map of Object.values(FALKENWACHT_MAPS)) {
        assert.deepEqual(map.glbModels.find((model) => model.id === ivy.id), ivy);
    }
});
