import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deriveEndlessSeed, sampleEndlessSeed } from '../../shared/contracts/EndlessParcoursContract.js';
import { ENDLESS_TUBE, resolveEndlessTubeRadius } from './EndlessParcoursTube.js';
import { placeEndlessCourseMesh, resolveEndlessCoursePoint } from './EndlessParcoursCourseSpace.js';
import { createEndlessPathSample } from './EndlessParcoursPathMetric.js';

/** Flat wall reliefs and rim bands: no new obstacle across the playable cabin or side mouth. */
export function buildEndlessBiomeView(module, baseSeed, biomeId, style, port) {
    const group = new THREE.Group(), geometries = [], opaque = [], glowing = [];
    const frame = createEndlessPathSample();
    group.name = `endless-module:${module.moduleIndex}:biome:${biomeId}`;
    const put = (geometry, collection, x, y, z, sx = 1, sy = 1, sz = 1, angle = 0) => {
        const positions = geometry.getAttribute('position'), cos = Math.cos(angle), sin = Math.sin(angle);
        const radiusAtCenter = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, z / module.length);
        for (let i = 0; i < positions.count; i++) {
            const vx = positions.getX(i) * sx, vy = positions.getY(i) * sy;
            let px = x + vx * cos - vy * sin, py = y + vx * sin + vy * cos;
            const localZ = z + positions.getZ(i) * sz, radius = Math.hypot(px, py);
            const segment = Math.PI * 2 / ENDLESS_TUBE.radialSegments;
            const theta = Math.atan2(py, px), within = ((theta % segment) + segment) % segment - segment / 2;
            const wall = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, localZ / module.length)
                * Math.cos(segment / 2) / Math.cos(within);
            const r = wall + radius - radiusAtCenter - 0.12;
            px *= r / radius; py *= r / radius;
            // Sample every vertex on the curve/radius, so long pipes never cut across bends.
            resolveEndlessCoursePoint(module, px, py, localZ, frame);
            positions.setXYZ(i, frame.position.x, frame.position.y, frame.position.z);
        }
        geometry.computeVertexNormals();
        if (!geometry.index) geometry.setIndex(Array.from({ length: positions.count }, (_, index) => index));
        collection.push(geometry);
    };
    const clearMouth = t => !port || t < port.firstRing / 32 - 0.04 || t > port.lastRing / 32 + 0.04;
    for (const t of [0.16, 0.5, 0.84]) {
        if (!clearMouth(t)) continue;
        const radius = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, t), z = t * module.length;
        // Circular rim bands follow the real local frame, including tilted/curved modules.
        put(new THREE.TorusGeometry(radius + 0.04, 0.14, 4, 32), glowing, 0, 0, z);
        if (biomeId === 'industrial') {
            const ribRadius = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, (z + 1.1) / module.length);
            put(new THREE.TorusGeometry(ribRadius + 0.12, 0.3, 4, 24), opaque, 0, 0, z + 1.1);
            for (const side of [-1, 1]) put(new THREE.BoxGeometry(0.3, 3, 16), opaque, side * radius, 0, z);
        } else if (biomeId === 'crystal') {
            for (let i = 0; i < 6; i++) {
                const angle = i * Math.PI / 3, r = radius + 0.05;
                // Faceted, shallow inlaid crystals keep the physical wall as the flight boundary.
                put(new THREE.OctahedronGeometry(1), glowing, Math.cos(angle) * r, Math.sin(angle) * r, z,
                    0.18, 3, 1.8, angle);
            }
        } else if (biomeId === 'ruins') {
            for (let i = 0; i < 8; i++) {
                const localZ = z + (i % 2 ? 2 : -2);
                const angle = i * Math.PI / 4, r = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, localZ / module.length) + 0.05;
                put(new THREE.BoxGeometry(0.28, 4.5, 5), opaque, Math.cos(angle) * r, Math.sin(angle) * r,
                    localZ, 1, 1, 1, angle);
            }
        } else if (biomeId === 'energy') {
            const nextRadius = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, (z + 2) / module.length);
            put(new THREE.TorusGeometry(nextRadius + 0.05, 0.1, 4, 32), glowing, 0, 0, z + 2);
        }
    }
    for (const [pieces, material] of [[opaque, style.detail], [glowing, style.trim]]) {
        if (!pieces.length) continue;
        const geometry = mergeGeometries(pieces); for (const piece of pieces) piece.dispose();
        geometry.userData.__sharedNoDispose = true; geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = false; group.add(mesh);
    }
    const positions = new Float32Array(24 * 3);
    for (let i = 0; i < 24; i++) {
        const roll = sampleEndlessSeed(deriveEndlessSeed(baseSeed, `biome-dust:${module.moduleIndex}:${i}`));
        const t = 0.05 + roll * 0.9, r = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, t) * (0.62 + i % 3 * 0.09);
        const angle = i * 2.399963;
        const point = new THREE.Object3D(); placeEndlessCourseMesh(point, module, Math.cos(angle) * r, Math.sin(angle) * r, t * module.length);
        positions.set(point.position.toArray(), i * 3);
    }
    const particleGeometry = new THREE.BufferGeometry(); particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.userData.__sharedNoDispose = true; geometries.push(particleGeometry);
    group.add(new THREE.Points(particleGeometry, style.particles));
    return { group, geometries };
}
