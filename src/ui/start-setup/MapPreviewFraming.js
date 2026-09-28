import * as THREE from 'three';

// Same diagonal view the miniature has always opened with.
const VIEW_DIRECTION = new THREE.Vector3(5.8, 4.95, 5.8).normalize();
const MIN_RADIUS = 0.5;
const scratchBox = new THREE.Box3();

function expandByDrawable(target, object) {
    if (object.isInstancedMesh) {
        if (!object.boundingBox) object.computeBoundingBox();
        scratchBox.copy(object.boundingBox);
    } else {
        const geometry = object.geometry;
        if (!geometry) return;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        scratchBox.copy(geometry.boundingBox);
    }
    if (scratchBox.isEmpty()) return;
    target.union(scratchBox.applyMatrix4(object.matrixWorld));
}

/**
 * Bounds of what the miniature actually draws. Hidden slots (break scenes, collision bodies) and
 * `_colonly` meshes stay out, or a tower lying in its baked collapse would widen the frame. The
 * arena outline is a line and stays out too: its height is mostly empty sky, and framing it left
 * low maps like the reactor site as a thin strip at the bottom of the view.
 */
export function measureVisibleBounds(root, target = new THREE.Box3()) {
    target.makeEmpty();
    if (!root) return target;
    root.updateWorldMatrix(true, true);
    root.traverseVisible((child) => {
        if (child.isMesh) expandByDrawable(target, child);
    });
    return target;
}

/**
 * Camera placement that keeps the whole bounding sphere in view for the narrower of the two
 * field-of-view axes, so tall and flat maps alike fill the frame without being cut off.
 * @param {THREE.Box3} bounds
 * @param {{ fovDegrees: number, aspect: number }} view
 */
export function resolvePreviewCameraFit(bounds, { fovDegrees, aspect }) {
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const radius = bounds.isEmpty()
        ? MIN_RADIUS
        : Math.max(MIN_RADIUS, bounds.getSize(new THREE.Vector3()).length() * 0.5);
    const halfVertical = THREE.MathUtils.degToRad(fovDegrees) * 0.5;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.1, Number(aspect) || 1));
    const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal));
    const maxDistance = distance * 2.2;
    return {
        target: center,
        position: center.clone().addScaledVector(VIEW_DIRECTION, distance),
        distance,
        minDistance: distance * 0.35,
        maxDistance,
        near: Math.max(0.01, radius * 0.01),
        far: maxDistance + radius * 2,
    };
}

export function applyPreviewCameraFit(camera, controls, root) {
    const fit = resolvePreviewCameraFit(measureVisibleBounds(root), {
        fovDegrees: camera.fov,
        aspect: camera.aspect,
    });
    camera.position.copy(fit.position);
    camera.near = fit.near;
    camera.far = fit.far;
    camera.updateProjectionMatrix();
    if (!controls) return fit;
    controls.target.copy(fit.target);
    controls.minDistance = fit.minDistance;
    controls.maxDistance = fit.maxDistance;
    controls.update(0);
    return fit;
}
