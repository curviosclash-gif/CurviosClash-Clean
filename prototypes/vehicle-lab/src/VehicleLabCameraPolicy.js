const MIN_CAMERA_DISTANCE = 1.5;
const MAX_CAMERA_DISTANCE = 120;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function resolveVehicleLabFitDistance(radius, verticalFovDegrees, aspect, padding = 1.18) {
    const safeRadius = Math.max(0.01, Number(radius) || 0.01);
    const verticalFov = clamp(Number(verticalFovDegrees) || 75, 10, 150) * Math.PI / 180;
    const safeAspect = Math.max(0.1, Number(aspect) || 1);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = (safeRadius / Math.sin(limitingFov / 2)) * Math.max(1, Number(padding) || 1);
    return clamp(distance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
}

export function resolveVehicleLabViewPose(view, distance) {
    const safeDistance = clamp(Number(distance) || 8, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    if (view === 'front') return { offset: [0, 0, safeDistance], up: [0, 1, 0] };
    if (view === 'side') return { offset: [safeDistance, 0, 0], up: [0, 1, 0] };
    if (view === 'top') return { offset: [0, safeDistance, 0], up: [0, 0, -1] };

    const length = Math.sqrt(1 + (0.65 * 0.65) + 1);
    return {
        offset: [safeDistance / length, safeDistance * 0.65 / length, safeDistance / length],
        up: [0, 1, 0],
    };
}

export const VEHICLE_LAB_CAMERA_DISTANCE_LIMITS = Object.freeze({
    min: MIN_CAMERA_DISTANCE,
    max: MAX_CAMERA_DISTANCE,
});
