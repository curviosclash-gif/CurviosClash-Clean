import { findFixedMenuPresetById, getFixedMenuPresetCatalog } from './MenuPresetCatalog.js';
import { createPresetMetadata } from './MenuPresetApplyOps.js';
import {
    LEGACY_STORAGE_KEYS,
    STORAGE_KEYS,
} from '../StorageKeys.js';
import { PersistentStore } from '../base/PersistentStore.js';
import { resolveStorePlatformOptions, loadVersionedRecord } from '../base/PersistentStoreLoadUtils.js';

const MENU_PRESET_STORAGE_KEY = STORAGE_KEYS.menuPresets;
const MENU_PRESET_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.menuPresets;
const MENU_PRESET_STORAGE_SCHEMA_VERSION = 'menu-preset-store.v1';

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function clonePreset(preset) {
    if (!preset || typeof preset !== 'object') return null;
    return {
        id: normalizeString(preset.id),
        name: normalizeString(preset.name),
        description: normalizeString(preset.description),
        metadata: {
            id: normalizeString(preset?.metadata?.id || preset.id),
            kind: normalizeString(preset?.metadata?.kind, 'open'),
            ownerId: normalizeString(preset?.metadata?.ownerId, 'owner'),
            lockedFields: Array.isArray(preset?.metadata?.lockedFields) ? preset.metadata.lockedFields.slice() : [],
            sourcePresetId: normalizeString(preset?.metadata?.sourcePresetId),
            createdAt: normalizeString(preset?.metadata?.createdAt),
            updatedAt: normalizeString(preset?.metadata?.updatedAt),
        },
        values: preset.values && typeof preset.values === 'object'
            ? { ...preset.values }
            : {},
    };
}

function ensurePresetMetadataContract(preset, options = {}) {
    const clonedPreset = clonePreset(preset);
    if (!clonedPreset) return null;
    const metadata = createPresetMetadata({
        id: clonedPreset.metadata.id || clonedPreset.id,
        kind: clonedPreset.metadata.kind,
        ownerId: clonedPreset.metadata.ownerId || options.ownerId || 'owner',
        lockedFields: clonedPreset.metadata.lockedFields,
        sourcePresetId: clonedPreset.metadata.sourcePresetId,
        createdAt: clonedPreset.metadata.createdAt,
        updatedAt: clonedPreset.metadata.updatedAt,
        timestamp: options.timestamp,
    });
    clonedPreset.id = metadata.id;
    clonedPreset.metadata = metadata;
    if (!clonedPreset.name) clonedPreset.name = metadata.id;
    return clonedPreset;
}

function sortPresets(left, right) {
    if (left.metadata.kind !== right.metadata.kind) {
        return left.metadata.kind === 'fixed' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
}

export class MenuPresetStore extends PersistentStore {
    constructor(options = {}) {
        super({
            ...options,
            ...resolveStorePlatformOptions(options, MENU_PRESET_STORAGE_KEY, MENU_PRESET_STORAGE_LEGACY_KEYS),
        });
        this.fixedCatalog = Array.isArray(options.fixedCatalog) && options.fixedCatalog.length > 0
            ? options.fixedCatalog.map((preset) => ensurePresetMetadataContract(preset))
            : getFixedMenuPresetCatalog().map((preset) => ensurePresetMetadataContract(preset));
        this.fixedCatalogById = new Map();
        this.fixedCatalog.forEach((preset) => {
            if (!preset) return;
            this.fixedCatalogById.set(preset.id, preset);
        });
    }

    _loadPersistedPresets() {
        return loadVersionedRecord(
            () => this.readJsonRecord(null),
            {
                artifactType: 'menu-preset-store',
                schemaVersion: MENU_PRESET_STORAGE_SCHEMA_VERSION,
                createDefault: () => [],
                transform: (parsed, versionState) => {
                    const rawPresets = versionState.hasVersionField
                        ? parsed?.presets
                        : (Array.isArray(parsed) ? parsed : parsed?.presets);
                    const presets = Array.isArray(rawPresets) ? rawPresets : [];
                    return presets.map((preset) => ensurePresetMetadataContract(preset)).filter(Boolean);
                },
                onUpgrade: (normalized) => this._savePersistedPresets(normalized),
            }
        );
    }

    _savePersistedPresets(presets) {
        return this.writeJsonRecord({
            schemaVersion: MENU_PRESET_STORAGE_SCHEMA_VERSION,
            presets,
        }).ok;
    }

    listPresets() {
        const persistedPresets = this._loadPersistedPresets();
        const merged = new Map();

        this.fixedCatalog.forEach((preset) => {
            if (!preset) return;
            merged.set(preset.id, clonePreset(preset));
        });
        persistedPresets.forEach((preset) => {
            if (!preset) return;
            merged.set(preset.id, clonePreset(preset));
        });

        return Array.from(merged.values())
            .filter(Boolean)
            .sort(sortPresets);
    }

    getPresetById(presetId) {
        const normalizedPresetId = normalizeString(presetId);
        if (!normalizedPresetId) return null;

        const fixedPreset = findFixedMenuPresetById(normalizedPresetId);
        if (fixedPreset) {
            return ensurePresetMetadataContract(fixedPreset);
        }
        const presets = this.listPresets();
        return presets.find((preset) => preset.id === normalizedPresetId) || null;
    }

    upsertPreset(preset, accessContext = null) {
        const normalizedPreset = ensurePresetMetadataContract(preset, { ownerId: accessContext?.ownerId || 'owner' });
        if (!normalizedPreset) {
            return { success: false, reason: 'invalid_preset' };
        }

        const isOwner = accessContext?.isOwner !== false;
        if (normalizedPreset.metadata.kind === 'fixed' && !isOwner) {
            return { success: false, reason: 'owner_required' };
        }

        const fixedCatalogPreset = this.fixedCatalogById.get(normalizedPreset.id);
        if (fixedCatalogPreset && normalizedPreset.metadata.kind !== 'fixed') {
            return { success: false, reason: 'fixed_catalog_conflict' };
        }

        const persisted = this._loadPersistedPresets();
        const next = [];
        let replaced = false;

        for (const entry of persisted) {
            if (entry.id !== normalizedPreset.id) {
                next.push(entry);
                continue;
            }
            replaced = true;
        }
        next.push(normalizedPreset);
        next.sort(sortPresets);

        const stored = this._savePersistedPresets(next);
        return {
            success: stored,
            reason: stored ? (replaced ? 'updated' : 'created') : 'storage_failed',
            preset: normalizedPreset,
        };
    }

    deletePreset(presetId, accessContext = null) {
        const normalizedPresetId = normalizeString(presetId);
        if (!normalizedPresetId) return { success: false, reason: 'invalid_preset_id' };
        if (this.fixedCatalogById.has(normalizedPresetId)) {
            return { success: false, reason: 'catalog_fixed_locked' };
        }

        const persisted = this._loadPersistedPresets();
        const current = persisted.find((preset) => preset.id === normalizedPresetId);
        if (!current) return { success: false, reason: 'preset_not_found' };

        const isOwner = accessContext?.isOwner !== false;
        if (current.metadata.kind === 'fixed' && !isOwner) {
            return { success: false, reason: 'owner_required' };
        }

        const next = persisted.filter((preset) => preset.id !== normalizedPresetId);
        const stored = this._savePersistedPresets(next);
        return {
            success: stored,
            reason: stored ? 'deleted' : 'storage_failed',
            preset: current,
        };
    }
}
