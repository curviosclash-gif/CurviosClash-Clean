// ============================================
// RoundStateControllerOps.js - pure controller tick/transition helpers
// ============================================

import {
    GAME_STATE_IDS,
    normalizeGameStateId,
} from '../shared/contracts/GameStateIds.js';
import { isRoundEndInputLocked } from './RoundEndInputLockOps.js';

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

/**
 * True when a "continue" press (any key, click or pad button; Enter included) may act.
 * The menu path is never locked - it is handled before this helper is asked.
 */
function readContinueRequest(inputs) {
    if (isRoundEndInputLocked(inputs.inputLockRemaining)) return false;
    return normalizeBool(inputs.enterPressed) || normalizeBool(inputs.continuePressed);
}

export function deriveRoundEndTickStep(inputs = {}) {
    const escapePressed = normalizeBool(inputs.escapePressed);
    const dt = normalizeDt(inputs.dt);
    const continueRequested = readContinueRequest(inputs);
    const nextInputLockRemaining = Math.max(0, normalizeDt(inputs.inputLockRemaining) - dt);

    if (escapePressed) {
        return {
            action: 'RETURN_TO_MENU',
            nextRoundPause: normalizePause(inputs.roundPause, 0),
            shouldUpdateCameras: false,
            countdownMessageSub: null,
            nextInputLockRemaining: 0,
        };
    }

    let nextRoundPause = normalizePause(inputs.roundPause, 0);
    if (continueRequested) {
        nextRoundPause = 0;
    }
    nextRoundPause -= dt;

    const countdown = Math.ceil(nextRoundPause);
    return {
        action: nextRoundPause <= 0 ? 'START_ROUND' : 'WAIT',
        nextRoundPause,
        shouldUpdateCameras: true,
        countdownMessageSub: countdown > 0 ? `Nächste Runde in ${countdown}...` : null,
        nextInputLockRemaining,
    };
}

export function deriveMatchEndTickStep(inputs = {}) {
    const escapePressed = normalizeBool(inputs.escapePressed);
    const continueRequested = readContinueRequest(inputs);
    const nextInputLockRemaining = Math.max(
        0,
        normalizeDt(inputs.inputLockRemaining) - normalizeDt(inputs.dt)
    );

    if (escapePressed) {
        return {
            action: 'RETURN_TO_MENU',
            shouldUpdateCameras: false,
            nextInputLockRemaining: 0,
        };
    }
    if (continueRequested) {
        return {
            action: 'RESTART_MATCH',
            shouldUpdateCameras: true,
            nextInputLockRemaining,
        };
    }
    return {
        action: 'WAIT',
        shouldUpdateCameras: true,
        nextInputLockRemaining,
    };
}
