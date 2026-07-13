import { normalizeText } from './ContractNormalizeUtils.js';

const DEFAULT_VERSION_FIELDS = Object.freeze(['schemaVersion', 'contractVersion', 'version']);

export const ARTIFACT_VERSION_DECISIONS = Object.freeze({
    CURRENT: 'current',
    UPGRADE: 'upgrade',
    FALLBACK: 'fallback',
    REJECT: 'reject',
});

function normalizeVersionToken(value, options = {}) {
    if (Number.isFinite(value)) {
        return Math.trunc(Number(value));
    }
    const text = normalizeText(value);
    if (!text) return null;
    if (options.coerceNumericVersions === true) {
        const numeric = Number(text);
        if (Number.isFinite(numeric)) {
            return Math.trunc(numeric);
        }
    }
    return text;
}

function normalizeVersionList(values, options = {}) {
    if (!Array.isArray(values)) return [];
    const out = [];
    for (const entry of values) {
        const normalized = normalizeVersionToken(entry, options);
        if (normalized === null) continue;
        out.push(normalized);
    }
    return out;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolveVersionField(payload, versionFields, options = {}) {
    if (!isPlainObject(payload)) {
        return { hasVersionField: false, field: '', value: null };
    }
    const candidates = Array.isArray(versionFields) && versionFields.length > 0
        ? versionFields
        : DEFAULT_VERSION_FIELDS;
    for (const candidate of candidates) {
        const fieldName = normalizeText(candidate);
        if (!fieldName) continue;
        if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) continue;
        const normalized = normalizeVersionToken(payload[fieldName], options);
        if (normalized === null) {
            return { hasVersionField: false, field: fieldName, value: null };
        }
        return { hasVersionField: true, field: fieldName, value: normalized };
    }
    return { hasVersionField: false, field: '', value: null };
}

function createResolution({
    artifactType,
    decision,
    reason,
    versionField,
    resolvedVersion,
    currentVersion,
    hasVersionField = false,
}) {
    return Object.freeze({
        artifactType,
        decision,
        reason,
        versionField,
        resolvedVersion,
        currentVersion,
        hasVersionField: hasVersionField === true,
        accepted: decision !== ARTIFACT_VERSION_DECISIONS.REJECT,
        shouldUpgrade: decision === ARTIFACT_VERSION_DECISIONS.UPGRADE,
        shouldFallback: decision === ARTIFACT_VERSION_DECISIONS.FALLBACK,
        shouldReject: decision === ARTIFACT_VERSION_DECISIONS.REJECT,
    });
}

export function resolveArtifactVersionState(payload, options = {}) {
    const artifactType = normalizeText(options.artifactType) || 'artifact';
    const versionFields = Array.isArray(options.versionFields) ? options.versionFields : DEFAULT_VERSION_FIELDS;
    const normalizeOptions = { coerceNumericVersions: options.coerceNumericVersions === true };
    const currentVersion = normalizeVersionToken(options.currentVersion, normalizeOptions);
    const supportedVersions = new Set(normalizeVersionList(options.supportedVersions, normalizeOptions));
    const fallbackVersions = new Set(normalizeVersionList(options.fallbackVersions, normalizeOptions));
    const resolved = resolveVersionField(payload, versionFields, normalizeOptions);

    if (!resolved.hasVersionField) {
        if (options.allowMissingVersion === true) {
            return createResolution({
                artifactType,
                decision: ARTIFACT_VERSION_DECISIONS.FALLBACK,
                reason: 'missing_version',
                versionField: resolved.field,
                resolvedVersion: null,
                currentVersion,
            });
        }
        return createResolution({
            artifactType,
            decision: ARTIFACT_VERSION_DECISIONS.REJECT,
            reason: 'missing_version',
            versionField: resolved.field,
            resolvedVersion: null,
            currentVersion,
        });
    }

    if (supportedVersions.has(resolved.value)) {
        const needsUpgrade = currentVersion !== null && resolved.value !== currentVersion;
        return createResolution({
            artifactType,
            decision: needsUpgrade
                ? ARTIFACT_VERSION_DECISIONS.UPGRADE
                : ARTIFACT_VERSION_DECISIONS.CURRENT,
            reason: needsUpgrade ? 'upgrade_required' : 'current_version',
            versionField: resolved.field,
            resolvedVersion: resolved.value,
            currentVersion,
            hasVersionField: true,
        });
    }

    const fallbackByPredicate = typeof options.shouldFallbackVersion === 'function'
        ? options.shouldFallbackVersion(resolved.value) === true
        : false;
    if (fallbackVersions.has(resolved.value) || fallbackByPredicate) {
        return createResolution({
            artifactType,
            decision: ARTIFACT_VERSION_DECISIONS.FALLBACK,
            reason: 'legacy_version',
            versionField: resolved.field,
            resolvedVersion: resolved.value,
            currentVersion,
            hasVersionField: true,
        });
    }

    if (
        options.rejectUnknownFuture !== false
        && Number.isFinite(currentVersion)
        && Number.isFinite(resolved.value)
        && Number(resolved.value) > Number(currentVersion)
    ) {
        return createResolution({
            artifactType,
            decision: ARTIFACT_VERSION_DECISIONS.REJECT,
            reason: 'future_version',
            versionField: resolved.field,
            resolvedVersion: resolved.value,
            currentVersion,
            hasVersionField: true,
        });
    }

    return createResolution({
        artifactType,
        decision: ARTIFACT_VERSION_DECISIONS.REJECT,
        reason: 'unsupported_version',
        versionField: resolved.field,
        resolvedVersion: resolved.value,
        currentVersion,
        hasVersionField: true,
    });
}

