import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { normalizeVehicleLabConfig } from '../src/shared/contracts/VehicleLabConfigContract.js';
import { applyVehiclePartStyle, measureVehiclePartBounds } from '../src/shared/contracts/VehiclePartStyleContract.js';
import { resolveArcadeSizedPartStyle } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { VEHICLE_PRESETS } from '../src/shared/vehicle-lab/VehiclePresets.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicle-lab/player-ships/index.js';
import { ModularVehicleMesh } from '../src/shared/vehicle-lab/ModularVehicleMeshBridge.js';
import {
    createVehicleMesh,
    getPlayerVehicleIds,
    listBaseVehicleDescriptors,
    listVehicleDescriptors,
} from '../src/entities/vehicle-registry.js';
import { RuntimeModularVehicleMesh } from '../src/entities/runtime-modular-vehicle-mesh.js';
import { syncPlayerHitboxFromVehicleMesh } from '../src/entities/player/PlayerMotionOps.js';

// Every ship has one part per Arcade size group, so every size step is visible (utility since 28.09.2026).
const REQUIRED_ROLES = ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right', 'utility'];
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

// --- Utility parts added on 28.09.2026 to the three ships that had none ---

const NEW_UTILITY_SHIPS = ['spaceship', 'arrow', 'manta'];
const MEASURE = Object.freeze({ includeMirrors: true, ignoreGeos: ['flame', 'forcefield'] });
// Factory box measured before the utility parts existed. Classic and Hunt take the player
// hitbox from it (syncPlayerHitboxFromVehicleMesh), the muzzle and the weapon mounts as well.
const FACTORY_LOCAL_BOX = Object.freeze({
    spaceship: [[-1.8, -1.4005, -2.75], [1.8, 0.875, 1.28]],
    arrow: [[-2.398589, -2.398589, -2.2], [2.398589, 2.398589, 4]],
    manta: [[-19.8998, -2, -12.866259], [19.8998, 2.5, 21.143222]],
});

function utilityOf(config) {
    return config.parts.find((part) => part.role === 'utility');
}

function meshesOf(node) {
    const list = [];
    node?.traverse((child) => { if (child.isMesh) list.push(child); });
    return list;
}

function firstHit(meshes, x, z, fromBelow = false) {
    const origin = new THREE.Vector3(x, fromBelow ? -1e3 : 1e3, z);
    const [hit] = new THREE.Raycaster(origin, new THREE.Vector3(0, fromBelow ? 1 : -1, 0)).intersectObjects(meshes, false);
    return hit || null;
}

function roleNode(mesh, role) {
    return mesh.children.find((child) => child.userData?.config?.role === role && !child.userData.isMirror);
}

function overlaps(a, b) {
    return [0, 1, 2].every((axis) => a.min[axis] < b.max[axis] && b.min[axis] < a.max[axis]);
}

// Hull and utility sizes the Arcade size workshop allows (80-125 %), drawn the way hangar and run draw them.
const SIZE_GRID = Object.freeze([80, 100, 125]);

function sizedConfig(config, hull, utility) {
    return applyVehiclePartStyle(config, resolveArcadeSizedPartStyle(config.parts, null, { hull, utility }), []);
}

function drawSized(config, hull, utility) {
    const mesh = new ModularVehicleMesh(sizedConfig(config, hull, utility));
    mesh.updateMatrixWorld(true);
    return mesh;
}

test('the new utility parts sit on the hull at every hull and utility size: visible from above, never floating', () => {
    for (const id of NEW_UTILITY_SHIPS) {
        const config = configById.get(id);
        assert.ok(utilityOf(config), `${id} has a utility part`);
        for (const [hullPct, utilityPct] of SIZE_GRID.flatMap((h) => SIZE_GRID.map((u) => [h, u]))) {
            const mesh = drawSized(config, hullPct, utilityPct);
            const node = roleNode(mesh, 'utility');
            // Pivot line through the drawn part: where the part sits once hull and utility are sized.
            const { x, z } = node.getWorldPosition(new THREE.Vector3());
            const own = meshesOf(node);
            const hull = firstHit(meshesOf(roleNode(mesh, 'core')), x, z);
            const top = firstHit(own, x, z);
            const bottom = firstHit(own, x, z, true);
            const label = `${id} hull ${hullPct} % utility ${utilityPct} %`;
            assert.ok(hull && top && bottom, `${label}: hull and part lie on the pivot line`);
            assert.ok(top.point.y > hull.point.y, `${label}: top ${top.point.y.toFixed(3)} shows above the hull ${hull.point.y.toFixed(3)}`);
            assert.ok(bottom.point.y <= hull.point.y, `${label}: bottom ${bottom.point.y.toFixed(3)} reaches into the hull, no gap`);

            // Seen from above, a good share of the part's footprint is the part itself, not hidden in the hull.
            const bounds = new THREE.Box3();
            own.forEach((child) => bounds.expandByObject(child));
            const all = meshesOf(mesh);
            let onPart = 0;
            let rays = 0;
            for (let i = 0; i < 9; i++) {
                for (let k = 0; k < 9; k++) {
                    const px = bounds.min.x + ((i + 0.5) / 9) * (bounds.max.x - bounds.min.x);
                    const pz = bounds.min.z + ((k + 0.5) / 9) * (bounds.max.z - bounds.min.z);
                    const hit = firstHit(all, px, pz);
                    if (!hit) continue;
                    rays += 1;
                    if (own.includes(hit.object)) onPart += 1;
                }
            }
            assert.ok(onPart / rays >= 0.3, `${label}: ${onPart}/${rays} rays from above meet the part first`);
            mesh.dispose();
        }
    }
});

test('the new utility parts keep clear of cockpit, wings and engines at every hull and utility size and match the Star-Cruiser proportion', () => {
    const ratio = (config) => {
        const part = measureVehiclePartBounds(utilityOf(config), MEASURE).size;
        const ship = createVehicleMesh(config.id, 0xffffff).localBox.getSize(new THREE.Vector3()).toArray();
        return Math.max(...part) / Math.max(...ship);
    };
    // ship5 "Rückenaufbau": the reference for the size of a utility part relative to its ship.
    const reference = ratio(configById.get('ship5'));
    for (const id of NEW_UTILITY_SHIPS) {
        const config = configById.get(id);
        assert.ok(utilityOf(config), `${id} has a utility part`);
        for (const hull of SIZE_GRID) {
            for (const size of SIZE_GRID) {
                const sized = sizedConfig(config, hull, size);
                const utility = measureVehiclePartBounds(utilityOf(sized), MEASURE);
                for (const part of sized.parts.filter((entry) => /^(nose|wing_|engine_)/.test(entry.role || ''))) {
                    assert.equal(overlaps(utility, measureVehiclePartBounds(part, MEASURE)), false,
                        `${id} hull ${hull} % utility ${size} %: utility clear of ${part.name}`);
                }
            }
        }
        const share = ratio(config) / reference;
        assert.ok(share >= 0.5 && share <= 2, `${id}: utility size relative to the ship is ${share.toFixed(2)} x the Star-Cruiser's`);
    }
});

test('Raumschiff: the deck module stands on the deck at every hull and utility size, its dark ring on the deck line', () => {
    const config = configById.get('spaceship');
    const hullPart = config.parts.find((part) => part.role === 'core');
    const [, , deckHeight] = hullPart.size; // saucer cylinder [top radius, bottom radius, height]
    for (const hullPct of SIZE_GRID) {
        for (const size of SIZE_GRID) {
            const label = `hull ${hullPct} % utility ${size} %`;
            const h = hullPct / 100;
            const deckY = (deckHeight / 2) * h;
            const deckRadius = hullPart.size[0] * h;
            // Below the deck the saucer flank widens from the top to the bottom radius.
            const flankSlope = (hullPart.size[1] - hullPart.size[0]) / deckHeight;
            const mesh = drawSized(config, hullPct, size);
            const node = roleNode(mesh, 'utility');
            let ring = null;
            node.traverse((child) => { if (child.name === 'Modulring') ring = child; });
            assert.ok(ring, 'the module has its dark ring');
            const ringBox = new THREE.Box3().setFromObject(ring);
            assert.ok(ringBox.min.y < deckY && ringBox.max.y > deckY + 0.01, `${label}: ring ${ringBox.min.y.toFixed(3)}..${ringBox.max.y.toFixed(3)} lies on the deck ${deckY.toFixed(3)}`);
            const point = new THREE.Vector3();
            for (const child of meshesOf(node)) {
                const position = child.geometry.getAttribute('position');
                for (let i = 0; i < position.count; i++) {
                    point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
                    const allowed = deckRadius + Math.max(0, deckY - point.y) * flankSlope;
                    assert.ok(Math.hypot(point.x, point.z) <= allowed + 1e-6,
                        `${label}: ${child.name} reaches ${Math.hypot(point.x, point.z).toFixed(3)} at y ${point.y.toFixed(3)}, saucer edge ${allowed.toFixed(3)}`);
                }
            }
            mesh.dispose();
        }
    }
});

test('the new utility parts keep the factory box, so Classic and Hunt keep hitbox, muzzle and weapon mounts', () => {
    for (const [id, [min, max]] of Object.entries(FACTORY_LOCAL_BOX)) {
        const config = configById.get(id);
        const mesh = createVehicleMesh(id, 0x3366ff);
        const player = { hitboxRadius: 1, hitboxBox: new THREE.Box3(), hitboxSize: new THREE.Vector3(), hitboxCenter: new THREE.Vector3(), vehicleMesh: mesh };
        const hitbox = syncPlayerHitboxFromVehicleMesh(player);
        const without = new RuntimeModularVehicleMesh(0x3366ff, { ...config, parts: config.parts.filter((part) => part.role !== 'utility') });
        for (let axis = 0; axis < 3; axis++) {
            const label = `${id} axis ${'xyz'[axis]}`;
            assert.ok(Math.abs(hitbox.min.getComponent(axis) - min[axis]) < 1e-5, `${label}: min ${hitbox.min.getComponent(axis)} vs ${min[axis]}`);
            assert.ok(Math.abs(hitbox.max.getComponent(axis) - max[axis]) < 1e-5, `${label}: max ${hitbox.max.getComponent(axis)} vs ${max[axis]}`);
            assert.ok(Math.abs(mesh.localBox.min.getComponent(axis) - without.localBox.min.getComponent(axis)) < 1e-9, `${label}: min without utility`);
            assert.ok(Math.abs(mesh.localBox.max.getComponent(axis) - without.localBox.max.getComponent(axis)) < 1e-9, `${label}: max without utility`);
        }
        assert.ok(mesh.muzzle.position.equals(without.muzzle.position), `${id}: muzzle stays`);
        assert.ok(mesh.firstPersonAnchor.position.equals(without.firstPersonAnchor.position), `${id}: cockpit camera stays`);
        mesh.dispose();
        without.dispose();
    }
});
