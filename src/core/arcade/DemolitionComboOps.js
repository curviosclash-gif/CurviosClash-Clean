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

export function applyDemolitionComboEvent(runtime, event) {
    if (!runtime._demolitionComboState) resetDemolitionCombo(runtime);
    const state = runtime._demolitionComboState;
    const nowMs = Math.max(state.gameplayTimeMs, toSafeNumber(runtime.now(), state.gameplayTimeMs));
    const score = applyArcadeComboDecay(state.score, state.config, nowMs, state.masteryPerks);
    state.gameplayTimeMs = nowMs;
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
