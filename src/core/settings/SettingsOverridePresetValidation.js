import { deepCloneJson, isPlainObject } from './SettingsOverrideMergeOps.js';

const createError = (path, code, message) => ({ path, code, message });
const PRESET_TURN_PATH = 'gameplay.turnSensitivity';
const PRESET_PITCH_PATH = 'gameplay.pitchSensitivity';

/**
 * Presets saved before Pitch had its own value steered both axes with Yaw; they keep doing so,
 * value and lock alike, instead of locking Yaw and leaving Pitch at the player's old value.
 * @param {unknown} presets
 */
export function normalizeOverrideFixedPresets(presets) {
    if (!Array.isArray(presets)) return presets;
    return presets.map((preset) => {
        const next = deepCloneJson(preset);
        if (!isPlainObject(next)) return next;
        // Only a preset without its own Pitch value is from before; a current one keeps its choice.
        if (!isPlainObject(next.values) || next.values[PRESET_PITCH_PATH] != null || next.values[PRESET_TURN_PATH] == null) return next;
        next.values[PRESET_PITCH_PATH] = next.values[PRESET_TURN_PATH];
        if (Array.isArray(next.lockedFields) && next.lockedFields.includes(PRESET_TURN_PATH) && !next.lockedFields.includes(PRESET_PITCH_PATH)) {
            next.lockedFields.push(PRESET_PITCH_PATH);
        }
        return next;
    });
}

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
