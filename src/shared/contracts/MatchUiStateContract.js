// ============================================
// MatchUiStateContract.js - shared match UI state derivations
// ============================================

export function deriveMatchStartUiState(inputs = {}) {
    const numHumans = Math.max(0, Number(inputs.numHumans) || 0);
    const isTwoPlayer = numHumans === 2;

    return {
        splitScreenEnabled: isTwoPlayer,
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
        messageSub: `Naechste Runde in ${countdown}...`,
    };
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
