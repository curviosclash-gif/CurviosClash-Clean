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
import {
    ARCADE_LAST_RUN_STORAGE_KEY,
    createArcadeLastRunRecord,
    readArcadeLastRunRecord,
} from '../../shared/contracts/ArcadeMenuPersistenceContract.js';
import { createPlayerProfileMenuRuntimeAccess } from './PlayerProfileRuntimeAccess.js';

function cloneJsonSnapshot(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function saveJourneyContinueAfterStart(game, stageId) {
    const profileAccess = createPlayerProfileMenuRuntimeAccess(game);
    const profile = profileAccess.getArcadePrimaryPlayerProfile();
    const profileId = String(profile?.id || '').trim();
    const store = profileAccess.getArcadeSettingsStore();
    if (!profileId || typeof store?.readJsonRecordResult !== 'function' || typeof store?.saveJsonRecord !== 'function') return;

    let read;
    try { read = store.readJsonRecordResult(ARCADE_LAST_RUN_STORAGE_KEY); } catch { return; }
    let base;
    if (read?.status === 'missing') {
        const settings = game?.settings;
        const seed = Math.floor(Number(settings?.arcade?.seed) || 0);
        if (seed <= 0) return;
        base = createArcadeLastRunRecord({
            at: new Date().toISOString(), mapKey: settings?.mapKey,
            vehicleId: settings?.vehicles?.PLAYER_1, botCount: settings?.numBots,
            botDifficulty: settings?.botDifficulty, seed,
            dailyChallenge: settings?.arcade?.dailyChallenge,
        });
    } else if (read?.status === 'found') {
        const parsed = readArcadeLastRunRecord(read.value);
        if (!parsed.record) return;
        base = parsed.record;
    } else {
        return;
    }
    try {
        store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, {
            ...base,
            profileId,
            journeyStageId: stageId,
        });
    } catch { /* The successful run remains valid if profile storage is unavailable. */ }
}

function clearJourneyContinueAfterDailyStart(game) {
    const store = createPlayerProfileMenuRuntimeAccess(game).getArcadeSettingsStore();
    if (typeof store?.readJsonRecordResult !== 'function' || typeof store?.saveJsonRecord !== 'function') return;
    let read;
    try { read = store.readJsonRecordResult(ARCADE_LAST_RUN_STORAGE_KEY); } catch { return; }
    if (read?.status !== 'found') return;
    const parsed = readArcadeLastRunRecord(read.value);
    if (!parsed.record?.journeyStageId) return;
    try {
        store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, { ...parsed.record, journeyStageId: '' });
    } catch { /* The daily run remains valid if profile storage is unavailable. */ }
}

export function normalizeBorrowedMatchSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (source.dailyChallenge === true) return { dailyChallenge: true };
    if (source.tutorial === true) return { tutorial: true, journeyStageId: 'flight_school' };
    const journeyStage = getArcadeJourneyStage(source.journeyStageId);
    if (journeyStage?.runType === 'classic_tutorial') return { tutorial: true, journeyStageId: journeyStage.id };
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
    } else if (borrowed.dailyChallenge) {
        settings.arcade = { ...settings.arcade, dailyChallenge: true, journeyStageId: '' };
        settings.gameMode = 'ARCADE';
        settings.localSettings = { ...settings.localSettings, modePath: 'arcade' };
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
    else if (borrowed.journeyStageId) saveJourneyContinueAfterStart(facade?.game, borrowed.journeyStageId);
    else if (borrowed.dailyChallenge) clearJourneyContinueAfterDailyStart(facade?.game);
    return started;
}
