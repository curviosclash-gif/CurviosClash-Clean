import {
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_RUNTIME_KINDS,
    PLATFORM_SURFACE_MENU_MODE_PATHS,
    PLATFORM_SURFACE_QUICK_START_ACTION_IDS,
    PLATFORM_SURFACE_SESSION_TYPES,
} from './PlatformCapabilityData.js';
import { MULTIPLAYER_TRANSPORTS } from './RuntimeSessionContract.js';
import { normalizeString } from './ContractNormalizeUtils.js';

/** @type {Set<string>} */
const VALID_PRODUCT_SURFACE_IDS = new Set(Object.values(PLATFORM_PRODUCT_SURFACE_IDS));
/** @type {Set<string>} */
const VALID_RUNTIME_KINDS = new Set(Object.values(PLATFORM_RUNTIME_KINDS));
/** @type {Set<string>} */
const VALID_LOBBY_TRANSPORTS = new Set(Object.values(MULTIPLAYER_TRANSPORTS));
/** @type {Set<string>} */
const VALID_SURFACE_SESSION_TYPES = new Set(Object.values(PLATFORM_SURFACE_SESSION_TYPES));
/** @type {Set<string>} */
const VALID_SURFACE_MENU_MODE_PATHS = new Set(Object.values(PLATFORM_SURFACE_MENU_MODE_PATHS));
/** @type {Set<string>} */
const VALID_SURFACE_QUICK_START_ACTION_IDS = new Set(Object.values(PLATFORM_SURFACE_QUICK_START_ACTION_IDS));

export function resolveRuntimeGlobal(runtimeGlobal = globalThis) {
    return runtimeGlobal && typeof runtimeGlobal === 'object'
        ? runtimeGlobal
        : (typeof globalThis !== 'undefined' ? globalThis : {});
}

export function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizePlatformProductSurfaceId(
    value,
    fallback = PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO
) {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_PRODUCT_SURFACE_IDS.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizePlatformRuntimeKind(value, fallback = PLATFORM_RUNTIME_KINDS.WEB) {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_RUNTIME_KINDS.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeLobbyProviderTransport(value, fallback = MULTIPLAYER_TRANSPORTS.LAN) {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_LOBBY_TRANSPORTS.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeSurfaceMenuModePath(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_SURFACE_MENU_MODE_PATHS.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeSurfaceSessionType(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_SURFACE_SESSION_TYPES.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeSurfaceQuickStartActionId(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_SURFACE_QUICK_START_ACTION_IDS.has(normalized) ? normalized : fallback;
}

export function sanitizeUniqueStringArray(values, normalizer) {
    if (!Array.isArray(values)) {
        return Object.freeze([]);
    }
    const seen = new Set();
    const sanitized = [];
    values.forEach((value) => {
        const normalized = normalizer(value, '');
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        sanitized.push(normalized);
    });
    return Object.freeze(sanitized);
}

export { normalizeString };
