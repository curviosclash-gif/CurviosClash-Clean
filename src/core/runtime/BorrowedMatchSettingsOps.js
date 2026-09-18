// ============================================
// BorrowedMatchSettingsOps.js - start values that belong to one match only
// ============================================
//
// Arcade run types (Endlosjagd, Fünf Fronten, Fünf Portale) play on their own map and
// bot count. Written straight into the settings, those values stayed for every later
// menu start. They now ride along with the start and go back through the session restore.

import { createSessionSettingsRestorePlan } from './SessionSettingsRestorePlan.js';

function cloneJsonSnapshot(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

export function normalizeBorrowedMatchSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const borrowed = {};
    const mapKey = typeof source.mapKey === 'string' ? source.mapKey.trim() : '';
    if (mapKey) borrowed.mapKey = mapKey;
    if (Number.isInteger(source.numBots) && source.numBots >= 0) borrowed.numBots = source.numBots;
    return borrowed;
}

/**
 * Applies the borrowed values, remembers what they replaced and starts the match.
 * A start that does not happen hands the values back right away.
 * @param {object} facade
 * @param {object|null} rawBorrowed
 */
export async function startMatchWithBorrowedSettings(facade, rawBorrowed = null) {
    const settings = facade?.game?.settings;
    const borrowed = normalizeBorrowedMatchSettings(rawBorrowed);
    const baseline = settings && Object.keys(borrowed).length > 0 ? cloneJsonSnapshot(settings) : null;
    if (!baseline) return facade?.startMatch?.();

    Object.assign(settings, borrowed);
    facade.settingsHandler?.holdSessionSettingsRestore?.(createSessionSettingsRestorePlan(baseline, settings));
    let started = false;
    try {
        started = await Promise.resolve(facade.startMatch());
    } catch {
        started = false;
    }
    if (!started) facade.settingsHandler?.restoreSessionSettings?.();
    return started;
}
