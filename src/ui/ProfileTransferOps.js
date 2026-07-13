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
    return `Legacy-Profil ohne contractVersion erkannt. Import wurde auf ${PROFILE_EXPORT_CONTRACT_VERSION} normalisiert.`;
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
            error: 'Kein Profil-Import vorhanden',
            message: 'Kein Profil-Import eingefuegt.',
        });
    }

    let parsed;
    try {
        parsed = JSON.parse(rawInput);
    } catch {
        return createProfileTransferFeedback({
            success: false,
            reason: 'invalid_json',
            error: 'Profil-Import ist kein gueltiges JSON',
            message: 'Profil-Import konnte nicht gelesen werden.',
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
            error: 'Profil-Import verwendet ungueltige contractVersion "unbekannt"',
            message: 'Profil-Import stammt aus einer nicht unterstuetzten Version.',
        });
    }
    if (versionState.shouldReject) {
        const receivedVersion = versionState.resolvedVersion === null
            ? 'unbekannt'
            : String(versionState.resolvedVersion);
        return createProfileTransferFeedback({
            success: false,
            reason: 'unsupported_contract_version',
            error: `Profil-Import verwendet ungueltige contractVersion "${receivedVersion}"`,
            message: 'Profil-Import stammt aus einer nicht unterstuetzten Version.',
        });
    }
    if (
        versionState.hasVersionField
        && (!parsed?.profile || typeof parsed.profile !== 'object' || Array.isArray(parsed.profile))
    ) {
        return createProfileTransferFeedback({
            success: false,
            reason: 'invalid_payload_shape',
            error: 'Profil-Import-Huelle ist unvollstaendig (profile fehlt)',
            message: 'Profil-Import enthaelt keine nutzbaren Profildaten.',
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
            error: 'Profilname fehlt im Import',
            message: 'Profil-Import enthaelt keinen gueltigen Namen.',
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
            ? 'Legacy-Profil importiert und auf den aktuellen Vertragsstand normalisiert.'
            : 'Profil importiert.',
        tone: usedLegacyFallback ? 'warning' : 'success',
        migration,
    });
}
