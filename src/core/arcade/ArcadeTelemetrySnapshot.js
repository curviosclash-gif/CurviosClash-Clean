import { getMapKeyForSector } from '../../state/arcade/ArcadeMapProgression.js';
import { toSafeInt, toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

const ABORT_REASONS = new Set(['ABORT', 'ABORTED', 'MATCH_ABORT', 'QUIT', 'RUN_ABORT']);

/**
 * @param {{enabled?: boolean, state?: any, activeVehicleId?: unknown, terminalReason?: unknown}} [options]
 */
export function createArcadeTelemetrySnapshot({ enabled, state, activeVehicleId, terminalReason = '' } = {}) {
    if (enabled !== true || !state) return { enabled: false };
    const history = Array.isArray(state.sectorHistory) ? state.sectorHistory : [];
    const sector = history[history.length - 1] || null;
    const run = state.postRunSummary && typeof state.postRunSummary === 'object' ? state.postRunSummary : null;
    const reason = String(terminalReason || '').trim().toUpperCase();
    const rewardIds = Array.isArray(run?.rewardHistory)
        ? run.rewardHistory.map((entry) => String(entry?.rewardId || entry?.id || '').trim()).filter(Boolean).slice(0, 32)
        : [];
    return {
        enabled: true,
        runId: String(state.runId || run?.runId || ''),
        phase: String(state.phase || ''),
        currentMapKey: String(getMapKeyForSector(state.mapSequence, Math.max(0, toSafeInt(state.sectorIndex, 1) - 1)) || ''),
        activeVehicleId: String(activeVehicleId || ''),
        lastSector: sector ? {
            sectorIndex: Math.max(0, toSafeInt(sector.sectorIndex, 0)),
            modifierId: String(sector.modifierId || ''),
            awardedPoints: Math.max(0, toSafeNumber(sector.awardedPoints, 0)),
            comboAtSectorEnd: Math.max(0, toSafeInt(sector.comboAtSectorEnd, 0)),
            missionsCompleted: Math.max(0, toSafeInt(sector.missionsCompleted, 0)),
            missionsTotal: Math.max(0, toSafeInt(sector.missionsTotal, 0)),
            xpEarned: Math.max(0, toSafeNumber(sector.xpEarned, 0)),
        } : null,
        run: run ? {
            score: Math.max(0, toSafeNumber(run.score, 0)),
            peakMultiplier: Math.max(1, toSafeNumber(run.peakMultiplier, 1)),
            peakCombo: Math.max(0, toSafeInt(run.bestCombo, 0)),
            completedSectors: Math.max(0, toSafeInt(run.completedSectors, 0)),
            isDailyChallenge: run.isDailyChallenge === true,
            aborted: ABORT_REASONS.has(reason),
            terminalReason: reason || 'COMPLETED',
            rewardIds,
        } : null,
    };
}
