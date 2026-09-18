/**
 * Switches the planar flight style. Planar maps need portals to change level, so turning it
 * on enables them; turning it off hands back whether the player had portals on before,
 * instead of leaving free flight with portals nobody asked for. The portal count belongs to
 * the map (planar flight raises an empty count at runtime).
 *
 * @param {object} settings Menu settings, mutated in place.
 * @param {boolean} enabled Planar flight on or off.
 * @param {object} keys SETTINGS_CHANGE_KEYS.
 * @param {{ portalsBeforePlanar?: { enabled: boolean }|null }} memory
 *   Per-menu scratch that survives between two calls.
 * @returns {{ changedKeys: string[] }}
 */
export function applyMenuPlanarMode(settings, enabled, keys, memory) {
    if (!settings.gameplay) settings.gameplay = {};
    const wasPlanar = settings.gameplay.planarMode === true;
    settings.gameplay.planarMode = !!enabled;
    const changedKeys = [keys.GAMEPLAY_PLANAR_MODE];

    if (settings.gameplay.planarMode) {
        if (!wasPlanar && !memory.portalsBeforePlanar) {
            memory.portalsBeforePlanar = { enabled: settings.portalsEnabled === true };
        }
        if (settings.portalsEnabled !== true) {
            settings.portalsEnabled = true;
            changedKeys.push(keys.RULES_PORTALS_ENABLED);
        }
        return { changedKeys };
    }

    const before = memory.portalsBeforePlanar;
    memory.portalsBeforePlanar = null;
    if (!before) return { changedKeys };
    if (settings.portalsEnabled !== before.enabled) {
        settings.portalsEnabled = before.enabled;
        changedKeys.push(keys.RULES_PORTALS_ENABLED);
    }
    return { changedKeys };
}
