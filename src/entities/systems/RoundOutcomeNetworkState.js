import { normalizeTeamId } from '../../shared/contracts/TeamCombatContract.js';

/**
 * The host's round result on the wire, for every mode (Classic, Parcours, HUNT).
 *
 * A network client never decides a round itself (RoundOutcomeSystem.resolve), so the
 * host result is the only way its round ends. `round` is the host's round serial
 * (raised by EntitySpawnOps.spawnAll) and guards against applying one result twice:
 * the host keeps its outcome until its own restart, while the client may already have
 * counted down and started the next round.
 */
export function createRoundOutcomeNetworkState(entityManager) {
    const outcome = entityManager?._lastRoundOutcome;
    if (!outcome?.shouldEnd) return null;
    return {
        round: Math.max(0, Math.trunc(Number(entityManager._networkRoundSerial) || 0)),
        winnerIndex: Number.isInteger(outcome.winner?.index) ? outcome.winner.index : -1,
        winnerTeamId: normalizeTeamId(outcome.winnerTeamId || outcome.winner?.teamId),
        reason: String(outcome.reason || ''),
        parcours: cloneWireObject(outcome.parcours),
    };
}

/**
 * Ends the client round through the same event bus path as the host tick pipeline
 * (EntityEventBus -> onRoundEnd -> ROUND_END with result board), once per host round.
 * A snapshot without the field (running round or an older host) changes nothing.
 */
export function applyRoundOutcomeNetworkState(entityManager, state) {
    if (!entityManager || !state || typeof state !== 'object') return false;
    const round = Number(state.round);
    if (!Number.isInteger(round) || round < 0) return false;
    if (entityManager._appliedHostRoundOutcome === round) return false;
    entityManager._appliedHostRoundOutcome = round;
    entityManager._roundEnded = true;
    const winner = entityManager.players?.find((player) => player?.index === state.winnerIndex) || null;
    entityManager._eventBus?.emitRoundEnd?.(winner, {
        shouldEnd: true,
        winner,
        winnerTeamId: normalizeTeamId(state.winnerTeamId),
        reason: String(state.reason || 'ELIMINATION'),
        parcours: state.parcours && typeof state.parcours === 'object' ? state.parcours : null,
    });
    return true;
}

function cloneWireObject(value) {
    if (!value || typeof value !== 'object') return null;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}
