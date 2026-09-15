import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
    createBoostPortalMesh,
    createPortalGateVisualRegistry,
    createPortalMesh,
    createSlingshotGateMesh,
} from '../src/entities/arena/PortalGateMeshFactory.js';
import { PortalRuntimeSystem } from '../src/entities/arena/portal/PortalRuntimeSystem.js';

const PORTAL_TYPES = [
    'portal_ring',
    'portal_cross',
    'portal_diamond',
    'portal_hex',
    'portal_octagon',
    'portal_square',
    'portal_star',
    'portal_triangle',
];

function createRendererHarness() {
    const scene = new THREE.Scene();
    return {
        scene,
        renderer: {
            addToScene(object) { scene.add(object); },
            removeFromScene(object) { scene.remove(object); },
        },
    };
}

function instanceMatrix(component) {
    return component.batch.instances[component.instanceId].matrix.clone();
}

function instanceColor(component) {
    return component.batch.instances[component.instanceId].colorHex;
}

function widthOf(geometry) {
    geometry.computeBoundingBox();
    return geometry.boundingBox.max.x - geometry.boundingBox.min.x;
}

function nearestRayHit(objects, origin, direction) {
    for (const object of objects) object.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(origin, direction);
    return raycaster.intersectObjects(objects, false)[0] || null;
}

function nearestGeometryRayHit(geometries, origin, direction) {
    const ray = new THREE.Ray(origin, direction);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const target = new THREE.Vector3();
    let nearest = null;
    for (const geometry of geometries) {
        const position = geometry.attributes.position;
        const index = geometry.index;
        const triangleCount = index ? index.count / 3 : position.count / 3;
        for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
            const offset = triangleIndex * 3;
            const ia = index ? index.getX(offset) : offset;
            const ib = index ? index.getX(offset + 1) : offset + 1;
            const ic = index ? index.getX(offset + 2) : offset + 2;
            a.fromBufferAttribute(position, ia);
            b.fromBufferAttribute(position, ib);
            c.fromBufferAttribute(position, ic);
            if (!ray.intersectTriangle(a, b, c, false, target)) continue;
            const distance = origin.distanceTo(target);
            if (!nearest || distance < nearest.distance) nearest = { geometry, distance };
        }
    }
    return nearest;
}

test('all portal silhouettes are beveled deep frames with a wide transparent opening', () => {
    for (const [index, visualType] of PORTAL_TYPES.entries()) {
        const { scene, renderer } = createRendererHarness();
        const registry = createPortalGateVisualRegistry(renderer);
        const handle = createPortalMesh(new THREE.Vector3(), 0x38d9ff, 'NEUTRAL', registry, {
            visualType,
            pairIndex: index,
        });
        const body = handle.userData.body;
        const bounds = body.batch.geometry.boundingBox;

        assert.ok(bounds.max.z - bounds.min.z >= 0.45, `${visualType} needs physical depth`);
        assert.ok(handle.userData.innerOpeningRadius >= 3.65, `${visualType} opening must remain near the old 3.7 radius`);
        assert.equal(handle.userData.disc, null, `${visualType} must not add a center disc`);

        scene.updateMatrixWorld(true);
        const opaquePortalObjects = [body.batch.mesh];
        const centerHit = nearestRayHit(
            opaquePortalObjects,
            new THREE.Vector3(0, 0, 8),
            new THREE.Vector3(0, 0, -1)
        );
        assert.equal(centerHit, null, `${visualType} opaque frame must leave the center transparent`);
        registry.dispose();
    }
});

test('square and diamond keep distinct authored static orientations', () => {
    const { renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const square = createPortalMesh(new THREE.Vector3(), 0x00ffcc, 'NEUTRAL', registry, {
        visualType: 'portal_square',
    });
    const diamond = createPortalMesh(new THREE.Vector3(20, 0, 0), 0x00ffcc, 'NEUTRAL', registry, {
        visualType: 'portal_diamond',
    });
    const squarePositions = Array.from(square.userData.body.batch.geometry.attributes.position.array.slice(0, 18));
    const diamondPositions = Array.from(diamond.userData.body.batch.geometry.attributes.position.array.slice(0, 18));

    assert.notDeepEqual(squarePositions, diamondPositions);
    assert.ok(square.quaternion.equals(new THREE.Quaternion()));
    assert.ok(diamond.quaternion.equals(new THREE.Quaternion()));
    registry.dispose();
});

test('pair glyph identity and color survive differing shapes, directions, pulses, and cache order', () => {
    const { renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const portalA = createPortalMesh(new THREE.Vector3(-12, 0, 0), 0xaa44ff, 'UP', registry, {
        visualType: 'portal_triangle',
        pairIndex: 6,
    });
    const portalB = createPortalMesh(new THREE.Vector3(12, 0, 0), 0xaa44ff, 'DOWN', registry, {
        visualType: 'portal_star',
        pairIndex: 6,
    });
    const unrelated = createPortalMesh(new THREE.Vector3(30, 0, 0), 0x22ffaa, 'NEUTRAL', registry, {
        visualType: 'portal_triangle',
        pairIndex: 6,
    });

    assert.equal(portalA.userData.pairMarkIndex, portalB.userData.pairMarkIndex);
    assert.equal(instanceColor(portalA.userData.pairMark), 0xaa44ff);
    assert.equal(instanceColor(portalB.userData.pairMark), 0xaa44ff);
    assert.equal(instanceColor(portalA.userData.directionCue), 0xf4fbff);
    assert.equal(instanceColor(portalB.userData.directionCue), 0xf4fbff);

    const bodyBefore = instanceMatrix(portalA.userData.body);
    const markBefore = instanceMatrix(portalA.userData.pairMark);
    const unrelatedMarkBefore = instanceColor(unrelated.userData.pairMark);
    unrelated.updatePortalVisualState(1.25, 1, true, true);
    portalA.updatePortalVisualState(1.25, 0.75, false, true);
    assert.ok(instanceMatrix(portalA.userData.body).equals(bodyBefore), 'pulse must not move the static frame');
    assert.ok(instanceMatrix(portalA.userData.pairMark).equals(markBefore), 'pulse must not move the pair glyph');
    assert.equal(instanceColor(portalA.userData.pairMark), 0xaa44ff);
    assert.equal(instanceColor(portalB.userData.pairMark), 0xaa44ff);
    assert.equal(instanceColor(unrelated.userData.pairMark), unrelatedMarkBefore);

    const fullFirst = createPortalMesh(new THREE.Vector3(), 0xffffff, 'NEUTRAL', registry, { pairIndex: 2 });
    const compactSecond = createPortalMesh(new THREE.Vector3(), 0xffffff, 'NEUTRAL', registry, { pairIndex: 2, compact: true });
    const compactFirst = createPortalMesh(new THREE.Vector3(), 0xffffff, 'NEUTRAL', registry, { pairIndex: 3, compact: true });
    const fullSecond = createPortalMesh(new THREE.Vector3(), 0xffffff, 'NEUTRAL', registry, { pairIndex: 3 });
    assert.ok(widthOf(fullFirst.userData.pairMark.batch.geometry) > widthOf(compactSecond.userData.pairMark.batch.geometry));
    assert.ok(widthOf(fullSecond.userData.pairMark.batch.geometry) > widthOf(compactFirst.userData.pairMark.batch.geometry));

    const markFamily = Array.from({ length: 10 }, (_, pairIndex) => createPortalMesh(
        new THREE.Vector3(pairIndex * 12, 20, 0),
        0x55ddff,
        'NEUTRAL',
        registry,
        { pairIndex }
    ));
    assert.deepEqual(markFamily.map((handle) => handle.userData.pairMarkIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(new Set(markFamily.map((handle) => handle.userData.pairMark.batch.geometry.uuid)).size, 10);
    registry.dispose();
});

test('portal colored inset rim is the visible surface from both traversal directions', () => {
    const { renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const handle = createPortalMesh(new THREE.Vector3(), 0x35e8ff, 'NEUTRAL', registry);
    const bodyGeometry = handle.userData.body.batch.geometry;
    const rimGeometry = handle.userData.rim.batch.geometry;
    const sampleRadius = handle.userData.innerOpeningRadius + 0.14;

    const frontHit = nearestGeometryRayHit(
        [bodyGeometry, rimGeometry],
        new THREE.Vector3(sampleRadius, 0, 8),
        new THREE.Vector3(0, 0, -1)
    );
    const rearHit = nearestGeometryRayHit(
        [bodyGeometry, rimGeometry],
        new THREE.Vector3(sampleRadius, 0, -8),
        new THREE.Vector3(0, 0, 1)
    );
    assert.equal(frontHit?.geometry, rimGeometry);
    assert.equal(rearHit?.geometry, rimGeometry);
    registry.dispose();
});

test('traversal pulse sweeps dynamic streaks while static matrices remain unchanged', () => {
    const { renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const handle = createPortalMesh(new THREE.Vector3(), 0xff55aa, 'UP', registry, { pairIndex: 1 });
    const bodyBefore = instanceMatrix(handle.userData.body);
    const rimBefore = instanceMatrix(handle.userData.rim);
    const arrowBefore = instanceMatrix(handle.userData.directionCue);

    handle.updatePortalVisualState(2, 1, true, true);
    const startPosition = handle.userData.energyFlow[0].localPosition.clone();
    handle.updatePortalVisualState(2, 0.45, true, true);
    const laterPosition = handle.userData.energyFlow[0].localPosition.clone();

    assert.ok(startPosition.distanceTo(laterPosition) > 0.01, 'pulse progress must move the traversal wave');
    assert.ok(instanceMatrix(handle.userData.body).equals(bodyBefore));
    assert.ok(instanceMatrix(handle.userData.rim).equals(rimBefore));
    assert.ok(instanceMatrix(handle.userData.directionCue).equals(arrowBefore));
    registry.dispose();
});

test('runtime synchronizes destination impulse and resets pulse while personal cooldown remains', () => {
    const callsA = [];
    const callsB = [];
    const portal = {
        posA: new THREE.Vector3(0, 0, 0),
        posB: new THREE.Vector3(40, 0, 0),
        cooldowns: new Map(),
        visualPulseRemaining: 0,
        visualPulseDestination: null,
        meshA: { updatePortalVisualState(...args) { callsA.push(args); } },
        meshB: { updatePortalVisualState(...args) { callsB.push(args); } },
    };
    const runtime = new PortalRuntimeSystem({ portalsEnabled: true, portals: [portal], exitPortals: [] });

    const result = runtime.checkPortal(new THREE.Vector3(), 0.1, 'player-1');
    assert.equal(result.target, portal.posB);
    assert.equal(portal.visualPulseDestination, 'B');
    assert.equal(runtime.checkPortal(new THREE.Vector3(), 0.1, 'player-2')?.ok, true);
    runtime.update(0.05);
    assert.ok(callsA.at(-1)[1] > 0);
    assert.equal(callsA.at(-1)[2], false);
    assert.equal(callsB.at(-1)[2], true);

    runtime.update(0.4);
    assert.equal(callsA.at(-1)[1], 0);
    assert.equal(callsB.at(-1)[1], 0);
    assert.equal(callsB.at(-1)[2], false);
    assert.ok(portal.cooldowns.get('player-1') > 0, 'visual reset must not clear personal traversal cooldown');
});

test('exit keeps its active-size silhouette while illumination changes', () => {
    const { renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const mesh = createPortalMesh(new THREE.Vector3(), 0x00ff88, 'NEUTRAL', registry, {
        kind: 'exit',
        active: false,
    });
    const exitPortal = {
        pos: new THREE.Vector3(),
        active: false,
        cooldowns: new Map(),
        visualPulseRemaining: 0,
        mesh,
    };
    const runtime = new PortalRuntimeSystem({ portalsEnabled: true, portals: [], exitPortals: [exitPortal] });
    const bodyBefore = instanceMatrix(mesh.userData.body);
    const inactiveColor = instanceColor(mesh.userData.rim);

    assert.ok(Math.abs(mesh.userData.innerOpeningRadius - 5.18) < 0.08);
    runtime.activateExitPortals();
    const activeColor = instanceColor(mesh.userData.rim);
    exitPortal.visualPulseRemaining = 0.4;
    runtime.update(0.1);
    runtime.deactivateExitPortals();
    const resetInactiveColor = instanceColor(mesh.userData.rim);
    const resetInactiveCrownColor = instanceColor(mesh.userData.crown);

    assert.notEqual(activeColor, inactiveColor);
    assert.equal(resetInactiveColor, inactiveColor);
    assert.equal(resetInactiveCrownColor, 0x18352f);
    assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
    assert.ok(instanceMatrix(mesh.userData.body).equals(bodyBefore));
    assert.ok(mesh.userData.crown, 'exit needs a unique crown marker');
    registry.dispose();
});

test('special gates retain open centers and orient their functional cues locally', () => {
    const { renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const authoredRotation = new THREE.Euler(0.3, 0.7, -0.2);
    const boost = createBoostPortalMesh(new THREE.Vector3(), authoredRotation, 0xffb34d, registry);
    const slingshot = createSlingshotGateMesh(new THREE.Vector3(20, 0, 0), authoredRotation, 0x7dfbff, registry);
    const boostOpaqueMeshes = [boost.userData.frameBody.batch.mesh];
    const slingshotOpaqueMeshes = [...new Set(slingshot.userData.frameBody.map((entry) => entry.batch.mesh))];

    assert.equal(nearestRayHit(boostOpaqueMeshes, new THREE.Vector3(0, 0, 8), new THREE.Vector3(0, 0, -1)), null);
    assert.equal(nearestRayHit(slingshotOpaqueMeshes, new THREE.Vector3(20, 0, 8), new THREE.Vector3(0, 0, -1)), null);
    assert.equal(boost.userData.innerDisk, null);
    assert.equal(slingshot.userData.axisBeam, null);
    assert.ok(slingshot.userData.upCue);

    const localChevronTip = new THREE.Vector3(0, -1, 0)
        .applyQuaternion(boost.userData.spines[0].localQuaternion)
        .normalize();
    assert.ok(localChevronTip.distanceTo(new THREE.Vector3(0, 0, 1)) < 0.0001);
    assert.ok(boost.quaternion.equals(new THREE.Quaternion().setFromEuler(authoredRotation)));
    assert.ok(slingshot.quaternion.equals(new THREE.Quaternion().setFromEuler(authoredRotation)));
    registry.dispose();
});

test('registry rebuild disposal removes batches without disposing permanent shared resources', () => {
    const { scene, renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    const handle = createPortalMesh(new THREE.Vector3(), 0x00ffcc, 'NEUTRAL', registry);
    const geometry = handle.userData.body.batch.geometry;
    const material = handle.userData.body.batch.material;
    let geometryDisposals = 0;
    let materialDisposals = 0;
    geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    material.addEventListener('dispose', () => { materialDisposals += 1; });
    assert.ok(scene.children.length > 0);

    registry.dispose();

    assert.equal(scene.children.length, 0);
    assert.equal(geometry.userData.__sharedNoDispose, true);
    assert.equal(material.userData.__sharedNoDispose, true);
    assert.equal(geometryDisposals, 0);
    assert.equal(materialDisposals, 0);

    const rebuiltRegistry = createPortalGateVisualRegistry(renderer);
    const rebuilt = createPortalMesh(new THREE.Vector3(), 0xff55aa, 'NEUTRAL', rebuiltRegistry);
    assert.ok(scene.children.length > 0);
    assert.equal(rebuilt.userData.body.batch.geometry, geometry, 'rebuild reuses the permanent geometry cache');
    rebuiltRegistry.dispose();
    assert.equal(scene.children.length, 0);
});

test('instanced portal materials never request missing geometry vertex colors', () => {
    const { scene, renderer } = createRendererHarness();
    const registry = createPortalGateVisualRegistry(renderer);
    createPortalMesh(new THREE.Vector3(), 0x33ddff, 'UP', registry, { pairIndex: 4 });
    createBoostPortalMesh(new THREE.Vector3(12, 0, 0), new THREE.Euler(), 0xffb34d, registry);
    createSlingshotGateMesh(new THREE.Vector3(24, 0, 0), new THREE.Euler(), 0x7dfbff, registry);

    scene.traverse((object) => {
        if (!object.isInstancedMesh || object.material?.vertexColors !== true) return;
        assert.ok(object.geometry.getAttribute('color'), `${object.name} requests a missing color attribute`);
    });
    registry.dispose();
});
