import { GAME_STATE_IDS, normalizeGameStateId } from '../contracts/GameStateIds.js';
import {
    canTransitionSessionRuntimeState,
    deriveSessionRuntimeStateFromGameStateId,
    SESSION_RUNTIME_STATES,
} from '../contracts/SessionRuntimeStateMachine.js';

function syncAudioLifecycle(game, state) {
    const audio = game?.audio;
    if (!audio) return;
    if (state === GAME_STATE_IDS.MENU) {
        audio.setPaused?.(false);
        audio.setMusicState?.('menu');
        return;
    }
    if (state === GAME_STATE_IDS.PAUSED) {
        audio.setPaused?.(true);
        return;
    }
    if (state === GAME_STATE_IDS.ROUND_END || state === GAME_STATE_IDS.MATCH_END) {
        audio.setPaused?.(false);
        audio.setMusicState?.('results');
        return;
    }
    if (state === GAME_STATE_IDS.PLAYING) {
        const modePath = String(game?.settings?.localSettings?.modePath || '').trim().toLowerCase();
        audio.setPaused?.(false);
        const musicState = modePath === 'fight' ? 'fight' : (modePath === 'arcade' ? 'arcade' : 'classic');
        audio.setMusicState?.(musicState);
    }
}

function applyGameState(game, state, fallbackState, reason) {
    const nextState = normalizeGameStateId(state, fallbackState);
    if (nextState !== game.state) {
        game.input?.clearInputState?.(reason);
    }
    game.state = nextState;
}

export function createMatchStatePort(game) {
    let pendingMatchRestartAuthorization = null;
    let matchRestartTransitionScopeDepth = 0;

    function inspectTransition(state, allowAuthorizedMatchRestart = true) {
        const currentGameState = normalizeGameStateId(game?.state, GAME_STATE_IDS.MENU);
        const nextGameState = normalizeGameStateId(state, currentGameState);
        const currentRuntimeState = deriveSessionRuntimeStateFromGameStateId(
            currentGameState,
            SESSION_RUNTIME_STATES.MENU
        );
        const nextRuntimeState = deriveSessionRuntimeStateFromGameStateId(
            nextGameState,
            currentRuntimeState
        );
        const authorizedMatchRestart = currentRuntimeState === SESSION_RUNTIME_STATES.MATCH_END
            && nextRuntimeState === SESSION_RUNTIME_STATES.PLAYING
            && allowAuthorizedMatchRestart
            && pendingMatchRestartAuthorization !== null
            && matchRestartTransitionScopeDepth > 0;
        return {
            nextGameState,
            authorizedMatchRestart,
            allowed: authorizedMatchRestart
                || canTransitionSessionRuntimeState(currentRuntimeState, nextRuntimeState),
        };
    }

    function applyStateTransition(state, fallbackState, reason, allowAuthorizedMatchRestart = true) {
        const inspected = inspectTransition(state, allowAuthorizedMatchRestart);
        if (!inspected.allowed) return false;
        applyGameState(game, inspected.nextGameState, fallbackState, reason);
        if (inspected.authorizedMatchRestart) pendingMatchRestartAuthorization = null;
        return true;
    }

    return {
        authorizeMatchRestart() {
            if (game?.state !== GAME_STATE_IDS.MATCH_END
                || pendingMatchRestartAuthorization !== null) {
                return null;
            }
            pendingMatchRestartAuthorization = {};
            return pendingMatchRestartAuthorization;
        },
        cancelMatchRestartAuthorization(authorization) {
            if (!authorization || pendingMatchRestartAuthorization !== authorization) return false;
            pendingMatchRestartAuthorization = null;
            return true;
        },
        withMatchRestartTransition(action) {
            if (typeof action !== 'function') return undefined;
            if (pendingMatchRestartAuthorization === null) return action();
            matchRestartTransitionScopeDepth += 1;
            try {
                return action();
            } finally {
                matchRestartTransitionScopeDepth -= 1;
            }
        },
        applyLifecycleTransition(transition = null, options = undefined) {
            if (!game || !transition || typeof transition !== 'object') return false;
            if (typeof transition.state === 'string' && transition.state.length > 0) {
                if (!applyStateTransition(
                    transition.state,
                    game.state || GAME_STATE_IDS.MENU,
                    'lifecycle-transition',
                    options?.allowAuthorizedMatchRestart !== false
                )) return false;
            }
            if (typeof transition.roundPause === 'number') game.roundPause = transition.roundPause;
            if (typeof transition.hudTimer === 'number') game._hudTimer = transition.hudTimer;
            if (transition.huntStatePatch && game.huntState) {
                Object.assign(game.huntState, { ...transition.huntStatePatch });
            }
            syncAudioLifecycle(game, game.state);
            return true;
        },
        enterRoundEnd(roundPause = 3) {
            if (!game) return false;
            if (!applyStateTransition(GAME_STATE_IDS.ROUND_END, GAME_STATE_IDS.ROUND_END, 'round-end')) {
                return false;
            }
            game.roundPause = Number.isFinite(Number(roundPause)) ? Number(roundPause) : 3;
            syncAudioLifecycle(game, game.state);
            return true;
        },
        applyRoundEndTransition(transition = null) {
            if (!game || !transition || typeof transition !== 'object') return false;
            if (!applyStateTransition(
                transition.nextState,
                GAME_STATE_IDS.ROUND_END,
                'round-transition'
            )) return false;
            game.roundPause = Number.isFinite(Number(transition.roundPause))
                ? Number(transition.roundPause)
                : game.roundPause;
            syncAudioLifecycle(game, game.state);
            return true;
        },
        setRoundPause(value) {
            if (!game || !Number.isFinite(Number(value))) return false;
            game.roundPause = Number(value);
            return true;
        },
    };
}
