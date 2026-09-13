import { normalizeString } from '../shared/contracts/ContractNormalizeUtils.js';

import {
    SIGNALING_COMMAND_TYPES,
    createSignalingEnvelope,
} from '../shared/contracts/SignalingSessionContract.js';

export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
export const DEFAULT_CONNECT_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);
export const DEFAULT_RECONNECT_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 5000]);

const NON_RETRYABLE_SIGNALING_ERROR_CODES = new Set([
    'signaling_endpoint_missing',
    'signaling_endpoint_invalid_url',
    'signaling_endpoint_invalid_scheme',
    'signaling_endpoint_missing_host',
    'signaling_server_error',
    'signaling_payload_invalid',
    'signaling_network_unavailable',
    'lobby_not_found',
    'lobby_full',
    'host_required',
    'not_enough_members',
    'members_not_ready',
    'rate_limit_exceeded',
    'reconnect_window_expired',
    'connection_resume_failed',
]);

const SERVER_ERROR_MESSAGES = Object.freeze({
    lobby_not_found: 'Lobby nicht gefunden.',
    lobby_full: 'Lobby ist voll.',
    host_required: 'Nur der Host darf diese Aktion ausfuehren.',
    not_enough_members: 'Mindestens zwei Teilnehmer werden benoetigt.',
    members_not_ready: 'Alle Teilnehmer muessen bereit sein.',
    rate_limit_exceeded: 'Zu viele Anfragen. Bitte kurz warten.',
    reconnect_window_expired: 'Die Wiederverbindungszeit ist abgelaufen.',
    connection_resume_failed: 'Wiederverbindung fehlgeschlagen.',
});

export class OnlineSignalingError extends Error {
    constructor(code, message, details = null, cause = null) {
        super(message);
        this.name = 'OnlineSignalingError';
        this.code = normalizeString(code, 'signaling_error');
        this.details = details && typeof details === 'object' ? { ...details } : {};
        if (cause) {
            this.cause = cause;
        }
    }
}

export function resolveRetryDelays(delays, fallback = DEFAULT_CONNECT_RETRY_DELAYS_MS) {
    if (!Array.isArray(delays) || delays.length <= 0) {
        return [...fallback];
    }
    return delays
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .map((value) => Math.floor(value));
}

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createOnlineSignalingError(code, message, details = null, cause = null) {
    return new OnlineSignalingError(code, message, details, cause);
}

export function createOnlineLobbyCreateEnvelope(options = {}) {
    return createSignalingEnvelope(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, {
        maxPlayers: options.maxPlayers || 10,
        actorId: options.actorId,
        name: options.name || options.actorId,
        metadata: options.metadata,
    });
}

export function createOnlineLobbyJoinEnvelope(lobbyCode, options = {}) {
    return createSignalingEnvelope(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, {
        lobbyCode,
        actorId: options.actorId,
        name: options.name || options.actorId,
    });
}

export function emitOnlineLobbyReconnectProgress(lobby, attempt, maxAttempts) {
    lobby._emit('reconnecting', { attempt, maxAttempts, sessionState: lobby.sessionState });
}

export function applyOnlineLobbySettings(lobby, settings = {}) {
    Object.assign(lobby.settings, settings);
    if (lobby.isHost === true && settings?.metadata) {
        lobby._send(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA, {
            metadata: settings.metadata,
        }));
    }
    lobby._emit('settingsChanged', { settings: lobby.settings, sessionState: lobby.sessionState });
}

export function isRetryableSignalingError(error) {
    const code = normalizeString(error?.code, '');
    return !NON_RETRYABLE_SIGNALING_ERROR_CODES.has(code);
}

export function resolveConnectTimeoutMs(value, fallback = DEFAULT_CONNECT_TIMEOUT_MS) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.max(1, Math.floor(parsed))
        : fallback;
}

export function resolveOnlineSignalingUrl(primaryValue, fallbackValue = '') {
    const rawValue = normalizeString(primaryValue, fallbackValue);
    if (!rawValue) {
        throw createOnlineSignalingError(
            'signaling_endpoint_missing',
            'Online ist derzeit nicht eingerichtet. Bitte LAN verwenden oder die Online-Konfiguration pruefen.'
        );
    }

    let parsedUrl;
    try {
        parsedUrl = rawValue.includes('://')
            ? new URL(rawValue)
            : new URL(`ws://${rawValue}`);
    } catch (error) {
        throw createOnlineSignalingError(
            'signaling_endpoint_invalid_url',
            'Die Online-Konfiguration ist ungueltig.',
            { rawValue },
            error
        );
    }

    const originalProtocol = normalizeString(parsedUrl.protocol, '').toLowerCase();
    if (originalProtocol === 'http:') {
        parsedUrl.protocol = 'ws:';
    } else if (originalProtocol === 'https:') {
        parsedUrl.protocol = 'wss:';
    }

    if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
        throw createOnlineSignalingError(
            'signaling_endpoint_invalid_scheme',
            'Die Online-Konfiguration verwendet ein nicht unterstuetztes Protokoll.',
            { rawValue, protocol: originalProtocol || parsedUrl.protocol }
        );
    }

    if (!normalizeString(parsedUrl.hostname, '')) {
        throw createOnlineSignalingError(
            'signaling_endpoint_missing_host',
            'Die Online-Konfiguration enthaelt keine Serveradresse.',
            { rawValue }
        );
    }

    return parsedUrl.toString();
}

export function buildSocketCloseDetails(event, signalingUrl = '') {
    return {
        signalingUrl: normalizeString(signalingUrl, ''),
        closeCode: Number.isFinite(Number(event?.code))
            ? Math.floor(Number(event.code))
            : 1006,
        closeReason: normalizeString(event?.reason, ''),
        wasClean: event?.wasClean === true,
    };
}

export function createSocketLifecycleError(source, details = null, cause = null) {
    const normalizedDetails = details && typeof details === 'object' ? { ...details } : {};
    if (source === 'error') {
        return createOnlineSignalingError(
            'signaling_socket_error',
            'Online-Verbindung fehlgeschlagen.',
            normalizedDetails,
            cause
        );
    }

    if (source === 'timeout') {
        return createOnlineSignalingError(
            'signaling_connect_timeout',
            'Die Online-Verbindung antwortet nicht rechtzeitig.',
            normalizedDetails,
            cause
        );
    }

    return createOnlineSignalingError(
        'signaling_socket_closed',
        'Die Online-Verbindung wurde unterbrochen.',
        normalizedDetails,
        cause
    );
}

export function createServerSignalingError(code, message = '', details = null, cause = null) {
    const normalizedCode = normalizeString(code, 'signaling_server_error');
    const normalizedMessage = SERVER_ERROR_MESSAGES[normalizedCode]
        || normalizeString(message, 'Der Lobby-Server hat die Anfrage abgelehnt.');
    return createOnlineSignalingError(
        normalizedCode,
        normalizedMessage,
        details,
        cause
    );
}

export function createInvalidSignalingPayloadError(details = null, cause = null) {
    return createOnlineSignalingError(
        'signaling_payload_invalid',
        'Online-Signaling hat eine ungueltige Nachricht geliefert.',
        details,
        cause
    );
}

export function createNetworkUnavailableSignalingError(details = null, cause = null) {
    return createOnlineSignalingError(
        'signaling_network_unavailable',
        'Online ist nicht erreichbar. Bitte Internetverbindung pruefen oder LAN verwenden.',
        details,
        cause
    );
}

export function createResumeSignalingEnvelope(payload = null) {
    return createSignalingEnvelope(SIGNALING_COMMAND_TYPES.RESUME_CONNECTION, payload);
}

export function toErrorPayload(error, fallbackMessage = 'Online-Signaling fehlgeschlagen.') {
    return {
        code: normalizeString(error?.code, 'signaling_error'),
        message: normalizeString(error?.message, fallbackMessage),
        details: error?.details && typeof error.details === 'object'
            ? { ...error.details }
            : null,
    };
}
