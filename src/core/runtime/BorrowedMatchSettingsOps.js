// ============================================
// BorrowedMatchSettingsOps.js - start values that belong to one match only
// ============================================
//
// Arcade run types borrow their map and bot count; the tutorial borrows its whole start
// selection. These values ride with one match and return through the session restore.

import { createSessionSettingsRestorePlan } from './SessionSettingsRestorePlan.js';
import { writeHangarMapSelection } from '../../composition/core-ui/CoreUiMenuPorts.js';
import { getArcadeJourneyStage } from '../../shared/contracts/ArcadeJourneyContract.js';
import { createDefaultArcadeRunSettings } from '../../shared/contracts/ArcadeRunSettingsContract.js';

function cloneJsonSnapshot(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

export function normalizeBorrowedMatchSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (source.tutorial === true) return { tutorial: true };
    const journeyStage = getArcadeJourneyStage(source.journeyStageId);
    if (journeyStage?.runType === 'classic_tutorial') return { tutorial: true };
    if (journeyStage) return { journeyStageId: journeyStage.id };
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

    if (borrowed.tutorial === true) {
        settings.mode = '1p';
        settings.gameMode = 'CLASSIC';
        settings.numBots = 0;
        settings.winsNeeded = 1;
        settings.localSettings = {
            ...settings.localSettings,
            sessionType: 'single',
            modePath: 'normal',
        };
        writeHangarMapSelection(settings, 'tutorial_classic', 'tutorial_classic', { modePath: 'normal' });
    } else if (borrowed.journeyStageId) {
        const stage = getArcadeJourneyStage(borrowed.journeyStageId);
        const defaults = createDefaultArcadeRunSettings();
        settings.arcade = { ...settings.arcade, runType: stage.runType, journeyStageId: stage.id,
            combatProfile: stage.runType === 'gauntlet' ? '' : 'hunt', dailyChallenge: false, companionCount: 0,
            portalChainId: stage.portalChainId || defaults.portalChainId };
        for (const key of ['sectorCount', 'comboWindowMs', 'comboDecayPerSecond', 'maxMultiplier']) settings.arcade[key] = defaults[key];
        settings.gameMode = 'ARCADE';
        settings.localSettings = { ...settings.localSettings, modePath: 'arcade' };
        settings.numBots = stage.botCount;
        writeHangarMapSelection(settings, stage.mapKey, stage.mapKey, { modePath: 'arcade' });
    } else {
        Object.assign(settings, borrowed);
    }
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
