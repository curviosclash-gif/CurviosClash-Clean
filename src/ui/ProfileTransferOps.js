import { resolveArtifactVersionState } from '../shared/contracts/ArtifactVersionMigrationContract.js';

function requireCallback(fn, name) {
    if (typeof fn !== 'function') {
        throw new TypeError(`${name} callback is required`);
    }
    return fn;
}

function cloneSettingsPayload(settings) {
    return JSON.parse(JSON.stringify(settings || {}));
}

function sanitizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeWarnings(warnings) {
    if (!Array.isArray(warnings)) return [];
    return warnings
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => entry.trim());
}

function createProfileTransferFeedback({
    success,
    reason,
    error = '',
    warnings = [],
    message = '',
    tone = 'info',
    profile = null,
    contractVersion = null,
    usedLegacyFallback = false,
    migration = null,
}) {
    return {
        success: success === true,
        reason: sanitizeString(reason),
        error: sanitizeString(error),
        warnings: normalizeWarnings(warnings),
        message: sanitizeString(message),
        tone: sanitizeString(tone, success ? 'success' : 'error'),
        profile,
        contractVersion: sanitizeString(contractVersion) || null,
        usedLegacyFallback: usedLegacyFallback === true,
        migration: migration && typeof migration === 'object'
            ? { ...migration }
            : null,
    };
}

function createLegacyImportWarning() {
    return `Ältere Einstellungen ohne Versionsangabe erkannt. Der Import wurde auf ${PROFILE_EXPORT_CONTRACT_VERSION} angepasst.`;
}

export const PROFILE_EXPORT_CONTRACT_VERSION = 'profile-export.v1';
const PROFILE_IMPORT_VERSION_FIELDS = Object.freeze(['contractVersion']);
const PROFILE_IMPORT_SUPPORTED_VERSIONS = Object.freeze([PROFILE_EXPORT_CONTRACT_VERSION]);

export function exportProfileAsJson(profile) {
    if (!profile || typeof profile !== 'object') {
        throw new TypeError('profile is required');
    }

    return JSON.stringify({
        contractVersion: PROFILE_EXPORT_CONTRACT_VERSION,
        exportedAt: Date.now(),
        profile: {
            name: String(profile.name || '').trim(),
            updatedAt: Number(profile.updatedAt || Date.now()),
            isDefault: Boolean(profile.isDefault),
            settings: cloneSettingsPayload(profile.settings),
        },
    }, null, 2);
}

export function parseProfileImport(inputValue, options = {}) {
    const normalizeProfileName = requireCallback(options.normalizeProfileName, 'normalizeProfileName');
    const rawInput = String(inputValue || '').trim();
    if (!rawInput) {
        return createProfileTransferFeedback({
            success: false,
            reason: 'empty_input',
            error: 'Kein Text zum Importieren vorhanden',
            message: 'Nichts zum Importieren eingefügt.',
        });
    }

    let parsed;
    try {
        parsed = JSON.parse(rawInput);
    } catch {
        return createProfileTransferFeedback({
            success: false,
            reason: 'invalid_json',
            error: 'Der Import ist kein gültiges JSON',
            message: 'Der Import konnte nicht gelesen werden.',
        });
    }

    const versionState = resolveArtifactVersionState(parsed, {
        artifactType: 'profile-import',
        versionFields: PROFILE_IMPORT_VERSION_FIELDS,
        supportedVersions: PROFILE_IMPORT_SUPPORTED_VERSIONS,
        currentVersion: PROFILE_EXPORT_CONTRACT_VERSION,
        allowMissingVersion: true,
    });
    const hasExplicitContractVersion = !!parsed
        && typeof parsed === 'object'
        && Object.prototype.hasOwnProperty.call(parsed, 'contractVersion');
    if (hasExplicitContractVersion && versionState.resolvedVersion === null) {
        return createProfileTransferFeedback({
            success: false,
            reason: 'unsupported_contract_version',
            error: 'Der Import nutzt eine unbekannte Version',
            message: 'Der Import stammt aus einer nicht unterstützten Version.',
        });
    }
    if (versionState.shouldReject) {
        const receivedVersion = versionState.resolvedVersion === null
            ? 'unbekannt'
            : String(versionState.resolvedVersion);
        return createProfileTransferFeedback({
            success: false,
            reason: 'unsupported_contract_version',
            error: `Der Import nutzt die unbekannte Version "${receivedVersion}"`,
            message: 'Der Import stammt aus einer nicht unterstützten Version.',
        });
    }
    if (
        versionState.hasVersionField
        && (!parsed?.profile || typeof parsed.profile !== 'object' || Array.isArray(parsed.profile))
    ) {
        return createProfileTransferFeedback({
            success: false,
            reason: 'invalid_payload_shape',
            error: 'Der Import ist unvollständig (Einstellungen fehlen)',
            message: 'Der Import enthält keine nutzbaren Einstellungen.',
        });
    }

    const candidate = parsed?.profile && typeof parsed.profile === 'object'
        ? parsed.profile
        : parsed;
    const name = normalizeProfileName(candidate?.name || '');
    if (!name) {
        return createProfileTransferFeedback({
            success: false,
            reason: 'missing_profile_name',
            error: 'Im Import fehlt der Name',
            message: 'Der Import enthält keinen gültigen Namen.',
        });
    }

    const usedLegacyFallback = !versionState.hasVersionField;
    const warnings = usedLegacyFallback ? [createLegacyImportWarning()] : [];
    const migration = usedLegacyFallback
        ? {
            applied: true,
            type: 'legacy-envelope-fallback',
            targetContractVersion: PROFILE_EXPORT_CONTRACT_VERSION,
        }
        : null;

    return createProfileTransferFeedback({
        success: true,
        reason: 'imported',
        profile: {
            name,
            updatedAt: Number(candidate?.updatedAt || Date.now()),
            isDefault: Boolean(candidate?.isDefault),
            settings: cloneSettingsPayload(candidate?.settings),
        },
        contractVersion: versionState.hasVersionField ? PROFILE_EXPORT_CONTRACT_VERSION : null,
        usedLegacyFallback,
        warnings,
        message: usedLegacyFallback
            ? 'Ältere Einstellungen importiert und auf den aktuellen Stand gebracht.'
            : 'Einstellungen importiert.',
        tone: usedLegacyFallback ? 'warning' : 'success',
        migration,
    });
}
