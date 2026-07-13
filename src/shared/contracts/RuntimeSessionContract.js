export const RUNTIME_SESSION_TYPES = Object.freeze({
    SINGLE: 'single',
    SPLITSCREEN: 'splitscreen',
    MULTIPLAYER: 'multiplayer',
    LAN: 'lan',
    ONLINE: 'online',
});

export const MULTIPLAYER_TRANSPORTS = Object.freeze({
    STORAGE_BRIDGE: 'storage-bridge',
    LAN: 'lan',
    ONLINE: 'online',
});

export const RUNTIME_MULTIPLAYER_TRANSPORT_PRODUCT_STATUSES = Object.freeze({
    PRODUCTIVE: 'productive',
    LEGACY_FALLBACK: 'legacy-fallback',
});

/**
 * Session role in a multiplayer session.
 * HOST: the peer that owns the lobby and drives match-start authority.
 * CLIENT: a peer that joins an existing lobby hosted by another player.
 *
 * This is the canonical definition shared by MultiplayerSessionContract
 * and SignalingSessionContract.
 */
export const MULTIPLAYER_SESSION_ROLES = Object.freeze({
    HOST: 'host',
    CLIENT: 'client',
});

/** @type {Set<string>} */
const VALID_SESSION_TYPE_SET = new Set(Object.values(RUNTIME_SESSION_TYPES));
/** @type {Set<string>} */
const VALID_MULTIPLAYER_TRANSPORT_SET = new Set(Object.values(MULTIPLAYER_TRANSPORTS));
/** @type {Set<string>} */
const VALID_SESSION_ROLE_SET = new Set(Object.values(MULTIPLAYER_SESSION_ROLES));

/**
 * @param {unknown} value
 * @param {string} [fallback=RUNTIME_SESSION_TYPES.SINGLE]
 * @returns {string}
 */
export function normalizeRuntimeSessionType(value, fallback = RUNTIME_SESSION_TYPES.SINGLE) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return VALID_SESSION_TYPE_SET.has(normalized) ? normalized : fallback;
}

export function isLegacyMultiplayerTransport(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE;
}

/**
 * @param {unknown} value
 * @param {string} [fallback=MULTIPLAYER_TRANSPORTS.LAN]
 * @returns {string}
 */
export function normalizeMultiplayerTransport(value, fallback = MULTIPLAYER_TRANSPORTS.LAN) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return VALID_MULTIPLAYER_TRANSPORT_SET.has(normalized) ? normalized : fallback;
}

export function resolveRuntimeSessionTransportPolicy(source = null) {
    const sessionSource = source && typeof source === 'object'
        ? source
        : { sessionType: source };
    const sessionType = normalizeRuntimeSessionType(sessionSource?.sessionType, RUNTIME_SESSION_TYPES.SINGLE);
    const multiplayerTransport = normalizeMultiplayerTransport(
        sessionSource?.multiplayerTransport,
        MULTIPLAYER_TRANSPORTS.LAN
    );
    const isLegacyTransport = sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER
        && multiplayerTransport === MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE;
    const isMultiplayerSession = sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER;
    const transportAudienceLabel = isLegacyTransport
        ? 'Legacy-Fallback (lokal, kein LAN/Online)'
        : (isMultiplayerSession
            ? (multiplayerTransport === MULTIPLAYER_TRANSPORTS.ONLINE ? 'Online' : 'LAN')
            : 'Offline');

    return Object.freeze({
        sessionType,
        multiplayerTransport,
        runtimeTransportKind: isLegacyTransport
            ? 'menu-storage-bridge'
            : (isMultiplayerSession ? multiplayerTransport : sessionType),
        transportProductStatus: isLegacyTransport
            ? RUNTIME_MULTIPLAYER_TRANSPORT_PRODUCT_STATUSES.LEGACY_FALLBACK
            : RUNTIME_MULTIPLAYER_TRANSPORT_PRODUCT_STATUSES.PRODUCTIVE,
        isLegacyTransport,
        isFallbackTransport: isLegacyTransport,
        isProductiveTransport: !isLegacyTransport,
        transportAudienceLabel,
        transportDiagnosticLabel: isLegacyTransport
            ? 'legacy-fallback: menu-storage-bridge (local-only)'
            : (isMultiplayerSession ? multiplayerTransport : `offline:${sessionType}`),
    });
}

export function resolveRuntimeSessionContract(source = null) {
    const transportPolicy = resolveRuntimeSessionTransportPolicy(source);
    const sessionType = transportPolicy.sessionType;
    const multiplayerTransport = transportPolicy.multiplayerTransport;
    const usesMenuStorageBridge = transportPolicy.isLegacyTransport;
    const adapterSessionType = usesMenuStorageBridge
        ? RUNTIME_SESSION_TYPES.SINGLE
        : (sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER
            ? (multiplayerTransport === MULTIPLAYER_TRANSPORTS.LAN
                ? RUNTIME_SESSION_TYPES.LAN
                : (multiplayerTransport === MULTIPLAYER_TRANSPORTS.ONLINE
                    ? RUNTIME_SESSION_TYPES.ONLINE
                    : sessionType))
            : sessionType);
    const runtimeTransportKind = usesMenuStorageBridge
        ? transportPolicy.runtimeTransportKind
        : adapterSessionType;
    return {
        sessionType,
        multiplayerTransport,
        usesMenuStorageBridge,
        adapterSessionType,
        runtimeTransportKind,
        transportProductStatus: usesMenuStorageBridge
            ? transportPolicy.transportProductStatus
            : RUNTIME_MULTIPLAYER_TRANSPORT_PRODUCT_STATUSES.PRODUCTIVE,
        isLegacyTransport: usesMenuStorageBridge,
        isFallbackTransport: usesMenuStorageBridge,
        transportAudienceLabel: usesMenuStorageBridge
            ? transportPolicy.transportAudienceLabel
            : (sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER
                ? transportPolicy.transportAudienceLabel
                : 'Offline'),
        transportDiagnosticLabel: usesMenuStorageBridge
            ? transportPolicy.transportDiagnosticLabel
            : (sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER
                ? transportPolicy.transportDiagnosticLabel
                : `offline:${sessionType}`),
        isNetworkSession: adapterSessionType === RUNTIME_SESSION_TYPES.LAN || adapterSessionType === RUNTIME_SESSION_TYPES.ONLINE,
    };
}

export function isMenuStorageBridgeSession(source = null) {
    return resolveRuntimeSessionContract(source).usesMenuStorageBridge === true;
}

/**
 * @param {unknown} value
 * @param {string} [fallback=MULTIPLAYER_SESSION_ROLES.CLIENT]
 * @returns {string}
 */
export function normalizeMultiplayerSessionRole(value, fallback = MULTIPLAYER_SESSION_ROLES.CLIENT) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return VALID_SESSION_ROLE_SET.has(normalized) ? normalized : fallback;
}

/**
 * Resolves transport-level host/join capabilities for a session.
 *
 * Returns whether the session can function as a HOST or CLIENT based solely
 * on sessionType + multiplayerTransport. This is the transport-level gate;
 * surface-level restrictions (desktop-app vs. browser-demo) are enforced by
 * PlatformCapabilityRegistry / DesktopMultiplayerRoleContract.
 *
 * Rules:
 *   - offline sessions (single, splitscreen): canHost=false, canJoin=false
 *   - network sessions (lan, online): canHost=true, canJoin=true
 *   - storage-bridge (legacy): adapterSessionType=single, isNetworkSession=false
 *     → canHost=false, canJoin=false (legacy mechanism, not a product-facing role)
 *
 * @param {object|null} source
 * @returns {{
 *   sessionType: string,
 *   multiplayerTransport: string,
 *   adapterSessionType: string,
 *   isNetworkSession: boolean,
 *   isLegacyTransport: boolean,
 *   isFallbackTransport: boolean,
 *   transportProductStatus: string,
 *   transportAudienceLabel: string,
 *   canHost: boolean,
 *   canJoin: boolean,
 * }}
 */
export function resolveRuntimeSessionCapabilities(source = null) {
    const contract = resolveRuntimeSessionContract(source);
    return Object.freeze({
        sessionType: contract.sessionType,
        multiplayerTransport: contract.multiplayerTransport,
        adapterSessionType: contract.adapterSessionType,
        isNetworkSession: contract.isNetworkSession,
        isLegacyTransport: contract.usesMenuStorageBridge,
        isFallbackTransport: contract.isFallbackTransport === true,
        transportProductStatus: contract.transportProductStatus,
        transportAudienceLabel: contract.transportAudienceLabel,
        canHost: contract.isNetworkSession,
        canJoin: contract.isNetworkSession,
    });
}
