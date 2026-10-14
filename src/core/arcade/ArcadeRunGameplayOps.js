// Gameplay clock, missions, combo and mission events of the Arcade run, moved out of
// ArcadeRunRuntime unchanged. `runtime` is the ArcadeRunRuntime.
import { trackArcadeColorEvent } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { ARCADE_RUN_PHASES } from '../../state/arcade/ArcadeRunState.js';
import { applyArcadeComboDecay, applyComboAction } from '../../state/arcade/ArcadeScoreOps.js';
import { updateSectorMissionState } from '../../state/arcade/ArcadeMissionState.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';
import { finalizeExpiredArcadeTestFlight } from './ArcadeRunCompletionOps.js';
import { applyArcadeMasteryScoreBonus } from './ArcadeMasteryPerkRuntimeOps.js';
import { updateArcadeObjectiveRuntimeState } from './ArcadeObjectiveRuntimeOps.js';
import { beginArcadeMoment, recordArcadeMoments } from '../../state/arcade/ArcadeRunMomentLog.js';

export function updateArcadeRunMissions(runtime, event) {
    if (!runtime._missionState) return;
    runtime._missionState = updateSectorMissionState(runtime._missionState, event);
    if (runtime._state) {
        runtime._state.missions = runtime._missionState;
    }
}

export function applyArcadeRunComboDecayAt(runtime, nowMs) {
    if (!runtime._state?.score) return;
    const frozenUntil = Math.max(0, toSafeNumber(runtime._state.comboFreezeUntilMs, 0));
    if (frozenUntil > 0 && nowMs <= frozenUntil) return;
    const decayedScore = applyArcadeComboDecay(runtime._state.score, runtime._state.config, nowMs, runtime._state.masteryPerks);
    if (decayedScore !== runtime._state.score) {
        runtime._state = { ...runtime._state, score: decayedScore };
    }
}

export function tickArcadeRunGameplay(runtime, dt = 0) {
    if (!runtime._enabled || !runtime._state) return null;
    const phase = String(runtime._state.phase || '');
    if (phase !== ARCADE_RUN_PHASES.SECTOR_ACTIVE && phase !== ARCADE_RUN_PHASES.SUDDEN_DEATH) {
        return null;
    }
    runtime._state.gameplayTimeMs += Math.max(0, toSafeNumber(dt, 0)) * 1000;
    runtime._sectorElapsedSeconds += Math.max(0, toSafeNumber(dt, 0));
    const elapsedSecond = Math.floor(runtime._sectorElapsedSeconds);
    if (elapsedSecond <= runtime._lastMissionTickSecond) return finalizeExpiredArcadeTestFlight(runtime);
    runtime._lastMissionTickSecond = elapsedSecond;
    return finalizeExpiredArcadeTestFlight(runtime)
        || runtime.applyGameplayEvent({ type: 'tick', elapsed: runtime._sectorElapsedSeconds });
}

/**
 * Apply a mission event and, for action events, increment the combo.
 * 61.2.1 + 61.2.3 + 61.3.5
 */
export function applyArcadeRunGameplayEvent(runtime, event) {
    if (!runtime._enabled || !runtime._state) return null;
    trackArcadeColorEvent(runtime._colorProgress, event);
    const nowMs = runtime._state.gameplayTimeMs;
    const eventWithTime = { ...event, nowMs };
    beginArcadeMoment(runtime);

    runtime._applyComboDecayAt(nowMs);

    // Update missions first so allCompleted flag reflects current action
    const wasAllCompleted = runtime._missionState?.allCompleted === true;
    runtime.updateMissions(eventWithTime);

    // 61.2.3: Freeze combo 3s on mission-all-complete (first time only)
    // 61.3.5: Also award score boost when all sector missions completed
    const justCompleted = !wasAllCompleted && runtime._missionState?.allCompleted === true;
    if (justCompleted && runtime._state.score) {
        const MISSION_ALL_COMPLETE_BONUS = 500;
        const multiplier = Math.max(1, toSafeNumber(runtime._state.score?.multiplier, 1));
        const bonus = applyArcadeMasteryScoreBonus(
            MISSION_ALL_COMPLETE_BONUS * multiplier,
            runtime._state.masteryPerks
        );
        runtime._state = {
            ...runtime._state,
            comboFreezeUntilMs: nowMs + 3000,
            score: {
                ...runtime._state.score,
                total: Math.max(0, toSafeNumber(runtime._state.score.total, 0) + bonus),
                lastMissionBonus: bonus,
                lastComboAtMs: nowMs,
                comboDecayApplied: 0,
                comboDecayRule: null,
            },
        };
    }

    // Combo freeze protects against decay; scoring actions still extend the chain.
    const newScore = applyComboAction(runtime._state.score, eventWithTime, runtime._state.config);
    if (newScore !== runtime._state.score) {
        runtime._state = { ...runtime._state, score: newScore };
    }

    updateArcadeObjectiveRuntimeState(runtime, eventWithTime);
    recordArcadeMoments(runtime, eventWithTime);
    return runtime.getStateSnapshot();
}
