import {
    createMenuConfigSharePayloadDefaults,
    createMenuLocalSettingsDefaults,
} from './MenuDefaultsEditorConfig.js';
import { resolveArtifactVersionState } from '../../shared/contracts/ArtifactVersionMigrationContract.js';
import { createBotHeuristicTuningSnapshot } from '../../shared/contracts/BotHeuristicTuningContract.js';

export const MENU_CONFIG_SHARE_CONTRACT_VERSION = 'menu-config-share.v1';
const INVALID_CONFIG_IMPORT_MESSAGE = 'Import fehlgeschlagen: Daten passen nicht zu Curvios Clash';
const MENU_CONFIG_SHARE_VERSION_FIELDS = Object.freeze(['contractVersion']);
const MENU_CONFIG_SHARE_SUPPORTED_VERSIONS = Object.freeze([MENU_CONFIG_SHARE_CONTRACT_VERSION]);

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function sanitizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function createImportFeedback({
    success,
    reason,
    error = '',
    warnings = [],
    message = '',
    tone = 'info',
    payload = null,
    contractVersion = null,
    usedLegacyFallback = false,
    migration = null,
    appliedValueCount = 0,
}) {
    return {
        success: success === true,
        reason: sanitizeString(reason),
        error: sanitizeString(error),
        warnings: Array.isArray(warnings)
            ? warnings.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
            : [],
        message: success ? sanitizeString(message) : INVALID_CONFIG_IMPORT_MESSAGE,
        tone: sanitizeString(tone, success ? 'success' : 'error'),
        payload,
        contractVersion,
        usedLegacyFallback: usedLegacyFallback === true,
        migration: migration && typeof migration === 'object'
            ? { ...migration }
            : null,
        appliedValueCount: Math.max(0, Number(appliedValueCount) || 0),
    };
}

function createLegacyImportWarning() {
    return `Legacy-Config ohne contractVersion erkannt. Import wurde auf ${MENU_CONFIG_SHARE_CONTRACT_VERSION} normalisiert.`;
}

function createSharePayload(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const defaults = createMenuConfigSharePayloadDefaults();
    const localDefaults = createMenuLocalSettingsDefaults();
    return {
        sessionType: sanitizeString(source?.localSettings?.sessionType, defaults.sessionType),
        modePath: sanitizeString(source?.localSettings?.modePath, defaults.modePath),
        shadowQuality: source?.localSettings?.shadowQuality ?? localDefaults.shadowQuality,
        bloomQuality: source?.localSettings?.bloomQuality ?? localDefaults.bloomQuality,
        startSetup: {
            arcadeGhostDuelMode: sanitizeString(
                source?.localSettings?.startSetup?.arcadeGhostDuelMode,
                localDefaults.startSetup.arcadeGhostDuelMode
            ),
            arcadeGhostTrailCollisionEnabled: typeof source?.localSettings?.startSetup?.arcadeGhostTrailCollisionEnabled === 'boolean'
                ? source.localSettings.startSetup.arcadeGhostTrailCollisionEnabled
                : localDefaults.startSetup.arcadeGhostTrailCollisionEnabled,
        },
        mode: source.mode === '2p' ? '2p' : defaults.mode,
        gameMode: sanitizeString(source.gameMode, defaults.gameMode),
        mapKey: sanitizeString(source.mapKey, defaults.mapKey),
        numBots: Number.isFinite(Number(source.numBots)) ? Number(source.numBots) : defaults.numBots,
        botDifficulty: sanitizeString(source.botDifficulty, defaults.botDifficulty).toUpperCase(),
        botPolicyStrategy: sanitizeString(source.botPolicyStrategy, defaults.botPolicyStrategy).toLowerCase(),
        botHeuristicProfile: ['defensive', 'balanced', 'aggressive'].includes(source.botHeuristicProfile)
            ? source.botHeuristicProfile
            : defaults.botHeuristicProfile,
        botHeuristicTuning: createBotHeuristicTuningSnapshot(source.botHeuristicTuning),
        winsNeeded: Number.isFinite(Number(source.winsNeeded)) ? Number(source.winsNeeded) : defaults.winsNeeded,
        autoRoll: typeof source.autoRoll === 'boolean' ? source.autoRoll : defaults.autoRoll,
        portalsEnabled: typeof source.portalsEnabled === 'boolean' ? source.portalsEnabled : defaults.portalsEnabled,
        vehicles: deepClone(source.vehicles || defaults.vehicles),
        hunt: deepClone(source.hunt || defaults.hunt),
        gameplay: deepClone(source.gameplay || defaults.gameplay),
        recording: deepClone(source.recording || defaults.recording),
        cameraPerspective: deepClone(source.cameraPerspective || defaults.cameraPerspective),
    };
}

export function applyMenuConfigPayload(settings, payload) {
    if (!settings || typeof settings !== 'object' || !payload || typeof payload !== 'object') {
        return false;
    }
    const defaults = createMenuConfigSharePayloadDefaults();
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);

    if (has('mode')) settings.mode = payload.mode === '2p' ? '2p' : defaults.mode;
    if (has('gameMode')) settings.gameMode = sanitizeString(payload.gameMode, settings.gameMode || defaults.gameMode);
    if (has('mapKey')) settings.mapKey = sanitizeString(payload.mapKey, settings.mapKey || defaults.mapKey);
    if (has('numBots')) settings.numBots = Number.isFinite(Number(payload.numBots)) ? Number(payload.numBots) : settings.numBots;
    if (has('botDifficulty')) settings.botDifficulty = sanitizeString(payload.botDifficulty, settings.botDifficulty || defaults.botDifficulty).toUpperCase();
    if (has('botPolicyStrategy')) settings.botPolicyStrategy = sanitizeString(payload.botPolicyStrategy, settings.botPolicyStrategy || defaults.botPolicyStrategy).toLowerCase();
    if (has('botHeuristicProfile')) settings.botHeuristicProfile = ['defensive', 'balanced', 'aggressive'].includes(payload.botHeuristicProfile)
        ? payload.botHeuristicProfile
        : defaults.botHeuristicProfile;
    if (has('botHeuristicTuning')) settings.botHeuristicTuning = createBotHeuristicTuningSnapshot(payload.botHeuristicTuning);
    if (has('winsNeeded')) settings.winsNeeded = Number.isFinite(Number(payload.winsNeeded)) ? Number(payload.winsNeeded) : settings.winsNeeded;
    if (has('autoRoll')) settings.autoRoll = typeof payload.autoRoll === 'boolean' ? payload.autoRoll : defaults.autoRoll;
    if (has('portalsEnabled')) settings.portalsEnabled = typeof payload.portalsEnabled === 'boolean' ? payload.portalsEnabled : defaults.portalsEnabled;
    if (has('vehicles')) settings.vehicles = {
        ...(settings.vehicles && typeof settings.vehicles === 'object' ? settings.vehicles : deepClone(defaults.vehicles)),
        ...(payload.vehicles && typeof payload.vehicles === 'object' ? payload.vehicles : {}),
    };
    if (has('hunt')) settings.hunt = {
        ...(settings.hunt && typeof settings.hunt === 'object' ? settings.hunt : deepClone(defaults.hunt)),
        ...(payload.hunt && typeof payload.hunt === 'object' ? payload.hunt : {}),
    };
    if (has('gameplay')) settings.gameplay = {
        ...(settings.gameplay && typeof settings.gameplay === 'object' ? settings.gameplay : deepClone(defaults.gameplay)),
        ...(payload.gameplay && typeof payload.gameplay === 'object' ? payload.gameplay : {}),
    };
    if (has('recording')) settings.recording = {
        ...(settings.recording && typeof settings.recording === 'object' ? settings.recording : deepClone(defaults.recording || {})),
        ...(payload.recording && typeof payload.recording === 'object' ? payload.recording : {}),
    };
    if (has('cameraPerspective')) settings.cameraPerspective = {
        ...(settings.cameraPerspective && typeof settings.cameraPerspective === 'object' ? settings.cameraPerspective : deepClone(defaults.cameraPerspective || {})),
        ...(payload.cameraPerspective && typeof payload.cameraPerspective === 'object' ? payload.cameraPerspective : {}),
    };
    if (['sessionType', 'modePath', 'shadowQuality', 'bloomQuality', 'startSetup'].some(has)) {
        if (!settings.localSettings || typeof settings.localSettings !== 'object') settings.localSettings = {};
    }
    if (has('sessionType')) settings.localSettings.sessionType = sanitizeString(payload.sessionType, settings.localSettings.sessionType || defaults.sessionType);
    if (has('modePath')) settings.localSettings.modePath = sanitizeString(payload.modePath, settings.localSettings.modePath || defaults.modePath);
    const localDefaults = createMenuLocalSettingsDefaults();
    if (has('shadowQuality')) settings.localSettings.shadowQuality = payload.shadowQuality ?? settings.localSettings.shadowQuality ?? localDefaults.shadowQuality;
    if (has('bloomQuality')) settings.localSettings.bloomQuality = payload.bloomQuality ?? settings.localSettings.bloomQuality ?? localDefaults.bloomQuality;
    if (has('startSetup')) settings.localSettings.startSetup = {
        ...(settings.localSettings.startSetup && typeof settings.localSettings.startSetup === 'object'
            ? settings.localSettings.startSetup
            : deepClone(localDefaults.startSetup)),
        ...(payload.startSetup && typeof payload.startSetup === 'object' ? payload.startSetup : {}),
    };
    return true;
}

export function exportMenuConfigAsJson(settings) {
    return JSON.stringify({
        contractVersion: MENU_CONFIG_SHARE_CONTRACT_VERSION,
        exportedAt: Date.now(),
        payload: createSharePayload(settings),
    }, null, 2);
}

export function exportMenuConfigAsCode(settings) {
    const json = JSON.stringify({
        contractVersion: MENU_CONFIG_SHARE_CONTRACT_VERSION,
        exportedAt: Date.now(),
        payload: createSharePayload(settings),
    });
    try {
        return btoa(unescape(encodeURIComponent(json)));
    } catch {
        return '';
    }
}

export function importMenuConfigFromInput(settings, inputValue) {
    const parseResult = parseMenuConfigImportInput(inputValue);
    if (!parseResult.success) {
        return parseResult;
    }

    const applied = applyMenuConfigPayload(settings, parseResult.payload);
    if (!applied) {
        return createImportFeedback({
            success: false,
            reason: 'apply_failed',
            error: 'Config-Import konnte nicht auf die aktuellen Menü-Einstellungen angewendet werden.',
            message: 'Config-Import konnte nicht übernommen werden.',
        });
    }

    return parseResult;
}

export function parseMenuConfigImportInput(inputValue) {
    const raw = sanitizeString(inputValue);
    if (!raw) {
        return createImportFeedback({
            success: false,
            reason: 'empty_input',
            error: 'Config-Import ist leer.',
            message: 'Kein Config-Export eingefügt.',
        });
    }

    let payload = null;
    try {
        payload = JSON.parse(raw);
    } catch {
        try {
            const decoded = decodeURIComponent(escape(atob(raw)));
            payload = JSON.parse(decoded);
        } catch {
            payload = null;
        }
    }

    if (!payload || typeof payload !== 'object') {
        return createImportFeedback({
            success: false,
            reason: 'invalid_payload',
            error: 'Config-Import enthält weder gültiges JSON noch einen lesbaren Code-Export.',
            message: 'Config-Import konnte nicht gelesen werden.',
        });
    }

    const versionState = resolveArtifactVersionState(payload, {
        artifactType: 'menu-config-share',
        versionFields: MENU_CONFIG_SHARE_VERSION_FIELDS,
        supportedVersions: MENU_CONFIG_SHARE_SUPPORTED_VERSIONS,
        currentVersion: MENU_CONFIG_SHARE_CONTRACT_VERSION,
        allowMissingVersion: true,
    });
    const hasExplicitContractVersion = Object.prototype.hasOwnProperty.call(payload, 'contractVersion');
    if ((versionState.shouldReject || versionState.resolvedVersion === null) && hasExplicitContractVersion) {
        return createImportFeedback({
            success: false,
            reason: 'unsupported_contract_version',
            error: `Config-Import verwendet eine inkompatible contractVersion. Erwartet wird ${MENU_CONFIG_SHARE_CONTRACT_VERSION}.`,
            message: 'Config-Import stammt aus einer nicht unterstützten Version.',
        });
    }

    const sourcePayload = versionState.hasVersionField
        ? payload.payload
        : payload;
    if (!sourcePayload || typeof sourcePayload !== 'object' || Array.isArray(sourcePayload)) {
        return createImportFeedback({
            success: false,
            reason: 'invalid_payload_shape',
            error: 'Config-Import-Hülle ist unvollständig oder veraltet (payload fehlt).',
            message: 'Config-Import enthält keine nutzbaren Einstellungsdaten.',
        });
    }

    // The current envelope needs enough fields to identify a Curvios Clash export.
    // Older unversioned shares only promised map and bot count, so keep that fallback.
    const knownKeys = Object.keys(createSharePayload({}));
    const knownKeySet = new Set(knownKeys);
    if (!knownKeys.some((key) => Object.prototype.hasOwnProperty.call(sourcePayload, key))) {
        return createImportFeedback({
            success: false,
            reason: 'no_known_settings',
            error: 'Config-Import enthält keine bekannten Einstellungsfelder.',
        });
    }
    const requiredFields = versionState.hasVersionField
        ? ['mode', 'gameMode', 'mapKey', 'sessionType']
        : ['mapKey', 'numBots'];
    const hasRequiredFields = requiredFields.every((key) => Object.prototype.hasOwnProperty.call(sourcePayload, key));
    const legacyContainsOnlyKnownFields = versionState.hasVersionField
        || Object.keys(sourcePayload).every((key) => knownKeySet.has(key));
    const validCoreValues = typeof sourcePayload.mapKey === 'string' && sourcePayload.mapKey.trim() !== ''
        && (!Object.prototype.hasOwnProperty.call(sourcePayload, 'numBots')
            || (Number.isInteger(sourcePayload.numBots) && sourcePayload.numBots >= 0));
    const validVersionedValues = !versionState.hasVersionField || (
        ['1p', '2p'].includes(sourcePayload.mode)
        && typeof sourcePayload.gameMode === 'string' && sourcePayload.gameMode.trim() !== ''
        && typeof sourcePayload.sessionType === 'string' && sourcePayload.sessionType.trim() !== ''
        && (!Object.prototype.hasOwnProperty.call(sourcePayload, 'modePath')
            || (typeof sourcePayload.modePath === 'string' && sourcePayload.modePath.trim() !== ''))
    );
    if (!hasRequiredFields || !legacyContainsOnlyKnownFields || !validCoreValues || !validVersionedValues) {
        return createImportFeedback({
            success: false,
            reason: 'invalid_settings_shape',
            error: 'Config-Import enthält keine vollständigen Curvios-Clash-Einstellungsfelder.',
        });
    }

    const appliedValueCount = knownKeys.filter((key) => Object.prototype.hasOwnProperty.call(sourcePayload, key)).length;

    const usedLegacyFallback = !versionState.hasVersionField;
    const warnings = usedLegacyFallback ? [createLegacyImportWarning()] : [];
    const migration = usedLegacyFallback
        ? {
            applied: true,
            type: 'legacy-envelope-fallback',
            targetContractVersion: MENU_CONFIG_SHARE_CONTRACT_VERSION,
        }
        : null;
    return createImportFeedback({
        success: true,
        reason: 'imported',
        payload: sourcePayload,
        contractVersion: versionState.hasVersionField ? MENU_CONFIG_SHARE_CONTRACT_VERSION : null,
        usedLegacyFallback,
        warnings,
        appliedValueCount,
        message: usedLegacyFallback
            ? `Legacy-Config importiert: ${appliedValueCount} Werte übernommen und auf den aktuellen Vertragsstand normalisiert.`
            : `Config importiert: ${appliedValueCount} Werte übernommen.`,
        tone: usedLegacyFallback ? 'warning' : 'success',
        migration,
    });
}
