// ============================================
// FreshProfileSettingsOps.js - the values a profile without stored settings starts with
// ============================================

// Each game style has one fixed preset that tunes it (the style buttons and the options
// reset use the same pairing).
export const MODE_PATH_TO_PRESET_ID = Object.freeze({
    arcade: 'arcade',
    fight: 'fight-standard',
    normal: 'normal-standard',
});

/**
 * A fresh profile plays its style with the style preset on top of the defaults - the same
 * values the options reset hands back. Bot difficulty stays the player's preference.
 * @param {object} settings defaults snapshot, changed in place
 * @param {(settings: object, presetId: string) => {success?: boolean}} applyMenuPreset
 */
export function seedFreshProfileStylePreset(settings, applyMenuPreset) {
    const modePath = String(settings?.localSettings?.modePath || '').trim().toLowerCase();
    const presetId = MODE_PATH_TO_PRESET_ID[modePath];
    if (!presetId || typeof applyMenuPreset !== 'function') return settings;
    const botDifficulty = settings.botDifficulty;
    const result = applyMenuPreset(settings, presetId);
    if (result?.success === true) {
        settings.botDifficulty = botDifficulty;
        settings.localSettings.seededModePaths = [modePath];
    }
    return settings;
}
