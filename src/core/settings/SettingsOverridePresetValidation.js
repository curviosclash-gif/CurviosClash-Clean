import { isPlainObject } from './SettingsOverrideMergeOps.js';

const createError = (path, code, message) => ({ path, code, message });

export function validateOverridePresets(presets, registry) {
    const errors = [];
    const presetIds = new Set();
    for (const [index, preset] of presets.entries()) {
        const path = `fixedPresets.${index}`;
        if (!isPlainObject(preset) || typeof preset.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(preset.id)
            || presetIds.has(preset.id) || typeof preset.name !== 'string' || !preset.name.trim() || !isPlainObject(preset.values)
            || !Array.isArray(preset.lockedFields)) {
            errors.push(createError(path, 'FIELD_PRESETS_INVALID', 'Preset benötigt eine eindeutige Kennung, einen Namen, Spielwerte und eine Sperrliste.'));
            continue;
        }
        presetIds.add(preset.id);
        for (const [key, value] of Object.entries(preset.values)) {
            const fieldPath = key.startsWith('localSettings.') ? key : `baseSettings.${key}`;
            const field = registry.get(fieldPath);
            const valuePath = `${path}.values.${key}`;
            if (!field || !['number', 'string', 'boolean'].includes(field.type)) {
                errors.push(createError(valuePath, 'FIELD_PATH_UNKNOWN', 'Unbekannter Preset-Spielwert.'));
                continue;
            }
            const limits = field.limits;
            if (typeof value !== field.type || (field.options.length && !field.options.includes(value))) {
                errors.push(createError(valuePath, 'FIELD_ENUM_INVALID', 'Ungültiger Preset-Wert.'));
            } else if (field.type === 'number' && (!Number.isFinite(value) || (limits && (value < limits.min || value > limits.max || (limits.integer && !Number.isInteger(value)))))) {
                errors.push(createError(valuePath, 'FIELD_NUMBER_INVALID', 'Preset-Zahl liegt außerhalb des erlaubten Wertebereichs.'));
            }
        }
        for (const key of preset.lockedFields) {
            if (typeof key !== 'string' || !registry.has(key.startsWith('localSettings.') ? key : `baseSettings.${key}`)) errors.push(createError(`${path}.lockedFields`, 'FIELD_PATH_UNKNOWN', 'Unbekanntes gesperrtes Preset-Feld.'));
        }
    }

    return errors;
}
