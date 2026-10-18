import * as THREE from 'three';
import { deriveEndlessSeed } from '../../shared/contracts/EndlessParcoursContract.js';
import { createStaticMeshCollider } from '../arena/StaticMeshCollider.js';
import { resolveEndlessSidePort, isEndlessPortPatch, sidePortRingProgress, appendEndlessSidePort, initializeEndlessSidePort } from './EndlessParcoursSidePort.js';
import { createEndlessPathSample, sampleEndlessModuleFrame } from './EndlessParcoursPathMetric.js';

export const ENDLESS_TUBE = Object.freeze({ radialSegments: 24, axialSegments: 32, minRadius: 27, thickness: 1.2 });

export function resolveEndlessTubeRadius(baseSeed, moduleIndex, progress) {
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const amplitude = 2 + deriveEndlessSeed(baseSeed, `tube-radius:${moduleIndex}`) % 7;
    return ENDLESS_TUBE.minRadius + amplitude * Math.sin(Math.PI * t) ** 2;
}

function geometryFrom(positions, indices) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    // Owned by the streaming instance, not by renderer-wide scene teardown.
    geometry.userData.__sharedNoDispose = true;
    return geometry;
}

/** Build the visible wall, its exact hollow-solid collider and a closed inner volume. */
export function buildEndlessTube({ module, baseSeed, material, ownerId }) {
    const { radialSegments: radial, axialSegments: axial, thickness } = ENDLESS_TUBE;
    const stride = radial, layerVertices = (axial + 1) * stride;
    const port = resolveEndlessSidePort(module, baseSeed);
    const positions = Array(layerVertices * 2 * 3).fill(0);
    const inner = Array((layerVertices + 2) * 3).fill(0);
    const frame = createEndlessPathSample();
    for (let ring = 0; ring <= axial; ring++) {
        const t = ring / axial;
        sampleEndlessModuleFrame(module, t, frame);
        const radius = resolveEndlessTubeRadius(baseSeed, module.moduleIndex, t);
        for (let side = 0; side < radial; side++) {
            const theta = side * Math.PI * 2 / radial, x = Math.cos(theta), y = Math.sin(theta);
            for (let layer = 0; layer < 2; layer++) {
                const offset = (layer * layerVertices + ring * stride + side) * 3;
                const layerT = sidePortRingProgress(port, ring, axial, layer, thickness, module.length);
                sampleEndlessModuleFrame(module, layerT, frame);
                const r = (layer ? resolveEndlessTubeRadius(baseSeed, module.moduleIndex, layerT) : radius) + layer * thickness;
                positions[offset] = frame.position.x + r * (frame.right.x * x + frame.up.x * y);
                positions[offset + 1] = frame.position.y + r * (frame.right.y * x + frame.up.y * y);
                positions[offset + 2] = frame.position.z - module.originZ + r * (frame.right.z * x + frame.up.z * y);
                if (layer === 0) {
                    const target = (ring * stride + side) * 3;
                    inner[target] = positions[offset]; inner[target + 1] = positions[offset + 1]; inner[target + 2] = positions[offset + 2];
                }
            }
        }
        if (ring === 0 || ring === axial) {
            const cap = (layerVertices + (ring === 0 ? 0 : 1)) * 3;
            inner[cap] = frame.position.x; inner[cap + 1] = frame.position.y; inner[cap + 2] = frame.position.z - module.originZ;
        }
    }
    const wallIndices = [], volumeIndices = [];
    for (let ring = 0; ring < axial; ring++) {
        for (let side = 0; side < radial; side++) {
            if (isEndlessPortPatch(port, ring, side, radial)) continue;
            const a = ring * stride + side, b = ring * stride + (side + 1) % radial;
            const c = a + stride, d = b + stride;
            // Inward winding for the cabin; outward winding for the exterior.
            wallIndices.push(a, c, b, b, c, d);
            volumeIndices.push(a, b, c, b, d, c);
            wallIndices.push(a + layerVertices, b + layerVertices, c + layerVertices,
                b + layerVertices, d + layerVertices, c + layerVertices);
        }
    }
    for (const ring of [0, axial]) {
        for (let side = 0; side < radial; side++) {
            const a = ring * stride + side, b = ring * stride + (side + 1) % radial;
            if (ring === 0) wallIndices.push(a, b, a + layerVertices, b, b + layerVertices, a + layerVertices);
            else wallIndices.push(a, a + layerVertices, b, b, a + layerVertices, b + layerVertices);
            // These cabin caps are query-only. The rendered/physical wall has an open centre.
            if (ring === 0) volumeIndices.push(b, a, layerVertices);
            else volumeIndices.push(a, b, layerVertices + 1);
        }
    }
    appendEndlessSidePort({ port, module, radial, axial, thickness,
        radiusAt: t => resolveEndlessTubeRadius(baseSeed, module.moduleIndex, t),
        positions, inner, wallIndices, volumeIndices, layerVertices });
    initializeEndlessSidePort(port, module, t => resolveEndlessTubeRadius(baseSeed, module.moduleIndex, t));
    const geometry = geometryFrom(positions, wallIndices);
    const volumeGeometry = geometryFrom(inner, volumeIndices);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${ownerId}:tube`;
    mesh.position.z = module.originZ;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    const volumeMesh = new THREE.Mesh(volumeGeometry, material);
    volumeMesh.position.z = module.originZ;
    volumeMesh.updateMatrixWorld(true);
    const volumeCollider = createStaticMeshCollider(volumeMesh);
    // The query mesh borrows the shared wall material and never enters the scene.
    const box = geometry.boundingBox.clone().translate(mesh.position);
    return { mesh, volumeCollider, box, port, geometries: [geometry, volumeGeometry],
        collider: { id: `${ownerId}:tube`, ownerId, kind: 'wall', isWall: true,
            box, meshCollider: createStaticMeshCollider(mesh) } };
}
