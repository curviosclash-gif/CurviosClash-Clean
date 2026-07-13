import {
    RUNTIME_SESSION_TYPES,
    resolveRuntimeSessionContract,
} from '../../shared/contracts/RuntimeSessionContract.js';

function buildTelemetryPayload(game) {
    return {
        sessionType: RUNTIME_SESSION_TYPES.MULTIPLAYER,
        multiplayerTransport: resolveRuntimeSessionContract(game?.settings?.localSettings).multiplayerTransport,
        modePath: game?.settings?.localSettings?.modePath || 'normal',
    };
}

function reportStartFailure({
    game,
    recordMenuTelemetry,
    telemetryPayload,
    code = 'unknown',
    message = 'Lobby-Start konnte nicht ausgeliefert werden.',
} = {}) {
    recordMenuTelemetry?.('abort', {
        ...telemetryPayload,
        reason: 'multiplayer_start_failed',
        code,
    });
    game?._showStatusToast?.(message, 1700, 'error');
}

export function syncRuntimeMultiplayerContext({
    game,
    changedKeys,
    menuMultiplayerBridge,
    resolveMenuAccessContext,
    didHostChangeMatchSettings,
    captureSettingsSnapshot,
    syncUiState,
}) {
    const sessionContract = resolveRuntimeSessionContract(game?.settings?.localSettings);
    if (sessionContract.sessionType !== RUNTIME_SESSION_TYPES.MULTIPLAYER) return false;

    const accessContext = resolveMenuAccessContext?.();
    menuMultiplayerBridge?.syncActorIdentity?.(accessContext?.actorId);
    if (Array.isArray(changedKeys) && changedKeys.length > 0 && didHostChangeMatchSettings?.(changedKeys)) {
        menuMultiplayerBridge?.publishHostSettings?.(captureSettingsSnapshot?.());
    }
    syncUiState?.();
    return true;
}

export function requestRuntimeMultiplayerMatchStart({
    game,
    menuMultiplayerBridge,
    captureSettingsSnapshot,
    recordMenuTelemetry,
}) {
    const sessionContract = resolveRuntimeSessionContract(game?.settings?.localSettings);
    if (sessionContract.sessionType !== RUNTIME_SESSION_TYPES.MULTIPLAYER) {
        return null;
    }

    const telemetryPayload = buildTelemetryPayload(game);
    const startResult = menuMultiplayerBridge?.requestMatchStart?.({
        settingsSnapshot: captureSettingsSnapshot?.(),
    });

    if (startResult && typeof startResult.then === 'function') {
        Promise.resolve(startResult)
            .then((resolvedResult) => {
                if (resolvedResult?.ok) return;
                reportStartFailure({
                    game,
                    recordMenuTelemetry,
                    telemetryPayload,
                    code: resolvedResult?.code || 'unknown',
                    message: resolvedResult?.message || 'Lobby-Start konnte nicht ausgeliefert werden.',
                });
            })
            .catch((error) => {
                reportStartFailure({
                    game,
                    recordMenuTelemetry,
                    telemetryPayload,
                    code: 'async_error',
                    message: error instanceof Error
                        ? error.message
                        : 'Lobby-Start konnte nicht ausgeliefert werden.',
                });
            });
        return true;
    }

    if (!startResult?.ok) {
        reportStartFailure({
            game,
            recordMenuTelemetry,
            telemetryPayload,
            code: startResult?.code || 'unknown',
            message: startResult?.message || 'Lobby-Start konnte nicht ausgeliefert werden.',
        });
        return false;
    }

    return true;
}
