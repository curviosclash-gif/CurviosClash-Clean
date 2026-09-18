function findGuidedRocket(manager, playerIndex) {
    if (manager?._killcamSystem?.ownsCamera?.(playerIndex) === true) return null;
    const projectiles = manager?._projectileSystem?.projectiles || [];
    for (const projectile of projectiles) {
        if (projectile?.guidedActive !== true || projectile.owner?.index !== playerIndex) continue;
        if (projectile.owner.alive === false) return null;
        return projectile;
    }
    return null;
}

export function ownsGuidedRocketCamera(manager, playerIndex) {
    return !!findGuidedRocket(manager, playerIndex);
}

/** Each local view follows only its owner's guided rocket; the killcam keeps priority. */
export function applyGuidedRocketCameras(manager, dt) {
    const cameras = manager?.renderer?.cameras || [];
    let count = 0;
    for (let index = 0; index < cameras.length; index += 1) {
        const rocket = findGuidedRocket(manager, index);
        const camera = cameras[index];
        if (!rocket || !camera || !rocket.position || !rocket.velocity) continue;
        const direction = manager._tmpDir2.copy(rocket.velocity);
        if (direction.lengthSq() < 0.000001) direction.set(0, 0, -1);
        else direction.normalize();
        const desired = manager._tmpCamRenderPos.copy(rocket.position).addScaledVector(direction, -7);
        desired.y += 2;
        camera.position.lerp(desired, 1 - Math.exp(-12 * Math.max(0, Number(dt) || 0)));
        manager._tmpVec2.copy(rocket.position).addScaledVector(direction, 8);
        camera.lookAt(manager._tmpVec2);
        count += 1;
    }
    return count;
}
