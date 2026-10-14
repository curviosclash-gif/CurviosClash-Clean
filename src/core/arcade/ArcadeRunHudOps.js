// HUD view of the Arcade run, moved out of ArcadeRunRuntime.getHudState unchanged.
// `runtime` is the ArcadeRunRuntime.
import { ARCADE_RUN_PHASES } from '../../state/arcade/ArcadeRunState.js';
import { resolveArcadeRunHudVehicleStats } from '../../state/arcade/ArcadeVehicleProfile.js';
import { toSafeInt, toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

export function getArcadeRunHudState(runtime) {
    if (!runtime._enabled || !runtime._state) return null;
    const nowMs = runtime._state.gameplayTimeMs;
    const score = runtime._state.score && typeof runtime._state.score === 'object'
        ? runtime._state.score
        : {};
    const breakdown = score.breakdown && typeof score.breakdown === 'object'
        ? score.breakdown
        : {};
    const parcoursXpGain = runtime._peekHudEvent('parcours_xp') || runtime._state.lastParcoursXpGain || null;
    const parcoursSegmentSplit = runtime._peekHudEvent('parcours_split') || runtime._state.lastParcoursSegmentSplit || null;
    const parcoursPenalty = runtime._peekHudEvent('parcours_penalty') || runtime._state.lastParcoursPenalty || null;
    // 82.8.3: Vehicle stats for sector-start HUD flash, incl. size build (2a) and the run's stones (3).
    // Profiles are canonicalized when loaded or changed; cached per profile and frozen stone steps.
    const runVehicleId = runtime._getRunVehicleId();
    const vehicleStats = resolveArcadeRunHudVehicleStats(
        runtime._vehicleProfiles?.[runVehicleId] || null,
        runVehicleId,
        runtime._config.dailyChallenge,
        runtime._runBonuses?.build?.stoneSteps
    );
    return {
        nowMs,
        parcoursXpGain,
        parcoursSegmentSplit,
        parcoursPenalty,
        ghostStatus: runtime._peekHudEvent('ghost_status')?.message || '',
        events: runtime._hudEvents,
        vehicleStats,
        phase: String(runtime._state.phase || ''),
        sectorIndex: Math.max(0, Math.floor(toSafeNumber(runtime._state.sectorIndex, 0))),
        completedSectors: Math.max(0, Math.floor(toSafeNumber(runtime._state.completedSectors, 0))),
        currentMapKey: String(runtime._state.currentMapKey || ''),
        activeModifierId: runtime._activeModifierId,
        missionState: runtime._missionState,
        objectiveState: runtime._state.objectiveState || null,
        comboWindowMs: Math.max(800, toSafeInt(runtime._state?.config?.comboWindowMs, 5000)),
        comboDecayPerSecond: Math.max(0, toSafeNumber(runtime._state?.config?.comboDecayPerSecond, 1)),
        comboFreezeUntilMs: Math.max(0, toSafeNumber(runtime._state?.comboFreezeUntilMs, 0)),
        maxMultiplier: Math.max(1, toSafeInt(runtime._state?.config?.maxMultiplier, 8)),
        suddenDeathElapsedMs: runtime._state.phase === ARCADE_RUN_PHASES.SUDDEN_DEATH
            ? Math.max(0, nowMs - Math.max(0, toSafeNumber(runtime._state?.suddenDeathStartedAtMs, nowMs)))
            : 0,
        score: {
            total: Math.max(0, toSafeNumber(score.total, 0)),
            combo: Math.max(0, Math.floor(toSafeNumber(score.combo, 0))),
            multiplier: Math.max(1, toSafeNumber(score.multiplier, 1)),
            lastComboAtMs: Math.max(0, toSafeNumber(score.lastComboAtMs, 0)),
            breakdown: {
                completion: breakdown.completion || 0,
                checkpoints: breakdown.checkpoints || 0,
                time: breakdown.time || 0,
                precision: breakdown.precision || 0,
                base: Math.max(0, toSafeNumber(breakdown.base, 0)),
                survival: Math.max(0, toSafeNumber(breakdown.survival, 0)),
                kills: Math.max(0, toSafeNumber(breakdown.kills, 0)),
                cleanSector: Math.max(0, toSafeNumber(breakdown.cleanSector, 0)),
                risk: Math.max(0, toSafeNumber(breakdown.risk, 0)),
                penalty: Math.max(0, toSafeNumber(breakdown.penalty, 0)),
                total: Math.max(0, toSafeNumber(breakdown.total, 0)),
            },
        },
        lastSectorScore: runtime._state?.lastSectorSummary || null,
    };
}
