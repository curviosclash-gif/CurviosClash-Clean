// @ts-nocheck
// ============================================
// MultiplayerMatchLifecycleKernel.js
// Common lifecycle kernel for LAN and Online sessions (client-side).
//
// Responsibilities:
//   - Translate network-level disconnect events into facade lifecycle commands.
//   - React to host-issued MATCH_LIFECYCLE_SIGNAL messages by triggering
//     the client's own returnToMenu() via the canonical command path.
//
// The kernel is attached only for client-side network sessions
// (not host, not offline).  All routing goes through facade.returnToMenu()
// so it always traverses the same finalizing -> match_finalized -> menu_opened
// path that offline sessions use.
// ============================================

import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';
import { MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES } from '../../shared/contracts/MultiplayerSessionContract.js';
import { createLogger } from '../../shared/logging/Logger.js';

const logger = createLogger('MultiplayerMatchLifecycleKernel');

/** Game states that indicate an active match (not yet in menu). */
const MATCH_ACTIVE_GAME_STATES = new Set([
    GAME_STATE_IDS.PLAYING,
    GAME_STATE_IDS.PAUSED,
    GAME_STATE_IDS.ROUND_END,
    GAME_STATE_IDS.MATCH_END,
]);

/**
 * Returns true if the facade is in an active match and not already finalizing.
 * Used to guard against spurious returnToMenu() calls when already in menu.
 *
 * @param {object} facade
 * @returns {boolean}
 */
function isInActiveMatch(facade) {
    if (facade?._pendingMatchFinalize) return false;
    const gameState = facade?.game?.state;
    return typeof gameState === 'string' && MATCH_ACTIVE_GAME_STATES.has(gameState);
}

/**
 * Calls facade.returnToMenu() with the given reason if we are still in an
 * active match.  Errors are swallowed — the lifecycle machinery handles them.
 *
 * @param {object} facade
 * @param {string} reason
 */
function triggerReturnToMenu(facade, reason) {
    if (!isInActiveMatch(facade)) return;
    if (facade?._pendingLifecycleReturnToMenu === true) return;
    facade._pendingLifecycleReturnToMenu = true;
    try {
        Promise.resolve(facade.returnToMenu({ reason })).catch((error) => {
            logger.warn('returnToMenu failed after multiplayer lifecycle signal', {
                reason,
                error: error instanceof Error ? error.message : String(error),
            });
        }).finally(() => {
            facade._pendingLifecycleReturnToMenu = false;
        });
    } catch (error) {
        facade._pendingLifecycleReturnToMenu = false;
        logger.warn('returnToMenu threw synchronously after multiplayer lifecycle signal', {
            reason,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Attaches lifecycle event handlers to a client-side network session adapter.
 * Routes host-disconnect and host-finalized signals to the facade's returnToMenu
 * command so that both LAN and Online sessions share the same lifecycle path.
 *
 * @param {object} facade - GameRuntimeFacade instance
 * @param {import('../../core/session/SessionAdapter.js').SessionAdapter} session
 * @returns {{ onHostDisconnected: Function, onMatchLifecycleSignal: Function } | null}
 */
export function attachMultiplayerLifecycleKernel(facade, session) {
    if (!session || !facade) return null;

    // Fired when the host peer disconnects (graceful HOST_LEAVING or ungraceful
    // heartbeat-timeout / channel-close).  Clients react by returning to menu.
    const onHostDisconnected = () => {
        triggerReturnToMenu(facade, 'host_disconnected');
    };

    // Fired when the host broadcasts a MATCH_LIFECYCLE_SIGNAL before teardown.
    // Clients react to the 'match_finalized' signal by initiating their own
    // return-to-menu finalize flow.
    const onMatchLifecycleSignal = ({ signal } = {}) => {
        const normalizedSignal = typeof signal === 'string' ? signal.trim() : '';
        if (normalizedSignal !== MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES.MATCH_FINALIZED) return;
        triggerReturnToMenu(facade, 'host_match_finalized');
    };

    session.on('hostDisconnected', onHostDisconnected);
    session.on('matchLifecycleSignal', onMatchLifecycleSignal);

    return { onHostDisconnected, onMatchLifecycleSignal };
}

/**
 * Removes lifecycle kernel handlers from the session adapter.
 * Called by teardownRuntimeSession before session.dispose() so handlers
 * cannot fire after teardown has already started.
 *
 * @param {import('../../core/session/SessionAdapter.js').SessionAdapter} session
 * @param {{ onHostDisconnected: Function, onMatchLifecycleSignal: Function } | null} handlers
 */
export function detachMultiplayerLifecycleKernel(session, handlers) {
    if (!session || !handlers) return;
    if (typeof handlers.onHostDisconnected === 'function') {
        session.off('hostDisconnected', handlers.onHostDisconnected);
    }
    if (typeof handlers.onMatchLifecycleSignal === 'function') {
        session.off('matchLifecycleSignal', handlers.onMatchLifecycleSignal);
    }
}
