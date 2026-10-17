import * as THREE from 'three';
import { createEndlessPathSample, sampleEndlessModuleFrame } from './EndlessParcoursPathMetric.js';

// Build-time scratch. Frames are copied into owned mesh matrices before the next placement.
const FRAME = createEndlessPathSample();
const BASIS = new THREE.Matrix4();
const RIGHT = new THREE.Vector3(), UP = new THREE.Vector3(), TANGENT = new THREE.Vector3();

export function resolveEndlessCoursePoint(module, x, y, localZ, out) {
    sampleEndlessModuleFrame(module, localZ / module.length, out);
    out.position.x += out.right.x * x + out.up.x * y;
    out.position.y += out.right.y * x + out.up.y * y;
    out.position.z += out.right.z * x + out.up.z * y;
    return out;
}

export function placeEndlessCourseMesh(mesh, module, x, y, localZ) {
    resolveEndlessCoursePoint(module, x, y, localZ, FRAME);
    mesh.position.copy(FRAME.position);
    RIGHT.copy(FRAME.right); UP.copy(FRAME.up); TANGENT.copy(FRAME.tangent);
    BASIS.makeBasis(RIGHT, UP, TANGENT);
    mesh.quaternion.setFromRotationMatrix(BASIS);
    mesh.updateMatrixWorld(true);
    return mesh;
}
