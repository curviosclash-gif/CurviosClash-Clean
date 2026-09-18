// ============================================
// NetworkPlayerDepartureOps.js - host takes guests out of a running match
// ============================================
//
// The session adapters already turn a guest's LEAVE message into
// 'playerDisconnected' (reason 'graceful-leave') and an expired reconnect
// window into 'playerRemoved'. Without a listener the guest's ship kept flying
// on its last input and respawned in fight mode. The host now deactivates the
// slot, which round outcome, scoring and the next spawn already skip.

import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';

const MATCH_ACTIVE_GAME_STATES = new Set([
    GAME_STATE_IDS.PLAYING,
    GAME_STATE_IDS.PAUSED,
    GAME_STATE_IDS.ROUND_END,
]);

function normalizePeerId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function resolveDepartureLabel(player, slot) {
    const slotName = typeof slot?.name === 'string' ? slot.name.trim() : '';
    if (slotName && slotName !== slot.peerId) return slotName;
    const playerName = typeof player?.name === 'string' ? player.name.trim() : '';
    return playerName || `P${player.index + 1}`;
}

/**
 * Deactivates the match slot of a guest who left. Returns true when a player was taken out.
 * @param {object} facade
 * @param {string} peerId
 */
export function removeDepartedNetworkPlayer(facade, peerId) {
    const game = facade?.game;
    if (!MATCH_ACTIVE_GAME_STATES.has(game?.state)) return false;
    const normalizedPeerId = normalizePeerId(peerId);
    const slots = game?.runtimeConfig?.session?.networkPlayerSlots;
    const slot = Array.isArray(slots)
        ? slots.find((entry) => normalizePeerId(entry?.peerId) === normalizedPeerId)
        : null;
    if (!slot || slot.isHost === true || !Number.isInteger(slot.playerIndex)) return false;
    const entityManager = game?.entityManager;
    const player = entityManager?.players?.find((candidate) => (
        candidate?.index === slot.playerIndex && candidate.isBot !== true
    ));
    if (!player || player.entitySlotActive === false) return false;

    player.entitySlotActive = false;
    if (player.alive) player.kill?.();
    player.view?.setVisible?.(false);
    player.trail?.clear?.();
    const message = `${resolveDepartureLabel(player, slot)} hat das Match verlassen`;
    entityManager.onHuntFeedEvent?.(message);
    game._showStatusToast?.(message, 2200, 'warning');
    return true;
}

/**
 * Host only: listens for guests that left for good.
 * @param {object} facade
 * @returns {{ onPlayerDisconnected: Function, onPlayerRemoved: Function } | null}
 */
export function attachNetworkPlayerDepartureHandler(facade) {
    const session = facade?.session;
    if (!session?.isHost || typeof session.on !== 'function') return null;
    const onPlayerDisconnected = ({ peerId, reason } = {}) => {
        // Only an explicit leave is final; a dropped channel may still reconnect.
        if (reason !== 'graceful-leave') return;
        removeDepartedNetworkPlayer(facade, peerId);
    };
    const onPlayerRemoved = ({ peerId } = {}) => {
        removeDepartedNetworkPlayer(facade, peerId);
    };
    session.on('playerDisconnected', onPlayerDisconnected);
    session.on('playerRemoved', onPlayerRemoved);
    return { onPlayerDisconnected, onPlayerRemoved };
}

export function detachNetworkPlayerDepartureHandler(session, handlers) {
    if (!session || !handlers || typeof session.off !== 'function') return;
    session.off('playerDisconnected', handlers.onPlayerDisconnected);
    session.off('playerRemoved', handlers.onPlayerRemoved);
}
