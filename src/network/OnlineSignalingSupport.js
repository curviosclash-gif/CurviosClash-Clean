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
]);

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

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
            'Online-Signaling-Endpoint fehlt. Setze VITE_SIGNALING_URL auf ws:// oder wss://.'
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
            `Online-Signaling-Endpoint ist ungueltig: ${rawValue}`,
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
            `Online-Signaling-Endpoint muss ws:// oder wss:// verwenden: ${rawValue}`,
            { rawValue, protocol: originalProtocol || parsedUrl.protocol }
        );
    }

    if (!normalizeString(parsedUrl.hostname, '')) {
        throw createOnlineSignalingError(
            'signaling_endpoint_missing_host',
            `Online-Signaling-Endpoint enthaelt keinen Host: ${rawValue}`,
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
    const closeCode = Number.isFinite(Number(normalizedDetails.closeCode))
        ? Math.floor(Number(normalizedDetails.closeCode))
        : null;

    if (source === 'error') {
        return createOnlineSignalingError(
            'signaling_socket_error',
            normalizedDetails.signalingUrl
                ? `WebSocket-Verbindung zum Online-Signaling fehlgeschlagen: ${normalizedDetails.signalingUrl}`
                : 'WebSocket-Verbindung zum Online-Signaling fehlgeschlagen.',
            normalizedDetails,
            cause
        );
    }

    if (source === 'timeout') {
        return createOnlineSignalingError(
            'signaling_connect_timeout',
            normalizedDetails.signalingUrl
                ? `Online-Signaling antwortet nicht rechtzeitig: ${normalizedDetails.signalingUrl}`
                : 'Online-Signaling antwortet nicht rechtzeitig.',
            normalizedDetails,
            cause
        );
    }

    return createOnlineSignalingError(
        'signaling_socket_closed',
        closeCode
            ? `WebSocket zum Online-Signaling wurde geschlossen (Code ${closeCode}).`
            : 'WebSocket zum Online-Signaling wurde geschlossen.',
        normalizedDetails,
        cause
    );
}

export function createServerSignalingError(message, details = null, cause = null) {
    const normalizedMessage = normalizeString(message, 'Signaling-Serverfehler');
    return createOnlineSignalingError(
        'signaling_server_error',
        `Signaling-Serverfehler: ${normalizedMessage}`,
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
        'Online nicht erreichbar – Internetverbindung oder Signaling-Server-Adresse pruefen.',
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
