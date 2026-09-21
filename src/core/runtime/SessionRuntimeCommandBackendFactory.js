import { finalizeMatchFlow } from './MatchFinalizeFlowService.js';
import {
    handleMultiplayerHostAction,
    handleMultiplayerJoinAction,
} from './MenuRuntimeMultiplayerService.js';
import { applyCommandRuntimeSettings } from './RuntimeCommandSettingsService.js';

function createMultiplayerCommandContext(facade, options = undefined) {
    return {
        game: facade?.game,
        event: {
            lobbyCode: options?.lobbyCode,
            signalingUrl: options?.signalingUrl,
            localPlayerCount: options?.localPlayerCount,
        },
        resolveMenuAccessContext: () => facade?._resolveMenuAccessContext?.(),
        menuMultiplayerBridge: facade?.menuMultiplayerBridge,
        syncUiState: () => facade?._syncMultiplayerUiState?.(),
        captureSettingsSnapshot: () => facade?._captureMultiplayerMatchSettings?.(),
        runtimeSource: facade?.getRuntimeBundle?.() || facade?.game,
    };
}

export function createSessionRuntimeCommandBackends({ facade = null } = {}) {
    return {
        applySettings(options = undefined) {
            return applyCommandRuntimeSettings(facade, options);
        },
        startMatch(options = undefined) {
            if (!facade?.game) {
                return false;
            }
            return facade?.sessionHandler?.startMatch?.(options);
        },
        returnToMenu(options = undefined) {
            return facade?.sessionHandler?.returnToMenu?.(options);
        },
        finalizeMatch(options = undefined, fallbackReason = undefined) {
            return finalizeMatchFlow(facade, options, fallbackReason);
        },
        hostLobby(options = undefined) {
            return handleMultiplayerHostAction(createMultiplayerCommandContext(facade, options));
        },
        joinLobby(options = undefined) {
            return handleMultiplayerJoinAction(createMultiplayerCommandContext(facade, options));
        },
    };
}
