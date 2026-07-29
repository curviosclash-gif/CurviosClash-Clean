import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';

export function dispatchGameStateUpdate(game, dt, hasInteractiveMatchRuntime) {
    if (game?.state === GAME_STATE_IDS.PLAYING && hasInteractiveMatchRuntime && game.entityManager) {
        game._updatePlayingState(dt);
    } else if (game?.state === GAME_STATE_IDS.PAUSED && hasInteractiveMatchRuntime) {
        game._updatePausedState(dt);
    } else if (game?.state === GAME_STATE_IDS.ROUND_END) {
        game._updateRoundEndState(dt);
    } else if (game?.state === GAME_STATE_IDS.MATCH_END) {
        game._updateMatchEndState(dt);
    }
}
