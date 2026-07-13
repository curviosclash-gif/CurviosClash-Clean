import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import {
    deriveMatchStartUiState,
    derivePauseUiState,
    deriveResumeUiState,
    deriveReturnToMenuUiState,
    deriveRoundStartUiState,
} from '../shared/contracts/MatchUiStateContract.js';

function createHuntStateReset() {
    return {
        killFeed: [],
        damageIndicator: null,
        damageIndicatorsByPlayer: {},
        overheatByPlayer: {},
    };
}

export function deriveMatchStartTransition({ numHumans } = {}) {
    return {
        state: null,
        roundPause: null,
        hudTimer: null,
        uiState: deriveMatchStartUiState({ numHumans }),
        huntStatePatch: null,
    };
}

export function deriveRoundStartTransition() {
    return {
        state: GAME_STATE_IDS.PLAYING,
        roundPause: 0,
        hudTimer: 0,
        uiState: deriveRoundStartUiState(),
        huntStatePatch: createHuntStateReset(),
    };
}

export function deriveReturnToMenuTransition() {
    return {
        state: GAME_STATE_IDS.MENU,
        roundPause: null,
        hudTimer: null,
        uiState: deriveReturnToMenuUiState(),
        huntStatePatch: createHuntStateReset(),
    };
}

export function derivePauseTransition() {
    return {
        state: GAME_STATE_IDS.PAUSED,
        roundPause: null,
        hudTimer: null,
        uiState: derivePauseUiState(),
        huntStatePatch: null,
    };
}

export function deriveResumeTransition() {
    return {
        state: GAME_STATE_IDS.PLAYING,
        roundPause: null,
        hudTimer: null,
        uiState: deriveResumeUiState(),
        huntStatePatch: null,
    };
}
