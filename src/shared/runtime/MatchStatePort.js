import { GAME_STATE_IDS, normalizeGameStateId } from '../contracts/GameStateIds.js';

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
        audio.setMusicState?.(modePath === 'fight' ? 'fight' : 'race');
    }
}

export function createMatchStatePort(game) {
    return {
        applyLifecycleTransition(transition = null) {
            if (!game || !transition || typeof transition !== 'object') return false;
            if (typeof transition.state === 'string' && transition.state.length > 0) {
                game.state = normalizeGameStateId(transition.state, game.state || GAME_STATE_IDS.MENU);
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
            game.state = GAME_STATE_IDS.ROUND_END;
            game.roundPause = Number.isFinite(Number(roundPause)) ? Number(roundPause) : 3;
            syncAudioLifecycle(game, game.state);
            return true;
        },
        applyRoundEndTransition(transition = null) {
            if (!game || !transition || typeof transition !== 'object') return false;
            game.roundPause = Number.isFinite(Number(transition.roundPause))
                ? Number(transition.roundPause)
                : game.roundPause;
            game.state = normalizeGameStateId(transition.nextState, GAME_STATE_IDS.ROUND_END);
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
