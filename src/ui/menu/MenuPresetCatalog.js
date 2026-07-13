import {
    createFixedMenuPresetSeedCatalog,
    MENU_FIXED_PRESET_CREATED_AT,
} from './MenuDefaultsEditorConfig.js';

function freezePreset(preset) {
    return Object.freeze({
        ...preset,
        metadata: Object.freeze({ ...preset.metadata }),
        values: Object.freeze({ ...preset.values }),
    });
}

function createFixedPreset({ id, name, description, lockedFields, values }) {
    return freezePreset({
        id,
        name,
        description,
        metadata: {
            id,
            kind: 'fixed',
            ownerId: 'owner',
            lockedFields: Array.isArray(lockedFields) ? lockedFields.slice() : [],
            sourcePresetId: '',
            createdAt: MENU_FIXED_PRESET_CREATED_AT,
            updatedAt: MENU_FIXED_PRESET_CREATED_AT,
        },
        values: { ...values },
    });
}

const FIXED_PRESET_CATALOG = Object.freeze(
    createFixedMenuPresetSeedCatalog().map((presetSeed) => createFixedPreset(presetSeed))
);

export function getFixedMenuPresetCatalog() {
    return FIXED_PRESET_CATALOG.map((preset) => ({
        ...preset,
        metadata: { ...preset.metadata, lockedFields: preset.metadata.lockedFields.slice() },
        values: { ...preset.values },
    }));
}

export function findFixedMenuPresetById(presetId) {
    const normalizedPresetId = typeof presetId === 'string' ? presetId.trim() : '';
    if (!normalizedPresetId) return null;
    const preset = FIXED_PRESET_CATALOG.find((entry) => entry.id === normalizedPresetId);
    if (!preset) return null;
    return {
        ...preset,
        metadata: { ...preset.metadata, lockedFields: preset.metadata.lockedFields.slice() },
        values: { ...preset.values },
    };
}
