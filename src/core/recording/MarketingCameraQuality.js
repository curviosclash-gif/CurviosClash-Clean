import * as THREE from 'three';

// Geometry is an automatic rejection gate, not proof of visual comprehension.
export function createCameraVisibilitySampler() {
    const camera = new THREE.PerspectiveCamera();
    const point = new THREE.Vector3(), direction = new THREE.Vector3(), local = new THREE.Vector3();
    return (pose, players, subjects, arena) => {
        camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion);
        Object.assign(camera, { fov: pose.fov, zoom: pose.zoom || 1, aspect: 9 / 16,
            near: pose.near || 0.1, far: pose.far || 2000 });
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        return subjects.map((index) => {
            const player = players.find((p) => p.playerIndex === index);
            if (!player) return { player: index, visible: false, reason: 'missing' };
            point.copy(player.position); local.copy(point).applyMatrix4(camera.matrixWorldInverse);
            direction.copy(point).sub(camera.position);
            const distance = direction.length(); direction.normalize();
            const blocked = arena?.raycast?.(camera.position, direction, Math.max(0, distance - 1))?.hit === true;
            point.project(camera);
            const pixels = (Math.max(0.01, player.modelScale || 1) * 1920 * camera.zoom)
                / (Math.max(0.01, -local.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
            const inside = Math.abs(point.x) < 0.9 && Math.abs(point.y) < 0.84 && point.z > -1 && point.z < 1;
            return { player: index, visible: inside && pixels >= 16 && !blocked,
                inside, blocked, pixels, x: point.x, y: point.y };
        });
    };
}

export function checkCameraVisibility(samples, criticalTimes) {
    if (!samples?.length || !criticalTimes?.length) return ['camera_visibility_evidence_missing'];
    const failures = [];
    for (const time of criticalTimes) {
        const sample = samples.reduce((best, s) => Math.abs(s.timeMs - time) < Math.abs(best.timeMs - time) ? s : best);
        if (Math.abs(sample.timeMs - time) > 25 || sample.subjects.length < 2 || sample.subjects.some((s) => !s.visible)) {
            failures.push(`key_action_not_visible:${Math.round(time)}`);
        }
    }
    if (samples.filter((s) => s.subjects.some((p) => !p.visible)).length / samples.length > 0.1) {
        failures.push('subjects_obscured_or_offscreen');
    }
    return failures;
}
