// ============================================
// RoundStateControllerOps.js - pure controller tick/transition helpers
// ============================================

import {
    GAME_STATE_IDS,
    normalizeGameStateId,
} from '../shared/contracts/GameStateIds.js';

function normalizeDt(value) {
    return Math.max(0, Number(value) || 0);
}

function normalizePause(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBool(value) {
    return !!value;
}

export function deriveRoundEndControllerTransition(roundEndOutcome, options = {}) {
    const defaultRoundPause = normalizePause(options.defaultRoundPause, 3);
    return {
        roundPause: defaultRoundPause,
        nextState: normalizeGameStateId(roundEndOutcome?.state, GAME_STATE_IDS.ROUND_END),
        overlayMessageText: String(roundEndOutcome?.messageText || ''),
        overlayMessageSub: String(roundEndOutcome?.messageSub || ''),
    };
}

export function deriveRoundEndTickStep(inputs = {}) {
    const escapePressed = normalizeBool(inputs.escapePressed);
    const enterPressed = normalizeBool(inputs.enterPressed);
    const dt = normalizeDt(inputs.dt);

    if (escapePressed) {
        return {
            action: 'RETURN_TO_MENU',
            nextRoundPause: normalizePause(inputs.roundPause, 0),
            shouldUpdateCameras: false,
            countdownMessageSub: null,
        };
    }

    let nextRoundPause = normalizePause(inputs.roundPause, 0);
    if (enterPressed) {
        nextRoundPause = 0;
    }
    nextRoundPause -= dt;

    const countdown = Math.ceil(nextRoundPause);
    return {
        action: nextRoundPause <= 0 ? 'START_ROUND' : 'WAIT',
        nextRoundPause,
        shouldUpdateCameras: true,
        countdownMessageSub: countdown > 0 ? `Naechste Runde in ${countdown}...` : null,
    };
}

export function deriveMatchEndTickStep(inputs = {}) {
    const escapePressed = normalizeBool(inputs.escapePressed);
    const enterPressed = normalizeBool(inputs.enterPressed);

    if (escapePressed) {
        return {
            action: 'RETURN_TO_MENU',
            shouldUpdateCameras: false,
        };
    }
    if (enterPressed) {
        return {
            action: 'RESTART_MATCH',
            shouldUpdateCameras: true,
        };
    }
    return {
        action: 'WAIT',
        shouldUpdateCameras: true,
    };
}
