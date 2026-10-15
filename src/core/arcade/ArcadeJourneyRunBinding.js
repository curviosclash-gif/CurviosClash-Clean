import {
    evaluateArcadeJourneyMedal,
    getArcadeJourneyStage,
} from '../../shared/contracts/ArcadeJourneyContract.js';
import { recordArcadeJourneyResult } from '../../state/arcade/ArcadeJourneyProgress.js';

const TIERS = new Set(['normal', 'hard', 'nightmare']);
const bindings = new WeakSet();
const bindingStates = new WeakMap();

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defineFixed(binding, key, value) {
    Object.defineProperty(binding, key, { value, enumerable: true, writable: false, configurable: false });
}

export function createArcadeJourneyRunBinding({
    stageId,
    runType,
    portalChainId,
    tierId,
    runId,
    participants,
} = {}) {
    const stage = getArcadeJourneyStage(stageId);
    const chainId = String(portalChainId || '').trim();
    const id = String(runId || '').trim();
    let tier = String(tierId || '').trim();
    if (!stage || stage.runType !== runType || !id
        || (stage.portalChainId ? chainId !== stage.portalChainId : chainId !== '')) {
        return null;
    }
    if (tier === 'any') {
        if (!stage.portalChainId) return null;
        tier = 'normal';
    }
    if (!TIERS.has(tier) || !Array.isArray(participants) || participants.length < 1) {
        return null;
    }

    const unique = new Map();
    for (const participant of participants) {
        const profileId = String(participant?.profileId || '').trim();
        const store = participant?.store;
        if (!profileId || !isRecord(store)
            || typeof store.readJsonRecordResult !== 'function'
            || typeof store.saveJsonRecord !== 'function') {
            return null;
        }
        if (!unique.has(profileId)) unique.set(profileId, Object.freeze({ profileId, store }));
    }
    if (unique.size < 1 || unique.size > stage.maxPlayers) return null;

    const frozenParticipants = Object.freeze([...unique.values()]);
    const state = {
        finalResult: null,
        medal: null,
        recipients: frozenParticipants.map(({ profileId, store }) => ({ profileId, store, status: 'pending' })),
        pending: false,
        finished: false,
    };
    const binding = {};
    defineFixed(binding, 'stageId', stage.id);
    defineFixed(binding, 'leaderboardVersion', stage.leaderboardVersion);
    defineFixed(binding, 'runType', stage.runType);
    defineFixed(binding, 'portalChainId', stage.portalChainId || '');
    defineFixed(binding, 'tierId', tier);
    defineFixed(binding, 'runId', id);
    defineFixed(binding, 'participants', frozenParticipants);
    for (const key of ['finalResult', 'medal', 'pending', 'finished']) {
        Object.defineProperty(binding, key, { enumerable: true, get: () => state[key] });
    }
    Object.defineProperty(binding, 'recipients', {
        enumerable: true,
        get: () => Object.freeze(state.recipients.map(({ profileId, status }) => Object.freeze({ profileId, status }))),
    });
    Object.seal(binding);
    bindings.add(binding);
    bindingStates.set(binding, state);
    return binding;
}

export function settleArcadeJourneyRun(binding, { succeeded, value, aborted } = {}) {
    if (!binding || !bindings.has(binding)) return { status: 'invalid', binding: null };
    const state = bindingStates.get(binding);
    if (!state.finalResult) {
        state.finalResult = Object.freeze({
            succeeded: succeeded === true,
            value,
            aborted: aborted === true,
        });
        state.medal = evaluateArcadeJourneyMedal(binding.stageId, state.finalResult);
    }
    if (state.finished) return settlementSnapshot(binding, state);

    if (state.medal < 1) {
        for (const recipient of state.recipients) recipient.status = 'not_awarded';
        state.pending = false;
        state.finished = true;
        return settlementSnapshot(binding, state);
    }

    for (const recipient of state.recipients) {
        if (recipient.status !== 'pending') continue;
        const result = recordArcadeJourneyResult(recipient.store, {
            stageId: binding.stageId,
            leaderboardVersion: binding.leaderboardVersion,
            tierId: binding.tierId,
            medal: state.medal,
            runId: binding.runId,
            value: state.finalResult.value,
            playerCount: binding.participants.length,
        });
        recipient.rank = result.rank;
        recipient.count = result.count;
        if (result.status === 'saved') recipient.status = 'saved';
        else if (result.status === 'unchanged') recipient.status = 'unchanged';
    }
    state.pending = state.recipients.some((recipient) => recipient.status === 'pending');
    state.finished = !state.pending;
    return settlementSnapshot(binding, state);
}

function settlementSnapshot(binding, state) {
    return {
        status: state.pending ? 'pending' : 'finished',
        runId: binding.runId,
        medal: state.medal,
        result: state.finalResult,
        pending: state.pending,
        finished: state.finished,
        recipients: state.recipients.map(({ profileId, status, rank, count }) => ({ profileId, status, rank, count })),
    };
}
