// ============================================
// HuntHudRocketWarning.js - "a rocket is chasing you" banner
// ============================================
//
// A homing rocket is the one threat a driver cannot see coming: it arrives from
// behind, and the cockpit camera never shows it. The warning therefore says three
// things at once - that there is a rocket, how far away the nearest one is, and
// which way to look - so it never relies on colour alone.
//
// The module owns exactly one warning element (one per split-screen viewport) and
// only the arithmetic around it. It writes nothing that has not changed, and it
// allocates nothing per frame: the vectors below are module-level scratch.

import * as THREE from 'three';

/** Below this distance the threat counts as immediate. */
export const ROCKET_WARNING_NEAR_DISTANCE = 40;
/** A known impact within this many seconds counts as immediate, too. */
export const ROCKET_WARNING_NEAR_SECONDS = 1.5;
/**
 * How much of the direction has to lie in the screen plane before an arrow angle
 * is meaningful. A rocket almost exactly ahead or behind projects onto a tiny
 * screen-plane vector whose angle spins with every frame, so it gets a word.
 */
export const ROCKET_WARNING_PLANE_EPSILON = 0.12;

const AXIS_WORDS = Object.freeze({ behind: 'HINTEN', ahead: 'VORN' });

const TMP_DIRECTION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();
// Shared result of the bearing: callers read it immediately, they never store it.
/** @type {{angleDeg: number, axis: 'side'|'ahead'|'behind'|'unknown'}} */
const BEARING = { angleDeg: 0, axis: 'unknown' };

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasFiniteXyz(value) {
    return !!value && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

/**
 * Turns the world-space direction from the player to the rocket into a screen-plane
 * arrow angle, seen from inside the player's own cockpit.
 *
 * The angle is measured the way the arrow glyph points: 0 degrees is straight up on
 * screen, 90 degrees is to the right, 180 degrees is down. When the rocket sits on
 * the forward axis the angle would be noise, so `axis` reports `ahead` or `behind`
 * and the angle is snapped instead of left to jitter.
 *
 * @param {{x:number,y:number,z:number}|null} direction world direction player -> rocket
 * @param {{x:number,y:number,z:number,w:number}|null} quaternion the player's rotation
 * @returns {{angleDeg:number, axis:'side'|'ahead'|'behind'|'unknown'}} shared scratch result
 */
export function resolveRocketWarningBearing(direction, quaternion) {
    BEARING.angleDeg = 0;
    BEARING.axis = 'unknown';
    if (!hasFiniteXyz(direction) || !quaternion || !isFiniteNumber(quaternion.w)
        || !hasFiniteXyz(quaternion)) {
        return BEARING;
    }
    TMP_DIRECTION.set(direction.x, direction.y, direction.z);
    if (TMP_DIRECTION.lengthSq() <= 1e-8) return BEARING;
    TMP_QUATERNION.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    if (TMP_QUATERNION.lengthSq() <= 1e-8) return BEARING;

    // Undoing the player's rotation puts the rocket into cockpit coordinates:
    // +x is right, +y is up and -z is where the driver is looking.
    TMP_DIRECTION.normalize().applyQuaternion(TMP_QUATERNION.normalize().invert());
    const right = TMP_DIRECTION.x;
    const up = TMP_DIRECTION.y;
    const forward = -TMP_DIRECTION.z;
    if (Math.hypot(right, up) < ROCKET_WARNING_PLANE_EPSILON) {
        BEARING.axis = forward >= 0 ? 'ahead' : 'behind';
        BEARING.angleDeg = forward >= 0 ? 0 : 180;
        return BEARING;
    }
    BEARING.axis = 'side';
    BEARING.angleDeg = THREE.MathUtils.radToDeg(Math.atan2(right, up));
    return BEARING;
}

/** Per-element memory of what already stands in the document. */
export function createRocketWarningCache() {
    return { visible: null, text: null, transform: null, near: null, pulse: null, left: null, aria: false };
}

function ensureAria(refs, cache) {
    if (cache.aria) return;
    refs.root?.setAttribute?.('role', 'status');
    refs.root?.setAttribute?.('aria-live', 'polite');
    refs.arrow?.setAttribute?.('aria-hidden', 'true');
    cache.aria = true;
}

function setVisible(refs, cache, visible) {
    if (cache.visible === visible) return;
    refs.root?.classList?.toggle('hidden', !visible);
    refs.root?.setAttribute?.('aria-hidden', String(!visible));
    cache.visible = visible;
}

function setClass(refs, cache, key, name, enabled) {
    if (cache[key] === enabled) return;
    refs.root?.classList?.toggle(name, enabled);
    cache[key] = enabled;
}

/** Hides the warning and forgets what stood there, e.g. at the end of a round. */
export function hideRocketWarning(refs, cache) {
    if (!refs || !cache) return;
    setVisible(refs, cache, false);
    setClass(refs, cache, 'near', 'near', false);
    setClass(refs, cache, 'pulse', 'pulse', false);
    if (refs.text && cache.text !== '') {
        refs.text.textContent = '';
        cache.text = '';
    }
}

function buildWarningText(count, distance, axis) {
    const countPart = count >= 2 ? ` ×${count}` : '';
    const axisWord = AXIS_WORDS[axis];
    return `RAKETE${countPart} · ${Math.round(distance)}${axisWord ? ` · ${axisWord}` : ''}`;
}

function isImmediate(threat) {
    if (threat.nearestDistance > 0 && threat.nearestDistance <= ROCKET_WARNING_NEAR_DISTANCE) {
        return true;
    }
    // A time to impact of zero means "unknown", not "impact now".
    const seconds = threat.timeToImpactSeconds;
    return seconds > 0 && seconds <= ROCKET_WARNING_NEAR_SECONDS;
}

/**
 * Writes one rocket warning for one player.
 *
 * @param {{root:object|null, arrow:object|null, text:object|null}|null} refs warning elements
 * @param {object|null} cache result of createRocketWarningCache for these refs
 * @param {object|null} player projected player (or a live player without a threat)
 * @param {{huntActive?:boolean, reduceMotion?:boolean, leftPercent?:string}} options
 */
export function updateRocketWarning(refs, cache, player, options = {}) {
    if (!refs || !cache) return;
    ensureAria(refs, cache);
    if (typeof options.leftPercent === 'string' && options.leftPercent !== cache.left) {
        if (refs.root?.style) refs.root.style.left = options.leftPercent;
        cache.left = options.leftPercent;
    }

    const threat = player?.rocketThreat;
    const visible = options.huntActive !== false
        && player?.alive !== false
        && threat?.active === true;
    if (!visible) {
        hideRocketWarning(refs, cache);
        return;
    }

    const bearing = resolveRocketWarningBearing(threat.direction, player?.quaternion);
    const text = buildWarningText(threat.count, threat.nearestDistance, bearing.axis);
    if (refs.text && text !== cache.text) {
        refs.text.textContent = text;
        cache.text = text;
    }
    const transform = `rotate(${bearing.angleDeg.toFixed(1)}deg)`;
    if (refs.arrow?.style && transform !== cache.transform) {
        refs.arrow.style.transform = transform;
        cache.transform = transform;
    }
    const near = isImmediate(threat);
    setClass(refs, cache, 'near', 'near', near);
    // Reduce motion is on by default in this project, so the pulse is the extra,
    // never the carrier of the message.
    setClass(refs, cache, 'pulse', 'pulse', near && options.reduceMotion === false);
    setVisible(refs, cache, true);
}
