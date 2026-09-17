const PLANAR_DEFAULT_PORTAL_COUNT = 4;

/**
 * Switches the planar flight style. Planar maps need portals to change level, so turning it
 * on enables them; turning it off hands back whatever portal setup the player had before,
 * instead of leaving free flight with portals nobody asked for.
 *
 * @param {object} settings Menu settings, mutated in place.
 * @param {boolean} enabled Planar flight on or off.
 * @param {object} keys SETTINGS_CHANGE_KEYS.
 * @param {{ portalsBeforePlanar?: { enabled: boolean, count: number }|null }} memory
 *   Per-menu scratch that survives between two calls.
 * @returns {{ changedKeys: string[], portalCountRaised: boolean }}
 */
export function applyMenuPlanarMode(settings, enabled, keys, memory) {
    if (!settings.gameplay) settings.gameplay = {};
    const wasPlanar = settings.gameplay.planarMode === true;
    settings.gameplay.planarMode = !!enabled;
    const changedKeys = [keys.GAMEPLAY_PLANAR_MODE];
    let portalCountRaised = false;

    if (settings.gameplay.planarMode) {
        if (!wasPlanar && !memory.portalsBeforePlanar) {
            memory.portalsBeforePlanar = {
                enabled: settings.portalsEnabled === true,
                count: Number(settings.gameplay.portalCount) || 0,
            };
        }
        if (settings.portalsEnabled !== true) {
            settings.portalsEnabled = true;
            changedKeys.push(keys.RULES_PORTALS_ENABLED);
        }
        if ((settings.gameplay.portalCount || 0) === 0) {
            settings.gameplay.portalCount = PLANAR_DEFAULT_PORTAL_COUNT;
            changedKeys.push(keys.GAMEPLAY_PORTAL_COUNT);
            portalCountRaised = true;
        }
        return { changedKeys, portalCountRaised };
    }

    const before = memory.portalsBeforePlanar;
    memory.portalsBeforePlanar = null;
    if (!before) return { changedKeys, portalCountRaised };
    if (settings.portalsEnabled !== before.enabled) {
        settings.portalsEnabled = before.enabled;
        changedKeys.push(keys.RULES_PORTALS_ENABLED);
    }
    if ((Number(settings.gameplay.portalCount) || 0) !== before.count) {
        settings.gameplay.portalCount = before.count;
        changedKeys.push(keys.GAMEPLAY_PORTAL_COUNT);
    }
    return { changedKeys, portalCountRaised };
}
