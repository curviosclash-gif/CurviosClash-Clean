import {
    WEAPON_RACE_CHECKPOINT_ORDER,
    WEAPON_RACE_CHECKPOINT_XP,
    WEAPON_RACE_FINISH_GRACE_SECONDS,
    WEAPON_RACE_FINISH_XP,
    resolveWeaponRaceStage,
} from '../../shared/contracts/WeaponRaceContract.js';

const CHECKPOINT_INDEX = new Map(
    WEAPON_RACE_CHECKPOINT_ORDER.map((checkpointId, index) => [checkpointId, index])
);

function normalizePlayerId(value) {
    return String(value ?? '').trim();
}

function finiteTime(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function stableIdCompare(left, right) {
    const a = String(left);
    const b = String(right);
    return a < b ? -1 : (a > b ? 1 : 0);
}

function createRacer(playerId, humanPlayerId) {
    return {
        playerId,
        isHuman: playerId === humanPlayerId,
        checkpointId: WEAPON_RACE_CHECKPOINT_ORDER[0],
        checkpointIndex: 0,
        distanceToNext: Number.POSITIVE_INFINITY,
        awardedCheckpointIds: [],
        checkpointXp: 0,
        finishXp: 0,
        finishedAtMs: null,
        finishTimeMs: null,
    };
}

export function createWeaponRaceState({ startedAtMs = 0, humanPlayerId = '', racerIds = [] } = {}) {
    const normalizedHumanId = normalizePlayerId(humanPlayerId);
    const racers = Object.create(null);
    for (const value of Array.isArray(racerIds) ? racerIds : []) {
        const playerId = normalizePlayerId(value);
        if (!playerId || racers[playerId]) continue;
        racers[playerId] = createRacer(playerId, normalizedHumanId);
    }
    return {
        startedAtMs: finiteTime(startedAtMs),
        humanPlayerId: normalizedHumanId,
        firstFinishAtMs: null,
        graceEndsAtMs: null,
        racers,
    };
}

export function recordWeaponRaceCheckpoint(state, playerId, checkpointId) {
    const racer = state?.racers?.[normalizePlayerId(playerId)];
    const normalizedCheckpointId = String(checkpointId || '').trim().toUpperCase();
    const nextIndex = CHECKPOINT_INDEX.get(normalizedCheckpointId);
    if (!racer || nextIndex === undefined || nextIndex < racer.checkpointIndex || racer.finishedAtMs !== null) {
        return { accepted: false, firstVisit: false, awardedXp: 0, stage: null };
    }

    if (nextIndex > racer.checkpointIndex) {
        racer.checkpointId = normalizedCheckpointId;
        racer.checkpointIndex = nextIndex;
        racer.distanceToNext = Number.POSITIVE_INFINITY;
    }

    const firstVisit = nextIndex > 0 && !racer.awardedCheckpointIds.includes(normalizedCheckpointId);
    const awardedXp = firstVisit && racer.isHuman ? WEAPON_RACE_CHECKPOINT_XP : 0;
    if (firstVisit) racer.awardedCheckpointIds.push(normalizedCheckpointId);
    racer.checkpointXp += awardedXp;
    return {
        accepted: true,
        firstVisit,
        awardedXp,
        stage: resolveWeaponRaceStage(normalizedCheckpointId),
    };
}

export function updateWeaponRaceProgress(state, playerId, distanceToNext) {
    const racer = state?.racers?.[normalizePlayerId(playerId)];
    if (!racer || racer.finishedAtMs !== null) return false;
    const distance = Number(distanceToNext);
    racer.distanceToNext = Number.isFinite(distance) ? Math.max(0, distance) : Number.POSITIVE_INFINITY;
    return true;
}

export function finishWeaponRaceRacer(state, playerId, finishedAtMs) {
    const racer = state?.racers?.[normalizePlayerId(playerId)];
    if (!racer || racer.finishedAtMs !== null) {
        return { accepted: false, awardedXp: 0, graceEndsAtMs: state?.graceEndsAtMs ?? null };
    }

    const finishAt = Math.max(state.startedAtMs, finiteTime(finishedAtMs, state.startedAtMs));
    racer.finishedAtMs = finishAt;
    racer.finishTimeMs = finishAt - state.startedAtMs;
    racer.distanceToNext = 0;
    racer.finishXp = racer.isHuman ? WEAPON_RACE_FINISH_XP : 0;
    if (state.firstFinishAtMs === null) {
        state.firstFinishAtMs = finishAt;
        state.graceEndsAtMs = finishAt + WEAPON_RACE_FINISH_GRACE_SECONDS * 1000;
    }
    return { accepted: true, awardedXp: racer.finishXp, graceEndsAtMs: state.graceEndsAtMs };
}

export function rankWeaponRaceRacers(state) {
    const racers = Object.values(state?.racers || {});
    racers.sort((left, right) => {
        const leftFinished = left.finishedAtMs !== null;
        const rightFinished = right.finishedAtMs !== null;
        if (leftFinished !== rightFinished) return leftFinished ? -1 : 1;
        if (leftFinished) {
            return left.finishTimeMs - right.finishTimeMs || stableIdCompare(left.playerId, right.playerId);
        }
        return right.checkpointIndex - left.checkpointIndex
            || left.distanceToNext - right.distanceToNext
            || stableIdCompare(left.playerId, right.playerId);
    });
    return racers.map((racer, index) => ({
        playerId: racer.playerId,
        place: index + 1,
        result: racer.finishedAtMs === null ? 'DNF' : 'finished',
        finishTimeMs: racer.finishTimeMs,
        checkpointId: racer.checkpointId,
        checkpointIndex: racer.checkpointIndex,
        distanceToNext: racer.distanceToNext,
    }));
}
