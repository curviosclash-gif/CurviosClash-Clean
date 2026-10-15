import { loadLastRunSnapshot } from './ArcadeMenuProfilePersistence.js';
import { resolveArcadeJourneyContinue } from '../../shared/contracts/ArcadeJourneyContinueContract.js';
import { getArcadeJourneyStage } from '../../shared/contracts/ArcadeJourneyContract.js';
import { loadArcadeJourneyProgress } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
import { resolveDemolitionLocalPlayerCount } from './ArcadeDemolitionProfileSelection.js';

export function syncArcadeJourneyContinueSummary({ ui, settings, runtimeAccess, profile, hasActiveLobbySession = false }) {
    if (hasActiveLobbySession || !profile?.id) return;
    const store = runtimeAccess.getSettingsStore?.();
    const record = loadLastRunSnapshot(store);
    const loaded = loadArcadeJourneyProgress(store);
    const legacyAccess = Number(runtimeAccess.getArcadePrimaryProfileRecords?.()?.records?.runsPlayed) > 0
        || Number(store?.loadJsonRecord?.('curviosclash.five-portals-records.v1', null)?.bestTotalMs) > 0;
    const continuation = resolveArcadeJourneyContinue(record, {
        profileId: profile.id, progress: loaded.progress, progressAvailable: loaded.status !== 'unavailable',
        playerCount: resolveDemolitionLocalPlayerCount(settings), legacyAccess,
    });
    const stage = getArcadeJourneyStage(continuation.stageId);
    const label = ui.quickStartLastButton?.querySelector?.('.menu-primary-start-label');
    if (stage) {
        if (ui.quickStartLastTitle) ui.quickStartLastTitle.textContent = stage.label;
        if (ui.quickStartLastSummary) ui.quickStartLastSummary.textContent = `${profile.displayName || 'Dein Profil'} · Arcade-Reise · ${continuation.status === 'ready' ? 'Letzte Etappe fortsetzen' : 'Etappe in der Zentrale ansehen'}`;
        if (label) label.textContent = continuation.status === 'ready' ? 'Weiterspielen' : 'Zur Arcade-Reise';
    } else if (!record) {
        if (ui.quickStartLastTitle) ui.quickStartLastTitle.textContent = 'Deine Arcade-Reise';
        if (ui.quickStartLastSummary) ui.quickStartLastSummary.textContent = `${profile.displayName || 'Dein Profil'} · Wähle deine erste Etappe`;
        if (label) label.textContent = 'Losfliegen';
    }
}
