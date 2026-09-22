import { resolveWorldAudioOptions } from '../audio/WorldAudioOptions.js';
import { REACTOR_FLASH_NAME } from './ReactorFlashOverlay.js';

const REACTOR_SITE_KEY = 'reactor_site';
const REACTOR_SEGMENT_ID = 'reactor_dome';
const BREACH_COLOR = 0xffe6bb;
const SHOCKWAVE_SCALE = 3;
const SHAKE_RANGE_AUTHORED = 260;
// Sound and pressure travel at 343 m/s. The plant is authored at 0.6 units per metre
// (METRE in ReactorSiteStructure.js) and the anchor scale takes that to world units.
const SOUND_METRES_PER_SECOND = 343;
const AUTHORED_UNITS_PER_METRE = 0.6;
// Past this the breach is simply not heard: nothing waits for an unreachable listener.
const PRESSURE_TRAVEL_LIMIT_SECONDS = 8;

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

function distanceTo(point, position) {
    return Math.hypot(
        (Number(point.x) || 0) - position.x,
        (Number(point.y) || 0) - position.y,
        (Number(point.z) || 0) - position.z,
    );
}

/** Shakes every local camera the pressure front has reached since the last call, once each. */
function shakeReachedCameras(owner, pending, front, expired) {
    const renderer = owner?.renderer;
    const cameras = Array.isArray(renderer?.cameras) ? renderer.cameras : [];
    const reduceMotion = renderer?.getCameraPerspectiveSettings?.()?.reduceMotion === true;
    const scale = Math.max(0.001, Number(owner?._mapDestructibleSystem?.anchorScale) || 1);
    const range = SHAKE_RANGE_AUTHORED * scale;
    let waiting = false;

    for (let index = 0; index < cameras.length; index += 1) {
        const camera = cameras[index];
        if (!camera?.position || pending.shaken.has(index)) continue;
        const distance = distanceTo(camera.position, pending.position);
        if (distance > front && !expired) {
            waiting = true;
            continue;
        }
        pending.shaken.add(index);
        if (expired || distance >= range) continue;
        const closeness = 1 - distance / range;
        const intensity = 0.18 + 0.5 * closeness * closeness;
        const duration = 0.55 + 0.35 * closeness;
        if (reduceMotion) renderer.reportImpact?.(index, intensity, duration);
        else renderer.triggerCameraShake?.(index, intensity, duration);
    }
    return waiting;
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

    // The flash overlays live in the cloud models and cannot see the player's settings.
    const reduceMotion = owner.renderer?.getCameraPerspectiveSettings?.()?.reduceMotion === true;
    for (const overlay of owner.renderer?.scene?.getObjectsByProperty?.('name', REACTOR_FLASH_NAME) || []) {
        overlay.userData.reduceMotion = reduceMotion;
    }
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


/**
 * Starts pressure feedback for a breach that detonated at `detonatedAt` on the map clock. The
 * visible shock leaves with the flash; sound and shake then reach every listener when the front,
 * moving at the speed of sound, has covered the distance to it.
 */
export function createMapDestructiblePressureFeedback(position, detonatedAt, delaySeconds) {
    return {
        position,
        detonatedAt,
        atSeconds: detonatedAt + delaySeconds,
        shown: false,
        heard: false,
        shaken: new Set(),
    };
}

/** Advances pending pressure to `elapsed`; returns true once nothing is left to deliver. */
export function advanceMapDestructiblePressureFeedback(owner, pending, elapsed) {
    const position = pending.position;
    if (!pending.shown) {
        pending.shown = true;
        const reduced = owner.renderer?.getCameraPerspectiveSettings?.()?.reduceMotion === true;
        owner.particles?.rocketBlastEffect?.spawn?.(position, 'REACTOR_PRESSURE', BREACH_COLOR, reduced ? 0.65 : 1);
    }
    const scale = Math.max(0.001, Number(owner?._mapDestructibleSystem?.anchorScale) || 1);
    const travelled = Math.max(0, elapsed - pending.detonatedAt);
    const front = travelled * SOUND_METRES_PER_SECOND * AUTHORED_UNITS_PER_METRE * scale;
    const expired = travelled > PRESSURE_TRAVEL_LIMIT_SECONDS;

    if (!pending.heard) {
        const options = resolveWorldAudioOptions(owner, position, { intensity: 1.5 });
        const distance = Number(options?.distance);
        if (expired) pending.heard = true;
        else if (!Number.isFinite(distance) || distance <= front) {
            pending.heard = true;
            owner.audio?.play?.('REACTOR_BREACH', options);
            // Within the pressure range the ears shut for a moment; the closer, the longer.
            const closeness = Number.isFinite(distance) ? 1 - distance / (SHAKE_RANGE_AUTHORED * scale) : 0;
            if (closeness > 0) owner.audio?.muffle?.(closeness, 1.5 + 1.5 * closeness);
        }
    }
    const waiting = shakeReachedCameras(owner, pending, front, expired);
    return pending.heard && !waiting;
}
