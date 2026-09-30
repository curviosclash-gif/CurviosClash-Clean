import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { computeCollectionPlacement } from '../src/entities/GLBCollectionPlacement.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { createSolidProbe } from './helpers/notre-dame-collision-utils.mjs';

const map = NOTRE_DAME_MAPS.notre_dame;
const isSolid = createSolidProbe(map.obstacles.filter((obstacle) => obstacle.compileWithGlb));
const FABRIC = new Set([
    'notre-dame-parvis', 'notre-dame-west-facade', 'notre-dame-nave',
    'notre-dame-transept', 'notre-dame-choir-apse', 'notre-dame-buttresses',
    'notre-dame-roof-fleche',
]);

async function loadChurchMeshes() {
    const visible = [];
    const colliding = [];
    for (const descriptor of map.glbModels.filter((model) => FABRIC.has(model.id))) {
        const gltf = await geometryOnlyGlbLoader.loadAsync(path.resolve(descriptor.url));
        const scene = gltf.scene;
        scene.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(scene);
        const placement = computeCollectionPlacement(bounds, descriptor, 1);
        const slot = new THREE.Group();
        slot.position.set(...placement.slotPosition);
        slot.rotation.set(...placement.slotRotation);
        const normalizer = new THREE.Group();
        normalizer.scale.setScalar(placement.fitScale);
        const offset = new THREE.Group();
        offset.position.set(...placement.offset);
        offset.add(scene);
        normalizer.add(offset);
        slot.add(normalizer);
        slot.updateWorldMatrix(true, true);
        scene.traverse((node) => {
            if (!node.isMesh) return;
            node.material.side = THREE.DoubleSide;
            node.userData.mapModelId = descriptor.id;
            if (!/_colonly/i.test(node.name)) visible.push(node);
            if (!/_nocol/i.test(node.name)) colliding.push(node);
        });
    }
    return { visible, colliding };
}

function firstHit(meshes, from, direction, distance) {
    const ray = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...direction), 0.001, distance);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit && { distance: hit.distance, mesh: hit.object.name, point: hit.point.toArray() };
}

function sphereHitsMesh(meshes, centre, radius) {
    const point = new THREE.Vector3(...centre);
    const closest = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const triangle = new THREE.Triangle();
    const radiusSq = radius * radius;
    for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;
        const index = geometry.index;
        const bounds = new THREE.Box3().setFromObject(mesh);
        if (point.distanceToSquared(bounds.clampPoint(point, closest)) > radiusSq) continue;
        const triangleCount = index ? index.count / 3 : positions.count / 3;
        for (let face = 0; face < triangleCount; face += 1) {
            const ia = index ? index.getX(face * 3) : face * 3;
            const ib = index ? index.getX(face * 3 + 1) : face * 3 + 1;
            const ic = index ? index.getX(face * 3 + 2) : face * 3 + 2;
            a.fromBufferAttribute(positions, ia).applyMatrix4(mesh.matrixWorld);
            b.fromBufferAttribute(positions, ib).applyMatrix4(mesh.matrixWorld);
            c.fromBufferAttribute(positions, ic).applyMatrix4(mesh.matrixWorld);
            triangle.set(a, b, c).closestPointToPoint(point, closest);
            if (point.distanceToSquared(closest) <= radiusSq) return mesh.name;
        }
    }
    return '';
}

function sphereSweepHit(meshes, from, to, radius) {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const delta = end.clone().sub(start);
    const steps = Math.ceil(delta.length() / (radius / 2));
    for (let step = 0; step <= steps; step += 1) {
        const centre = start.clone().addScaledVector(delta, step / steps);
        const mesh = sphereHitsMesh(meshes, centre.toArray(), radius);
        if (mesh) return { mesh, centre: centre.toArray(), step, steps };
    }
    return undefined;
}

function leaksThroughVisible(meshes, from, direction, distance) {
    const visible = firstHit(meshes.visible, from, direction, distance);
    if (!visible) return false;
    const collision = firstHit(meshes.colliding, from, direction, visible.distance + 0.8);
    const point = from.map((value, axis) => value + direction[axis] * visible.distance);
    return !collision && !isSolid(point);
}

function foamContains(point) {
    return map.obstacles.some((box) => box.kind === 'foam' && box.compileWithGlb
        && box.pos.every((center, axis) => Math.abs(point[axis] - center) < box.size[axis] / 2));
}

// A finding may only disappear. Each ray reaches the actual placed GLB triangles, while the
// supplementary boxes are limited to compileWithGlb, the only ones active with loaded models.
// Every measured surface and route probe must remain clear.
const KNOWN_FINDINGS = [];

test('Notre-Dame model collision findings only shrink', async () => {
    const meshes = await loadChurchMeshes();
    assert.ok(meshes.visible.length > 0 && meshes.colliding.length > 0);
    const cp10 = map.parcours.checkpoints.find((checkpoint) => checkpoint.id === 'CP10');
    assert.ok(cp10);
    assert.equal(sphereHitsMesh(meshes.colliding, cp10.pos, 1.6 / 3), '',
        'CP10 must clear the updated roof GLB for the largest shipped ship hitbox');
    const withoutRoof = {
        visible: meshes.visible.filter((mesh) => mesh.userData.mapModelId !== 'notre-dame-roof-fleche'),
        colliding: meshes.colliding.filter((mesh) => mesh.userData.mapModelId !== 'notre-dame-roof-fleche'),
    };
    const findings = [];
    const record = (id, broken) => { if (broken) findings.push(id); };

    record('K1-roof-ridge', leaksThroughVisible(meshes, [-30, 60, 0], [0, 1, 0], 24));
    record('K2-transept-gable', leaksThroughVisible(meshes, [17, 56, -20], [0, 0, -1], 22));
    record('K3-aisle-roof-seam', leaksThroughVisible(meshes, [-30, 35.5, 4], [0, 0, 1], 30));
    record('K4-clerestory-crown', leaksThroughVisible(withoutRoof, [-30, 54, 4], [0, 0, 1], 20));
    record('K5-apse-crack', !firstHit(meshes.visible, [68, 40, 15], [1, 0, 0], 16)
        && !firstHit(meshes.colliding, [68, 40, 15], [1, 0, 0], 16));
    record('K6-tower-finials', leaksThroughVisible(meshes, [-85, 105.2, -20], [0, 1, 0], 14));
    record('K7-island-over-water', foamContains([0, 4, 80])
        && !firstHit(meshes.colliding, [0, 15, 80], [0, -1, 0], 20));

    const sling = map.gates.find((gate) => gate.id === 'nd_apse_sling');
    assert.ok(sling);
    const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    record('S1-apse-sling-enclosed', directions.every((direction) =>
        firstHit(meshes.colliding, sling.pos, direction, 20)));
    const cp12 = map.parcours.checkpoints.find((checkpoint) => checkpoint.id === 'CP12');
    assert.ok(cp12);
    record('S2-CP12-intersects-vault', Boolean(firstHit(meshes.colliding, cp12.pos, [0, 1, 0], cp12.radius)));

    for (const id of ['CP13', 'CP14', 'FINISH']) {
        const ring = id === 'FINISH' ? map.parcours.finish
            : map.parcours.checkpoints.find((checkpoint) => checkpoint.id === id);
        assert.ok(ring, `${id} has a route anchor`);
        const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (const direction of directions) {
            assert.equal(firstHit(meshes.colliding, ring.pos, direction, ring.radius), undefined,
                `${id} clears the loaded cathedral meshes along ${direction.join(',')}`);
        }
    }

    // The paired belfry openings remain open at route height, on both tower sides.
    for (const ring of ['CP13', 'CP14'].map((id) => (
        map.parcours.checkpoints.find((checkpoint) => checkpoint.id === id)
    ))) {
        assert.equal(firstHit(meshes.colliding, [ring.pos[0] - 7, ring.pos[1], ring.pos[2]],
            [1, 0, 0], 14), undefined, 'the belfry stays open through its west/east walls');
    }

    const apseSamples = [49.25, 56.5, 62.0].map((metresX) => {
        const x = (metresX - 41.4) * 1.4 + 41.4 * 1.4;
        const hit = firstHit(meshes.visible, [x, 8 + 96 * 1.4, 0], [0, -1, 0], 120);
        assert.ok(hit, `the rounded apse roof is visible above x=${metresX} m`);
        return (hit.point[1] - 8) / 1.4;
    });
    assert.ok(apseSamples[0] > apseSamples[1] && apseSamples[1] > apseSamples[2],
        `the half-round roof curves down to the apse rim: ${apseSamples.map((height) => height.toFixed(1)).join(', ')} m`);

    assert.deepEqual(findings.sort(), [...KNOWN_FINDINGS].sort());
});

test('the raised triforium and gallery form two continuous, collider-clear flight paths', async () => {
    const meshes = await loadChurchMeshes();
    const galleryHeight = 8 + 17.5 * 1.4;
    const shipRadius = 1.6 / 3;

    // Enter from the central vessel under the arcade, rise in the side aisle above its decorative
    // vault ribs, then fly through the real pointed triforium opening into the upper gallery.
    // Every leg uses the largest shipped ship hitbox, not a centre ray.
    // The eastmost bay opens into the crossing rather than another nave arcade; its gallery
    // segment is covered by the full-length lane sweep below, while the adjacent bay supplies
    // the paired entry and exit.
    for (let bay = 0; bay < 9; bay += 1) {
        const galleryX = (-54.75 + 3 + bay * 6) * 1.4;
        const arcadeX = (-54.75 + 6 + bay * 6) * 1.4;
        const lowerArcadeHeight = 8 + 14 * 1.4;
        for (const side of [-1, 1]) {
            const entry = [
                [arcadeX, lowerArcadeHeight, 0],
                [arcadeX, lowerArcadeHeight, side * 10.5],
                [arcadeX, galleryHeight, side * 10.5],
                [galleryX, galleryHeight, side * 10.5],
                [galleryX, galleryHeight, side * 20.3],
            ];
            for (let leg = 0; leg < entry.length - 1; leg += 1) {
                assert.equal(sphereSweepHit(meshes.colliding, entry[leg], entry[leg + 1], shipRadius), undefined,
                    `bay ${bay} entry leg ${leg} is clear into the ${side > 0 ? 'south' : 'north'} gallery`);
            }
            for (let leg = entry.length - 1; leg > 0; leg -= 1) {
                assert.equal(sphereSweepHit(meshes.colliding, entry[leg], entry[leg - 1], shipRadius), undefined,
                    `bay ${bay} exit leg ${leg - 1} is clear from the ${side > 0 ? 'south' : 'north'} gallery`);
            }
        }
    }

    // Sweep the whole longitudinal lane, including every bay joint, supports, and both ends.
    for (const side of [-1, 1]) {
        const firstBayOpening = (-54.75 + 3) * 1.4;
        const lastBayOpening = (-54.75 + 3 + 9 * 6) * 1.4;
        const sweep = sphereSweepHit(meshes.colliding,
            [firstBayOpening - 3, galleryHeight, side * 20.3],
            [lastBayOpening + 3, galleryHeight, side * 20.3], shipRadius);
        assert.equal(sweep, undefined,
            `the ${side > 0 ? 'south' : 'north'} gallery is ship-clear through every bay seam and end`);
    }

    // Keep collision on the raised roof itself; the passable gallery must be a deliberate gap
    // below it rather than a missing collider that would reopen the nave roof to gameplay.
    for (const side of [-1, 1]) {
        const roofCentre = [(-54.75 + 3) * 1.4, 8 + 22 * 1.4, side * 20.3];
        assert.ok(sphereHitsMesh(meshes.colliding, roofCentre, shipRadius),
            `the ${side > 0 ? 'south' : 'north'} raised gallery roof still blocks above the flight lane`);
    }

    // The unchanged mandatory route keeps a full ship radius at each nave/choir anchor.
    for (const id of ['CP06', 'CP07', 'CP08_ATTIC', 'CP08_AISLE', 'CP09', 'CP10',
        'CP11_CHOIR', 'CP11_AMBULATORY']) {
        const checkpoint = map.parcours.checkpoints.find((entry) => entry.id === id);
        assert.ok(checkpoint, `${id} remains on the current route`);
        assert.equal(sphereHitsMesh(meshes.colliding, checkpoint.pos, shipRadius), '',
            `${id} remains clear of the updated interior GLBs`);
    }
});
