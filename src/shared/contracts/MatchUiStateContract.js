// ============================================
// MatchUiStateContract.js - shared match UI state derivations
// ============================================

import { VIEWPORT_LAYOUTS, normalizeViewportLayout } from './ViewportLayoutContract.js';

export function deriveMatchStartUiState(inputs = {}) {
    const numHumans = Math.max(0, Number(inputs.numHumans) || 0);
    const isTwoPlayer = numHumans === 2;
    const viewportLayout = normalizeViewportLayout(
        inputs.viewportLayout,
        isTwoPlayer ? VIEWPORT_LAYOUTS.TWO_COLUMNS : VIEWPORT_LAYOUTS.SINGLE
    );

    return {
        viewportLayout,
        splitScreenEnabled: viewportLayout !== VIEWPORT_LAYOUTS.SINGLE,
        p2HudVisible: isTwoPlayer,
        visibility: {
            mainMenuHidden: true,
            hudHidden: false,
            messageOverlayHidden: true,
            pauseOverlayHidden: true,
            statusToastHidden: true,
        },
        overlayStats: null,
    };
}

export function deriveMatchLoadingUiState(inputs = {}) {
    return {
        messageText: String(inputs.messageText || 'Lade Arena...'),
        messageSub: String(inputs.messageSub || 'Map-Assets werden vorbereitet'),
        visibility: {
            mainMenuHidden: true,
            hudHidden: true,
            messageOverlayHidden: false,
            pauseOverlayHidden: true,
            statusToastHidden: true,
        },
        overlayStats: null,
    };
}

export function deriveReturnToMenuUiState() {
    return {
        viewportLayout: VIEWPORT_LAYOUTS.SINGLE,
        splitScreenEnabled: false,
        p2HudVisible: false,
        visibility: {
            mainMenuHidden: false,
            hudHidden: true,
            messageOverlayHidden: true,
            pauseOverlayHidden: true,
            statusToastHidden: true,
        },
        overlayStats: null,
    };
}

export function deriveRoundStartUiState() {
    return {
        visibility: {
            hudHidden: false,
            messageOverlayHidden: true,
            pauseOverlayHidden: true,
            statusToastHidden: true,
        },
        overlayStats: null,
    };
}

export function deriveRoundEndOverlayUiState(roundEndOutcome = {}) {
    return {
        messageText: String(roundEndOutcome.messageText || ''),
        messageSub: String(roundEndOutcome.messageSub || ''),
        overlayStats: roundEndOutcome.overlayStats || null,
        visibility: {
            messageOverlayHidden: false,
        },
    };
}

export function deriveRoundEndCountdownUiState(roundPause) {
    const countdown = Math.ceil(Number(roundPause) || 0);
    if (countdown <= 0) {
        return null;
    }
    return {
        messageSub: `Nächste Runde in ${countdown}...`,
    };
}

/**
 * Continue prompt on the result board (P7c): what the player may do right now.
 * `lockRemaining`/`lockTotal` are the input lock of `RoundEndInputLockOps`, so the board can draw
 * how long "continue" is still blocked. `waitingForHost` marks a network replica, which may reach
 * the menu but never starts a round or a match.
 * @typedef {object} ContinuePromptUiState
 * @property {boolean} visible
 * @property {boolean} canContinue
 * @property {number} lockRemaining
 * @property {number} lockTotal
 * @property {string} phase
 * @property {boolean} waitingForHost
 */

export const CONTINUE_PROMPT_PHASES = Object.freeze({
    NONE: '',
    ROUND_END: 'round_end',
    MATCH_END: 'match_end',
});

/** Float noise from summed dt steps must not keep the button disabled for another frame. */
const CONTINUE_PROMPT_LOCK_EPSILON = 1e-6;

/** @type {ContinuePromptUiState} */
const HIDDEN_CONTINUE_PROMPT = {
    visible: false,
    canContinue: false,
    lockRemaining: 0,
    lockTotal: 0,
    phase: CONTINUE_PROMPT_PHASES.NONE,
    waitingForHost: false,
};

/**
 * @param {Partial<ContinuePromptUiState> | null} [source]
 * @returns {ContinuePromptUiState}
 */
export function normalizeContinuePromptState(source) {
    const phase = source?.phase === CONTINUE_PROMPT_PHASES.ROUND_END
        || source?.phase === CONTINUE_PROMPT_PHASES.MATCH_END
        ? source.phase
        : CONTINUE_PROMPT_PHASES.NONE;
    if (phase === CONTINUE_PROMPT_PHASES.NONE || source?.visible !== true) {
        return { ...HIDDEN_CONTINUE_PROMPT };
    }
    const total = Number(source.lockTotal);
    const lockTotal = Number.isFinite(total) && total > 0 ? total : 0;
    const remaining = Number(source.lockRemaining);
    const lockRemaining = Number.isFinite(remaining) ? Math.min(Math.max(remaining, 0), lockTotal) : 0;
    const waitingForHost = source.waitingForHost === true;
    return {
        visible: true,
        canContinue: source.canContinue === true
            && !waitingForHost
            && lockRemaining <= CONTINUE_PROMPT_LOCK_EPSILON,
        lockRemaining,
        lockTotal,
        phase,
        waitingForHost,
    };
}

/**
 * Fill share of the lock bar: 0 when the board just opened, 1 once "continue" is free.
 * @param {{ lockRemaining?: number, lockTotal?: number } | null} [state]
 * @returns {number}
 */
export function resolveContinuePromptProgress(state) {
    const total = Number(state?.lockTotal) || 0;
    if (total <= 0) return 1;
    const remaining = Math.min(Math.max(Number(state?.lockRemaining) || 0, 0), total);
    return 1 - (remaining / total);
}

export function derivePauseUiState() {
    return {
        visibility: {
            pauseOverlayHidden: false,
            messageOverlayHidden: true,
            statusToastHidden: true,
        },
    };
}

export function deriveResumeUiState() {
    return {
        visibility: {
            pauseOverlayHidden: true,
        },
    };
}
