// ============================================
// HuntHudDamageIndicators.js - "you were hit from there" arrow
// ============================================
//
// Lifted out of HuntHUD.js unchanged: the file had reached its line budget, and the
// hit arrow is a self-contained piece of arithmetic on top of two elements. The
// centre of a viewport moves with the split screen, which is why the horizontal
// placement lives here as well.

import { clamp01 } from '../shared/utils/MathOps.js';

const INDICATOR_DEFAULT_INTENSITY = 0.6;
const INDICATOR_MIN_OPACITY = 0.2;
const SPLIT_LEFT = Object.freeze({ p1: '25%', p2: '75%' });
const SINGLE_LEFT = '50%';

/** Memory of the last split-screen state, so the placement is written once. */
export function createDamageIndicatorCache() {
    return { p2Visible: null };
}

function resolveDamageIndicatorState(playerIndex, huntProjection, legacyIndicator, allowLegacyFallback) {
    const byPlayer = huntProjection?.damageIndicatorsByPlayer;
    if (Number.isInteger(playerIndex) && byPlayer && typeof byPlayer === 'object') {
        const indicatorByPlayer = byPlayer[playerIndex];
        if (indicatorByPlayer) {
            return indicatorByPlayer;
        }
    }
    if (!allowLegacyFallback) return null;
    return huntProjection?.damageIndicator || legacyIndicator || null;
}

function updateDamageIndicatorElement(element, indicator, dt) {
    if (!element) return;
    if (!indicator) {
        element.classList.add('hidden');
        return;
    }

    let remainingMs = Number(indicator.remainingMs);
    if (!Number.isFinite(remainingMs)) {
        const legacyTtl = Number(indicator.ttl);
        if (Number.isFinite(legacyTtl)) {
            indicator.ttl = Math.max(0, legacyTtl - dt);
            remainingMs = indicator.ttl * 1000;
        }
    }
    if (!(remainingMs > 0)) {
        element.classList.add('hidden');
        return;
    }

    const angle = Number(indicator.angleDeg) || 0;
    const intensity = clamp01(indicator.intensity || INDICATOR_DEFAULT_INTENSITY);
    element.classList.remove('hidden');
    element.style.opacity = String(Math.max(INDICATOR_MIN_OPACITY, intensity));
    element.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(1)}deg) scale(var(--hud-scale, 1))`;
}

/**
 * Writes both damage arrows and reports whether the second viewport is in use, so
 * the caller can place its own centred overlays the same way.
 *
 * @param {{p1:object|null, p2:object|null}} elements the two arrow elements
 * @param {object} cache result of createDamageIndicatorCache
 * @param {Array<object>} humans local players, in viewport order
 * @param {object|null} huntProjection projected hunt state
 * @param {object|null} legacyIndicator pre-projection fallback indicator
 * @param {number} dt seconds since the last indicator tick
 * @returns {boolean} true while the screen is split
 */
export function updateHuntDamageIndicators(elements, cache, humans, huntProjection, legacyIndicator, dt) {
    const p2Visible = Array.isArray(humans) && humans.length > 1;
    if (p2Visible !== cache.p2Visible) {
        if (elements.p1?.style) {
            elements.p1.style.left = p2Visible ? SPLIT_LEFT.p1 : SINGLE_LEFT;
        }
        if (elements.p2?.style) {
            elements.p2.style.left = p2Visible ? SPLIT_LEFT.p2 : SINGLE_LEFT;
        }
        cache.p2Visible = p2Visible;
    }

    const p1 = humans?.[0] || null;
    updateDamageIndicatorElement(
        elements.p1,
        resolveDamageIndicatorState(p1?.playerIndex ?? p1?.index, huntProjection, legacyIndicator, true),
        dt
    );

    if (!p2Visible) {
        elements.p2?.classList.add('hidden');
        return false;
    }
    const p2 = humans[1] || null;
    updateDamageIndicatorElement(
        elements.p2,
        resolveDamageIndicatorState(p2?.playerIndex ?? p2?.index, huntProjection, legacyIndicator, false),
        dt
    );
    return true;
}

/** Where a centred overlay belongs for one viewport, matching the damage arrows. */
export function resolveOverlayLeft(p2Visible, isSecondPlayer) {
    if (!p2Visible) return SINGLE_LEFT;
    return isSecondPlayer ? SPLIT_LEFT.p2 : SPLIT_LEFT.p1;
}
