import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createVehicleMesh, getPlayerVehicleIds } from '../src/entities/vehicle-registry.js';
import { syncPlayerHitboxFromVehicleMesh } from '../src/entities/player/PlayerMotionOps.js';
import { HangarVehicleAssembly } from '../src/ui/hangar/HangarVehicleAssembly.js';
import { FIGHT_MACHINE_GUN_MODELS } from '../src/shared/contracts/FightMachineGunContract.js';
import { ROCKET_PICKUP_DEFINITIONS } from '../src/shared/contracts/RocketPickupDefinitionsContract.js';

const VEHICLE_IDS = ['ship5', 'spaceship', 'arrow', 'manta', 'drone', 'ship1', 'ship9', 'lab_helix_interceptor'];
const MANTA_MIN = [-19.899800138711928, -2.0000000894069685, -12.866259235242687];
const MANTA_MAX = [19.899800138711928, 2.5000000894069685, 21.143222119068028];
const closeVector = (actual, expected, label) => {
    expected.forEach((value, index) => assert.ok(Math.abs(actual[index] - value) < 1e-6, `${label}[${index}] ${actual[index]} vs ${value}`));
};

function rocketScale(mesh, index) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixScale(matrix).length();
}

test('all eight selectable vehicles have reusable guns, five mounts, and inventory-driven rockets', () => {
    assert.deepEqual(getPlayerVehicleIds(), VEHICLE_IDS);
    const rocketTypes = Object.keys(ROCKET_PICKUP_DEFINITIONS);
    for (const vehicleId of VEHICLE_IDS) {
        const vehicle = createVehicleMesh(vehicleId, 0x3366ff);
        try {
            const guns = vehicle.getObjectByName('PlayerWeaponHardpoints');
            const leftMount = vehicle.getObjectByName('PlayerMachineGunMountLeft');
            const rightMount = vehicle.getObjectByName('PlayerMachineGunMountRight');
            const rockets = vehicle.getObjectByName('PlayerInventoryRockets');
            assert.ok(guns?.isMesh, `${vehicleId} has a visible weapon assembly`);
            assert.ok(leftMount?.isGroup && rightMount?.isGroup && leftMount !== rightMount,
                `${vehicleId} has independent MG mounts`);
            assert.ok(leftMount.position.x < rightMount.position.x, `${vehicleId} has a MG on either side`);
            assert.equal(guns.geometry.groups.length, 3, `${vehicleId} has rack and two MG geometry groups`);
            assert.ok(rockets?.isInstancedMesh, `${vehicleId} has fixed rocket slots`);
            assert.equal(rockets.count, 5);
            assert.ok(rockets.boundingSphere?.radius > 0 && !rockets.boundingBox?.isEmpty(),
                `${vehicleId} reserves culling bounds for later pickups`);
            assert.equal(rocketScale(rockets, 0), 0, `${vehicleId} selection keeps rockets unloaded`);

            const shapes = new Set();
            for (const model of FIGHT_MACHINE_GUN_MODELS) {
                vehicle.setMachineGunModel(model.id);
                assert.equal(guns.material[1].color.getHex(), model.tracerColor, `${vehicleId} ${model.id} visual mapping`);
                assert.equal(guns.material[2].color.getHex(), model.tracerColor, `${vehicleId} right ${model.id} visual mapping`);
                guns.geometry.computeBoundingBox();
                shapes.add(`${guns.geometry.attributes.position.count}|${guns.geometry.boundingBox.min.z.toFixed(3)}|${guns.geometry.boundingBox.max.y.toFixed(3)}`);
            }
            assert.equal(shapes.size, FIGHT_MACHINE_GUN_MODELS.length, `${vehicleId} MGs have four distinct shapes`);

            for (let count = 0; count <= 5; count += 1) {
                const inventory = rocketTypes.slice(0, count);
                vehicle.syncRocketInventory(inventory);
                for (let slot = 0; slot < 5; slot += 1) {
                    assert.equal(rocketScale(rockets, slot) > 0, slot < count, `${vehicleId} count ${count} slot ${slot}`);
                }
                if (count === 5) {
                    for (let slot = 0; slot < count; slot += 1) {
                        const tint = new THREE.Color();
                        rockets.getColorAt(slot, tint);
                        const expectedTint = new THREE.Color(ROCKET_PICKUP_DEFINITIONS[inventory[slot]].color);
                        assert.ok(Math.abs(tint.r - expectedTint.r) < 1e-6
                            && Math.abs(tint.g - expectedTint.g) < 1e-6
                            && Math.abs(tint.b - expectedTint.b) < 1e-6,
                            `${vehicleId} rocket ${inventory[slot]} preserves its pickup color`);
                    }
                }
            }
        } finally {
            vehicle.dispose();
        }
    }
});

test('Manta weapon visuals stay outside its exact dimensions and player hitbox', () => {
    const manta = createVehicleMesh('manta', 0x3366ff);
    try {
        closeVector(manta.localBox.min.toArray(), MANTA_MIN, 'Manta localBox.min');
        closeVector(manta.localBox.max.toArray(), MANTA_MAX, 'Manta localBox.max');
        const player = {
            hitboxBox: new THREE.Box3(),
            hitboxSize: new THREE.Vector3(),
            hitboxCenter: new THREE.Vector3(),
            hitboxRadius: 1.4,
        };
        syncPlayerHitboxFromVehicleMesh(player, manta);
        closeVector(player.hitboxBox.min.toArray(), MANTA_MIN, 'Manta hitbox.min');
        closeVector(player.hitboxBox.max.toArray(), MANTA_MAX, 'Manta hitbox.max');
    } finally {
        manta.dispose();
    }
});

test('Hangar fight MG styling survives the editable vehicle variant rebuild', () => {
    const assembly = new HangarVehicleAssembly(new THREE.Group());
    try {
        assembly.setVehicle('ship5');
        assembly.setMachineGunModel('lance_p4');
        const originalNode = assembly.vehicleNode;
        const wing = originalNode.config.parts.find((part) => part.role === 'wing_left');
        assembly.setPartStyle({ [wing.name]: { scale: 1.1 } }, wing.name);
        assert.equal(assembly.vehicleNode, originalNode);
        assert.equal(assembly.vehicleNode.getObjectByName('PlayerWeaponHardpoints').material[1].color.getHex(),
            FIGHT_MACHINE_GUN_MODELS.find((model) => model.id === 'lance_p4').tracerColor);
        assert.ok(assembly.vehicleNode.getObjectByName('PlayerWeaponHardpoints').parent,
            'MG mounts stay visible after Hangar rebuild');
        assert.equal(assembly.vehicleNode.getObjectByName('PlayerInventoryRockets').count, 5,
            'all empty missile mounts stay available in the Hangar');
    } finally {
        assembly.dispose();
    }
});

test('player color changes rebuild the same modular vehicle in the Hangar', () => {
    const assembly = new HangarVehicleAssembly(new THREE.Group());
    try {
        assembly.setVehicle('ship5', '#66b6ff');
        const firstNode = assembly.vehicleNode;
        assert.equal(firstNode.config.primaryColor, 0x66b6ff);
        assembly.setVehicle('ship5', '#ff9f5a');
        assert.notEqual(assembly.vehicleNode, firstNode);
        assert.equal(assembly.vehicleNode.config.primaryColor, 0xff9f5a);
        assert.equal(assembly.vehicleNode.getObjectByName('PlayerInventoryRockets').count, 5);
    } finally {
        assembly.dispose();
    }
});
