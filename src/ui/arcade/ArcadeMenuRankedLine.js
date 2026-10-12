import { createArcadeRankContext } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { resolveActiveArcadeCompanionCount } from '../../shared/contracts/ArcadeCompanionContract.js';
import { ARCADE_RANKED_STORAGE_KEY, normalizeArcadeRankedLeaderboard, resolveArcadeRankKey } from '../../shared/contracts/ArcadeRankedLeaderboardContract.js';
import { resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';

/** The rank context the next run would get, built by the same contract the runtime uses. */
export function createArcadeMenuRankContext(settings, { tierId, vehicleId, profile }) {
    const arcade = settings?.arcade || {};
    const humanCount = Math.max(1, Number.parseInt(String(settings?.mode || '1p'), 10) || 1);
    // runId and stoneSteps only feed botStrength, which the menu line does not read.
    return createArcadeRankContext({
        runId: '', stoneSteps: undefined,
        runType: arcade.runType || 'gauntlet', vehicleId, profile, tierId, dailyChallenge: arcade.dailyChallenge === true,
        runSettings: arcade, portalChainId: arcade.portalChainId,
        companionCount: resolveActiveArcadeCompanionCount({ ...arcade, enabled: true }, { humanCount, enemyCount: 1 }),
    });
}

/** "Bestenliste" line: the board of this run type, tier and level range, plus why a run would not count. */
export function formatArcadeMenuRankedLine(rankContext, store, { tierLabel, formatInteger }) {
    // An unranked choice still shows the standard board it would otherwise compete on.
    const key = resolveArcadeRankKey({ ...rankContext, ranked: rankContext.strengthScaled });
    const rows = normalizeArcadeRankedLeaderboard(store?.loadJsonRecord?.(ARCADE_RANKED_STORAGE_KEY, null)).boards[key] || [];
    // An unranked run neither enters the board nor unlocks a difficulty tier (evaluateArcadeDifficultyUnlock).
    const note = rankContext.customSettings ? ' · nicht gewertet, keine Stufen-Freischaltung (eigene Einstellungen)'
        : (rankContext.companions && rankContext.strengthScaled ? ' · nicht gewertet, keine Stufen-Freischaltung (mit Mitstreitern)' : '');
    const formatRow = (row, index) => `${index + 1}. ${resolveVehiclePreview(row.vehicleId).label} (Lv. ${row.vehicleLevel}) `
        + (rankContext.runType === 'five_portals' ? `${(row.score / 1000).toFixed(2)} s` : `${formatInteger(row.score)} Punkte`);
    return `Bestenliste · ${tierLabel} · Level ${rankContext.levelRange.label}${note}: `
        + (rows.length ? rows.map(formatRow).join(' · ') : 'Noch kein gewerteter Lauf.');
}
