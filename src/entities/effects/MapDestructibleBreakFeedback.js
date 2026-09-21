import { resolveWorldAudioOptions } from '../audio/WorldAudioOptions.js';

const REACTOR_SITE_KEY = 'reactor_site';
const REACTOR_SEGMENT_ID = 'reactor_dome';
const BREACH_COLOR = 0xffe6bb;
const SHOCKWAVE_SCALE = 3;
const SHAKE_RANGE_AUTHORED = 260;

function resolveSegmentPosition(owner, segmentId) {
    const system = owner?._mapDestructibleSystem;
    const segment = system?.getDefinition?.()?.segments?.find((entry) => entry.id === segmentId);
    if (!segment?.anchor) return null;
    const scale = Math.max(0.001, Number(system.anchorScale) || 1);
    return {
        x: (Number(segment.anchor[0]) || 0) * scale,
        y: (Number(segment.anchor[1]) || 0) * scale,
        z: (Number(segment.anchor[2]) || 0) * scale,
    };
}

function shakeLocalCameras(owner, position) {
    const renderer = owner?.renderer;
    const cameras = renderer?.cameras;
    if (!Array.isArray(cameras)) return;
    const reduceMotion = renderer.getCameraPerspectiveSettings?.()?.reduceMotion === true;
    const scale = Math.max(0.001, Number(owner?._mapDestructibleSystem?.anchorScale) || 1);
    const range = SHAKE_RANGE_AUTHORED * scale;

    for (let index = 0; index < cameras.length; index += 1) {
        const camera = cameras[index];
        if (!camera?.position) continue;
        const distance = Math.hypot(
            (Number(camera.position.x) || 0) - position.x,
            (Number(camera.position.y) || 0) - position.y,
            (Number(camera.position.z) || 0) - position.z,
        );
        if (distance >= range) continue;
        const closeness = 1 - distance / range;
        const intensity = 0.18 + 0.5 * closeness * closeness;
        const duration = 0.55 + 0.35 * closeness;
        if (reduceMotion) renderer.reportImpact?.(index, intensity, duration);
        else renderer.triggerCameraShake?.(index, intensity, duration);
    }
}

/**
 * Adds presentation to the reactor breach without changing damage, score or round outcome.
 * The map clock schedules pressure and sound together after the initial flash.
 * Resetting the destructible system cancels pending feedback without wall-clock timers.
 */
export function emitMapDestructibleBreakFeedback(owner, event) {
    if (owner?.arena?.currentMapKey !== REACTOR_SITE_KEY || event?.segmentId !== REACTOR_SEGMENT_ID) {
        return false;
    }
    const position = resolveSegmentPosition(owner, event.segmentId);
    if (!position) return false;

    owner.particles?.spawn?.(position, 96, BREACH_COLOR, 24, 1.35, 1.2, {
        gravity: -3.2,
        type: 'reactor-breach',
    });
    owner.particles?.rocketBlastEffect?.spawn?.(
        position,
        'REACTOR_BREACH',
        BREACH_COLOR,
        SHOCKWAVE_SCALE * (owner.renderer?.getCameraPerspectiveSettings?.()?.reduceMotion ? 0.65 : 1),
    );
    owner._mapDestructibleSystem?.schedulePressureFeedback?.(position, event.atSeconds);
    return true;
}


export function emitMapDestructiblePressureFeedback(owner, position) {
    const reduced = owner.renderer?.getCameraPerspectiveSettings?.()?.reduceMotion === true;
    owner.particles?.rocketBlastEffect?.spawn?.(position, 'REACTOR_PRESSURE', BREACH_COLOR, reduced ? 0.65 : 1);
    owner.audio?.play?.('REACTOR_BREACH', resolveWorldAudioOptions(owner, position, { intensity: 1.5 }));
    shakeLocalCameras(owner, position);
}
