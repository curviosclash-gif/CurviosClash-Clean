import * as THREE from 'three';

/** @typedef {[number, number, number]} Vector3Tuple */

/**
 * Pure placement math for one model inside a GLB collection: where its slot sits and turns in
 * world space, how much the loaded scene must be scaled to reach its authored size, and the
 * offset that re-centers the model on its footprint (so it stands on its bottom, not its
 * center). `GLBMapLoader.placeCollectionScene` applies this while assembling the runtime scene
 * graph; the animated-setpiece clearance test (`tests/animated-setpiece-clearance.contract.test.mjs`)
 * uses the same function to rebuild that placement outside the renderer, so the test can never
 * compute a placement that diverges from what players actually collide against.
 *
 * @param {THREE.Box3} bounds bind-pose bounding box of the model, in the GLB file's own units
 * @param {{ position: number[], rotation: number[], targetSize: number, scale: number }} descriptor
 * @param {number} placementScale world units per authored unit (e.g. CONFIG.ARENA.MAP_SCALE)
 * @returns {{ slotPosition: Vector3Tuple, slotRotation: Vector3Tuple, fitScale: number, offset: Vector3Tuple }}
 */
export function computeCollectionPlacement(bounds, descriptor, placementScale) {
    const [px, py, pz] = descriptor.position;
    const [rx, ry, rz] = descriptor.rotation;
    /** @type {Vector3Tuple} */
    const slotPosition = [px * placementScale, py * placementScale, pz * placementScale];
    /** @type {Vector3Tuple} */
    const slotRotation = [rx, ry, rz];

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
    const fitScale = descriptor.targetSize > 0
        ? (descriptor.targetSize * placementScale) / maxDimension
        : descriptor.scale * placementScale;

    /** @type {Vector3Tuple} */
    const offset = [-center.x, -bounds.min.y, -center.z];

    return { slotPosition, slotRotation, fitScale, offset };
}
