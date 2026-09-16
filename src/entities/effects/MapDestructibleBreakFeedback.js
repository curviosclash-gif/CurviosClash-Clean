import { resolveWorldAudioOptions } from '../audio/WorldAudioOptions.js';

const REACTOR_SITE_KEY = 'reactor_site';
const REACTOR_SEGMENT_ID = 'reactor_dome';
const BREACH_COLOR = 0xffa24a;
const SHOCKWAVE_SCALE = 10;
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
        const intensity = 0.12 + 0.3 * closeness * closeness;
        const duration = 0.55 + 0.35 * closeness;
        if (reduceMotion) renderer.reportImpact?.(index, intensity, duration);
        else renderer.triggerCameraShake?.(index, intensity, duration);
    }
}

/**
 * Adds presentation to the reactor breach without changing damage, score or round outcome.
 * Existing particle, audio and camera systems own all resources, so a round restart has no
 * map-specific objects or timers to clean up.
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
        'DEATH',
        BREACH_COLOR,
        SHOCKWAVE_SCALE,
    );
    owner.audio?.play?.('EXPLOSION', resolveWorldAudioOptions(owner, position, { intensity: 1.5 }));
    shakeLocalCameras(owner, position);
    return true;
}

