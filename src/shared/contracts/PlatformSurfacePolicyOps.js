// @ts-nocheck
/* eslint-disable max-lines -- central surface-policy contract is intentionally co-located */
import {
    PLATFORM_CAPABILITY_IDS,
} from './PlatformCapabilityContract.js';
import {
    isMapEligibleForModePath,
    resolveModePathFallbackMapKey,
} from './MapModeContract.js';
import {
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_SURFACE_MENU_MODE_PATHS,
    PLATFORM_SURFACE_POLICY_MODES,
    PLATFORM_SURFACE_QUICK_START_ACTION_IDS,
    PLATFORM_SURFACE_SESSION_TYPES,
    resolveSurfaceCapabilityAccess,
    resolveSurfaceDeveloperAccess,
    resolveSurfacePolicy,
} from './PlatformCapabilityRegistry.js';
import { normalizeString } from './ContractNormalizeUtils.js';

const VALID_SURFACE_MENU_MODE_PATHS = new Set(Object.values(PLATFORM_SURFACE_MENU_MODE_PATHS));
const VALID_SURFACE_QUICK_START_ACTION_IDS = new Set(Object.values(PLATFORM_SURFACE_QUICK_START_ACTION_IDS));
const VALID_SURFACE_SESSION_TYPES = new Set(Object.values(PLATFORM_SURFACE_SESSION_TYPES));
const SURFACE_POLICY_BLOCKED_REASON = 'surface_policy_blocked';
const SURFACE_POLICY_BLOCKED_TONE = 'warning';
const SURFACE_POLICY_BLOCKED_DURATION_MS = 1600;
export const PLATFORM_SURFACE_FEATURE_IDS = Object.freeze({
    REPLAY_EXPORT: 'replay-export',
    VIDEO_EXPORT: 'video-export',
    FILE_IO: 'file-io',
    DIAGNOSTICS: 'diagnostics',
    TOOLING: 'tooling',
    MAP_EDITOR: 'map-editor',
    VEHICLE_EDITOR: 'vehicle-editor',
});
export const PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS = Object.freeze({
    DESKTOP_ONLY: 'desktop-only',
    DEMO_SAFE: 'demo-safe',
    LEGACY: 'legacy',
    FUTURE_OPT_IN: 'future opt-in',
});
const VALID_SURFACE_FEATURE_IDS = new Set(Object.values(PLATFORM_SURFACE_FEATURE_IDS));

function normalizeSurfaceMenuModePath(value, fallback = '') {
    const normalized = /** @type {any} */ (normalizeString(value, '').toLowerCase());
    return VALID_SURFACE_MENU_MODE_PATHS.has(normalized) ? normalized : fallback;
}

function normalizeSurfaceSessionType(value, fallback = '') {
    const normalized = /** @type {any} */ (normalizeString(value, '').toLowerCase());
    return VALID_SURFACE_SESSION_TYPES.has(normalized) ? normalized : fallback;
}

function normalizeSurfaceQuickStartActionId(value, fallback = '') {
    const normalized = /** @type {any} */ (normalizeString(value, '').toLowerCase());
    return VALID_SURFACE_QUICK_START_ACTION_IDS.has(normalized) ? normalized : fallback;
}

function normalizeSurfaceFeatureId(value, fallback = '') {
    const normalized = /** @type {any} */ (normalizeString(value, '').toLowerCase());
    return VALID_SURFACE_FEATURE_IDS.has(normalized) ? normalized : fallback;
}

export function listSurfaceAllowedSessionTypes(options = {}) {
    const policy = resolveSurfacePolicy(options);
    if (Array.isArray(policy.allowedSessionTypes) && policy.allowedSessionTypes.length > 0) {
        return Object.freeze([...policy.allowedSessionTypes]);
    }
    if (policy.defaultAccessMode === PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL) {
        return Object.freeze([
            PLATFORM_SURFACE_SESSION_TYPES.SINGLE,
            PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER,
            PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN,
        ]);
    }
    return Object.freeze([PLATFORM_SURFACE_SESSION_TYPES.SINGLE]);
}

export function resolveSurfaceFallbackSessionType(options = {}) {
    return listSurfaceAllowedSessionTypes(options)[0] || PLATFORM_SURFACE_SESSION_TYPES.SINGLE;
}

export function isSurfaceSessionTypeAllowed(sessionType, options = {}) {
    const normalizedSessionType = normalizeSurfaceSessionType(sessionType, '');
    if (!normalizedSessionType) {
        return false;
    }
    return listSurfaceAllowedSessionTypes(options).includes(normalizedSessionType);
}

/**
 * @param {any} settings
 * @param {any} options
 */
export function resolveSurfaceMenuState(settings = {}, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const productSurfaceId = policy.productSurfaceId;
    const localSettings = settings?.localSettings && typeof settings.localSettings === 'object'
        ? settings.localSettings
        : {};
    const requestedSessionType = normalizeSurfaceSessionType(
        localSettings.sessionType,
        PLATFORM_SURFACE_SESSION_TYPES.SINGLE
    );
    const sessionType = isSurfaceSessionTypeAllowed(requestedSessionType, { productSurfaceId })
        ? requestedSessionType
        : resolveSurfaceFallbackSessionType({ productSurfaceId });

    const requestedModePath = normalizeSurfaceMenuModePath(
        localSettings.modePath,
        PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL
    );
    const modePath = isSurfaceModePathAllowed(requestedModePath, { productSurfaceId })
        ? requestedModePath
        : resolveSurfaceFallbackModePath({ productSurfaceId });

    const maps = options?.maps && typeof options.maps === 'object' ? options.maps : null;
    const requestedMapKey = normalizeString(settings?.mapKey, '');
    const requestedMapDefinition = requestedMapKey && maps ? maps[requestedMapKey] : null;
    const requestedMapAllowed = (
        requestedMapKey === 'custom'
        && policy.requiresCuratedMaps !== true
    )
        || (
            requestedMapKey
            && !!requestedMapDefinition
            && isMapEligibleForModePath(requestedMapDefinition, modePath)
            && isSurfaceMapKeyAllowedForModePath(requestedMapKey, modePath, { productSurfaceId })
        );
    const surfaceAllowedMapKeys = listSurfaceAllowedMapKeysForModePath(modePath, { productSurfaceId });
    const fallbackMapKey = maps
        ? (
            surfaceAllowedMapKeys
                .find((mapKey) => maps?.[mapKey] && isMapEligibleForModePath(maps[mapKey], modePath))
            || (
                resolveSurfacePolicy({ productSurfaceId }).requiresCuratedMaps === true
                    ? normalizeString(surfaceAllowedMapKeys[0], '')
                    : resolveModePathFallbackMapKey(maps, modePath, requestedMapKey || 'standard')
            )
        )
        : requestedMapKey;
    const mapKey = requestedMapAllowed ? requestedMapKey : fallbackMapKey;

    return Object.freeze({
        productSurfaceId,
        requestedSessionType,
        sessionType,
        sessionTypeChanged: sessionType !== requestedSessionType,
        requestedModePath,
        modePath,
        modePathChanged: modePath !== requestedModePath,
        requestedMapKey,
        mapKey,
        mapKeyChanged: !!mapKey && mapKey !== requestedMapKey,
    });
}

/**
 * @param {any} settings
 * @param {any} options
 */
export function applySurfaceMenuState(settings = {}, options = {}) {
    const source = settings && typeof settings === 'object' ? settings : null;
    const resolvedState = resolveSurfaceMenuState(source || {}, options);
    if (!source) {
        return Object.freeze({
            ...resolvedState,
            changed: false,
            changedKeys: Object.freeze([]),
        });
    }
    if (!source.localSettings || typeof source.localSettings !== 'object') {
        source.localSettings = {};
    }

    const changedKeys = new Set();
    if (source.localSettings.sessionType !== resolvedState.sessionType) {
        source.localSettings.sessionType = resolvedState.sessionType;
        changedKeys.add('sessionType');
    }
    if (source.localSettings.modePath !== resolvedState.modePath) {
        source.localSettings.modePath = resolvedState.modePath;
        changedKeys.add('modePath');
    }
    if (resolvedState.mapKey && source.mapKey !== resolvedState.mapKey) {
        source.mapKey = resolvedState.mapKey;
        changedKeys.add('mapKey');
    }

    return Object.freeze({
        ...resolvedState,
        changed: changedKeys.size > 0,
        changedKeys: Object.freeze(Array.from(changedKeys)),
    });
}

export function resolveSurfaceFallbackModePath(options = {}) {
    return resolveSurfacePolicy(options).defaultModePath;
}

export function resolveSurfaceFeatureClassification(featureId, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const developerAccess = resolveSurfaceDeveloperAccess({
        productSurfaceId: policy.productSurfaceId,
    });
    const normalizedFeatureId = normalizeSurfaceFeatureId(featureId, '');
    const isBrowserDemo = policy.productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO;
    const classificationByFeatureId = Object.freeze({
        [PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT,
            productSurfaceId: policy.productSurfaceId,
            classification: isBrowserDemo
                ? PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DEMO_SAFE
                : PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY,
            rationale: isBrowserDemo
                ? 'Replay-JSON ist in der Demo als begrenzter Browser-Download zulaessig.'
                : 'Replay-Export bleibt der primaere Desktop-Vollversionspfad.',
        }),
        [PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT,
            productSurfaceId: policy.productSurfaceId,
            classification: isBrowserDemo
                ? PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.FUTURE_OPT_IN
                : PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY,
            rationale: isBrowserDemo
                ? 'Video-Export bleibt in der Demo ein optionaler, bewusst degradierter Zukunftspfad.'
                : 'Video-Export ist Teil des Desktop-Produkts und kein Browser-Paritaetsversprechen.',
        }),
        [PLATFORM_SURFACE_FEATURE_IDS.FILE_IO]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.FILE_IO,
            productSurfaceId: policy.productSurfaceId,
            classification: PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY,
            rationale: 'Dateioperationen bleiben an Desktop-Shell-Capabilities gebunden.',
        }),
        [PLATFORM_SURFACE_FEATURE_IDS.DIAGNOSTICS]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.DIAGNOSTICS,
            productSurfaceId: policy.productSurfaceId,
            classification: isBrowserDemo
                ? PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.FUTURE_OPT_IN
                : PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY,
            rationale: isBrowserDemo
                ? 'Demo-Diagnostics sind nur als expliziter Opt-in erlaubt, nicht als Standardfeature.'
                : 'Desktop-Diagnostics gehoeren zum Vollversions- und Supportpfad.',
        }),
        [PLATFORM_SURFACE_FEATURE_IDS.TOOLING]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.TOOLING,
            productSurfaceId: policy.productSurfaceId,
            classification: developerAccess.available === true
                ? PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.LEGACY
                : PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.FUTURE_OPT_IN,
            rationale: developerAccess.available === true
                ? 'Tooling bleibt lokaler Dev-/Diagnosezugang und zaehlt nicht zum Produktversprechen.'
                : 'Tooling ist fuer diese Surface aktuell nicht freigegeben.',
        }),
        [PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR,
            productSurfaceId: policy.productSurfaceId,
            classification: PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY,
            rationale: isBrowserDemo
                ? 'Der Map-Editor bleibt eine Vollversions-Authoring-Funktion und ist in der Demo nicht verfuegbar.'
                : 'Der Map-Editor gehoert zur Desktop-Vollversion und bleibt eine Authoring-Funktion.',
        }),
        [PLATFORM_SURFACE_FEATURE_IDS.VEHICLE_EDITOR]: Object.freeze({
            featureId: PLATFORM_SURFACE_FEATURE_IDS.VEHICLE_EDITOR,
            productSurfaceId: policy.productSurfaceId,
            classification: PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY,
            rationale: isBrowserDemo
                ? 'Der Vehicle-Editor bleibt eine Vollversions-Funktion und ist in der Demo nicht verfuegbar.'
                : 'Der Vehicle-Editor gehoert zur Desktop-Vollversion und bleibt eine lokale Tool-Funktion.',
        }),
    });
    if (!normalizedFeatureId) {
        return Object.freeze({
            featureId: '',
            productSurfaceId: policy.productSurfaceId,
            classification: PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.FUTURE_OPT_IN,
            rationale: 'Unbekannte Surface-Features starten als expliziter Zukunfts-Opt-in.',
        });
    }
    return classificationByFeatureId[normalizedFeatureId] || Object.freeze({
        featureId: normalizedFeatureId,
        productSurfaceId: policy.productSurfaceId,
        classification: PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.FUTURE_OPT_IN,
        rationale: 'Unklassifiziertes Feature bleibt bis zur Freigabe als Zukunfts-Opt-in markiert.',
    });
}

export function isSurfaceModePathAllowed(modePath, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const normalizedModePath = normalizeSurfaceMenuModePath(modePath, '');
    if (!normalizedModePath) {
        return false;
    }
    if (policy.allowedModePaths.length === 0) {
        return policy.defaultAccessMode === PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL;
    }
    return policy.allowedModePaths.includes(normalizedModePath);
}

export function listSurfaceAllowedMapKeysForModePath(modePath, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const normalizedModePath = normalizeSurfaceMenuModePath(modePath, '');
    if (!normalizedModePath) {
        return Object.freeze([]);
    }
    return Array.isArray(policy.curatedMapKeysByModePath?.[normalizedModePath])
        ? Object.freeze([...policy.curatedMapKeysByModePath[normalizedModePath]])
        : Object.freeze([]);
}

export function isSurfaceMapKeyAllowedForModePath(mapKey, modePath, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const normalizedMapKey = normalizeString(mapKey, '');
    const normalizedModePath = normalizeSurfaceMenuModePath(modePath, '');
    if (!normalizedMapKey || !normalizedModePath) {
        return false;
    }
    if (!isSurfaceModePathAllowed(normalizedModePath, {
        productSurfaceId: policy.productSurfaceId,
    })) {
        return false;
    }
    if (policy.requiresCuratedMaps !== true) {
        return true;
    }
    return listSurfaceAllowedMapKeysForModePath(normalizedModePath, {
        productSurfaceId: policy.productSurfaceId,
    }).includes(normalizedMapKey);
}

export function isSurfacePresetAllowed(presetId, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const normalizedPresetId = normalizeString(presetId, '');
    if (!normalizedPresetId) {
        return false;
    }
    if (policy.allowedPresetIds.length === 0) {
        return policy.defaultAccessMode === PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL;
    }
    return policy.allowedPresetIds.includes(normalizedPresetId);
}

export function isSurfaceQuickStartActionAllowed(actionId, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const normalizedActionId = normalizeSurfaceQuickStartActionId(actionId, '');
    if (!normalizedActionId) {
        return false;
    }
    if (policy.allowedQuickStartActionIds.length === 0) {
        return policy.defaultAccessMode === PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL;
    }
    return policy.allowedQuickStartActionIds.includes(normalizedActionId);
}

export function resolveSurfaceBlockedFeatureFeedback(featureLabel = 'Diese Funktion', options = {}) {
    const policy = resolveSurfacePolicy(options);
    const normalizedFeatureLabel = normalizeString(featureLabel, 'Diese Funktion');
    const isBrowserDemo = policy.productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO;
    return Object.freeze({
        reason: SURFACE_POLICY_BLOCKED_REASON,
        productSurfaceId: policy.productSurfaceId,
        message: `${normalizedFeatureLabel} ist in dieser ${isBrowserDemo ? 'Demo' : 'Surface'} nicht verfuegbar.`,
        tone: SURFACE_POLICY_BLOCKED_TONE,
        durationMs: SURFACE_POLICY_BLOCKED_DURATION_MS,
    });
}

/**
 * Resolves the multiplayer gate access for a given action ('host', 'join', 'discover').
 * @param {'host'|'join'|'discover'} action
 * @param {object} options
 * @returns {{ allowed: boolean, action: string, productSurfaceId: string, multiplayerRole: string, reason: string, message: string, tone: string, durationMs: number }}
 */
export function resolveSurfaceMultiplayerGateAccess(action, options = {}) {
    const policy = resolveSurfacePolicy(options);
    const productSurfaceId = policy.productSurfaceId;
    const isBrowserDemo = productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO;
    const multiplayerRole = policy.multiplayerRole;
    const normalizedAction = normalizeString(action, '').toLowerCase();

    const hostCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId,
    });

    if (normalizedAction === 'host') {
        if (hostCapability.available !== true) {
            return Object.freeze({
                allowed: false,
                action: 'host',
                productSurfaceId,
                multiplayerRole,
                reason: 'surface_host_denied',
                message: isBrowserDemo
                    ? 'Hosting ist nur in der Desktop-Vollversion verfuegbar. Diese Demo kann nur beitreten.'
                    : 'Hosting ist in dieser Surface nicht verfuegbar.',
                tone: SURFACE_POLICY_BLOCKED_TONE,
                durationMs: SURFACE_POLICY_BLOCKED_DURATION_MS,
            });
        }
        if (policy.hostMultiplayerTransports.length === 0) {
            return Object.freeze({
                allowed: false,
                action: 'host',
                productSurfaceId,
                multiplayerRole,
                reason: 'surface_host_no_transport',
                message: isBrowserDemo
                    ? 'Kein produktiver Host-Transport fuer die Demo verfuegbar.'
                    : 'Kein produktiver Host-Transport verfuegbar.',
                tone: SURFACE_POLICY_BLOCKED_TONE,
                durationMs: SURFACE_POLICY_BLOCKED_DURATION_MS,
            });
        }
        return Object.freeze({
            allowed: true,
            action: 'host',
            productSurfaceId,
            multiplayerRole,
            reason: '',
            message: '',
            tone: '',
            durationMs: 0,
        });
    }

    if (normalizedAction === 'join') {
        if (policy.joinMultiplayerTransports.length === 0) {
            return Object.freeze({
                allowed: false,
                action: 'join',
                productSurfaceId,
                multiplayerRole,
                reason: 'surface_join_no_transport',
                message: isBrowserDemo
                    ? 'Kein produktiver Join-Transport fuer die Demo verfuegbar.'
                    : 'Kein produktiver Join-Transport verfuegbar.',
                tone: SURFACE_POLICY_BLOCKED_TONE,
                durationMs: SURFACE_POLICY_BLOCKED_DURATION_MS,
            });
        }
        return Object.freeze({
            allowed: true,
            action: 'join',
            productSurfaceId,
            multiplayerRole,
            reason: '',
            message: '',
            tone: '',
            durationMs: 0,
        });
    }

    if (normalizedAction === 'discover') {
        const discoveryCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.DISCOVERY, {
            productSurfaceId,
        });
        if (discoveryCapability.available !== true) {
            return Object.freeze({
                allowed: false,
                action: 'discover',
                productSurfaceId,
                multiplayerRole,
                reason: 'surface_discovery_denied',
                message: isBrowserDemo
                    ? 'Discovery ist in dieser Demo nicht verfuegbar.'
                    : 'Discovery ist in dieser Surface nicht verfuegbar.',
                tone: SURFACE_POLICY_BLOCKED_TONE,
                durationMs: SURFACE_POLICY_BLOCKED_DURATION_MS,
            });
        }
        return Object.freeze({
            allowed: true,
            action: 'discover',
            productSurfaceId,
            multiplayerRole,
            reason: '',
            message: '',
            tone: '',
            durationMs: 0,
        });
    }

    return Object.freeze({
        allowed: false,
        action: normalizedAction || 'unknown',
        productSurfaceId,
        multiplayerRole,
        reason: 'surface_unknown_action',
        message: `Unbekannte Multiplayer-Aktion: ${normalizedAction || '(leer)'}.`,
        tone: SURFACE_POLICY_BLOCKED_TONE,
        durationMs: SURFACE_POLICY_BLOCKED_DURATION_MS,
    });
}

export function resolveSurfaceEntryCopy(options = {}) {
    const policy = resolveSurfacePolicy(options);
    const productSurfaceId = policy.productSurfaceId;
    const isBrowserDemo = productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO;
    const sessionType = normalizeSurfaceSessionType(
        options.sessionType,
        resolveSurfaceFallbackSessionType({ productSurfaceId })
    );
    const hostCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId,
    });

    return Object.freeze({
        productSurfaceId,
        sessionType,
        sessionLabels: Object.freeze({
            [PLATFORM_SURFACE_SESSION_TYPES.SINGLE]: isBrowserDemo ? 'Showcase' : 'Single Player',
            [PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER]: isBrowserDemo ? 'Join only' : 'Multiplayer',
            [PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN]: 'Splitscreen',
        }),
        sessionDescriptions: Object.freeze({
            [PLATFORM_SURFACE_SESSION_TYPES.SINGLE]: isBrowserDemo
                ? 'Kuratierter Offline-Showcase der Browser-Demo.'
                : 'Lokaler Startpfad fuer Solo-Runden in der Vollversion.',
            [PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER]: isBrowserDemo
                ? 'Desktop-Lobbys beitreten, aber nicht hosten.'
                : 'Hosten oder einer Lobby beitreten.',
            [PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN]: isBrowserDemo
                ? 'Splitscreen ist in dieser Demo nicht verfuegbar.'
                : 'Lokaler 2-Spieler-Modus auf einem Geraet.',
        }),
        sessionSummaryLabels: Object.freeze({
            [PLATFORM_SURFACE_SESSION_TYPES.SINGLE]: isBrowserDemo ? 'Showcase offline' : 'Single Player',
            [PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER]: isBrowserDemo ? 'Join only' : 'Multiplayer',
            [PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN]: 'Splitscreen',
        }),
        startButtonLabel: isBrowserDemo && sessionType !== PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER
            ? 'Showcase starten'
            : 'Starten',
        startButtonTitle: isBrowserDemo && sessionType !== PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER
            ? 'Startet den kuratierten Demo-Showcase.'
            : '',
        multiplayerTitle: isBrowserDemo ? 'Lobby & Join only' : 'Lobby & Bereitschaft',
        multiplayerSubtitle: isBrowserDemo
            ? 'Die Demo kann Desktop-Lobbys beitreten, hostet aber nicht.'
            : 'Session-Code, echte Lobby-Verbindung und Ready-Status.',
        hostButtonLabel: hostCapability.available === true
            ? 'Host'
            : (isBrowserDemo ? 'Nur Desktop' : 'Nicht verfuegbar'),
        hostButtonTitle: hostCapability.available === true
            ? 'Desktop kann Lobbys erstellen und Matchstart besitzen.'
            : (isBrowserDemo
                ? 'Hosting ist nur in der Desktop-Vollversion verfuegbar.'
                : 'Hosting ist in dieser Surface nicht verfuegbar.'),
        hostActionAvailable: hostCapability.available === true,
        joinButtonLabel: isBrowserDemo ? 'Join only' : 'Join',
        joinButtonTitle: isBrowserDemo
            ? 'Diese Demo kann nur einer Desktop-Lobby beitreten.'
            : 'Einer vorhandenen Lobby beitreten.',
        lobbyCodePlaceholder: isBrowserDemo ? 'Code vom Desktop-Host' : 'z. B. TEST-1234',
        multiplayerInactiveStatus: isBrowserDemo ? 'Join only inaktiv' : 'Lobby inaktiv',
        multiplayerDisconnectedStatus: isBrowserDemo
            ? 'Lobby offline | Rolle: Join only'
            : 'Lobby offline | Rolle: nicht verbunden',
        multiplayerClientRoleLabel: isBrowserDemo ? 'Join only' : 'Client',
        multiplayerJoinWaitTitle: isBrowserDemo
            ? 'Lobby-Code eines Desktop-Hosts eingeben und Join only verwenden.'
            : 'Lobby hosten oder joinen, bevor gestartet wird.',
        multiplayerClientStartTitle: isBrowserDemo
            ? 'Diese Demo kann nur beitreten; Matchstart erfolgt ueber den Desktop-Host.'
            : 'Nur der Host kann das Match starten.',
    });
}
