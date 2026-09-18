import { normalizeHuntWinCondition } from '../shared/contracts/HuntWinConditionContract.js';

function normalizeOutcome(outcome) {
    if (!outcome?.shouldEnd) return null;
    return {
        reason: String(outcome.reason || ''),
        winnerIndex: Number.isInteger(outcome?.winner?.index) ? outcome.winner.index : -1,
    };
}

export function createHuntNetworkState(entityManager) {
    if (!entityManager?.huntEnabled) return null;
    const matchState = entityManager._roundOutcomeSystem?.getDeathmatchState?.() || {};
    const winCondition = normalizeHuntWinCondition(entityManager.entityRuntimeConfig?.HUNT?.WIN_CONDITION);
    return {
        scoreboardRows: entityManager.getHuntScoreboard?.()
            || entityManager._huntScoring?.getScoreboard?.(entityManager.players, { winCondition }) || [],
        killLimit: Math.max(1, Number(entityManager.entityRuntimeConfig?.HUNT?.DEATHMATCH_KILL_LIMIT) || 10),
        winCondition,
        livesRemainingByPlayer: entityManager._respawnSystem?.getLivesRemainingByPlayer?.(entityManager.players) || {},
        ...matchState,
        // Null on every map without destructible geometry, so the block costs nothing there.
        mapDestructibles: entityManager._mapDestructibleSystem?.serializeNetworkState?.() || null,
        // Tanks: host truth for position, hit points and shots; null on maps without them.
        mapUnits: entityManager._mapUnitSystem?.serializeNetworkState?.() || null,
        lightning: entityManager._lightningStrikeSystem?.serializeNetworkState?.() || null,
        railgunBeams: entityManager._railgunSystem?.serializeNetworkState?.() || null,
        outcome: normalizeOutcome(entityManager._lastRoundOutcome),
    };
}

export function applyHuntNetworkState(entityManager, state) {
    if (!entityManager || !state || typeof state !== 'object') return;
    const rows = Array.isArray(state.scoreboardRows) ? state.scoreboardRows : [];
    entityManager._huntScoring?.applyScoreboard?.(rows);
    entityManager._authoritativeHuntState = state;
    if (state.mapDestructibles) {
        entityManager._mapDestructibleSystem?.applyNetworkState?.(state.mapDestructibles);
    }
    if (state.mapUnits) entityManager._mapUnitSystem?.applyNetworkState?.(state.mapUnits);
    // Always applied, also when null: a finished warning has to leave the client sky.
    entityManager._lightningStrikeSystem?.applyNetworkState?.(state.lightning || { pending: [], strikes: [] });
    entityManager._railgunSystem?.applyNetworkState?.(state.railgunBeams || []);

    const outcome = state.outcome;
    if (!outcome) return;
    const key = `${outcome.reason}:${outcome.winnerIndex}`;
    if (entityManager._lastAppliedAuthoritativeOutcomeKey === key) return;
    entityManager._lastAppliedAuthoritativeOutcomeKey = key;
    entityManager._roundEnded = true;
    const winner = entityManager.players?.find((player) => player?.index === outcome.winnerIndex) || null;
    entityManager._eventBus?.emitRoundEnd?.(winner, {
        shouldEnd: true,
        winner,
        reason: String(outcome.reason || 'KILL_LIMIT'),
        parcours: null,
    });
}
