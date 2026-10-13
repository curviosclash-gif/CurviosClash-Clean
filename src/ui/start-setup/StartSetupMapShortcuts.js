// ============================================
// StartSetupMapShortcuts.js - Quick ways through the free play map choice: the random map button
// (K7) and the gamepad shortcuts (K5). LB/RB switch the filter, Y toggles the favourite, X draws a
// random map. Every result is also written as text into the status line of the map choice.
// ============================================

import { deriveFreePlayVariant } from '../../shared/contracts/FreePlayVariantContract.js';
import { pickRandomFreePlayMapKey } from '../../shared/contracts/FreePlayMapChoiceContract.js';
import { ensureStartSetupLocalState, toggleFavoriteEntry } from './StartSetupUiOps.js';

export const MAP_PICKER_SHORTCUT_ACTIONS = Object.freeze({
    PREVIOUS_FILTER: 'previous-filter',
    NEXT_FILTER: 'next-filter',
    FAVORITE: 'favorite',
    RANDOM: 'random',
});

const SHORTCUT_BY_BUTTON = Object.freeze({
    LB: MAP_PICKER_SHORTCUT_ACTIONS.PREVIOUS_FILTER,
    RB: MAP_PICKER_SHORTCUT_ACTIONS.NEXT_FILTER,
    Y: MAP_PICKER_SHORTCUT_ACTIONS.FAVORITE,
    X: MAP_PICKER_SHORTCUT_ACTIONS.RANDOM,
});

/** Visible next to the map choice; state is never conveyed by colour alone. */
export const MAP_PICKER_SHORTCUT_HINT_TEXT = 'Controller: LB/RB Filter wechseln · Y Favorit · X Zufallskarte';

/** @param {string} button Logical pad button name (LB, RB, X, Y). @returns {string} action id or '' */
export function resolveMapPickerShortcut(button) {
    return Object.hasOwn(SHORTCUT_BY_BUTTON, button) ? SHORTCUT_BY_BUTTON[/** @type {'LB'} */ (button)] : '';
}

/**
 * Next value in a list, wrapping around at both ends; an unknown current value starts at the edge.
 * @param {string[]} values
 * @param {string} current
 * @param {number} step 1 or -1
 * @returns {string}
 */
export function cycleMapFilterValue(values, current, step) {
    if (!Array.isArray(values) || values.length === 0) return '';
    const index = values.indexOf(current);
    if (index < 0) return values[step < 0 ? values.length - 1 : 0];
    return values[(index + (step < 0 ? -1 : 1) + values.length) % values.length];
}

/**
 * @param {{ ui: any, getSettings: () => any, sync: (settings: any) => void, rng?: (() => number)|null,
 *   isVisible?: (() => boolean)|null }} options
 */
export function createMapPickerShortcuts({ ui, getSettings, sync, rng = null, isVisible = null }) {
    const say = (text) => {
        if (ui.mapChoiceStatus) ui.mapChoiceStatus.textContent = text;
    };
    const labelOf = (mapKey) => Array.from(ui.mapSelect?.options || [])
        .find((option) => option.value === mapKey)?.textContent?.trim() || mapKey;
    const visible = () => (typeof isVisible === 'function'
        ? isVisible()
        : !!deriveFreePlayVariant(getSettings())
            && (ui.mapSelect?.getClientRects?.().length || 0) > 0);

    function pickRandom() {
        const settings = getSettings();
        if (!settings || !ui.mapSelect) return false;
        const startSetup = ensureStartSetupLocalState(settings);
        // The select lists what the filter and search leave; a favourites filter therefore draws from favourites only.
        const candidates = Array.from(ui.mapSelect.options)
            .filter((option) => option.dataset?.filterRetained !== 'true' && option.hidden !== true)
            .map((option) => option.value);
        const mapKey = pickRandomFreePlayMapKey({ candidates, recentKeys: startSetup.recentMaps, rng });
        if (!mapKey) {
            say('Keine Karte zum Auslosen — Suche oder Filter ändern');
            return false;
        }
        ui.mapSelect.value = mapKey;
        ui.mapSelect.dispatchEvent(new Event('change', { bubbles: true }));
        say(`Zufällige Karte: ${labelOf(mapKey)}`);
        return true;
    }

    function cycleFilter(step) {
        const settings = getSettings();
        const select = ui.mapFilterSelect;
        if (!settings || !select) return false;
        const startSetup = ensureStartSetupLocalState(settings);
        const values = Array.from(select.options).map((option) => option.value);
        const next = cycleMapFilterValue(values, String(startSetup.mapFilter || 'all'), step);
        if (!next) return false;
        startSetup.mapFilter = next;
        sync(settings);
        say(`Filter: ${Array.from(select.options).find((option) => option.value === next)?.textContent?.trim() || next}`);
        return true;
    }

    function toggleFavorite() {
        const settings = getSettings();
        if (!settings || !ui.mapSelect) return false;
        const focusedKey = globalThis.document?.activeElement?.dataset?.mapKey || '';
        const mapKey = String(focusedKey || ui.mapSelect.value || '').trim();
        if (!mapKey) return false;
        const favorites = ensureStartSetupLocalState(settings).favoriteMaps;
        toggleFavoriteEntry(favorites, mapKey);
        sync(settings);
        say(favorites.includes(mapKey) ? `Favorit: ${labelOf(mapKey)}` : `Kein Favorit mehr: ${labelOf(mapKey)}`);
        return true;
    }

    /** @returns {boolean} true when the press belonged to the map choice and was used */
    function handleButton(button) {
        const action = resolveMapPickerShortcut(button);
        if (!action || !visible()) return false;
        if (action === MAP_PICKER_SHORTCUT_ACTIONS.PREVIOUS_FILTER) cycleFilter(-1);
        else if (action === MAP_PICKER_SHORTCUT_ACTIONS.NEXT_FILTER) cycleFilter(1);
        else if (action === MAP_PICKER_SHORTCUT_ACTIONS.FAVORITE) toggleFavorite();
        else pickRandom();
        return true;
    }

    return Object.freeze({ pickRandom, cycleFilter, toggleFavorite, handleButton, isVisible: visible });
}
