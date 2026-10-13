// ============================================
// MenuRuntimeFreePlayService.js - free play variant choice
// ============================================

import { SETTINGS_CHANGE_KEYS } from '../../shared/settings/SettingsChangeKeys.js';
import {
    deriveFreePlayVariant,
    normalizeFreePlayVariant,
    resolveFreePlayVariantSettings,
} from '../../shared/contracts/FreePlayVariantContract.js';
import { handleModePathChangeAction } from './MenuRuntimeSessionService.js';
import { CONFIG } from '../Config.js';
import { writeHangarMapSelection } from '../../composition/core-ui/CoreUiMenuPorts.js';
import { isMapEligibleForModePath } from '../../shared/contracts/MapModeContract.js';
import { resolveFreePlayVariantMapKey } from '../../shared/contracts/FreePlayMapChoiceContract.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';

// V7: the map this variant remembers comes back when the player switches to it, if it fits.
function restoreRememberedMap(game, variant, modePath) {
    const settings = game.settings;
    const surface = createSurfacePolicyPort({
        getProductSurfaceId: () => String(game?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || '').trim().toLowerCase(),
        getSettings: () => settings,
    });
    const maps = CONFIG?.MAPS || {};
    const target = resolveFreePlayVariantMapKey({
        variant,
        memory: settings.localSettings?.freePlayMapByVariant,
        maps,
        currentMapKey: settings.mapKey,
        isOffered: (mapKey) => isMapEligibleForModePath(maps[mapKey], modePath) && surface.isMapAllowed(mapKey, modePath),
    });
    if (!target || target === settings.mapKey) return false;
    writeHangarMapSelection(settings, target, target, { modePath });
    return true;
}

const TEAM_CHANGED_KEYS = Object.freeze([
    SETTINGS_CHANGE_KEYS.HUNT_TEAM_MODE,
    SETTINGS_CHANGE_KEYS.HUNT_TEAM_OBJECTIVE,
    SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
]);

/**
 * Picks a free play variant. Without an explicit variant (the entry card in the hub) the
 * last chosen one comes back. The mode path switch does the heavy lifting (style seeding,
 * map fallback, game mode); the team setup is written on top before anyone is told.
 */
export function handleFreePlayVariantChangeAction(ctx) {
    const { game, event } = ctx;
    if (!game?.settings) return;
    if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
        game.settings.localSettings = {};
    }
    const remembered = normalizeFreePlayVariant(game.settings.localSettings.freePlayVariant);
    const pinned = resolveFreePlayVariantSettings(normalizeFreePlayVariant(event?.variant, remembered));
    const stayOnPanel = event?.stayOnPanel === true;
    let mapChanged = false;

    handleModePathChangeAction({
        ...ctx,
        event: { modePath: pinned.modePath, stayOnPanel },
        onSettingsChanged: (payload) => {
            const settings = game.settings;
            // A surface or feature flag may have refused the fight path; then the variant
            // follows what the mode path really became instead of claiming team play.
            if (settings.localSettings.modePath === pinned.modePath) {
                if (!settings.hunt || typeof settings.hunt !== 'object') settings.hunt = {};
                settings.hunt.teamMode = pinned.teamMode;
                settings.hunt.teamObjective = pinned.teamObjective;
                if (pinned.forcesRespawn) settings.hunt.respawnEnabled = true;
                if (restoreRememberedMap(game, pinned.variant, pinned.modePath)) mapChanged = true;
            }
            settings.localSettings.freePlayVariant = deriveFreePlayVariant(settings) || remembered;
            const changedKeys = [...(payload?.changedKeys || []), ...TEAM_CHANGED_KEYS];
            if (mapChanged) changedKeys.push(SETTINGS_CHANGE_KEYS.MAP_KEY);
            ctx.onSettingsChanged?.({ ...payload, changedKeys: Array.from(new Set(changedKeys)) });
        },
    });
}
