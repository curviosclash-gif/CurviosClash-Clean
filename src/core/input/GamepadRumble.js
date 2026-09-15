// Controller rumble follows the renderer's per-player impacts (own damage, nearby
// blast): the same events that shake a camera, reported even when reduced motion
// keeps the picture still.

// Camera shake intensities top out around 0.5; that maps to full motor power.
const FULL_INTENSITY = 0.5;
const MIN_MAGNITUDE = 0.12;
const MIN_DURATION_MS = 60;
const MAX_DURATION_MS = 500;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Translates one camera shake into a dual-rumble effect.
 * The heavy motor carries the impact, the light motor keeps small hits noticeable.
 *
 * @param {number} intensity - Camera shake intensity.
 * @param {number} duration - Camera shake duration in seconds.
 * @returns {{duration: number, strongMagnitude: number, weakMagnitude: number} | null}
 */
export function resolveRumbleEffect(intensity, duration) {
    const safeIntensity = Number(intensity);
    const safeDuration = Number(duration);
    if (!Number.isFinite(safeIntensity) || safeIntensity <= 0) return null;
    if (!Number.isFinite(safeDuration) || safeDuration <= 0) return null;
    const strongMagnitude = clamp(safeIntensity / FULL_INTENSITY, MIN_MAGNITUDE, 1);
    return {
        duration: Math.round(clamp(safeDuration * 1000, MIN_DURATION_MS, MAX_DURATION_MS)),
        strongMagnitude,
        weakMagnitude: clamp(0.25 + strongMagnitude * 0.6, 0, 1),
    };
}

/**
 * Hardware slot of the controller that currently steers a player, or null when
 * the player is on keyboard, mouse or touch.
 *
 * @param {{type?: string, gamepadIndex?: number} | null | undefined} source
 * @returns {number | null}
 */
export function resolvePlayerGamepadIndex(source) {
    if (source?.type !== 'gamepad') return null;
    return Number.isInteger(source.gamepadIndex) && source.gamepadIndex >= 0 ? source.gamepadIndex : null;
}

function readDefaultGamepads() {
    return globalThis.navigator?.getGamepads?.() || null;
}

function readDefaultNow() {
    return globalThis.performance?.now?.() ?? 0;
}

export class GamepadRumble {
    /**
     * @param {{
     *   resolveGamepadIndex?: (playerIndex: number) => number | null,
     *   isEnabled?: () => boolean,
     *   getGamepads?: () => ArrayLike<any> | null,
     *   now?: () => number,
     * }} [options]
     */
    constructor({
        resolveGamepadIndex = () => null,
        isEnabled = () => true,
        getGamepads = readDefaultGamepads,
        now = readDefaultNow,
    } = {}) {
        this._resolveGamepadIndex = resolveGamepadIndex;
        this._isEnabled = isEnabled;
        this._getGamepads = getGamepads;
        this._now = now;
        // Per hardware slot: the running effect, so a burst of weak MG hits cannot
        // cut a strong blast short.
        this._activeUntil = new Map();
        this._activeStrength = new Map();
    }

    pulse(playerIndex, intensity, duration) {
        if (!this._isEnabled()) return false;
        const effect = resolveRumbleEffect(intensity, duration);
        if (!effect) return false;
        const slot = this._resolveGamepadIndex(playerIndex);
        if (!Number.isInteger(slot)) return false;
        const actuator = this._getGamepads()?.[slot]?.vibrationActuator;
        if (typeof actuator?.playEffect !== 'function') return false;

        const now = this._now();
        if (now < (this._activeUntil.get(slot) ?? 0)
            && effect.strongMagnitude <= (this._activeStrength.get(slot) ?? 0)) {
            return false;
        }
        this._activeUntil.set(slot, now + effect.duration);
        this._activeStrength.set(slot, effect.strongMagnitude);
        try {
            // A newer effect preempts this one; Chromium then rejects or resolves the old promise.
            Promise.resolve(actuator.playEffect('dual-rumble', { startDelay: 0, ...effect })).catch(() => {});
        } catch {
            return false;
        }
        return true;
    }
}
