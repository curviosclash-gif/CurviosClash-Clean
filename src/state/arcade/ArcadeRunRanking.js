import { loadArcadeDifficultyProgress, evaluateArcadeDifficultyUnlock, ARCADE_DIFFICULTY_STORAGE_KEY } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { ARCADE_RANKED_STORAGE_KEY, ARCADE_RANKED_VERSION, insertArcadeRankedResult } from '../../shared/contracts/ArcadeRankedLeaderboardContract.js';

/** Existing XP and run records are settled first. These independent writes cannot discard them. */
export function settleArcadeRunRanking(runtime, result, nowMs = Date.now()) {
    const context = runtime?.rankContext;
    const store = runtime?._rankingStore;
    if (!context?.ranked || !store || result?.aborted === true) return null;
    try {
        const progress = loadArcadeDifficultyProgress(store);
        if (progress.status !== 'unavailable') {
            const next = evaluateArcadeDifficultyUnlock(progress.progress, context, result, nowMs);
            if (JSON.stringify(next) !== JSON.stringify(progress.progress)) store.saveJsonRecord?.(ARCADE_DIFFICULTY_STORAGE_KEY, next);
        }
        const read = store.readJsonRecordResult?.(ARCADE_RANKED_STORAGE_KEY);
        if (read?.status !== 'missing' && (read?.status !== 'found' || read.value?.schemaVersion !== ARCADE_RANKED_VERSION)) return null;
        const ranked = insertArcadeRankedResult(read?.value, context, result, nowMs);
        const saved = store.saveJsonRecord?.(ARCADE_RANKED_STORAGE_KEY, ranked.leaderboard);
        if (saved !== true && saved?.success !== true && saved?.ok !== true) return null;
        return { key: ranked.key, rank: ranked.rank, tierId: context.tierId, vehicleLevel: context.vehicleLevel, levelRange: context.levelRange };
    } catch { return null; }
}
