import { SESSION_FINALIZE_TRIGGERS } from '../../shared/contracts/MatchLifecycleContract.js';
import { SESSION_RUNTIME_COMMAND_TYPES } from '../../shared/contracts/SessionRuntimeCommandContract.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../../shared/contracts/SessionRuntimeEventContract.js';
import { recordSessionRuntimeEvent } from '../../shared/runtime/SessionRuntimeObservability.js';
import { normalizeString } from '../../shared/contracts/ContractNormalizeUtils.js';

const INVALID_COMMAND_ERROR_MESSAGE = 'invalid session runtime command';

function createObservedCommandInput(command = null, fallbackType = 'invalid_command') {
    const payload = command?.payload && typeof command.payload === 'object' && !Array.isArray(command.payload)
        ? { ...command.payload }
        : {};
    return {
        type: normalizeString(command?.type, fallbackType),
        payload,
    };
}

function summarizeCommandPayload(command = null) {
    const payload = command?.payload && typeof command.payload === 'object'
        ? command.payload
        : {};
    return {
        commandType: normalizeString(command?.type, ''),
        commandSource: normalizeString(payload.source, 'runtime_api'),
        reason: normalizeString(payload.reason, ''),
        trigger: normalizeString(payload.trigger, ''),
        lobbyCode: normalizeString(payload.lobbyCode, ''),
        preserveLobby: payload.preserveLobby === true,
        hasSettingsSnapshot: !!payload.settingsSnapshot,
        notifyMenuOpened: payload.notifyMenuOpened !== false,
    };
}

function summarizeCommandResult(result) {
    if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
        return result.ok ? 'ok' : 'error';
    }
    if (result === true) return 'true';
    if (result === false) return 'false';
    if (result == null) return 'empty';
    return typeof result;
}

function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}

function createSettledCommandResult(command, { ok = false, value = undefined, error = null, resultStatus = '' } = {}) {
    return {
        ok: ok === true,
        ...summarizeCommandPayload(command),
        resultStatus: normalizeString(
            resultStatus,
            ok ? summarizeCommandResult(value) : 'error'
        ),
        value,
        errorMessage: error instanceof Error
            ? error.message
            : normalizeString(error, ok ? '' : 'command execution failed'),
    };
}

function recordCommandObservation(facade, command, phase, extra = null) {
    recordSessionRuntimeEvent(facade?.getRuntimeBundle?.() || facade?.game, {
        type: SESSION_RUNTIME_EVENT_TYPES.COMMAND_OBSERVED,
        source: 'session_runtime_command_use_case',
        payload: {
            phase: normalizeString(phase, 'received'),
            ...summarizeCommandPayload(command),
            ...(extra && typeof extra === 'object' ? extra : {}),
        },
    });
}

function recordCommandFailure(facade, command, resultStatus, error, fallbackMessage) {
    recordCommandObservation(facade, command, 'failed', {
        resultStatus: normalizeString(resultStatus, 'error'),
        errorMessage: error instanceof Error ? error.message : normalizeString(fallbackMessage, 'command execution failed'),
    });
}

function finalizeObservedCommandResult(facade, command, result, settle = false) {
    if (isPromiseLike(result)) {
        const trackedPromise = Promise.resolve(result)
            .then((resolvedResult) => {
                const resultStatus = summarizeCommandResult(resolvedResult);
                recordCommandObservation(facade, command, 'completed', {
                    resultStatus,
                });
                if (!settle) {
                    return resolvedResult;
                }
                return createSettledCommandResult(command, {
                    ok: true,
                    value: resolvedResult,
                    resultStatus,
                });
            })
            .catch((error) => {
                recordCommandFailure(facade, command, 'rejected', error, 'command promise rejected');
                if (!settle) {
                    throw error;
                }
                return createSettledCommandResult(command, {
                    ok: false,
                    error,
                    resultStatus: 'rejected',
                });
            });
        if (!settle) {
            trackedPromise.catch(() => {});
        }
        return trackedPromise;
    }

    const resultStatus = summarizeCommandResult(result);
    recordCommandObservation(facade, command, 'completed', {
        resultStatus,
    });
    if (!settle) {
        return result;
    }
    return Promise.resolve(createSettledCommandResult(command, {
        ok: true,
        value: result,
        resultStatus,
    }));
}

function createObservedRuntimeCommandUseCase(facade, execute) {
    const runCommand = (command = null, settle = false) => {
        recordCommandObservation(facade, command, 'received');
        let result;
        try {
            result = execute(command?.payload);
        } catch (error) {
            recordCommandFailure(facade, command, 'threw', error, 'command execution failed');
            if (!settle) {
                throw error;
            }
            return Promise.resolve(createSettledCommandResult(command, {
                ok: false,
                error,
                resultStatus: 'threw',
            }));
        }
        return finalizeObservedCommandResult(facade, command, result, settle);
    };

    return {
        execute(command = null) {
            return runCommand(command, false);
        },
        executeResult(command = null) {
            return runCommand(command, true);
        },
    };
}

function createInvalidCommandUseCase(facade) {
    return {
        execute(command = null) {
            const invalidCommand = createObservedCommandInput(command);
            recordCommandObservation(facade, invalidCommand, 'received');
            recordCommandFailure(
                facade,
                invalidCommand,
                'invalid_command',
                INVALID_COMMAND_ERROR_MESSAGE,
                INVALID_COMMAND_ERROR_MESSAGE
            );
            return undefined;
        },
        executeResult(command = null) {
            const invalidCommand = createObservedCommandInput(command);
            recordCommandObservation(facade, invalidCommand, 'received');
            recordCommandFailure(
                facade,
                invalidCommand,
                'invalid_command',
                INVALID_COMMAND_ERROR_MESSAGE,
                INVALID_COMMAND_ERROR_MESSAGE
            );
            return Promise.resolve(createSettledCommandResult(invalidCommand, {
                ok: false,
                error: INVALID_COMMAND_ERROR_MESSAGE,
                resultStatus: 'invalid_command',
            }));
        },
    };
}

function createRuntimeCommandUseCase(execute) {
    return execute;
}

function createApplySettingsCommandUseCase(facade, backends) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => backends?.applySettings?.(options)
    ));
}

function createInitializeSessionCommandUseCase(facade) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => facade?.sessionHandler?.initializeSession?.(options)
    ));
}

function createStartMatchCommandUseCase(facade, backends) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => backends?.startMatch?.(options)
    ));
}

function createPauseMatchCommandUseCase(facade) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => facade?.sessionHandler?.pauseMatch?.(options)
    ));
}

function createResumeMatchCommandUseCase(facade) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => facade?.sessionHandler?.resumeMatch?.(options)
    ));
}

function createReturnToMenuCommandUseCase(facade, backends) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => backends?.returnToMenu?.(options)
    ));
}

function createFinalizeMatchCommandUseCase(facade, backends) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(facade, (options) => {
        const reason = typeof options?.reason === 'string' && options.reason.trim()
            ? options.reason.trim()
            : SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU;
        return backends?.finalizeMatch?.(options, reason);
    }));
}

function createHostLobbyCommandUseCase(facade, backends) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => backends?.hostLobby?.(options)
    ));
}

function createJoinLobbyCommandUseCase(facade, backends) {
    return createRuntimeCommandUseCase(createObservedRuntimeCommandUseCase(
        facade,
        (options) => backends?.joinLobby?.(options)
    ));
}

export function createSessionRuntimeCommandUseCases({ facade = null, backends = null } = {}) {
    const byType = {
        [SESSION_RUNTIME_COMMAND_TYPES.APPLY_SETTINGS]: createApplySettingsCommandUseCase(facade, backends),
        [SESSION_RUNTIME_COMMAND_TYPES.INITIALIZE_SESSION]: createInitializeSessionCommandUseCase(facade),
        [SESSION_RUNTIME_COMMAND_TYPES.START_MATCH]: createStartMatchCommandUseCase(facade, backends),
        [SESSION_RUNTIME_COMMAND_TYPES.PAUSE_MATCH]: createPauseMatchCommandUseCase(facade),
        [SESSION_RUNTIME_COMMAND_TYPES.RESUME_MATCH]: createResumeMatchCommandUseCase(facade),
        [SESSION_RUNTIME_COMMAND_TYPES.RETURN_TO_MENU]: createReturnToMenuCommandUseCase(facade, backends),
        [SESSION_RUNTIME_COMMAND_TYPES.FINALIZE_MATCH]: createFinalizeMatchCommandUseCase(facade, backends),
        [SESSION_RUNTIME_COMMAND_TYPES.HOST_LOBBY]: createHostLobbyCommandUseCase(facade, backends),
        [SESSION_RUNTIME_COMMAND_TYPES.JOIN_LOBBY]: createJoinLobbyCommandUseCase(facade, backends),
    };
    return {
        invalid: createInvalidCommandUseCase(facade),
        byType,
        get(commandType = '') {
            return byType[normalizeString(commandType)] || this.invalid;
        },
        applySettings: byType[SESSION_RUNTIME_COMMAND_TYPES.APPLY_SETTINGS],
        initializeSession: byType[SESSION_RUNTIME_COMMAND_TYPES.INITIALIZE_SESSION],
        startMatch: byType[SESSION_RUNTIME_COMMAND_TYPES.START_MATCH],
        pauseMatch: byType[SESSION_RUNTIME_COMMAND_TYPES.PAUSE_MATCH],
        resumeMatch: byType[SESSION_RUNTIME_COMMAND_TYPES.RESUME_MATCH],
        returnToMenu: byType[SESSION_RUNTIME_COMMAND_TYPES.RETURN_TO_MENU],
        finalizeMatch: byType[SESSION_RUNTIME_COMMAND_TYPES.FINALIZE_MATCH],
        hostLobby: byType[SESSION_RUNTIME_COMMAND_TYPES.HOST_LOBBY],
        joinLobby: byType[SESSION_RUNTIME_COMMAND_TYPES.JOIN_LOBBY],
    };
}
