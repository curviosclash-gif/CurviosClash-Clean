import { CONFIG } from '../Config.js';
import {
    createMenuSettingsDefaults,
    ensureMenuContractState,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import {
    BOT_POLICY_STRATEGIES,
} from '../RuntimeConfig.js';
import { resolveActiveGameMode } from '../../hunt/HuntMode.js';
import { createControlBindingsSnapshot } from '../config/SettingsRuntimeContract.js';
import {
    createDefaultRecordingCaptureSettings,
    normalizeRecordingCaptureSettings,
} from '../../shared/contracts/RecordingCaptureContract.js';
import {
    createDefaultCameraPerspectiveSettings,
    normalizeCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';
import { deepClone } from './SettingsDomainUtils.js';
import {
    classifyOverrideDraftMigration,
    migrateOverrideDraft,
    validateSettingsOverrideDraft,
} from './SettingsOverrideContract.js';
import {
    collectPrimitiveLeafPaths,
    deepMergeKnownShape,
    isPlainObject,
    readPathValue,
    writePathValue,
} from './SettingsOverrideMergeOps.js';
import {
    createSettingsDefaultsRuntimePort,
    readSettingsOverrideDraftFromPort,
    readSettingsOverrideDraftFromRuntime,
} from './SettingsRuntimeLimits.js';
import { resolveElectronRuntimeSnapshot } from '../../platform/electron/ElectronPlatformBridge.js';

export function cloneDefaultControlsSnapshot() {
    const base = deepClone(CONFIG.KEYS);
    return createControlBindingsSnapshot(base, base);
}

export function createDefaultSettingsSnapshot() {
    const defaults = createMenuSettingsDefaults();
    defaults.gameMode = resolveActiveGameMode(defaults.gameMode, CONFIG.HUNT?.ENABLED !== false);
    defaults.botPolicyStrategy = defaults.botPolicyStrategy || BOT_POLICY_STRATEGIES.AUTO;
    defaults.recording = normalizeRecordingCaptureSettings(
        defaults.recording,
        createDefaultRecordingCaptureSettings()
    );
    defaults.cameraPerspective = normalizeCameraPerspectiveSettings(
        defaults.cameraPerspective,
        createDefaultCameraPerspectiveSettings()
    );
    defaults.controls = cloneDefaultControlsSnapshot();
    return ensureMenuContractState(defaults);
}

function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function applySettingsOverrideToDefaults(baseSettings, validatedOverrideDraft) {
    if (!isPlainObject(validatedOverrideDraft) || !isPlainObject(validatedOverrideDraft.baseSettings)) {
        return baseSettings;
    }
    return deepMergeKnownShape(baseSettings, validatedOverrideDraft.baseSettings);
}

export function createDefaultSettingsSnapshotWithOverride(rawOverrideDraft, migrationInfo = null) {
    const base = createDefaultSettingsSnapshot();
    if (!isPlainObject(rawOverrideDraft)) {
        return base;
    }
    const resolvedMigration = migrationInfo || classifyOverrideDraftMigration(rawOverrideDraft);
    const migratedDraft = resolvedMigration.status === 'upgrade'
        ? migrateOverrideDraft(rawOverrideDraft, resolvedMigration)
        : rawOverrideDraft;
    const result = validateSettingsOverrideDraft(migratedDraft);
    if (!result.valid) {
        base.__overrideSkipped = true;
        base.__overrideSkippedReason = result.errors.map((e) => e.code).join(', ');
        base.__overrideDiagnostics = {
            status: 'skipped',
            reason: 'VALIDATION_FAILED',
            errorCodes: result.errors.map((e) => e.code),
            details: result.errors.map((e) => e.message).join('; '),
            migrationCode: resolvedMigration?.code || null,
        };
        return base;
    }
    if (resolvedMigration && resolvedMigration.status !== 'current') {
        base.__overrideDiagnostics = {
            status: 'applied_with_migration',
            migrationCode: resolvedMigration.code,
            migrationReason: resolvedMigration.reason || null,
        };
    }
    return applySettingsOverrideToDefaults(base, result.normalizedDraft);
}

export function createSettingsDefaultsPortForRuntime(runtimeGlobal = globalThis) {
    const electronContract = resolveElectronRuntimeSnapshot(runtimeGlobal).settingsDefaultsContract;
    return createSettingsDefaultsRuntimePort(electronContract || runtimeGlobal);
}

export function createDefaultSettingsSnapshotForRuntime(runtimeGlobal = globalThis) {
    return createDefaultSettingsSnapshotWithOverride(
        readSettingsOverrideDraftFromRuntime(runtimeGlobal)
    );
}

export function createDefaultSettingsSnapshotFromPort(settingsDefaultsPort = null) {
    return createDefaultSettingsSnapshotWithOverride(
        readSettingsOverrideDraftFromPort(settingsDefaultsPort)
    );
}

export function rebaseSettingsSnapshotWithRuntimeDefaults(
    settings,
    runtimeGlobal = globalThis
) {
    const resolvedDefaults = createDefaultSettingsSnapshotForRuntime(runtimeGlobal);
    if (!isPlainObject(settings)) {
        return resolvedDefaults;
    }

    const rebasedSettings = deepClone(settings);
    const codeDefaults = createDefaultSettingsSnapshot();
    const knownPaths = collectPrimitiveLeafPaths(resolvedDefaults);

    for (const path of knownPaths) {
        const currentValue = readPathValue(rebasedSettings, path);
        const codeDefaultValue = readPathValue(codeDefaults, path);
        const resolvedDefaultValue = readPathValue(resolvedDefaults, path);

        if (currentValue === undefined) {
            writePathValue(rebasedSettings, path, deepClone(resolvedDefaultValue));
            continue;
        }
        if (!valuesEqual(currentValue, codeDefaultValue)) {
            continue;
        }
        if (valuesEqual(resolvedDefaultValue, codeDefaultValue)) {
            continue;
        }

        writePathValue(rebasedSettings, path, deepClone(resolvedDefaultValue));
    }

    return rebasedSettings;
}
