// Route and reward choices of the Arcade intermission, pending intermission effects and the
// victory choice, moved out of ArcadeRunRuntime unchanged. `runtime` is the ArcadeRunRuntime.
import { ARCADE_RUN_PHASES } from '../../state/arcade/ArcadeRunState.js';
import { toSafeInt } from '../../shared/utils/ArcadeUtils.js';
import { applyArcadeIntermissionEffects } from './ArcadeIntermissionEffects.js';
import { resolveArcadeModifierScoreBonus } from './ArcadeIntermissionPlanOps.js';

function clampIndex(index, maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
    const parsed = Number(index);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(maxExclusive - 1, Math.floor(parsed)));
}

export function selectArcadeIntermissionChoice(runtime, choiceIdOrIndex) {
    if (!runtime._state?.intermission) return null;
    const intermission = runtime._state.intermission;
    const choices = Array.isArray(intermission.choices) ? intermission.choices : [];
    if (choices.length === 0) return runtime.getIntermissionState();

    const selectedChoice = typeof choiceIdOrIndex === 'number'
        ? choices[clampIndex(choiceIdOrIndex, choices.length)]
        : choices.find((entry) => entry.id === String(choiceIdOrIndex || '').trim());
    if (!selectedChoice) return runtime.getIntermissionState();

    intermission.selectedChoiceId = selectedChoice.id;
    intermission.nextSectorPreview = {
        ...(intermission.nextSectorPreview && typeof intermission.nextSectorPreview === 'object'
            ? intermission.nextSectorPreview
            : {}),
        mapKey: selectedChoice.mapKey,
        mapLabel: selectedChoice.mapLabel,
        modifierId: selectedChoice.modifierId || null,
        modifierLabel: selectedChoice.modifierLabel || 'Kein Modifikator',
        modifierEffect: selectedChoice.modifierEffect || '',
    };
    const nextSectorIndex = Math.max(1, toSafeInt(intermission.nextSectorIndex, runtime._state.completedSectors + 1));
    const seqIndex = Math.max(0, nextSectorIndex - 1);

    if (Array.isArray(runtime._state.mapSequence) && seqIndex < runtime._state.mapSequence.length) {
        runtime._state.mapSequence[seqIndex] = selectedChoice.mapKey;
    }
    if (Array.isArray(runtime._state.encounterSequence) && seqIndex < runtime._state.encounterSequence.length) {
        const currentEntry = runtime._state.encounterSequence[seqIndex];
        if (currentEntry && typeof currentEntry === 'object') {
            const modifierId = selectedChoice.modifierId || null;
            runtime._state.encounterSequence[seqIndex] = {
                ...currentEntry,
                modifierId,
                scoreBonus: resolveArcadeModifierScoreBonus(modifierId),
            };
        }
    }
    return runtime.getIntermissionState();
}

export function selectArcadeReward(runtime, rewardId) {
    if (!runtime._state?.intermission) return null;
    const intermission = runtime._state.intermission;
    const rewards = Array.isArray(intermission.rewardChoices) ? intermission.rewardChoices : [];
    const selectedReward = rewards.find((entry) => entry.id === String(rewardId || '').trim()) || null;
    if (!selectedReward) return runtime.getIntermissionState();

    intermission.selectedRewardId = selectedReward.id;
    intermission.selectedRewardLabel = selectedReward.label || selectedReward.id;
    intermission.selectedRewardEffect = selectedReward.effectText || '';
    return runtime.getIntermissionState();
}

export function applyArcadePendingIntermissionEffects(runtime, { players = null } = {}) {
    if (!runtime._pendingIntermissionEffects) return null;
    const context = runtime._pendingIntermissionEffects;
    const result = applyArcadeIntermissionEffects({
        players,
        strategy: runtime._strategy,
        context,
        state: runtime._state,
        nowMs: runtime.now(),
    });
    runtime._pendingIntermissionEffects = null;
    return result;
}

export function resolveArcadeVictoryChoice(runtime, choice) {
    if (runtime._state?.phase !== ARCADE_RUN_PHASES.VICTORY || !runtime._state.victory) return null;
    if (choice === 'finish') {
        runtime._finalizeRun(runtime.now());
        runtime.flushPersistenceSaves();
        return { nextState: 'MATCH_END', roundPause: 0 };
    }
    if (choice !== 'continue') return null;
    runtime._state.phase = ARCADE_RUN_PHASES.INTERMISSION;
    runtime._prepareIntermission(runtime.now());
    return { nextState: 'ROUND_END', roundPause: runtime._config.intermissionSeconds };
}
