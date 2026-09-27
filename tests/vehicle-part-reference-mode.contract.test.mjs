import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    isVehicleLabBaseMeshReferenceOnly,
    normalizeVehicleLabConfig,
} from '../src/shared/contracts/VehicleLabConfigContract.js';
import { HangarVehicleAssembly } from '../src/ui/hangar/HangarVehicleAssembly.js';

const REFERENCE_CONFIG = Object.freeze({
    label: 'Ship 5 aus Teilen',
    baseVehicleId: 'ship5',
    baseMeshMode: 'reference',
    parts: [{ name: 'Rumpf', geo: 'box', size: [1, 1, 3], role: 'core' }],
});

test('the reference base mode survives normalization only next to a game base model', () => {
    const kept = normalizeVehicleLabConfig(REFERENCE_CONFIG);
    assert.equal(kept.ok, true);
    assert.equal(kept.config.baseMeshMode, 'reference');
    assert.equal(isVehicleLabBaseMeshReferenceOnly(kept.config), true);

    const unknownMode = normalizeVehicleLabConfig({ ...REFERENCE_CONFIG, baseMeshMode: 'body' });
    assert.equal('baseMeshMode' in unknownMode.config, false);

    const withoutBase = normalizeVehicleLabConfig({ ...REFERENCE_CONFIG, baseVehicleId: '' });
    assert.equal('baseMeshMode' in withoutBase.config, false);
    assert.equal(isVehicleLabBaseMeshReferenceOnly(withoutBase.config), false);
});

test('hangar stones sit on top of the named parts of a part-built vehicle', () => {
    const assembly = new HangarVehicleAssembly(new THREE.Group());
    assembly.setVehicle('lab_helix_interceptor');
    const byName = new Map();
    assembly.vehicleNode.traverse((child) => {
        if (child.userData?.config?.name && !child.userData.isMirror) byName.set(child.userData.config.name, child);
    });
    const expectTopCenter = (slotId, partName) => {
        const box = new THREE.Box3().setFromObject(byName.get(partName));
        const center = box.getCenter(new THREE.Vector3());
        const hardpoint = assembly.getHardpoint(slotId);
        assert.ok(Math.abs(hardpoint.position[0] - center.x) < 1e-6, `${slotId} x`);
        assert.ok(Math.abs(hardpoint.position[2] - center.z) < 1e-6, `${slotId} z`);
        assert.ok(hardpoint.position[1] > box.max.y, `${slotId} above the part`);
    };
    expectTopCenter('nose', 'Needle Nose');
    expectTopCenter('wing_left', 'L-Main Wing');
    expectTopCenter('engine_right', 'R-Main Engine');
    assembly.dispose();
});
