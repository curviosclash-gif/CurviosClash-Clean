/* eslint-disable max-lines -- browser demo policy override contract is intentionally co-located */
import { normalizeString } from './ContractNormalizeUtils.js';
import {
    PLATFORM_PROVIDER_KINDS,
    PLATFORM_SURFACE_MENU_MODE_PATHS,
    PLATFORM_SURFACE_SESSION_TYPES,
} from './PlatformCapabilityData.js';
import { PLATFORM_CAPABILITY_IDS } from './PlatformCapabilityContract.js';
import { MULTIPLAYER_TRANSPORTS } from './RuntimeSessionContract.js';

export const BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION = 'browser-demo-surface-policy.v1';

export const BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES = Object.freeze({
    CURRENT: 'BROWSER_DEMO_POLICY_VERSION_CURRENT',
    UPGRADE: 'BROWSER_DEMO_POLICY_VERSION_UPGRADE',
    FALLBACK: 'BROWSER_DEMO_POLICY_VERSION_UNKNOWN',
    REJECT: 'BROWSER_DEMO_POLICY_VERSION_CORRUPT',
});

export const BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES = Object.freeze({
    DRAFT_TYPE_INVALID: 'DRAFT_TYPE_INVALID',
    CONTRACT_VERSION_MISSING: 'CONTRACT_VERSION_MISSING',
    CONTRACT_VERSION_MISMATCH: 'CONTRACT_VERSION_MISMATCH',
    TOP_LEVEL_FIELD_UNKNOWN: 'TOP_LEVEL_FIELD_UNKNOWN',
    POLICY_SECTION_INVALID: 'POLICY_SECTION_INVALID',
    POLICY_FIELD_UNKNOWN: 'POLICY_FIELD_UNKNOWN',
    FIELD_TYPE_INVALID: 'FIELD_TYPE_INVALID',
    FIELD_VALUE_INVALID: 'FIELD_VALUE_INVALID',
    CAPABILITY_FLAGS_INVALID: 'CAPABILITY_FLAGS_INVALID',
    CAPABILITY_FLAG_UNKNOWN: 'CAPABILITY_FLAG_UNKNOWN',
    CAPABILITY_FLAG_INVALID: 'CAPABILITY_FLAG_INVALID',
    CAPABILITY_FLAG_FIELD_UNKNOWN: 'CAPABILITY_FLAG_FIELD_UNKNOWN',
});

export const BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_FIELDS = Object.freeze([
    'allowedSessionTypes',
    'allowedModePaths',
    'allowedPresetIds',
    'curatedMapKeysByModePath',
    'allowedMultiplayerTransports',
    'hostMultiplayerTransports',
    'joinMultiplayerTransports',
]);

const TOP_LEVEL_FIELDS = new Set(['contractVersion', 'policy', 'capabilityFlags']);
const POLICY_FIELD_SET = new Set(BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_FIELDS);
const CAPABILITY_FLAG_FIELDS = new Set(['enabled']);
/** @type {Set<string>} */
const VALID_SESSION_TYPES = new Set(Object.values(PLATFORM_SURFACE_SESSION_TYPES));
/** @type {Set<string>} */
const VALID_MODE_PATHS = new Set(Object.values(PLATFORM_SURFACE_MENU_MODE_PATHS));
/** @type {Set<string>} */
const VALID_MULTIPLAYER_TRANSPORTS = new Set(Object.values(MULTIPLAYER_TRANSPORTS));
/** @type {Set<string>} */
const VALID_CAPABILITY_IDS = new Set(Object.values(PLATFORM_CAPABILITY_IDS));
const VERSION_PATTERN = /^browser-demo-surface-policy\.v\d+$/;

function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function createError(path, code, message) {
    return Object.freeze({
        path: normalizeString(path, ''),
        code: normalizeString(code, ''),
        message: normalizeString(message, ''),
    });
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeSessionType(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_SESSION_TYPES.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeModePath(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_MODE_PATHS.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeTransport(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_MULTIPLAYER_TRANSPORTS.has(normalized) ? normalized : fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizePresetId(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return normalized || fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeMapKey(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return normalized || fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeCapabilityId(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    return VALID_CAPABILITY_IDS.has(normalized) ? normalized : fallback;
}

function sanitizeUniqueStringArray(values, normalizer) {
    if (!Array.isArray(values)) {
        return Object.freeze([]);
    }
    const seen = new Set();
    const sanitized = [];
    values.forEach((entry) => {
        const normalized = normalizer(entry, '');
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        sanitized.push(normalized);
    });
    return Object.freeze(sanitized);
}

function intersectInBaseOrder(baseValues, overrideValues) {
    const base = sanitizeUniqueStringArray(baseValues, normalizeString);
    if (!Array.isArray(overrideValues)) {
        return base;
    }
    const allowed = new Set(sanitizeUniqueStringArray(overrideValues, normalizeString));
    return Object.freeze(base.filter((entry) => allowed.has(entry)));
}

function normalizeOptionalStringArray(value, path, errors, normalizer) {
    if (value === undefined) {
        return null;
    }
    if (!Array.isArray(value)) {
        errors.push(createError(
            path,
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.FIELD_TYPE_INVALID,
            `${path} muss ein Array sein.`
        ));
        return null;
    }
    const seen = new Set();
    const normalized = [];
    value.forEach((entry, index) => {
        const candidate = normalizer(entry, '');
        if (!candidate) {
            errors.push(createError(
                `${path}[${index}]`,
                BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.FIELD_VALUE_INVALID,
                `${path}[${index}] enthaelt einen ungueltigen Wert.`
            ));
            return;
        }
        if (seen.has(candidate)) {
            return;
        }
        seen.add(candidate);
        normalized.push(candidate);
    });
    return Object.freeze(normalized);
}

function normalizeCuratedMapOverride(value, path, errors) {
    if (value === undefined) {
        return null;
    }
    if (!isPlainObject(value)) {
        errors.push(createError(
            path,
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.FIELD_TYPE_INVALID,
            `${path} muss ein Objekt sein.`
        ));
        return null;
    }

    const normalized = {};
    Object.entries(value).forEach(([rawModePath, rawMapKeys]) => {
        const modePath = normalizeModePath(rawModePath, '');
        if (!modePath) {
            errors.push(createError(
                `${path}.${rawModePath}`,
                BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.FIELD_VALUE_INVALID,
                `Ungueltiger Mode-Path in ${path}: ${rawModePath}.`
            ));
            return;
        }
        const mapKeys = normalizeOptionalStringArray(
            rawMapKeys,
            `${path}.${modePath}`,
            errors,
            normalizeMapKey
        );
        if (mapKeys !== null) {
            normalized[modePath] = mapKeys;
        }
    });
    return Object.freeze(normalized);
}

function normalizeCapabilityFlagEntry(value, path, errors) {
    if (typeof value === 'boolean') {
        return Object.freeze({ enabled: value === true });
    }
    if (!isPlainObject(value)) {
        errors.push(createError(
            path,
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAG_INVALID,
            `${path} muss ein Boolean oder Objekt mit enabled sein.`
        ));
        return null;
    }

    Object.keys(value).forEach((field) => {
        if (!CAPABILITY_FLAG_FIELDS.has(field)) {
            errors.push(createError(
                `${path}.${field}`,
                BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAG_FIELD_UNKNOWN,
                `Unbekanntes Feld ${path}.${field}.`
            ));
        }
    });

    if (typeof value.enabled !== 'boolean') {
        errors.push(createError(
            `${path}.enabled`,
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAG_INVALID,
            `${path}.enabled muss true oder false sein.`
        ));
        return null;
    }

    return Object.freeze({ enabled: value.enabled === true });
}

function normalizeCapabilityFlags(rawFlags, errors) {
    if (rawFlags === undefined) {
        return Object.freeze({});
    }
    if (!isPlainObject(rawFlags)) {
        errors.push(createError(
            'capabilityFlags',
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAGS_INVALID,
            'capabilityFlags muss ein Objekt sein.'
        ));
        return Object.freeze({});
    }

    const normalized = {};
    Object.entries(rawFlags).forEach(([rawCapabilityId, rawEntry]) => {
        const capabilityId = normalizeCapabilityId(rawCapabilityId, '');
        if (!capabilityId) {
            errors.push(createError(
                `capabilityFlags.${rawCapabilityId}`,
                BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CAPABILITY_FLAG_UNKNOWN,
                `Unbekannte Capability-ID: ${rawCapabilityId}.`
            ));
            return;
        }
        const normalizedEntry = normalizeCapabilityFlagEntry(
            rawEntry,
            `capabilityFlags.${capabilityId}`,
            errors
        );
        if (normalizedEntry) {
            normalized[capabilityId] = normalizedEntry;
        }
    });

    return Object.freeze(normalized);
}

function normalizePolicySection(rawPolicy, errors) {
    if (rawPolicy === undefined) {
        return Object.freeze({});
    }
    if (!isPlainObject(rawPolicy)) {
        errors.push(createError(
            'policy',
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.POLICY_SECTION_INVALID,
            'policy muss ein Objekt sein.'
        ));
        return Object.freeze({});
    }

    Object.keys(rawPolicy).forEach((field) => {
        if (!POLICY_FIELD_SET.has(field)) {
            errors.push(createError(
                `policy.${field}`,
                BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.POLICY_FIELD_UNKNOWN,
                `Unbekanntes Policy-Feld: ${field}.`
            ));
        }
    });

    const normalized = {};
    const sessionTypes = normalizeOptionalStringArray(
        rawPolicy.allowedSessionTypes,
        'policy.allowedSessionTypes',
        errors,
        normalizeSessionType
    );
    if (sessionTypes !== null) {
        normalized.allowedSessionTypes = sessionTypes;
    }

    const modePaths = normalizeOptionalStringArray(
        rawPolicy.allowedModePaths,
        'policy.allowedModePaths',
        errors,
        normalizeModePath
    );
    if (modePaths !== null) {
        normalized.allowedModePaths = modePaths;
    }

    const presetIds = normalizeOptionalStringArray(
        rawPolicy.allowedPresetIds,
        'policy.allowedPresetIds',
        errors,
        normalizePresetId
    );
    if (presetIds !== null) {
        normalized.allowedPresetIds = presetIds;
    }

    const allowedTransports = normalizeOptionalStringArray(
        rawPolicy.allowedMultiplayerTransports,
        'policy.allowedMultiplayerTransports',
        errors,
        normalizeTransport
    );
    if (allowedTransports !== null) {
        normalized.allowedMultiplayerTransports = allowedTransports;
    }

    const hostTransports = normalizeOptionalStringArray(
        rawPolicy.hostMultiplayerTransports,
        'policy.hostMultiplayerTransports',
        errors,
        normalizeTransport
    );
    if (hostTransports !== null) {
        normalized.hostMultiplayerTransports = hostTransports;
    }

    const joinTransports = normalizeOptionalStringArray(
        rawPolicy.joinMultiplayerTransports,
        'policy.joinMultiplayerTransports',
        errors,
        normalizeTransport
    );
    if (joinTransports !== null) {
        normalized.joinMultiplayerTransports = joinTransports;
    }

    const curatedMapKeysByModePath = normalizeCuratedMapOverride(
        rawPolicy.curatedMapKeysByModePath,
        'policy.curatedMapKeysByModePath',
        errors
    );
    if (curatedMapKeysByModePath !== null) {
        normalized.curatedMapKeysByModePath = curatedMapKeysByModePath;
    }

    return Object.freeze(normalized);
}

function normalizeBaseSurfacePolicy(baseSurfacePolicy = {}) {
    const source = isPlainObject(baseSurfacePolicy) ? baseSurfacePolicy : {};
    const allowedSessionTypes = sanitizeUniqueStringArray(
        source.allowedSessionTypes,
        normalizeSessionType
    );
    const allowedModePaths = sanitizeUniqueStringArray(
        source.allowedModePaths,
        normalizeModePath
    );
    const allowedPresetIds = sanitizeUniqueStringArray(
        source.allowedPresetIds,
        normalizePresetId
    );
    const allowedMultiplayerTransports = sanitizeUniqueStringArray(
        source.allowedMultiplayerTransports,
        normalizeTransport
    );

    const hostMultiplayerTransports = sanitizeUniqueStringArray(
        source.hostMultiplayerTransports,
        normalizeTransport
    ).filter((transport) => allowedMultiplayerTransports.includes(transport));

    const joinMultiplayerTransports = sanitizeUniqueStringArray(
        source.joinMultiplayerTransports,
        normalizeTransport
    ).filter((transport) => allowedMultiplayerTransports.includes(transport));

    const curatedMapKeysByModePath = {};
    if (isPlainObject(source.curatedMapKeysByModePath)) {
        Object.entries(source.curatedMapKeysByModePath).forEach(([rawModePath, rawMapKeys]) => {
            const modePath = normalizeModePath(rawModePath, '');
            if (!modePath) {
                return;
            }
            curatedMapKeysByModePath[modePath] = sanitizeUniqueStringArray(rawMapKeys, normalizeMapKey);
        });
    }

    const defaultModePathFallback = allowedModePaths[0] || PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL;
    const defaultModePath = normalizeModePath(source.defaultModePath, defaultModePathFallback) || defaultModePathFallback;
    const defaultTransportFallback = allowedMultiplayerTransports[0] || MULTIPLAYER_TRANSPORTS.LAN;
    const defaultMultiplayerTransport = normalizeTransport(
        source.defaultMultiplayerTransport,
        defaultTransportFallback
    );

    return Object.freeze({
        ...source,
        allowedSessionTypes,
        allowedModePaths,
        allowedPresetIds,
        allowedMultiplayerTransports: Object.freeze([...allowedMultiplayerTransports]),
        hostMultiplayerTransports: Object.freeze([...hostMultiplayerTransports]),
        joinMultiplayerTransports: Object.freeze([...joinMultiplayerTransports]),
        curatedMapKeysByModePath: Object.freeze(curatedMapKeysByModePath),
        defaultModePath,
        defaultMultiplayerTransport,
    });
}

function mergeCuratedMapKeysByModePath(baseCurated, overrideCurated, allowedModePaths) {
    const allowedModeSet = new Set(allowedModePaths);
    const merged = {};
    const baseSource = isPlainObject(baseCurated) ? baseCurated : {};
    const overrideSource = isPlainObject(overrideCurated) ? overrideCurated : null;

    Object.entries(baseSource).forEach(([modePath, rawMapKeys]) => {
        if (!allowedModeSet.has(modePath)) {
            return;
        }
        const baseMapKeys = sanitizeUniqueStringArray(rawMapKeys, normalizeMapKey);
        if (overrideSource && Object.prototype.hasOwnProperty.call(overrideSource, modePath)) {
            merged[modePath] = intersectInBaseOrder(baseMapKeys, overrideSource[modePath]);
            return;
        }
        merged[modePath] = baseMapKeys;
    });

    return Object.freeze(merged);
}

function resolveCapabilitySpecAvailable(spec) {
    if (isPlainObject(spec)) {
        if (Object.prototype.hasOwnProperty.call(spec, 'enabled')) {
            return spec.enabled === true;
        }
        const availableProvider = normalizeString(spec.available, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
        return availableProvider !== PLATFORM_PROVIDER_KINDS.UNAVAILABLE;
    }
    const provider = normalizeString(spec, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
    return provider !== PLATFORM_PROVIDER_KINDS.UNAVAILABLE;
}

function resolveBaseCapabilityFlags(baseCapabilities) {
    const source = isPlainObject(baseCapabilities) ? baseCapabilities : {};
    const flags = {};
    Object.values(PLATFORM_CAPABILITY_IDS).forEach((capabilityId) => {
        flags[capabilityId] = resolveCapabilitySpecAvailable(source[capabilityId]);
    });
    return Object.freeze(flags);
}

function mergeCapabilityFlags(baseCapabilities, overrideFlags = {}) {
    const source = isPlainObject(overrideFlags) ? overrideFlags : {};
    const baseFlags = resolveBaseCapabilityFlags(baseCapabilities);
    const merged = {};
    Object.values(PLATFORM_CAPABILITY_IDS).forEach((capabilityId) => {
        const baseAvailable = baseFlags[capabilityId] === true;
        const overrideEnabled = source[capabilityId]?.enabled;
        merged[capabilityId] = baseAvailable && overrideEnabled !== false;
    });
    return Object.freeze(merged);
}

export function createBrowserDemoSurfacePolicyOverrideDraft() {
    return Object.freeze({
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
        policy: Object.freeze({}),
        capabilityFlags: Object.freeze({}),
    });
}

export function validateBrowserDemoSurfacePolicyOverrideDraft(candidateDraft) {
    const errors = [];
    const warnings = [];
    const source = isPlainObject(candidateDraft) ? candidateDraft : {};

    if (!isPlainObject(candidateDraft)) {
        errors.push(createError(
            '',
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.DRAFT_TYPE_INVALID,
            'Draft muss ein Objekt sein.'
        ));
    } else {
        Object.keys(candidateDraft).forEach((field) => {
            if (!TOP_LEVEL_FIELDS.has(field)) {
                errors.push(createError(
                    field,
                    BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.TOP_LEVEL_FIELD_UNKNOWN,
                    `Unbekanntes Feld auf Root-Ebene: ${field}.`
                ));
            }
        });
    }

    const contractVersion = normalizeString(source.contractVersion, '');
    if (!contractVersion) {
        errors.push(createError(
            'contractVersion',
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CONTRACT_VERSION_MISSING,
            'contractVersion fehlt.'
        ));
    } else if (contractVersion !== BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION) {
        errors.push(createError(
            'contractVersion',
            BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_VALIDATION_CODES.CONTRACT_VERSION_MISMATCH,
            `contractVersion muss ${BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION} sein.`
        ));
    }

    const policy = normalizePolicySection(source.policy, errors);
    const capabilityFlags = normalizeCapabilityFlags(source.capabilityFlags, errors);

    const normalizedDraft = Object.freeze({
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
        policy,
        capabilityFlags,
    });

    return Object.freeze({
        valid: errors.length === 0,
        normalizedDraft,
        errors: Object.freeze(errors),
        warnings: Object.freeze(warnings),
    });
}

export function classifyBrowserDemoSurfacePolicyOverrideMigration(rawDraft) {
    if (!isPlainObject(rawDraft)) {
        return Object.freeze({
            status: 'reject',
            code: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.REJECT,
            reason: 'Draft ist kein Objekt.',
        });
    }

    const contractVersion = normalizeString(rawDraft.contractVersion, '');
    if (!contractVersion) {
        return Object.freeze({
            status: 'upgrade',
            code: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.UPGRADE,
            reason: 'contractVersion fehlt; Upgrade auf aktuelle Version.',
        });
    }
    if (contractVersion === BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION) {
        return Object.freeze({
            status: 'current',
            code: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.CURRENT,
            reason: null,
        });
    }
    if (VERSION_PATTERN.test(contractVersion)) {
        return Object.freeze({
            status: 'fallback',
            code: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.FALLBACK,
            reason: `Unbekannte Vertragsversion: ${contractVersion}. Fallback auf Basis-Policy.`,
        });
    }
    return Object.freeze({
        status: 'reject',
        code: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_MIGRATION_CODES.REJECT,
        reason: `Ungueltige Vertragsversion: ${contractVersion}.`,
    });
}

export function migrateBrowserDemoSurfacePolicyOverrideDraft(rawDraft, migration) {
    if (!migration || migration.status === 'current') {
        return rawDraft;
    }
    if (migration.status === 'upgrade') {
        return isPlainObject(rawDraft)
            ? { ...rawDraft, contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION }
            : rawDraft;
    }
    if (migration.status === 'fallback') {
        return createBrowserDemoSurfacePolicyOverrideDraft();
    }
    return rawDraft;
}

export function mergeBrowserDemoSurfacePolicyWithOverride(
    baseSurfacePolicy,
    baseCapabilities,
    rawOverrideDraft
) {
    const basePolicy = normalizeBaseSurfacePolicy(baseSurfacePolicy);
    const baseCapabilityFlags = resolveBaseCapabilityFlags(baseCapabilities);
    const migration = classifyBrowserDemoSurfacePolicyOverrideMigration(rawOverrideDraft);

    if (migration.status === 'reject') {
        return Object.freeze({
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            draft: createBrowserDemoSurfacePolicyOverrideDraft(),
            policy: basePolicy,
            capabilityFlags: baseCapabilityFlags,
            diagnostics: Object.freeze({
                status: 'reject',
                reason: normalizeString(migration.reason, 'Migrationsklassifikation fehlgeschlagen.'),
                migrationCode: migration.code,
                errorCodes: Object.freeze([]),
                warningCodes: Object.freeze([]),
            }),
        });
    }

    const migratedDraft = migrateBrowserDemoSurfacePolicyOverrideDraft(rawOverrideDraft, migration);
    const validation = validateBrowserDemoSurfacePolicyOverrideDraft(migratedDraft);

    if (!validation.valid) {
        return Object.freeze({
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            draft: validation.normalizedDraft,
            policy: basePolicy,
            capabilityFlags: baseCapabilityFlags,
            diagnostics: Object.freeze({
                status: 'reject',
                reason: 'VALIDATION_FAILED',
                migrationCode: migration.code,
                errorCodes: Object.freeze(validation.errors.map((entry) => entry.code)),
                warningCodes: Object.freeze(validation.warnings.map((entry) => entry.code)),
            }),
        });
    }

    const overridePolicy = /** @type {Record<string, any>} */ (
        validation.normalizedDraft?.policy && typeof validation.normalizedDraft.policy === 'object'
            ? validation.normalizedDraft.policy
            : {}
    );
    const mergedAllowedSessionTypes = intersectInBaseOrder(
        basePolicy.allowedSessionTypes,
        overridePolicy.allowedSessionTypes
    );
    const mergedAllowedModePaths = intersectInBaseOrder(
        basePolicy.allowedModePaths,
        overridePolicy.allowedModePaths
    );
    const mergedAllowedPresetIds = intersectInBaseOrder(
        basePolicy.allowedPresetIds,
        overridePolicy.allowedPresetIds
    );
    const mergedAllowedMultiplayerTransports = intersectInBaseOrder(
        basePolicy.allowedMultiplayerTransports,
        overridePolicy.allowedMultiplayerTransports
    );

    const baseHostSubset = intersectInBaseOrder(
        basePolicy.hostMultiplayerTransports,
        mergedAllowedMultiplayerTransports
    );
    const mergedHostMultiplayerTransports = intersectInBaseOrder(
        baseHostSubset,
        overridePolicy.hostMultiplayerTransports
    );

    const baseJoinSubset = intersectInBaseOrder(
        basePolicy.joinMultiplayerTransports,
        mergedAllowedMultiplayerTransports
    );
    const mergedJoinMultiplayerTransports = intersectInBaseOrder(
        baseJoinSubset,
        overridePolicy.joinMultiplayerTransports
    );

    const mergedDefaultModePath = mergedAllowedModePaths.includes(basePolicy.defaultModePath)
        ? basePolicy.defaultModePath
        : (mergedAllowedModePaths[0] || basePolicy.defaultModePath);
    const mergedDefaultMultiplayerTransport = mergedAllowedMultiplayerTransports.includes(basePolicy.defaultMultiplayerTransport)
        ? basePolicy.defaultMultiplayerTransport
        : (mergedAllowedMultiplayerTransports[0] || basePolicy.defaultMultiplayerTransport);

    const mergedPolicy = Object.freeze({
        ...basePolicy,
        allowedSessionTypes: mergedAllowedSessionTypes,
        allowedModePaths: mergedAllowedModePaths,
        allowedPresetIds: mergedAllowedPresetIds,
        allowedMultiplayerTransports: mergedAllowedMultiplayerTransports,
        hostMultiplayerTransports: mergedHostMultiplayerTransports,
        joinMultiplayerTransports: mergedJoinMultiplayerTransports,
        curatedMapKeysByModePath: mergeCuratedMapKeysByModePath(
            basePolicy.curatedMapKeysByModePath,
            overridePolicy.curatedMapKeysByModePath,
            mergedAllowedModePaths
        ),
        defaultModePath: mergedDefaultModePath,
        defaultMultiplayerTransport: mergedDefaultMultiplayerTransport,
    });

    const mergedCapabilityFlags = mergeCapabilityFlags(
        baseCapabilities,
        validation.normalizedDraft.capabilityFlags
    );

    const status = migration.status === 'fallback'
        ? 'fallback'
        : 'applied';

    return Object.freeze({
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
        draft: validation.normalizedDraft,
        policy: mergedPolicy,
        capabilityFlags: mergedCapabilityFlags,
        diagnostics: Object.freeze({
            status,
            reason: normalizeString(migration.reason, ''),
            migrationCode: migration.code,
            errorCodes: Object.freeze(validation.errors.map((entry) => entry.code)),
            warningCodes: Object.freeze(validation.warnings.map((entry) => entry.code)),
        }),
    });
}
