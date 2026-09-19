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
    REPAIR_DRONE: 1.860, BOMBER_STRIKE: 2.240,
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

function geometryComponentCount(geometry) {
    const positions = geometry.attributes.position;
    const parents = Array.from({ length: positions.count }, (_, index) => index);
    const find = (index) => {
        while (parents[index] !== index) {
            parents[index] = parents[parents[index]];
            index = parents[index];
        }
        return index;
    };
    const join = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    const coincident = new Map();
    for (let index = 0; index < positions.count; index += 1) {
        const key = `${positions.getX(index).toFixed(5)},${positions.getY(index).toFixed(5)},${positions.getZ(index).toFixed(5)}`;
        if (coincident.has(key)) join(index, coincident.get(key));
        else coincident.set(key, index);
    }
    const indices = geometry.index?.array ?? Array.from({ length: positions.count }, (_, index) => index);
    for (let index = 0; index < indices.length; index += 3) {
        join(indices[index], indices[index + 1]);
        join(indices[index + 1], indices[index + 2]);
    }
    return new Set(Array.from({ length: positions.count }, (_, index) => find(index))).size;
}

function triangleIndices(geometry) {
    return geometry.index?.array ?? Array.from(
        { length: geometry.attributes.position.count }, (_, index) => index,
    );
}

function geometrySignedVolume(geometry) {
    const positions = geometry.attributes.position;
    const indices = triangleIndices(geometry);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let volume = 0;
    for (let index = 0; index < indices.length; index += 3) {
        a.fromBufferAttribute(positions, indices[index]);
        b.fromBufferAttribute(positions, indices[index + 1]);
        c.fromBufferAttribute(positions, indices[index + 2]);
        volume += a.dot(b.clone().cross(c)) / 6;
    }
    return volume;
}

function geometryBoundaryEdgeCount(geometry) {
    const positions = geometry.attributes.position;
    const indices = triangleIndices(geometry);
    const vertexKey = (index) => [
        positions.getX(index), positions.getY(index), positions.getZ(index),
    ].map((value) => value.toFixed(5)).join(',');
    const edges = new Map();
    for (let index = 0; index < indices.length; index += 3) {
        const vertices = indices.slice(index, index + 3).map(vertexKey);
        for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
            const key = [vertices[left], vertices[right]].sort().join('|');
            edges.set(key, (edges.get(key) || 0) + 1);
        }
    }
    return [...edges.values()].filter((uses) => uses === 1).length;
}

function geometryComponentBounds(mesh, root) {
    root.updateWorldMatrix(true, true);
    mesh.updateWorldMatrix(true, false);
    const toRoot = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const positions = mesh.geometry.attributes.position;
    const points = Array.from({ length: positions.count }, (_, index) => (
        new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(toRoot)
    ));
    const parents = points.map((_, index) => index);
    const find = (index) => {
        while (parents[index] !== index) {
            parents[index] = parents[parents[index]];
            index = parents[index];
        }
        return index;
    };
    const join = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    const coincident = new Map();
    for (let index = 0; index < points.length; index += 1) {
        const key = points[index].toArray().map((value) => value.toFixed(5)).join(',');
        if (coincident.has(key)) join(index, coincident.get(key));
        else coincident.set(key, index);
    }
    const indices = triangleIndices(mesh.geometry);
    for (let index = 0; index < indices.length; index += 3) {
        join(indices[index], indices[index + 1]);
        join(indices[index + 1], indices[index + 2]);
    }
    const boxes = new Map();
    for (let index = 0; index < points.length; index += 1) {
        const component = find(index);
        if (!boxes.has(component)) boxes.set(component, new THREE.Box3());
        boxes.get(component).expandByPoint(points[index]);
    }
    return [...boxes.values()].sort((left, right) => left.min.x - right.min.x);
}

function rootSpaceVertexKeys(mesh, root, transform = (point) => point) {
    root.updateWorldMatrix(true, true);
    mesh.updateWorldMatrix(true, false);
    const toRoot = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const positions = mesh.geometry.attributes.position;
    const keys = new Set();
    for (let index = 0; index < positions.count; index += 1) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(toRoot);
        transform(point);
        keys.add(point.toArray().map((value) => (
            Math.abs(value) < 5e-5 ? '0.0000' : value.toFixed(4)
        )).join(','));
    }
    return [...keys].sort();
}

function horizontalArrowDirection(mesh, root) {
    const boxes = geometryComponentBounds(mesh, root);
    assert.equal(boxes.length, 1, `${mesh.name} is one physical arrow`);
    root.updateWorldMatrix(true, true);
    mesh.updateWorldMatrix(true, false);
    const toRoot = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const positions = mesh.geometry.attributes.position;
    const points = Array.from({ length: positions.count }, (_, index) => (
        new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(toRoot)
    ));
    const bounds = boxes[0];
    const tolerance = (bounds.max.x - bounds.min.x) * 0.08;
    const verticalSpan = (selected) => (
        Math.max(...selected.map((point) => point.y)) - Math.min(...selected.map((point) => point.y))
    );
    const leftSpan = verticalSpan(points.filter((point) => point.x <= bounds.min.x + tolerance));
    const rightSpan = verticalSpan(points.filter((point) => point.x >= bounds.max.x - tolerance));
    return leftSpan < rightSpan ? 'left' : 'right';
}

function roleBounds(root, role) {
    const bounds = new THREE.Box3();
    root.traverse((node) => {
        if (node.isMesh && node.userData.pickupMaterialRole === role) bounds.expandByObject(node);
    });
    return bounds;
}

test('real pickup GLB contains every semantic and legacy root within render budgets', async () => {
    const gltf = await parseLibrary();
    // Every registered pickup has its baked root; a new item without one fails here on purpose
    // (the model factory would fall back to a coloured cube).
    const expected = [
        ...getPickupTypes(),
        ...LEGACY_PICKUP_MODEL_TYPES,
    ];
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
        let cluster = null;
        root.traverse((node) => { if (node.userData.weaponFanProjectileCluster === true) cluster = node; });
        assert.ok(cluster, `FAN_${count} exposes its projectile cluster`);
        assert.equal(cluster.userData.projectileCount, count);
        const projectileGeometry = cluster.children.find((child) => (
            child.isMesh && child.userData.pickupMaterialRole === 'accent'
        ));
        assert.ok(projectileGeometry, `FAN_${count} exports projectile geometry`);
        assert.equal(
            geometryComponentCount(projectileGeometry.geometry),
            count,
            `FAN_${count} contains ${count} separate physical projectiles`,
        );
    }
});

test('pilot models export visible role geometry and two physical heavy-rocket collars', async () => {
    const gltf = await parseLibrary();
    const expectedRoles = new Map([
        ['SPEED_UP', ['frame', 'accent']],
        ['SHIELD', ['metal', 'frame', 'accent']],
        ['HEALTH', ['metal', 'frame', 'accent']],
        ['ROCKET_HEAVY', ['metal', 'frame', 'accent', 'glow']],
    ]);
    for (const [identifier, roles] of expectedRoles) {
        const root = gltf.scene.getObjectByName(`pickup_${identifier}`);
        const exportedRoles = new Set();
        root.traverse((node) => {
            if (!node.isMesh) return;
            exportedRoles.add(node.userData.pickupMaterialRole);
            assert.equal(node.material.transparent, false, `${identifier} surfaces stay opaque`);
            assert.equal(node.material.opacity, 1, `${identifier} surfaces have full coverage`);
        });
        assert.deepEqual([...exportedRoles].sort(), [...roles].sort(), `${identifier} exports its designed surfaces`);
    }

    const heavy = gltf.scene.getObjectByName('pickup_ROCKET_HEAVY');
    let collarGroup = null;
    heavy.traverse((node) => { if (node.userData.rocketTierCollars === true) collarGroup = node; });
    assert.ok(collarGroup, 'heavy rocket exports a physical collar group');
    assert.equal(collarGroup.userData.tierMarkerCount, 2);
    const collarMeshes = collarGroup.children.filter((child) => child.isMesh);
    assert.equal(collarMeshes.length, 1, 'same-material tier collars share one draw call');
    assert.equal(geometryComponentCount(collarMeshes[0].geometry), 2, 'joined geometry contains two real collars');
});

test('polygon-prism pickup meshes export outward winding for FrontSide materials', async () => {
    const gltf = await parseLibrary();
    const expectedRoles = new Map([
        ['FAN_3', ['accent']], ['FAN_4', ['accent']], ['FAN_5', ['accent']],
        ['THICK', ['frame']], ['THIN', ['frame']],
        ['INVERT', ['accent', 'frame']], ['SWAP', ['accent', 'frame']],
        ['item_arrow', ['accent', 'frame']], ['item_star', ['accent', 'frame']],
    ]);
    for (const [identifier, roles] of expectedRoles) {
        const root = gltf.scene.getObjectByName(`pickup_${identifier}`);
        for (const role of roles) {
            const meshes = [];
            root.traverse((node) => {
                if (node.isMesh && node.userData.pickupMaterialRole === role) meshes.push(node);
            });
            assert.ok(meshes.length > 0, `${identifier} exports ${role} prism geometry`);
            for (const mesh of meshes) {
                const volume = geometrySignedVolume(mesh.geometry);
                assert.ok(volume > 1e-7, `${identifier}/${mesh.name} has positive signed volume (${volume})`);
            }
        }
    }
});

test('fan pickups use a closed common base, physical connectors, and mirrored outside labels', async () => {
    const gltf = await parseLibrary();
    for (const count of [3, 4, 5]) {
        const root = gltf.scene.getObjectByName(`pickup_FAN_${count}`);
        let base = null;
        let connectorGroup = null;
        let cluster = null;
        let label = null;
        root.traverse((node) => {
            if (node.userData.weaponFanClosedBase === true) base = node;
            if (node.userData.weaponFanConnectorAssembly === true) connectorGroup = node;
            if (node.userData.weaponFanProjectileCluster === true) cluster = node;
            if (node.userData.weaponFanLabel === true) label = node;
        });
        assert.ok(base?.isMesh, `FAN_${count} exports a solid base mesh`);
        assert.equal(geometryBoundaryEdgeCount(base.geometry), 0, `FAN_${count} base is watertight`);
        assert.ok(geometrySignedVolume(base.geometry) > 0, `FAN_${count} base faces outward`);

        const connector = connectorGroup?.children.find((child) => child.isMesh);
        const projectile = cluster?.children.find((child) => (
            child.isMesh && child.userData.pickupMaterialRole === 'accent'
        ));
        assert.ok(connector, `FAN_${count} exports its connector geometry`);
        assert.equal(connectorGroup.userData.connectorCount, count);
        const connectorBounds = geometryComponentBounds(connector, root);
        const projectileBounds = geometryComponentBounds(projectile, root);
        const baseBounds = geometryComponentBounds(base, root)[0];
        assert.equal(connectorBounds.length, count, `FAN_${count} has one connector per projectile`);
        assert.equal(projectileBounds.length, count, `FAN_${count} keeps ${count} projectile bodies`);
        for (let index = 0; index < count; index += 1) {
            assert.ok(connectorBounds[index].intersectsBox(baseBounds), `FAN_${count} connector ${index} touches the base`);
            assert.ok(
                connectorBounds[index].intersectsBox(projectileBounds[index]),
                `FAN_${count} connector ${index} touches its projectile`,
            );
        }

        const surfaces = label.children.filter((child) => child.userData.weaponFanLabelSurface === true);
        assert.equal(surfaces.length, 2, `FAN_${count} has separate front and rear labels`);
        const front = surfaces.find((surface) => surface.userData.labelSide === 'front');
        const back = surfaces.find((surface) => surface.userData.labelSide === 'back');
        assert.ok(front && back, `FAN_${count} identifies both label sides`);
        const frontCenter = new THREE.Box3().setFromObject(front).getCenter(new THREE.Vector3());
        const backCenter = new THREE.Box3().setFromObject(back).getCenter(new THREE.Vector3());
        assert.ok(frontCenter.z * backCenter.z < 0, `FAN_${count} labels sit on opposite outside faces`);
        assert.deepEqual(
            rootSpaceVertexKeys(front, root, (point) => point.set(-point.x, point.y, -point.z)),
            rootSpaceVertexKeys(back, root),
            `FAN_${count} rear label mirrors the front for correct reading direction`,
        );
    }
});

test('THICK arrows point outward and THIN arrows point inward on both readable faces', async () => {
    const gltf = await parseLibrary();
    for (const [identifier, directions] of [
        ['THICK', { left: 'left', right: 'right' }],
        ['THIN', { left: 'right', right: 'left' }],
    ]) {
        const root = gltf.scene.getObjectByName(`pickup_${identifier}`);
        let assembly = null;
        root.traverse((node) => { if (node.userData.trailWidthArrowAssembly === true) assembly = node; });
        assert.ok(assembly, `${identifier} exports its arrow assembly`);
        assert.equal(assembly.userData.trailArrowMode, identifier === 'THICK' ? 'outward' : 'inward');
        const arrows = assembly.children.filter((child) => child.isMesh);
        assert.equal(arrows.length, 4, `${identifier} exports two physical arrows on each face`);
        for (const arrowMesh of arrows) {
            const face = arrowMesh.userData.trailArrowFace;
            const side = arrowMesh.userData.trailArrowSide;
            assert.ok(['front', 'back'].includes(face), `${identifier} arrow identifies its exterior face`);
            assert.ok(['left', 'right'].includes(side), `${identifier} ${face} arrow identifies its viewer side`);
            assert.equal(
                arrowMesh.userData.trailArrowDirection,
                directions[side],
                `${identifier} ${face} ${side} arrow records its viewer-readable direction`,
            );
            const worldDirection = face === 'front'
                ? directions[side]
                : directions[side] === 'left' ? 'right' : 'left';
            assert.equal(
                arrowMesh.userData.trailArrowWorldDirection,
                worldDirection,
                `${identifier} ${face} ${side} arrow records its model-space direction`,
            );
            assert.equal(
                horizontalArrowDirection(arrowMesh, root),
                worldDirection,
                `${identifier} ${face} ${side} arrow remains readable from its viewing side`,
            );
            assert.ok(
                geometrySignedVolume(arrowMesh.geometry) > 0,
                `${identifier} ${face} ${side} arrow has positive outward volume`,
            );

            const arrowBounds = new THREE.Box3().setFromObject(arrowMesh);
            const rootBounds = new THREE.Box3().setFromObject(root);
            const origin = arrowBounds.getCenter(new THREE.Vector3());
            const faceSign = face === 'front' ? 1 : -1;
            origin.z = faceSign > 0 ? rootBounds.max.z + 1 : rootBounds.min.z - 1;
            const raycaster = new THREE.Raycaster(
                origin,
                new THREE.Vector3(0, 0, -faceSign),
                0,
                rootBounds.getSize(new THREE.Vector3()).z + 2,
            );
            const firstHit = raycaster.intersectObject(root, true)[0];
            assert.ok(firstHit, `${identifier} ${face} ${side} arrow is raycastable`);
            assert.equal(
                firstHit.object,
                arrowMesh,
                `${identifier} ${face} ${side} arrow is the first visible exterior surface`,
            );
        }
    }
});

test('rotating pilot icons keep semantic faces on both sides', async () => {
    const gltf = await parseLibrary();
    for (const identifier of ['SPEED_UP', 'SHIELD', 'HEALTH']) {
        const root = gltf.scene.getObjectByName(`pickup_${identifier}`);
        const overall = new THREE.Box3().setFromObject(root);
        const accent = roleBounds(root, 'accent');
        const center = overall.getCenter(new THREE.Vector3());
        const depth = overall.getSize(new THREE.Vector3()).z;
        assert.ok(!accent.isEmpty(), `${identifier} exports semantic accent surfaces`);
        assert.ok(accent.min.z < center.z - depth * 0.25, `${identifier} accent reaches its front`);
        assert.ok(accent.max.z > center.z + depth * 0.25, `${identifier} accent reaches its back`);
    }
});

test('heavy rocket exports an outward-facing open nozzle with recessed glow', async () => {
    const gltf = await parseLibrary();
    const heavy = gltf.scene.getObjectByName('pickup_ROCKET_HEAVY');
    let nozzle = null;
    let glow = null;
    heavy.traverse((node) => {
        if (node.userData.rocketNozzle === true) nozzle = node;
        if (node.userData.rocketNozzleGlow === true) glow = node;
    });
    assert.ok(nozzle?.isMesh, 'heavy rocket exports its nozzle shell');
    assert.ok(glow?.isMesh, 'heavy rocket exports its nozzle glow insert');

    const positions = nozzle.geometry.attributes.position;
    const indices = nozzle.geometry.index?.array ?? Array.from({ length: positions.count }, (_, index) => index);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const radial = new THREE.Vector3();
    let minimumY = Infinity;
    for (let index = 0; index < positions.count; index += 1) minimumY = Math.min(minimumY, positions.getY(index));
    let openingCaps = 0;
    let sideFaces = 0;
    for (let index = 0; index < indices.length; index += 3) {
        a.fromBufferAttribute(positions, indices[index]);
        b.fromBufferAttribute(positions, indices[index + 1]);
        c.fromBufferAttribute(positions, indices[index + 2]);
        if ([a.y, b.y, c.y].every((value) => Math.abs(value - minimumY) < 1e-5)) openingCaps += 1;
        if (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) < 1e-5) continue;
        normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        radial.copy(a).add(b).add(c).multiplyScalar(1 / 3).setY(0);
        assert.ok(normal.dot(radial) > 0, 'each nozzle side triangle faces outward for FrontSide rendering');
        sideFaces += 1;
    }
    assert.ok(sideFaces > 0, 'nozzle has a revolved outer wall');
    assert.equal(openingCaps, 0, 'nozzle exhaust end stays open');

    const nozzleBounds = new THREE.Box3().setFromObject(nozzle);
    const glowBounds = new THREE.Box3().setFromObject(glow);
    assert.ok(glowBounds.min.y > nozzleBounds.min.y, 'glow insert sits behind the nozzle opening');
});

test('GLB cache loads once and shares geometry and semantic materials across clones', async () => {
    const gltf = await parseLibrary();
    let loads = 0;
    const cache = new PowerupAuthoredModelCache(1.5, {
        loader: { loadAsync: async () => { loads += 1; return gltf; } },
        libraryUrl: 'memory://pickup-library.glb',
    });
    try {
        const [first, second, fog] = await Promise.all([
            cache.createModel('pickup_SHIELD', 0x4488ff),
            cache.createModel('pickup_SHIELD', 0x4488ff),
            cache.createModel('pickup_FOG', 0xd7dce2),
        ]);
        assert.equal(loads, 1);
        assert.equal(first.userData.blenderPickupModel, 'SHIELD');
        const firstMeshes = [];
        const secondMeshes = [];
        first.traverse((node) => { if (node.isMesh) firstMeshes.push(node); });
        second.traverse((node) => { if (node.isMesh) secondMeshes.push(node); });
        assert.deepEqual(firstMeshes.map((mesh) => mesh.geometry), secondMeshes.map((mesh) => mesh.geometry));
        assert.deepEqual(firstMeshes.map((mesh) => mesh.material), secondMeshes.map((mesh) => mesh.material));
        const byRole = new Map(firstMeshes.map((mesh) => [mesh.userData.pickupMaterialRole, mesh.material]));
        assert.equal(byRole.get('metal').color.getHex(THREE.SRGBColorSpace), 0x526477);
        assert.equal(byRole.get('metal').metalness, 0.35);
        assert.equal(byRole.get('metal').roughness, 0.35);
        assert.equal(byRole.get('frame').color.getHex(THREE.SRGBColorSpace), 0xdbe5ea);
        assert.equal(byRole.get('frame').metalness, 0.08);
        assert.equal(byRole.get('accent').color.getHex(THREE.SRGBColorSpace), 0x4488ff);
        assert.equal(byRole.get('accent').emissiveIntensity, 0.08);
        let fogMatte = null;
        fog.traverse((mesh) => {
            if (mesh.isMesh && mesh.userData.pickupMaterialRole === 'matte') fogMatte = mesh.material;
        });
        assert.equal(fogMatte.color.getHex(THREE.SRGBColorSpace), 0xd7dce2);
        assert.equal(fogMatte.roughness, 0.72);
        assert.equal(fogMatte.metalness, 0.04);
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
