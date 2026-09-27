import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { normalizeVehicleLabConfig } from '../src/shared/contracts/VehicleLabConfigContract.js';
import { VEHICLE_PRESETS } from '../src/shared/vehicle-lab/VehiclePresets.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicle-lab/player-ships/index.js';
import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';
import {
    createVehicleMesh,
    getPlayerVehicleIds,
    listBaseVehicleDescriptors,
    listVehicleDescriptors,
} from '../src/entities/vehicle-registry.js';

const REQUIRED_ROLES = ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right'];
const MAX_VISIBLE_MESHES = 40;

// Visible size [width x, height y, length z] of the old game models, measured from the
// meshes the game draws (OBJ ships after their 4.5-unit normalization, incl. wing engines).
const OLD_MODEL_SIZE = Object.freeze({
    ship5: [4.81, 0.891, 4.433],
    spaceship: [3.6, 2.275, 4.03],
    drone: [3.7, 1.4, 4.45],
    ship1: [3.01, 0.56, 5.736],
    ship9: [4.499, 0.866, 6.604],
    // The Manta is drawn about ten times larger than the other ships; it keeps that size.
    manta: [39.801, 4.5, 34.063],
});
// The code-built Arrow (5 x 5 x 6.2 with its fins) is larger than its hitbox; its rebuild
// keeps the silhouette at regular ship size.
const RESCALED_LONGEST_EXTENT = Object.freeze({ arrow: [4, 6.5] });

const SHIP_IDS = ['ship5', 'spaceship', 'arrow', 'manta', 'drone', 'ship1', 'ship9'];
const configById = new Map(PLAYER_SHIP_PART_CONFIGS.map((config) => [config.id, config]));
const HELIX = VEHICLE_PRESETS.find((preset) => preset.id === 'lab_helix_interceptor');

function walk(parts, visit, depth = 0) {
    for (const part of parts || []) {
        visit(part, depth);
        walk(part.children, visit, depth + 1);
    }
}

function visibleBounds(object) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let meshes = 0;
    object.traverse((child) => {
        if (!child.isMesh) return;
        for (let node = child; node; node = node.parent) if (!node.visible) return;
        meshes += 1;
        child.geometry.computeBoundingBox();
        box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
    });
    return { size: box.getSize(new THREE.Vector3()).toArray(), meshes };
}

function assertPartStructure(config) {
    const normalized = normalizeVehicleLabConfig(config);
    assert.equal(normalized.ok, true, normalized.errors.join('\n'));
    assert.deepEqual(normalized.warnings, []);

    const names = [];
    const roles = new Map();
    walk(config.parts, (part, depth) => {
        names.push(part.name);
        if (!part.role) return;
        assert.equal(depth, 0, `${part.name}: roles belong to top-level parts`);
        assert.ok(!part.mirror && !part.mirrorAxis, `${part.name}: role parts are not mirrored copies`);
        roles.set(part.role, [...(roles.get(part.role) || []), part]);
    });
    assert.equal(new Set(names).size, names.length, `part names are unique: ${names.join(', ')}`);
    assert.ok(names.length >= 10 && names.length <= 32, `10-32 parts, got ${names.length}`);
    for (const role of REQUIRED_ROLES) assert.equal(roles.get(role)?.length, 1, `exactly one ${role} part`);
    assert.ok((roles.get('utility')?.length || 0) <= 1, 'at most one utility part');

    const z = (role) => roles.get(role)[0].pos?.[2] ?? 0;
    const x = (role) => roles.get(role)[0].pos?.[0] ?? 0;
    assert.ok(z('nose') < z('core'), 'the nose points to -z');
    assert.ok(z('engine_left') > z('nose') && z('engine_right') > z('nose'), 'engines sit behind the nose');
    assert.ok(x('wing_left') < 0 && x('wing_right') > 0, 'left wing at -x, right wing at +x');
    assert.ok(x('engine_left') <= 0 && x('engine_right') >= 0, 'left engine at -x, right engine at +x');
}

for (const id of SHIP_IDS) {
    test(`${id} is rebuilt from editable parts that replace the old model`, () => {
        const config = configById.get(id);
        assert.ok(config?.parts?.length > 0, `${id} has parts`);
        assert.equal(config.id, id);
        assert.equal(config.baseVehicleId, id);
        assert.equal(config.baseMeshMode, 'reference');
        assertPartStructure(config);

        const base = listBaseVehicleDescriptors().find((entry) => entry.id === id);
        const registered = listVehicleDescriptors().find((entry) => entry.id === id);
        assert.equal(config.label, base.label, 'label stays the one players know');
        assert.equal(registered.isGeneratedModular, true);
        assert.equal(registered.hitboxRadius, base.hitboxRadius, 'hitbox stays unchanged');
        assert.ok(getPlayerVehicleIds().includes(id));

        const mesh = createVehicleMesh(id, 0x3366ff);
        assert.equal(mesh.isModularVehicle, true);
        assert.equal(mesh.baseMesh, null, 'the old model is not drawn in the game');
        const { size, meshes } = visibleBounds(mesh);
        assert.ok(meshes <= MAX_VISIBLE_MESHES, `${meshes} meshes exceed the draw budget`);
        if (OLD_MODEL_SIZE[id]) {
            OLD_MODEL_SIZE[id].forEach((expected, axis) => {
                const tolerance = Math.max(expected * (axis === 1 ? 0.25 : 0.12), 0.2);
                assert.ok(Math.abs(size[axis] - expected) <= tolerance,
                    `${'xyz'[axis]} size ${size[axis].toFixed(2)} vs old ${expected}`);
            });
        } else {
            const [min, max] = RESCALED_LONGEST_EXTENT[id];
            const longest = Math.max(...size);
            assert.ok(longest >= min && longest <= max, `longest extent ${longest.toFixed(2)} in [${min}, ${max}]`);
        }
        mesh.dispose();
    });
}

test('the Helix Interceptor follows the same part rules', () => {
    assertPartStructure(HELIX);
    const { meshes } = visibleBounds(new ModularVehicleMesh(HELIX));
    assert.ok(meshes <= MAX_VISIBLE_MESHES, `${meshes} meshes exceed the draw budget`);
});
