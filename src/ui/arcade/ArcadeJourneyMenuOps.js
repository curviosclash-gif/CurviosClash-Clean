import { loadArcadeJourneyProgress } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
import { ARCADE_JOURNEY_STAGES, getArcadeJourneyStage, resolveArcadeJourneyAccess } from '../../shared/contracts/ArcadeJourneyContract.js';
import { loadArcadeDifficultyProgress, resolveArcadeRunTier } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { resolveDemolitionLocalPlayerCount } from './ArcadeDemolitionProfileSelection.js';

export function syncArcadeJourneyMenu(view, runtimeAccess, settings, profile, records, seed = settings.arcade?.seed) {
    const store = runtimeAccess?.getSettingsStore?.();
    const loaded = loadArcadeJourneyProgress(store);
    const difficulty = loadArcadeDifficultyProgress(store).progress;
    const tiers = Object.fromEntries(ARCADE_JOURNEY_STAGES.map(stage => {
        if (stage.runType === 'classic_tutorial') return [stage.id, 'normal'];
        const tier = resolveArcadeRunTier(settings.arcade?.difficultyTierId, difficulty, { runType: stage.runType });
        return [stage.id, tier === 'any' ? 'normal' : tier];
    }));
    const legacyAccess = Number(records?.runsPlayed) > 0
        || Number(store?.loadJsonRecord?.('curviosclash.five-portals-records.v1', null)?.bestTotalMs) > 0;
    const briefing = runtimeAccess?.getArcadeJourneyBriefing?.(seed, tiers.first_run);
    view.render({ briefings: briefing ? { first_run: briefing } : {}, progress: loaded.progress, available: loaded.status !== 'unavailable', legacyAccess, tiers,
        playerCount: resolveDemolitionLocalPlayerCount(settings), profileId: profile?.id || '', profileName: profile?.displayName || '' });
}

/** Validate again at click time; a profile can change while its old world card is still mounted. */
export function prepareArcadeJourneyMenuStart(stageId, settings, runtimeAccess) {
    const stage = getArcadeJourneyStage(stageId);
    const store = runtimeAccess?.getSettingsStore?.();
    const loaded = loadArcadeJourneyProgress(store);
    if (!stage || loaded.status === 'unavailable') return false;
    const legacy = runtimeAccess?.getArcadePrimaryProfileRecords?.()?.records;
    const legacyAccess = Number(legacy?.runsPlayed) > 0
        || Number(store?.loadJsonRecord?.('curviosclash.five-portals-records.v1', null)?.bestTotalMs) > 0;
    const access = resolveArcadeJourneyAccess(stageId, loaded.progress, {
        playerCount: resolveDemolitionLocalPlayerCount(settings), legacyAccess,
    });
    if (!access.unlocked) return false;
    return true;
}
