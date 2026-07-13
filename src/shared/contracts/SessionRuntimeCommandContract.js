export const SESSION_RUNTIME_COMMAND_CONTRACT_VERSION = 'session-runtime-command.v1';

export const SESSION_RUNTIME_COMMAND_TYPES = Object.freeze({
    APPLY_SETTINGS: 'apply_settings',
    INITIALIZE_SESSION: 'initialize_session',
    START_MATCH: 'start_match',
    PAUSE_MATCH: 'pause_match',
    RESUME_MATCH: 'resume_match',
    RETURN_TO_MENU: 'return_to_menu',
    FINALIZE_MATCH: 'finalize_match',
    HOST_LOBBY: 'host_lobby',
    JOIN_LOBBY: 'join_lobby',
});

const SESSION_RUNTIME_COMMAND_TYPE_SET = new Set(Object.values(SESSION_RUNTIME_COMMAND_TYPES));

function normalizeSessionRuntimeCommandType(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SESSION_RUNTIME_COMMAND_TYPE_SET.has(normalized) ? normalized : '';
}

function cloneCommandPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }
    return { ...payload };
}

export function isSessionRuntimeCommandType(value) {
    return normalizeSessionRuntimeCommandType(value) !== '';
}

export function createSessionRuntimeCommand(type, payload = undefined) {
    const normalizedType = normalizeSessionRuntimeCommandType(type);
    if (!normalizedType) return null;
    return {
        contractVersion: SESSION_RUNTIME_COMMAND_CONTRACT_VERSION,
        type: normalizedType,
        payload: cloneCommandPayload(payload),
    };
}

export function normalizeSessionRuntimeCommand(command = null, fallbackType = '') {
    if (!command || typeof command !== 'object') {
        return createSessionRuntimeCommand(fallbackType);
    }
    return createSessionRuntimeCommand(command.type || fallbackType, command.payload);
}

export function createApplySettingsCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.APPLY_SETTINGS, options);
}

export function createInitializeSessionCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.INITIALIZE_SESSION, options);
}

export function createStartMatchCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.START_MATCH, options);
}

export function createPauseMatchCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.PAUSE_MATCH, options);
}

export function createResumeMatchCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.RESUME_MATCH, options);
}

export function createReturnToMenuCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.RETURN_TO_MENU, options);
}

export function createFinalizeMatchCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.FINALIZE_MATCH, options);
}

export function createHostLobbyCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.HOST_LOBBY, options);
}

export function createJoinLobbyCommand(options = undefined) {
    return createSessionRuntimeCommand(SESSION_RUNTIME_COMMAND_TYPES.JOIN_LOBBY, options);
}
