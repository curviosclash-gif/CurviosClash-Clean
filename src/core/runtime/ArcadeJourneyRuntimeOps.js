import { isClassicTutorialRoute } from '../../shared/contracts/ClassicTutorialContract.js';
import { createArcadeJourneyRunBinding, settleArcadeJourneyRun } from '../arcade/ArcadeJourneyRunBinding.js';
import { resolvePlayerRecordStorePortForIndex } from './PlayerProfileRuntimeAccess.js';
import { loadArcadeJourneyProgress } from '../../state/arcade/ArcadeJourneyProgress.js';
import { getArcadeJourneyNextStage } from '../../shared/contracts/ArcadeJourneyContract.js';

function updateResult(current, result) {
    const binding = current.binding;
    const progress = loadArcadeJourneyProgress(binding.participants[0].store);
    const next = !result.pending && result.medal > 0 && progress.status !== 'unavailable'
        ? getArcadeJourneyNextStage(binding.stageId, progress.progress, binding.participants.length) : null;
    current.projected = { ...result, stageId: binding.stageId, tierId: binding.tierId, nextStageId: next?.id || '' };
    current.runtime.journeyResult = current.projected;
    return current.projected;
}

export function projectArcadeJourneyResult(support) { return support._journeyRun?.projected || null; }

function journeyRuntime(support, state) {
    switch (state?.runtimeConfig?.arcade?.runType) {
        case 'five_portals': return support.fivePortalsRuntime;
        case 'arena_waves': return support.arenaWavesRuntime;
        case 'weapon_race': return support.weaponRaceRuntime;
        case 'demolition': return support.demolitionSupport?.runtime;
        case 'endless_parcours': return support._getEndlessRuntime?.(state);
        default: return support.arcadeRunRuntime;
    }
}

export function retryPendingArcadeJourney(support, { immediate = false } = {}) {
    const current = support._journeyRun;
    if (!current?.binding.pending) return true;
    const now = support._nowMs();
    if (!immediate && now < current.retryAtMs) return false;
    current.retryAtMs = now + 1000;
    const result = settleArcadeJourneyRun(current.binding);
    updateResult(current, result);
    return !result.pending;
}

/** Called after profile/rank binding and before a run can start or rebind its entities. */
export function prepareArcadeJourneyRuntime(support, state, runActive) {
    if (!retryPendingArcadeJourney(support, { immediate: true })) {
        throw new Error('Die Medaillen des vorherigen Laufs konnten noch nicht gespeichert werden.');
    }
    const runtime = journeyRuntime(support, state);
    const previous = support._journeyRun;
    const active = runActive || (state?.runtimeConfig?.arcade?.runType === 'demolition'
        && runtime?.phase !== 'idle' && runtime?.phase !== 'finished');
    if (previous?.runtime === runtime && active) return;
    if (previous && !previous.binding.finished) settleArcadeJourneyRun(previous.binding, { aborted: true });
    if (previous && previous.runtime?._onJourneyCompleted === previous.complete) previous.runtime._onJourneyCompleted = null;
    support._journeyRun = null;
    const config = state?.runtimeConfig?.arcade;
    const tutorial = !config?.enabled && state?.mapKey === 'tutorial_classic';
    if (!runtime || (!tutorial && (!config?.enabled || !config.journeyStageId))) return;
    const manager = support.game?.playerProfileManager;
    const profileIds = tutorial ? [manager?.getActiveProfile?.()?.id]
        : config.runType === 'demolition' ? config.demolitionProfileIds : config.playerProfileIds;
    const humans = state?.entityManager?.humanPlayers || [];
    const participants = humans.filter(player => !player.isBot).map(player => ({
        profileId: profileIds?.[player.index],
        store: resolvePlayerRecordStorePortForIndex(manager, player.index, profileIds?.[player.index]),
    }));
    support._journeySequence = (support._journeySequence || 0) + 1;
    const binding = createArcadeJourneyRunBinding({ stageId: tutorial ? 'flight_school' : config.journeyStageId, runType: tutorial ? 'classic_tutorial' : config.runType,
        portalChainId: !tutorial && config.runType === 'five_portals' ? config.portalChainId : '',
        tierId: tutorial ? 'normal' : runtime.rankContext?.tierId || 'normal',
        runId: `journey:${support._nowMs()}:${support._journeySequence}`, participants });
    if (!binding) throw new Error('Die Reise-Etappe benötigt gültige, getrennte Spielerprofile.');
    const current = { runtime, binding, retryAtMs: 0, complete: null };
    current.complete = (result) => {
        const settled = settleArcadeJourneyRun(binding, result);
        const projected = updateResult(current, settled);
        current.retryAtMs = support._nowMs() + 1000;
        return projected;
    };
    runtime.journeyResult = null;
    runtime._onJourneyCompleted = current.complete;
    support._journeyRun = current;
}


/** Receives the real parcours completion event, never an HUD-render or a checkpoint event. */
export function completeClassicTutorialJourney(support, state, event) {
    const current = support._journeyRun;
    if (current?.binding.stageId !== 'flight_school' || current.binding.finalResult
        || event?.type !== 'finish' || event.playerIndex !== 0 || !isClassicTutorialRoute(event.routeId)
        || state?.mapKey !== 'tutorial_classic' || state?.runtimeConfig?.arcade?.enabled) return false;
    const winner = state?.entityManager?.humanPlayers?.find(player => player.index === 0 && !player.isBot);
    if (!winner) return false;
    current.complete({ succeeded: true, value: 1 });
    state.entityManager.requestRoundEnd?.({ winner, reason: 'JOURNEY_TUTORIAL' });
    return true;
}
