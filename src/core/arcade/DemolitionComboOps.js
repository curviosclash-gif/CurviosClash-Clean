import { createArcadeRunState } from '../../state/arcade/ArcadeRunState.js';
import { applyArcadeComboDecay, applyComboAction } from '../../state/arcade/ArcadeScoreOps.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

export function resetDemolitionCombo(runtime) {
    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    runtime._demolitionComboState = createArcadeRunState({
        config: { ...runtime._config, maxMultiplier: 3 },
        records: runtime._records,
        nowMs,
        runId: 'demolition-combo',
    });
    return getDemolitionComboMultiplier(runtime);
}

/**
 * Played time of the combo. Demolition skips the arcade run tick, so its support advances this
 * clock per simulation tick; a pause therefore freezes the combo window instead of running it out.
 */
export function advanceDemolitionComboClock(runtime, dt) {
    const state = runtime?._demolitionComboState;
    if (!state) return;
    state.gameplayTimeMs += Math.max(0, toSafeNumber(dt, 0)) * 1000;
}

export function applyDemolitionComboEvent(runtime, event) {
    if (!runtime._demolitionComboState) resetDemolitionCombo(runtime);
    const state = runtime._demolitionComboState;
    const nowMs = state.gameplayTimeMs;
    const score = applyArcadeComboDecay(state.score, state.config, nowMs, state.masteryPerks);
    state.score = applyComboAction(score, { ...event, type: 'kill', nowMs }, state.config);
    return getDemolitionComboMultiplier(runtime);
}

export function getDemolitionComboMultiplier(runtime) {
    return Math.max(1, toSafeNumber(
        runtime._demolitionComboState?.score?.multiplier ?? runtime._state?.score?.multiplier,
        1
    ));
}

export function clearDemolitionCombo(runtime) {
    runtime._demolitionComboState = null;
}
