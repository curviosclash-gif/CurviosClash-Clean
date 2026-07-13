import {
    applyMenuConfigPayload,
    parseMenuConfigImportInput,
} from '../../composition/core-ui/CoreUiMenuPorts.js';
import { diffSettingsSnapshots } from './SettingsDiffOps.js';

function deepClone(value) {
    return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {}));
}

function normalizeWarnings(warnings) {
    return Array.isArray(warnings)
        ? warnings.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
        : [];
}

export function previewMenuConfigImport({
    settings,
    inputValue,
    accessContext = null,
    sanitizeSettings,
    applyMenuCompatibilityRules,
    diffSettings = diffSettingsSnapshots,
} = {}) {
    const sanitize = typeof sanitizeSettings === 'function'
        ? sanitizeSettings
        : (snapshot) => snapshot;
    const before = sanitize(deepClone(settings));
    const previewSnapshot = deepClone(before);
    const importResult = parseMenuConfigImportInput(inputValue);

    if (!importResult.success) {
        return {
            success: false,
            reason: String(importResult.reason || 'import_failed'),
            message: String(importResult.message || ''),
            tone: String(importResult.tone || 'error'),
            changedKeys: [],
            changes: [],
            warnings: normalizeWarnings(importResult.warnings),
            blockedPaths: [],
            usedLegacyFallback: importResult.usedLegacyFallback === true,
        };
    }

    if (!applyMenuConfigPayload(previewSnapshot, importResult.payload)) {
        return {
            success: false,
            reason: 'apply_failed',
            message: 'Config-Import konnte nicht uebernommen werden.',
            tone: 'error',
            changedKeys: [],
            changes: [],
            warnings: normalizeWarnings(importResult.warnings),
            blockedPaths: [],
            usedLegacyFallback: importResult.usedLegacyFallback === true,
        };
    }
    const compatibilityResult = typeof applyMenuCompatibilityRules === 'function'
        ? applyMenuCompatibilityRules(previewSnapshot, {
            accessContext,
        })
        : null;
    const after = sanitize(previewSnapshot);
    const diffResult = diffSettings(before, after);
    const changedKeys = Array.from(new Set([
        ...diffResult.changedKeys,
        ...(
            Array.isArray(compatibilityResult?.changedKeys)
                ? compatibilityResult.changedKeys
                : []
        ),
    ].filter((key) => typeof key === 'string' && key.trim())));

    return {
        success: true,
        reason: String(importResult.reason || 'imported'),
        message: String(importResult.message || ''),
        tone: String(importResult.tone || 'success'),
        changedKeys,
        changes: diffResult.changes,
        warnings: normalizeWarnings(importResult.warnings),
        blockedPaths: [],
        usedLegacyFallback: importResult.usedLegacyFallback === true,
    };
}
