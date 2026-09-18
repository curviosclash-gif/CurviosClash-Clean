// ============================================
// HuntHudReserveArcs.js - Hunt HUD boost/slow-motion arcs
// ============================================
//
// Both reserves render the same way: one segmented arc, one cooldown state and one
// percentage label. Only the field names differ, so the renderer is table driven
// and the Hunt HUD keeps a single call site for both meters.

import { clamp01 } from '../shared/utils/MathOps.js';
import { HUD_ARC_SEGMENT_COUNT } from './HudSegmentedArc.js';

const MIN_CAPACITY = 0.001;
const DEFAULT_CAPACITY = 1;

const RESERVE_ARCS = Object.freeze([
    Object.freeze({
        fill: 'boostFill', text: 'boostText',
        charge: 'boostCharge', capacity: 'boostCapacity',
        recharging: 'boostRecharging', manual: 'manualBoostActive',
        widthCache: 'boostW', cooldownCache: 'boostCooldown', textCache: 'boostTxt',
        fallbackIndex: 0,
    }),
    Object.freeze({
        fill: 'slowMoFill', text: 'slowMoText',
        charge: 'slowMoCharge', capacity: 'slowMoCapacity',
        recharging: 'slowMoRecharging', manual: 'manualSlowMoActive',
        widthCache: 'slowMoW', cooldownCache: 'slowMoCooldownState', textCache: 'slowMoTxt',
        fallbackIndex: 1,
    }),
]);

// Reused scratch slot for the per-reserve capacity fallbacks; the Hunt panel update
// runs on a throttled tick but must still not allocate per call.
const TMP_FALLBACKS = [DEFAULT_CAPACITY, DEFAULT_CAPACITY];

function toPercent(value) {
    return `${(clamp01(value) * 100).toFixed(1)}%`;
}

function resolveCapacity(player, keys, fallbackCapacity) {
    const raw = Number(player?.[keys.capacity]) || Number(fallbackCapacity);
    return Math.max(MIN_CAPACITY, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CAPACITY);
}

function resolveCooldown(player, keys, charge, capacity) {
    if (typeof player?.[keys.recharging] === 'boolean') {
        return player[keys.recharging];
    }
    return !player?.[keys.manual] && charge < (capacity - MIN_CAPACITY);
}

/**
 * Writes the boost and slow-motion arcs of one Hunt player panel.
 * @param {object|null} player projected or live player
 * @param {object} refs panel element refs (boostFill/boostText/slowMoFill/slowMoText)
 * @param {object|null} cache per-panel value cache, avoids redundant DOM writes
 * @param {number} fallbackBoostCapacity boost capacity when the player carries none
 * @param {number} fallbackSlowMoCapacity slow-motion capacity when the player carries none
 */
export function updateHuntReserveArcs(
    player,
    refs,
    cache = null,
    fallbackBoostCapacity = DEFAULT_CAPACITY,
    fallbackSlowMoCapacity = DEFAULT_CAPACITY
) {
    if (!refs) return;
    const fallbacks = TMP_FALLBACKS;
    fallbacks[0] = fallbackBoostCapacity;
    fallbacks[1] = fallbackSlowMoCapacity;
    for (let i = 0; i < RESERVE_ARCS.length; i += 1) {
        const keys = RESERVE_ARCS[i];
        const capacity = resolveCapacity(player, keys, fallbacks[keys.fallbackIndex]);
        const charge = Math.max(0, Math.min(capacity, Number(player?.[keys.charge]) || 0));
        const ratio = clamp01(charge / capacity);
        const cooldown = resolveCooldown(player, keys, charge, capacity);
        const width = toPercent(ratio);
        const fill = refs[keys.fill];
        if (fill && width !== cache?.[keys.widthCache]) {
            fill.style.width = width;
            fill.style.setProperty?.('--hunt-segments-filled', `${Math.round(ratio * HUD_ARC_SEGMENT_COUNT)}%`);
            if (cache) cache[keys.widthCache] = width;
        }
        if (fill && cooldown !== cache?.[keys.cooldownCache]) {
            fill.classList.toggle('cooldown', cooldown);
            if (cache) cache[keys.cooldownCache] = cooldown;
        }
        const text = `${Math.round(ratio * 100)}%`;
        if (refs[keys.text] && text !== cache?.[keys.textCache]) {
            refs[keys.text].textContent = text;
            refs[keys.text].parentElement?.setAttribute?.('aria-valuenow', String(Math.round(ratio * 100)));
            if (cache) cache[keys.textCache] = text;
        }
    }
}
