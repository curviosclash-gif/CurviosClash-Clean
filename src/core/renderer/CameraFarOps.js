// Some map effects extend beyond the fog's designed visibility range. The fog closure stays at
// its authored distance while those effects still get enough camera depth.
export function resolveCameraFarRange(fogFar, minimumFar, mapCameraFar) {
    const fogClipDistance = Math.max(minimumFar, fogFar);
    return { fogClipDistance, cameraFar: Math.max(fogClipDistance, mapCameraFar) };
}

export function applyCameraFar(cameras, far) {
    if (!cameras) return;
    for (const camera of cameras) {
        if (camera.far === far) continue;
        camera.far = far;
        camera.updateProjectionMatrix();
    }
}
