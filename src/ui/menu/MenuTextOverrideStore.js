import {
    LEGACY_STORAGE_KEYS,
    STORAGE_KEYS,
} from '../StorageKeys.js';
import { PersistentStore } from '../base/PersistentStore.js';
import { resolveStorePlatformOptions, loadVersionedRecord } from '../base/PersistentStoreLoadUtils.js';

const MENU_TEXT_OVERRIDE_STORAGE_KEY = STORAGE_KEYS.menuTextOverrides;
const MENU_TEXT_OVERRIDE_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.menuTextOverrides;
const MENU_TEXT_OVERRIDE_STORAGE_SCHEMA_VERSION = 'menu-text-overrides.v1';

function sanitizeTextId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized;
}

function sanitizeTextValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeOverrides(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const normalized = {};
    Object.entries(source).forEach(([textId, value]) => {
        const sanitizedId = sanitizeTextId(textId);
        const sanitizedValue = sanitizeTextValue(value);
        if (!sanitizedId || !sanitizedValue) return;
        normalized[sanitizedId] = sanitizedValue;
    });
    return normalized;
}

export class MenuTextOverrideStore extends PersistentStore {
    constructor(options = {}) {
        super({
            ...options,
            ...resolveStorePlatformOptions(options, MENU_TEXT_OVERRIDE_STORAGE_KEY, MENU_TEXT_OVERRIDE_STORAGE_LEGACY_KEYS),
        });
    }

    _loadRaw() {
        return loadVersionedRecord(
            () => this.readJsonRecord(null),
            {
                artifactType: 'menu-text-overrides',
                schemaVersion: MENU_TEXT_OVERRIDE_STORAGE_SCHEMA_VERSION,
                createDefault: () => ({}),
                transform: (parsed, versionState) => {
                    const rawOverrides = versionState.hasVersionField
                        ? parsed?.overrides
                        : (
                            parsed?.overrides
                            && typeof parsed.overrides === 'object'
                            && !Array.isArray(parsed.overrides)
                                ? parsed.overrides
                                : parsed
                        );
                    return normalizeOverrides(rawOverrides);
                },
                onUpgrade: (normalized) => this._saveRaw(normalized),
            }
        );
    }

    _saveRaw(rawOverrides) {
        return this.writeJsonRecord({
            schemaVersion: MENU_TEXT_OVERRIDE_STORAGE_SCHEMA_VERSION,
            overrides: normalizeOverrides(rawOverrides),
        }).ok;
    }

    listOverrides() {
        return this._loadRaw();
    }

    getOverride(textId) {
        const normalizedTextId = sanitizeTextId(textId);
        if (!normalizedTextId) return '';
        const overrides = this._loadRaw();
        return sanitizeTextValue(overrides[normalizedTextId]);
    }

    setOverride(textId, textValue) {
        const normalizedTextId = sanitizeTextId(textId);
        const normalizedTextValue = sanitizeTextValue(textValue);
        if (!normalizedTextId) return { success: false, reason: 'invalid_text_id' };

        const overrides = this._loadRaw();
        if (!normalizedTextValue) {
            delete overrides[normalizedTextId];
        } else {
            overrides[normalizedTextId] = normalizedTextValue;
        }

        const stored = this._saveRaw(overrides);
        return {
            success: stored,
            reason: stored ? 'updated' : 'storage_failed',
            textId: normalizedTextId,
            value: normalizedTextValue,
        };
    }

    clearOverride(textId) {
        return this.setOverride(textId, '');
    }
}
