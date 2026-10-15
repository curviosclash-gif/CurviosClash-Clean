import { ARCADE_JOURNEY_STORAGE_KEY, ARCADE_JOURNEY_SCHEMA, getArcadeJourneyStage } from './ArcadeJourneyContract.js';

const TIERS = new Set(['normal', 'hard', 'nightmare']);
const STAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function emptyProgress() {
    return { schema: ARCADE_JOURNEY_SCHEMA, stages: {} };
}

export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidProgress(value) {
    return isRecord(value)
        && value.schema === ARCADE_JOURNEY_SCHEMA
        && isRecord(value.stages);
}

export function safeRead(store) {
    if (typeof store?.readJsonRecordResult !== 'function') {
        return { status: 'unavailable', progress: emptyProgress() };
    }
    try {
        const result = store.readJsonRecordResult(ARCADE_JOURNEY_STORAGE_KEY);
        if (result?.status === 'missing') return { status: 'created', progress: emptyProgress() };
        if (result?.status !== 'found' || !isValidProgress(result.value)) {
            return { status: 'unavailable', progress: emptyProgress() };
        }
        return { status: 'ok', progress: result.value };
    } catch {
        return { status: 'unavailable', progress: emptyProgress() };
    }
}

export function loadArcadeJourneyProgress(store) {
    return safeRead(store);
}

export function validateLeaderboardRequest(stageId, tierId, playerCount, value, leaderboardVersion) {
    const id = String(stageId || '').trim();
    const tier = String(tierId || '').trim();
    const stage = getArcadeJourneyStage(id);
    if (!stage || !STAGE_ID_PATTERN.test(id) || !TIERS.has(tier)
        || (leaderboardVersion !== undefined && leaderboardVersion !== stage.leaderboardVersion)
        || !Number.isInteger(playerCount) || playerCount < 1 || playerCount > 3 || playerCount > stage.maxPlayers
        || (value !== undefined && (!Number.isFinite(value) || value < 0 || (stage.metric === 'time' && value <= 0)))) {
        return null;
    }
    return { stage, stageId: id, tierId: tier, playerCount };
}

export function leaderboardKey(stageId, tierId, playerCount, version = getArcadeJourneyStage(stageId)?.leaderboardVersion || 1) {
    const base = `${stageId}:${tierId}:${playerCount}`;
    return version === 1 ? base : `${base}:v${version}`;
}

export function compareRows(metric, left, right) {
    if (left.value !== right.value) {
        if (metric === 'time' || metric === 'place') return left.value - right.value;
        return right.value - left.value;
    }
    return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
}

export function validBoardRows(value, playerCount, metric = 'score') {
    return Array.isArray(value) && value.length <= 10 && value.every((row) => isRecord(row)
        && typeof row.runId === 'string' && row.runId.trim() !== ''
        && Number.isFinite(row.value) && row.value >= 0 && (metric !== 'time' || row.value > 0)
        && Number.isInteger(row.medal) && row.medal >= 0 && row.medal <= 3
        && row.playerCount === playerCount);
}

export function getArcadeJourneyLeaderboard(progress, stageId, tierId, playerCount) {
    const request = validateLeaderboardRequest(stageId, tierId, playerCount);
    if (!request || !isValidProgress(progress) || (progress.boards !== undefined && !isRecord(progress.boards))) return [];
    const rows = progress.boards?.[leaderboardKey(request.stageId, request.tierId, request.playerCount)];
    if (rows === undefined) return [];
    if (!validBoardRows(rows, request.playerCount, request.stage.metric)) return [];
    return [...rows].sort((left, right) => compareRows(request.stage.metric, left, right)).slice(0, 10);
}

/** Known previous score rules remain readable without becoming today's competing scores. */
export function getArcadeJourneyLegacyLeaderboard(progress, stageId, tierId, playerCount) {
    const request = validateLeaderboardRequest(stageId, tierId, playerCount);
    if (!request?.stage.legacyLeaderboardMetric || request.stage.leaderboardVersion !== 2
        || !isValidProgress(progress) || !isRecord(progress.boards)) return [];
    const rows = progress.boards[leaderboardKey(request.stageId, request.tierId, request.playerCount, 1)];
    if (!validBoardRows(rows, request.playerCount, request.stage.legacyLeaderboardMetric)) return [];
    return [...rows].sort((left, right) => compareRows(request.stage.legacyLeaderboardMetric, left, right)).slice(0, 10);
}
