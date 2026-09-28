import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    VEHICLE_PART_STYLE_SCALE_RANGE,
    applyVehiclePartStyle,
    listVehiclePartVariants,
    measureVehiclePartBounds,
    normalizeVehiclePartStyle,
} from '../src/shared/contracts/VehiclePartStyleContract.js';
import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';
import { normalizeArcadeVehicleProfileRecord } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { listPlayerShipPartDonors } from '../src/shared/vehicle-lab/player-ships/index.js';
import { RuntimeModularVehicleMesh } from '../src/entities/runtime-modular-vehicle-mesh.js';
import { applyArcadeRuntimeCosmetics } from '../src/core/arcade/ArcadeRuntimeCosmeticOps.js';
import { HangarVehicleAssembly } from '../src/ui/hangar/HangarVehicleAssembly.js';

const SHIP = Object.freeze({
    id: 'test_ship',
    label: 'Testschiff',
    parts: [
        { name: 'Rumpf', geo: 'box', size: [1, 0.5, 3], role: 'core' },
        { name: 'Nase', geo: 'cone', size: [0.4, 1], pos: [0, 0, -2], rot: [-90, 0, 0], role: 'nose' },
        { name: 'Linker Flügel', geo: 'box', size: [2, 0.1, 1], pos: [-1.5, 0, 0], role: 'wing_left' },
        { name: 'Deko', geo: 'sphere', size: [0.2], pos: [0, 0.4, 0] },
    ],
});
const DONOR = Object.freeze({
    id: 'donor_ship',
    label: 'Spender',
    parts: [
        { name: 'Spendernase', geo: 'capsule', size: [2, 8], rot: [90, 0, 0], role: 'nose', children: [
            { name: 'Spitze', geo: 'sphere', size: [1], pos: [0, 0, -4] },
        ] },
    ],
});

test('part styles keep only known fields within the allowed ranges', () => {
    const style = normalizeVehiclePartStyle({
        Rumpf: { color: '#ff0000', scale: 9 },
        Nase: { scale: 0.1, variant: 'donor_ship' },
        Leer: {},
        Kaputt: 'x',
    });
    assert.deepEqual(style, {
        Rumpf: { color: 0xff0000, scale: VEHICLE_PART_STYLE_SCALE_RANGE.max },
        Nase: { scale: VEHICLE_PART_STYLE_SCALE_RANGE.min, variant: 'donor_ship' },
    });
    assert.deepEqual(normalizeVehiclePartStyle(null), {});
});

test('applying a style recolors, rescales and swaps parts without touching the source', () => {
    const before = JSON.stringify(SHIP);
    const styled = applyVehiclePartStyle(SHIP, {
        Rumpf: { color: 0x00ff00, scale: 1.2 },
        Nase: { variant: 'donor_ship' },
        Unbekannt: { scale: 1.1 },
    }, [DONOR]);
    assert.equal(JSON.stringify(SHIP), before);
    const [core, nose, wing, deco] = styled.parts;
    assert.equal(core.color, 0x00ff00);
    assert.deepEqual(core.scale, [1.2, 1.2, 1.2]);
    assert.equal(nose.name, 'Nase');
    assert.equal(nose.role, 'nose');
    assert.equal(nose.geo, 'capsule');
    assert.equal(nose.children[0].name, 'Nase · Spitze', 'child names stay unique');
    assert.deepEqual(wing, SHIP.parts[2]);
    assert.deepEqual(deco, SHIP.parts[3]);
});

function renderedBounds(config, partName) {
    const mesh = new ModularVehicleMesh(config);
    mesh.updateMatrixWorld(true);
    const part = mesh.children.find((child) => child.name === partName && !child.userData.isMirror);
    const box = new THREE.Box3().setFromObject(part);
    mesh.dispose();
    return box;
}

test('a swapped shape takes the place and footprint of the old part, rotation included', () => {
    const ship5 = listPlayerShipPartDonors().find((donor) => donor.id === 'ship5');
    for (const role of ['wing_left', 'wing_right', 'nose', 'engine_left']) {
        const name = ship5.parts.find((part) => part.role === role).name;
        const styled = applyVehiclePartStyle(ship5, { [name]: { variant: 'lab_helix_interceptor' } }, listPlayerShipPartDonors());
        const before = renderedBounds(ship5, name);
        const after = renderedBounds(styled, name);
        const sizeBefore = before.getSize(new THREE.Vector3());
        const sizeAfter = after.getSize(new THREE.Vector3());
        const centerBefore = before.getCenter(new THREE.Vector3());
        const centerAfter = after.getCenter(new THREE.Vector3());
        for (const axis of ['x', 'z']) {
            assert.ok(sizeAfter[axis] <= sizeBefore[axis] * 1.02 + 1e-6, `${role} ${axis} footprint ${sizeAfter[axis].toFixed(2)} fits ${sizeBefore[axis].toFixed(2)}`);
            assert.ok(Math.abs(centerAfter[axis] - centerBefore[axis]) < 0.02, `${role} ${axis} center stays`);
        }
        const fills = Math.max(sizeAfter.x / sizeBefore.x, sizeAfter.z / sizeBefore.z);
        assert.ok(fills > 0.98, `${role} fills the old footprint on one axis (${fills.toFixed(2)})`);
        const measured = measureVehiclePartBounds(styled.parts.find((part) => part.name === name));
        assert.ok(Math.abs(measured.size[0] - sizeAfter.x) < 0.1, `${role} measured width matches the renderer`);
    }
});

test('only role parts except the core offer shapes of other ships with the same role', () => {
    assert.deepEqual(listVehiclePartVariants(SHIP, 'Nase', [DONOR, { ...SHIP }]), [{ id: 'donor_ship', label: 'Spender' }]);
    assert.deepEqual(listVehiclePartVariants(SHIP, 'Rumpf', [DONOR]), []);
    assert.deepEqual(listVehiclePartVariants(SHIP, 'Deko', [DONOR]), []);
    const donors = listPlayerShipPartDonors();
    assert.equal(donors.length, 8);
    assert.ok(donors.every((donor) => donor.parts.some((part) => part.role === 'nose')));
});

test('arcade vehicle profiles keep a normalized part style', () => {
    const profile = normalizeArcadeVehicleProfileRecord('ship5', { partStyle: { Rumpf: { scale: 3 } } });
    assert.deepEqual(profile.partStyle, { Rumpf: { scale: VEHICLE_PART_STYLE_SCALE_RANGE.max } });
    assert.deepEqual(normalizeArcadeVehicleProfileRecord('ship5', {}).partStyle, {});
});

function createPlayer(isBot = false) {
    return { isBot, vehicleMesh: new RuntimeModularVehicleMesh(0x3366ff, SHIP), trail: null };
}

test('arcade runs draw the styled vehicle for humans but keep the hitbox and never compound', () => {
    const human = createPlayer();
    const bot = createPlayer(true);
    const hitboxBefore = human.vehicleMesh.localBox.clone();
    const store = {
        loadJsonRecord: () => ({
            test_ship: { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'test_ship', partStyle: { Rumpf: { scale: 1.25 } } },
        }),
    };
    const support = {
        _resolveActiveVehicleId: () => 'test_ship',
        game: { settingsManager: { getPlayerRecordStorePort: () => store } },
    };
    const runtimeState = { entityManager: { players: [human, bot] } };
    const runtimeConfig = { arcade: { enabled: true } };
    applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig);
    applyArcadeRuntimeCosmetics(support, runtimeState, runtimeConfig);
    const core = (mesh) => mesh.children.find((child) => child.name === 'Rumpf');
    assert.ok(Math.abs(core(human.vehicleMesh).scale.x - 1.25) < 1e-6, 'style applied once, not twice');
    assert.equal(core(bot.vehicleMesh).scale.x, 1, 'bots keep the factory vehicle');
    assert.ok(human.vehicleMesh.localBox.equals(hitboxBefore), 'hitbox stays the factory hitbox');

    applyArcadeRuntimeCosmetics(support, runtimeState, { arcade: { enabled: false } });
    assert.equal(core(human.vehicleMesh).scale.x, 1, 'outside arcade the factory vehicle returns');
});

test('the hangar preview shows the style and moves stones with the styled parts', () => {
    const assembly = new HangarVehicleAssembly(new THREE.Group());
    assembly.setVehicle('ship5');
    const before = assembly.getHardpoint('wing_left').position;
    const wingName = assembly.vehicleNode.config.parts.find((part) => part.role === 'wing_left').name;
    assembly.setPartStyle({ [wingName]: { scale: 1.25 } }, wingName);
    const after = assembly.getHardpoint('wing_left').position;
    assert.notDeepEqual(after, before);
    const wing = assembly.vehicleNode.children.find((child) => child.name === wingName);
    assert.ok(Math.abs(wing.scale.x - 1.25) < 1e-6);
    assert.equal(assembly.vehicleNode.selectedIndex, assembly.vehicleNode.config.parts.findIndex((part) => part.name === wingName));
    assembly.dispose();
});
