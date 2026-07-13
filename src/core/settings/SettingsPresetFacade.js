import {
    applyPresetToSettings,
    capturePresetValuesFromSettings,
    createPresetMetadata,
    ensureMenuContractState,
    resolveMenuAccessContext,
    SETTINGS_CHANGE_KEYS,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import { normalizePresetId } from './SettingsDomainUtils.js';
import { createSettingsMutationFailure } from './SettingsMutationResult.js';

function mergeChangedKeys(...groups) {
    return Array.from(new Set(groups.flatMap((group) => (
        Array.isArray(group) ? group : []
    ))));
}

export function createSettingsPresetFacade(options = {}) {
    const menuPresetStore = options.menuPresetStore;
    const applyMenuCompatibilityRules = typeof options.applyMenuCompatibilityRules === 'function'
        ? options.applyMenuCompatibilityRules
        : () => ({ changedKeys: [] });

    function listMenuPresets() {
        return menuPresetStore.listPresets();
    }

    function applyMenuPreset(settings, presetId, accessContext = null) {
        const normalizedPresetId = String(presetId || '').trim();
        if (!normalizedPresetId) {
            return createSettingsMutationFailure('invalid_preset_id');
        }
        const preset = menuPresetStore.getPresetById(normalizedPresetId);
        if (!preset) {
            return createSettingsMutationFailure('preset_not_found');
        }

        ensureMenuContractState(settings);
        const resolvedContext = accessContext && typeof accessContext === 'object'
            ? accessContext
            : resolveMenuAccessContext(settings);
        const result = applyPresetToSettings({
            settings,
            preset,
            accessContext: resolvedContext,
            allowOpenPresetEditing: settings?.menuFeatureFlags?.allowOpenPresetEditing !== false,
        });
        const compatibilityResult = applyMenuCompatibilityRules(settings, {
            accessContext: resolvedContext,
            changedKeys: Array.isArray(result.changedKeys) ? result.changedKeys : [],
        });
        ensureMenuContractState(settings);
        const success = result.reason !== 'invalid_payload';
        const changedKeys = success
            ? mergeChangedKeys(
                result.changedKeys,
                compatibilityResult.changedKeys,
                [
                    SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID,
                    SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND,
                    SETTINGS_CHANGE_KEYS.PRESET_STATUS,
                ]
            )
            : [];

        return {
            ...result,
            success,
            preset,
            changedKeys,
            compatibilityResult,
            metadata: success
                ? {
                    presetId: preset.id,
                    presetKind: preset?.metadata?.kind || '',
                }
                : null,
        };
    }

    function saveMenuPreset(settings, optionsPayload = {}, accessContext = null) {
        ensureMenuContractState(settings);
        const resolvedContext = accessContext && typeof accessContext === 'object'
            ? accessContext
            : resolveMenuAccessContext(settings);
        const kind = optionsPayload.kind === 'fixed' ? 'fixed' : 'open';
        if (kind === 'fixed' && !resolvedContext.isOwner) {
            return createSettingsMutationFailure('owner_required');
        }

        const requestedName = String(optionsPayload.name || '').trim();
        const requestedId = String(optionsPayload.id || '').trim();
        const derivedId = normalizePresetId(requestedId || requestedName || `preset-${Date.now()}`);
        if (!derivedId) {
            return createSettingsMutationFailure('invalid_preset_id');
        }

        const metadata = createPresetMetadata({
            id: derivedId,
            kind,
            ownerId: resolvedContext.ownerId || 'owner',
            lockedFields: Array.isArray(optionsPayload.lockedFields) ? optionsPayload.lockedFields : [],
            sourcePresetId: optionsPayload.sourcePresetId || settings?.matchSettings?.activePresetId || '',
            createdAt: optionsPayload.createdAt,
            updatedAt: optionsPayload.updatedAt,
            timestamp: optionsPayload.timestamp,
        });
        const preset = {
            id: metadata.id,
            name: requestedName || metadata.id,
            description: String(optionsPayload.description || '').trim(),
            metadata,
            values: capturePresetValuesFromSettings(settings),
        };
        const result = menuPresetStore.upsertPreset(preset, resolvedContext);
        return {
            ...result,
            changedKeys: result.success
                ? [
                    SETTINGS_CHANGE_KEYS.PRESET_LIST,
                    SETTINGS_CHANGE_KEYS.PRESET_STATUS,
                ]
                : [],
            metadata: result.success
                ? {
                    presetId: result.preset?.id || metadata.id,
                    presetKind: kind,
                }
                : null,
        };
    }

    function deleteMenuPreset(presetId, settings, accessContext = null) {
        ensureMenuContractState(settings);
        const resolvedContext = accessContext && typeof accessContext === 'object'
            ? accessContext
            : resolveMenuAccessContext(settings);
        const result = menuPresetStore.deletePreset(presetId, resolvedContext);
        return {
            ...result,
            changedKeys: result.success
                ? [
                    SETTINGS_CHANGE_KEYS.PRESET_LIST,
                    SETTINGS_CHANGE_KEYS.PRESET_STATUS,
                ]
                : [],
            metadata: result.success
                ? {
                    presetId: result.preset?.id || String(presetId || '').trim(),
                    presetKind: result.preset?.metadata?.kind || '',
                }
                : null,
        };
    }

    return {
        listMenuPresets,
        applyMenuPreset,
        saveMenuPreset,
        deleteMenuPreset,
    };
}
