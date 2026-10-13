// ============================================
// StartSetupFreePlayMaps.js - Free play map choice: which variant the menu is in, which map
// each variant remembers (V7) and the counter line beside the map list (K1).
// Pure helpers over settings, so the sync code stays short and the rules stay testable.
// ============================================

import { isMapEligibleForFreePlayVariant, resolveFreePlayVariantSettings } from '../../shared/contracts/FreePlayVariantContract.js';
import {
    describeFreePlayMapCount,
    rememberFreePlayMap,
} from '../../shared/contracts/FreePlayMapChoiceContract.js';
import { resolveMapProfile } from '../../shared/contracts/MapProfileContract.js';
import { resolveBundledMapBalancing } from '../../shared/maps/MapBalancingBundledData.js';
import { renderMapProfileCard } from './MapProfileCardView.js';

/**
 * After the map list is built: the map on screen becomes the one this variant remembers.
 * Maps the variant cannot host (and the local custom map) are never remembered.
 * @param {{ settings: any, variant: string|null, maps: any, mapKey: string, isOffered?: ((mapKey: string) => boolean)|null }} options
 * @returns {boolean} true when the memory changed
 */
export function rememberFreePlayVariantMap({ settings, variant, maps, mapKey, isOffered = null }) {
    const localSettings = settings?.localSettings;
    if (!variant || !localSettings || !mapKey) return false;
    if (!isMapEligibleForFreePlayVariant(maps?.[mapKey], variant)) return false;
    if (typeof isOffered === 'function' && !isOffered(mapKey)) return false;
    if (localSettings.freePlayMapByVariant?.[variant] === mapKey) return false;
    localSettings.freePlayMapByVariant = { ...rememberFreePlayMap(localSettings.freePlayMapByVariant, variant, mapKey) };
    return true;
}

/**
 * Steckbrief of the chosen map (K4): size, bot limit, recommended pilots, features. Shown in free
 * play only. The bot limit is read from the shipped map balancing for display; it is not enforced
 * here (MAP_BALANCING_AUTHORITATIVE decides that in the runtime).
 * @param {{ node: HTMLElement|null|undefined, variant: string|null, mapKey: string, mapDefinition?: unknown, mapName?: string }} options
 */
export function syncMapProfileCard({ node, variant, mapKey, mapDefinition, mapName = '' }) {
    if (!node) return;
    if (!variant || !mapDefinition) {
        renderMapProfileCard(node, null);
        return;
    }
    const { modePath, gameMode } = resolveFreePlayVariantSettings(variant);
    const balancing = resolveBundledMapBalancing({ modePath, mapKey });
    renderMapProfileCard(node, { profile: resolveMapProfile(mapDefinition, balancing, { gameMode }), mapName });
}

/**
 * Writes the counter line ("24 Karten passen zu Flaggen"); hidden outside free play.
 * @param {HTMLElement|null|undefined} node
 * @param {string|null} variant
 * @param {number} count
 */
export function renderFreePlayMapCount(node, variant, count, total = Number.NaN) {
    if (!node) return;
    const text = describeFreePlayMapCount(variant, count, total);
    node.textContent = text;
    node.classList.toggle('hidden', text === '');
    node.setAttribute('aria-hidden', String(text === ''));
}
