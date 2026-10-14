// Round-end and match-end telemetry, sector history and XP awards of the Arcade run, moved out of
// ArcadeRunRuntime unchanged. `runtime` is the ArcadeRunRuntime.
import { ARCADE_RUN_PHASES } from '../../state/arcade/ArcadeRunState.js';
import { applyArcadeSectorScore } from '../../state/arcade/ArcadeScoreOps.js';
import { getMapKeyForSector } from '../../state/arcade/ArcadeMapProgression.js';
import { calculateSectorXp, XP_REWARD_TABLE } from '../../state/arcade/ArcadeVehicleProfile.js';
import { toSafeInt, toSafeNumber } from '../../shared/utils/ArcadeUtils.js';
import { awardArcadeRunPartnersXp, awardArcadeRunPlayerXp } from './ArcadeRunVehicleRewardOps.js';
import { syncArcadeMasteryPerks } from './ArcadeMasteryPerkRuntimeOps.js';

export function handleArcadeRoundEndTelemetry(runtime, payload = null) {
    if (!runtime._enabled || !runtime._state || !payload || typeof payload !== 'object') {
        return runtime.getStateSnapshot();
    }

    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    const lastScoredSector = runtime._state.score.lastScoredSector;
    runtime._state = applyArcadeSectorScore(runtime._state, payload, {
        nowMs: runtime._state.gameplayTimeMs,
        masteryPerks: runtime._state.masteryPerks,
    });
    if (runtime._state.score.lastScoredSector > lastScoredSector) runtime._applySectorXpReward(payload);
    runtime._recordSectorHistoryEntry(payload, nowMs);
    if (runtime._state.phase === ARCADE_RUN_PHASES.VICTORY && !runtime._state.victory) {
        runtime._state.victory = {
            score: runtime._state.score.total,
            xpEarned: runtime._state.xpEarned,
            completedSectors: runtime._state.completedSectors,
            lastSector: runtime._state.lastSectorSummary,
        };
        runtime._recordDailyResult(nowMs);
    }
    if (runtime._state.intermission) {
        runtime._state.intermission.lastSectorPoints = runtime._state.lastSectorSummary?.awardedPoints || 0;
        runtime._state.intermission.lastSectorXp = runtime._state.xpEarned - (runtime._state.sectorStartXp || 0);
        runtime._state.intermission.missionBonus = runtime._state.lastSectorSummary?.missionBonus || 0;
        runtime._state.intermission.scoreFactor = runtime._state.lastSectorSummary?.scoreFactor || 1;
        runtime._state.intermission.breakdown = runtime._state.lastSectorSummary?.breakdown || null;
    }

    const payloadState = String(payload.state || '').trim().toUpperCase();
    if (payloadState === 'MATCH_END' || runtime._state.phase === ARCADE_RUN_PHASES.FINISHED) {
        runtime._finalizeRun(nowMs);
    }
    return runtime.getStateSnapshot();
}

export function handleArcadeMatchEndTelemetry(runtime, payload = null) {
    if (!runtime._enabled || !runtime._state || !payload || typeof payload !== 'object') {
        return runtime.getStateSnapshot();
    }

    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    const payloadState = String(payload.state || '').trim().toUpperCase();
    if (payloadState === 'MATCH_END' || runtime._state.phase === ARCADE_RUN_PHASES.FINISHED) {
        runtime._finalizeRun(nowMs);
    }
    return runtime.getStateSnapshot();
}

export function recordArcadeSectorHistoryEntry(runtime, payload, nowMs = Date.now()) {
    if (!runtime._state) return;
    const lastSectorSummary = runtime._state.lastSectorSummary;
    const sectorIndex = Math.max(0, toSafeInt(lastSectorSummary?.sectorIndex, 0));
    if (sectorIndex <= 0) return;
    const existing = Array.isArray(runtime._state.sectorHistory) ? runtime._state.sectorHistory : [];
    if (existing.some((entry) => toSafeInt(entry?.sectorIndex, -1) === sectorIndex)) return;

    const encounterEntry = runtime._getEncounterSectorEntry(sectorIndex);
    const missionsCompleted = Math.max(0, toSafeInt(runtime._missionState?.completedCount, 0));
    const missionsTotal = Math.max(0, toSafeInt(runtime._missionState?.missions?.length, 0));
    const breakdown = lastSectorSummary?.breakdown && typeof lastSectorSummary.breakdown === 'object'
        ? { ...lastSectorSummary.breakdown }
        : {};
    existing.push({
        sectorIndex,
        endedAtIso: new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString(),
        phase: String(lastSectorSummary?.sectorPhase || ''),
        wasSuddenDeath: lastSectorSummary?.wasSuddenDeath === true,
        mapKey: getMapKeyForSector(runtime._state.mapSequence, Math.max(0, sectorIndex - 1)),
        templateId: String(encounterEntry?.templateId || ''),
        encounterId: String(lastSectorSummary?.encounterId || encounterEntry?.encounterId || encounterEntry?.id || ''),
        objectiveId: String(encounterEntry?.objectiveId || ''),
        squadId: String(encounterEntry?.squadId || ''),
        modifierId: String(lastSectorSummary?.modifierId || encounterEntry?.modifierId || runtime._activeModifierId || ''),
        scoreBonus: Math.max(0, toSafeNumber(encounterEntry?.scoreBonus, 0)),
        awardedPoints: Math.max(0, toSafeNumber(lastSectorSummary?.awardedPoints, 0)),
        multiplierApplied: Math.max(1, toSafeNumber(lastSectorSummary?.multiplierApplied, 1)),
        comboAtSectorEnd: Math.max(0, toSafeInt(lastSectorSummary?.comboAtSectorEnd, 0)),
        missionsCompleted,
        missionsTotal,
        kills: Math.max(0, toSafeInt(payload?.kills, 0)),
        duration: Math.max(0, toSafeNumber(payload?.duration, 0)),
        selfCollisions: Math.max(0, toSafeInt(payload?.selfCollisions, 0)),
        itemUses: Math.max(0, toSafeInt(payload?.itemUses, 0)),
        stuckEvents: Math.max(0, toSafeInt(payload?.stuckEvents, 0)),
        breakdown,
        xpEarned: Math.max(0, toSafeNumber(runtime._state?.lastSectorXp?.earned, 0)),
    });
    runtime._state.sectorHistory = existing;
}

// playerVehicleId: plane of that local pilot, so split-screen XP levels the plane that earned it.
export function applyArcadeParcoursXpEvent(runtime, eventType, playerIndex = 0, playerVehicleId = null) {
    if (!runtime._enabled) return null;
    const xpByEvent = {
        checkpoint: XP_REWARD_TABLE.parcoursCheckpoint,
        finish: XP_REWARD_TABLE.parcoursFinish,
        new_best_time: XP_REWARD_TABLE.parcoursNewBestTime,
    };
    const baseXp = xpByEvent[String(eventType)] || 0;
    if (baseXp <= 0) return null;

    const { result, ownsRunPerks } = awardArcadeRunPlayerXp(runtime, baseXp, playerIndex, playerVehicleId) || {};
    if (!result) return null;
    const xpEarned = result.earned;
    if (runtime._state) runtime._state.xpEarned += xpEarned;
    if (ownsRunPerks) syncArcadeMasteryPerks(runtime._state, result.profile);

    if (runtime._state) {
        runtime._state.lastParcoursXpGain = runtime._enqueueHudEvent('parcours_xp', {
            eventType: String(eventType),
            earned: xpEarned,
            leveledUp: result.leveledUp,
            newLevel: result.newLevel,
        });
    }
    return { earned: xpEarned, leveledUp: result.leveledUp, newLevel: result.newLevel };
}

export function applyArcadeSectorXpReward(runtime, telemetryPayload) {
    const missionsCompleted = runtime._missionState?.completedCount || 0;
    const totalMissions = runtime._missionState?.missions?.length || 0;
    const telemetry = {
        kills: toSafeNumber(telemetryPayload?.kills, 0),
        intercepts: toSafeNumber(telemetryPayload?.intercepts, 0),
        unitsDestroyed: toSafeNumber(telemetryPayload?.unitsDestroyed, 0),
        unitDestroyedXp: toSafeNumber(telemetryPayload?.unitDestroyedXp, NaN),
        multiplier: toSafeNumber(runtime._state?.score?.multiplier, 1),
        missionsCompleted,
        totalMissions,
        cleanSector: Math.max(0, toSafeNumber(telemetryPayload?.selfCollisions, 0)) === 0,
    };

    const baseXp = calculateSectorXp(telemetry);
    // Player one's plane keeps the run perks; split-screen partners level their own planes.
    const result = awardArcadeRunPlayerXp(runtime, baseXp)?.result;
    if (!result) return;
    const xpEarned = result.earned;
    if (runtime._state) runtime._state.xpEarned += xpEarned + awardArcadeRunPartnersXp(runtime, baseXp);
    syncArcadeMasteryPerks(runtime._state, result.profile);

    // Attach XP info to state for UI consumption
    if (runtime._state) {
        runtime._state.lastSectorXp = {
            earned: xpEarned,
            leveledUp: result.leveledUp,
            newLevel: result.newLevel,
            unlocksGained: result.unlocksGained,
        };
    }
}
