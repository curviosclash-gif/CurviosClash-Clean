import { normalizeEndlessParcoursRecords, ENDLESS_PARCOURS_RECORDS_STORAGE_KEY } from '../../shared/contracts/EndlessParcoursRecordsContract.js';
import { resolveEndlessRecordScope } from '../../shared/contracts/EndlessParcoursSeedContract.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from '../../shared/contracts/EndlessParcoursWaveContract.js';
import { resolveArcadeRunVehicleId } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import { resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { loadArcadeJourneyProgress } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
import { ARCADE_JOURNEY_STAGES, getArcadeJourneyStage, resolveArcadeJourneyAccess } from '../../shared/contracts/ArcadeJourneyContract.js';
import { loadArcadeDifficultyProgress, resolveArcadeRunTier } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { resolveDemolitionLocalPlayerCount } from './ArcadeDemolitionProfileSelection.js';
import { PORTAL_CHAINS } from '../../shared/contracts/PortalChainContract.js';

export function syncArcadeJourneyMenu(view, runtimeAccess, settings, profile, records, seed = settings.arcade?.seed) {
    const store = runtimeAccess?.getSettingsStore?.();
    const loaded = loadArcadeJourneyProgress(store);
    const difficulty = loadArcadeDifficultyProgress(store).progress;
    const tiers = Object.fromEntries(ARCADE_JOURNEY_STAGES.map(stage => {
        if (stage.runType === 'classic_tutorial') return [stage.id, 'normal'];
        const tier = resolveArcadeRunTier(settings.arcade?.difficultyTierId, difficulty, { runType: stage.runType });
        return [stage.id, tier === 'any' ? 'normal' : tier];
    }));
    const legacyAccess = loaded.progress.allStagesUnlocked === true;
    const briefing = runtimeAccess?.getArcadeJourneyBriefing?.(seed, tiers.first_run);
    const freeRecords = Object.fromEntries(Object.values(PORTAL_CHAINS).map(chain => {
        const record = store?.loadJsonRecord?.(chain.recordKey, null);
        return [chain.id, Number.isFinite(record?.bestTotalMs) && record.bestTotalMs > 0
            ? `Bisheriger freier Tourrekord: ${(record.bestTotalMs / 1000).toFixed(2)} s · eigene Rekordwertung, keine Reisemedaille` : 'Noch keine gespeicherte freie Tourbestzeit'];
    }));
    const options = view.getEndlessStartOptions?.(profile?.id || '') || { seedMode: 'free' };
    const vehicleId = resolveArcadeRunVehicleId(settings?.vehicles?.PLAYER_1);
    const scope = resolveEndlessRecordScope({ ruleVersion: ENDLESS_PARCOURS_RULE_VERSION, vehicleId,
        seedMode: options.seedMode, seed: options.trainingSeed });
    const endless = normalizeEndlessParcoursRecords(store?.loadJsonRecord?.(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY, null));
    const best = endless.bestByRunScope[scope], distance = endless.bestDistanceByRunScope[scope];
    freeRecords.endless_hunt = `${resolveVehiclePreview(vehicleId).label} · ${options.seedMode === 'training' ? 'Training · Seed ' + options.trainingSeed : 'Frei'}: `
        + (best ? `${Math.round(best.score)} Punkte · ${Math.round(distance?.distanceMeters || 0)} m` : 'Noch kein Modellrekord.');
    view.render({ briefings: briefing ? { first_run: briefing } : {}, progress: loaded.progress, available: loaded.status !== 'unavailable', legacyAccess, tiers, freeRecords,
        playerCount: resolveDemolitionLocalPlayerCount(settings), profileId: profile?.id || '', profileName: profile?.displayName || '' });
}

/** Validate again at click time; a profile can change while its old world card is still mounted. */
export function prepareArcadeJourneyMenuStart(stageId, settings, runtimeAccess) {
    const stage = getArcadeJourneyStage(stageId);
    const store = runtimeAccess?.getSettingsStore?.();
    const loaded = runtimeAccess?.initializeArcadeJourneyAccess?.(store);
    if (!stage || !loaded || loaded.status === 'unavailable') return false;
    const legacyAccess = loaded.progress.allStagesUnlocked === true;
    const access = resolveArcadeJourneyAccess(stageId, loaded.progress, {
        playerCount: resolveDemolitionLocalPlayerCount(settings), legacyAccess,
    });
    if (!access.unlocked) return false;
    return true;
}
