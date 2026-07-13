import { GAME_MODE_TYPES } from '../../hunt/HuntMode.js';
import { SETTINGS_CHANGE_KEYS } from '../SettingsChangeKeys.js';
import { findFixedMenuPresetById } from './MenuPresetCatalog.js';
import { MENU_DEVELOPER_ACCESS_MODES } from './MenuStateContracts.js';
import { getRuntimeMapCatalog } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import {
    isMapEligibleForModePath,
    resolveModePathFallbackMapKey,
} from '../../shared/contracts/MapModeContract.js';

export const MENU_COMPATIBILITY_CONTRACT_VERSION = 'menu-compatibility.v1';
const CUSTOM_MAP_KEY = 'custom';

const MENU_COMPATIBILITY_RULES = Object.freeze([
    { id: 'session_type_mode_sync', priority: 5 },
    { id: 'mode_path_game_mode_sync', priority: 8 },
    { id: 'map_key_validity_guard', priority: 9 },
    { id: 'mode_hunt_respawn', priority: 10 },
    { id: 'theme_mode_local_guard', priority: 15 },
    { id: 'preset_identity_integrity', priority: 20 },
    { id: 'fixed_preset_exists', priority: 30 },
    { id: 'fixed_preset_binding', priority: 40 },
    { id: 'fixed_lock_requires_fixed_preset', priority: 50 },
    { id: 'developer_feature_flag_guard', priority: 60 },
    { id: 'developer_release_preview_guard', priority: 65 },
    { id: 'developer_visibility_guard', priority: 70 },
]);

const MENU_COMPATIBILITY_RULE_TRIGGER_KEYS = Object.freeze({
    session_type_mode_sync: Object.freeze([
        SETTINGS_CHANGE_KEYS.SESSION_TYPE,
        SETTINGS_CHANGE_KEYS.MODE,
    ]),
    mode_path_game_mode_sync: Object.freeze([
        SETTINGS_CHANGE_KEYS.MODE_PATH,
        SETTINGS_CHANGE_KEYS.GAME_MODE,
        SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
    ]),
    map_key_validity_guard: Object.freeze([
        SETTINGS_CHANGE_KEYS.MODE_PATH,
        SETTINGS_CHANGE_KEYS.MAP_KEY,
    ]),
    mode_hunt_respawn: Object.freeze([
        SETTINGS_CHANGE_KEYS.GAME_MODE,
        SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
    ]),
    theme_mode_local_guard: Object.freeze([
        SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE,
    ]),
    preset_identity_integrity: Object.freeze([
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID,
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND,
        SETTINGS_CHANGE_KEYS.PRESET_STATUS,
    ]),
    fixed_preset_exists: Object.freeze([
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID,
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND,
        SETTINGS_CHANGE_KEYS.PRESET_STATUS,
    ]),
    fixed_preset_binding: Object.freeze([
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID,
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND,
        SETTINGS_CHANGE_KEYS.PRESET_STATUS,
    ]),
    fixed_lock_requires_fixed_preset: Object.freeze([
        SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND,
        SETTINGS_CHANGE_KEYS.PRESET_STATUS,
        SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK,
    ]),
    developer_release_preview_guard: Object.freeze([
        SETTINGS_CHANGE_KEYS.DEVELOPER_RELEASE_PREVIEW,
        SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED,
    ]),
    developer_visibility_guard: Object.freeze([
        SETTINGS_CHANGE_KEYS.DEVELOPER_VISIBILITY_MODE,
        SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED,
    ]),
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function addChangedKey(result, key) {
    if (typeof key !== 'string' || !key.trim()) return;
    result._changedKeySet.add(key);
}

function trackFix(result, ruleId, path, previousValue, nextValue, reason) {
    if (Object.is(previousValue, nextValue)) return;
    if (!result.appliedRuleIds.includes(ruleId)) {
        result.appliedRuleIds.push(ruleId);
    }
    result.fixes.push({
        ruleId,
        path,
        from: previousValue,
        to: nextValue,
        reason,
    });
}

function applySessionTypeModeSyncRule(settings, result) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    const sessionType = normalizeString(settings.localSettings.sessionType);
    const expectedMode = sessionType === 'splitscreen' ? '2p' : '1p';
    const currentMode = settings.mode === '2p' ? '2p' : '1p';
    if (currentMode === expectedMode) return;

    const previousMode = settings.mode;
    settings.mode = expectedMode;
    addChangedKey(result, SETTINGS_CHANGE_KEYS.MODE);
    trackFix(
        result,
        'session_type_mode_sync',
        'mode',
        previousMode,
        settings.mode,
        'mode_mismatch_for_session_type'
    );
}

function applyModePathGameModeSyncRule(settings, result) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    const modePath = normalizeString(settings.localSettings.modePath);
    if (!modePath) return;

    const shouldUseHunt = modePath === 'fight';
    const shouldUseClassic = modePath === 'normal' || modePath === 'arcade';
    const expectedGameMode = shouldUseHunt
        ? GAME_MODE_TYPES.HUNT
        : (shouldUseClassic ? GAME_MODE_TYPES.CLASSIC : null);

    if (expectedGameMode && settings.gameMode !== expectedGameMode) {
        const previousGameMode = settings.gameMode;
        settings.gameMode = expectedGameMode;
        addChangedKey(result, SETTINGS_CHANGE_KEYS.GAME_MODE);
        trackFix(
            result,
            'mode_path_game_mode_sync',
            'gameMode',
            previousGameMode,
            settings.gameMode,
            'game_mode_mismatch_for_mode_path'
        );
    }

    if (!settings.hunt || typeof settings.hunt !== 'object') {
        settings.hunt = {};
    }
    if (!('respawnEnabled' in settings.hunt)) {
        settings.hunt.respawnEnabled = false;
    }
    const expectedRespawnEnabled = shouldUseHunt;
    if ((shouldUseHunt || shouldUseClassic) && settings.hunt.respawnEnabled !== expectedRespawnEnabled) {
        const previousRespawnEnabled = settings.hunt.respawnEnabled;
        settings.hunt.respawnEnabled = expectedRespawnEnabled;
        addChangedKey(result, SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED);
        trackFix(
            result,
            'mode_path_game_mode_sync',
            'hunt.respawnEnabled',
            previousRespawnEnabled,
            settings.hunt.respawnEnabled,
            'respawn_mismatch_for_mode_path'
        );
    }
}

function applyMapKeyValidityGuardRule(settings, result) {
    const currentMapKey = normalizeString(settings?.mapKey);
    if (!currentMapKey) return;
    if (currentMapKey === CUSTOM_MAP_KEY) return;
    const modePath = normalizeString(settings?.localSettings?.modePath || 'normal').toLowerCase();
    const maps = getRuntimeMapCatalog();
    const mapDefinition = maps?.[currentMapKey];
    const mapExists = !!mapDefinition;
    const mapModeEligible = mapExists ? isMapEligibleForModePath(mapDefinition, modePath) : false;
    if (mapExists && mapModeEligible) return;

    const previousMapKey = settings.mapKey;
    settings.mapKey = resolveModePathFallbackMapKey(maps, modePath, previousMapKey);
    addChangedKey(result, SETTINGS_CHANGE_KEYS.MAP_KEY);
    trackFix(
        result,
        'map_key_validity_guard',
        'mapKey',
        previousMapKey,
        settings.mapKey,
        mapExists ? 'map_not_allowed_for_mode_path' : 'invalid_map_fallback_standard'
    );
}

function applyModeHuntRespawnRule(settings, result) {
    if (!settings?.hunt || typeof settings.hunt !== 'object') return;
    if (settings.gameMode === GAME_MODE_TYPES.HUNT) return;
    if (settings.hunt.respawnEnabled !== true) return;

    const previousValue = settings.hunt.respawnEnabled;
    settings.hunt.respawnEnabled = false;
    addChangedKey(result, SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED);
    trackFix(
        result,
        'mode_hunt_respawn',
        'hunt.respawnEnabled',
        previousValue,
        settings.hunt.respawnEnabled,
        'respawn_requires_hunt_mode'
    );
}

function applyThemeModeLocalGuardRule(settings, result) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    const currentThemeMode = normalizeString(settings.localSettings.themeMode, 'dunkel').toLowerCase();
    if (currentThemeMode === 'hell' || currentThemeMode === 'dunkel') return;

    const previousThemeMode = settings.localSettings.themeMode;
    settings.localSettings.themeMode = 'dunkel';
    addChangedKey(result, SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE);
    trackFix(
        result,
        'theme_mode_local_guard',
        'localSettings.themeMode',
        previousThemeMode,
        settings.localSettings.themeMode,
        'invalid_theme_mode_fallback'
    );
}

function applyPresetIdentityIntegrityRule(settings, result) {
    if (!settings?.matchSettings || typeof settings.matchSettings !== 'object') return;
    const activePresetId = normalizeString(settings.matchSettings.activePresetId);
    const activePresetKind = normalizeString(settings.matchSettings.activePresetKind);
    const activePresetSourceId = normalizeString(settings.matchSettings.activePresetSourceId);

    if (activePresetId) return;

    if (activePresetKind) {
        const previousValue = settings.matchSettings.activePresetKind;
        settings.matchSettings.activePresetKind = '';
        addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND);
        trackFix(
            result,
            'preset_identity_integrity',
            'matchSettings.activePresetKind',
            previousValue,
            settings.matchSettings.activePresetKind,
            'active_preset_kind_requires_id'
        );
    }

    if (activePresetSourceId) {
        const previousValue = settings.matchSettings.activePresetSourceId;
        settings.matchSettings.activePresetSourceId = '';
        addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_STATUS);
        trackFix(
            result,
            'preset_identity_integrity',
            'matchSettings.activePresetSourceId',
            previousValue,
            settings.matchSettings.activePresetSourceId,
            'active_preset_source_requires_id'
        );
    }
}

function clearActivePresetIdentity(settings, result, reason) {
    const activePresetId = normalizeString(settings?.matchSettings?.activePresetId);
    const activePresetKind = normalizeString(settings?.matchSettings?.activePresetKind);
    const activePresetSourceId = normalizeString(settings?.matchSettings?.activePresetSourceId);
    if (!activePresetId && !activePresetKind && !activePresetSourceId) return;

    const previousId = settings.matchSettings.activePresetId;
    const previousKind = settings.matchSettings.activePresetKind;
    const previousSource = settings.matchSettings.activePresetSourceId;
    settings.matchSettings.activePresetId = '';
    settings.matchSettings.activePresetKind = '';
    settings.matchSettings.activePresetSourceId = '';
    addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID);
    addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND);
    addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_STATUS);
    trackFix(
        result,
        'fixed_preset_exists',
        'matchSettings.activePresetId',
        previousId,
        settings.matchSettings.activePresetId,
        reason
    );
    trackFix(
        result,
        'fixed_preset_exists',
        'matchSettings.activePresetKind',
        previousKind,
        settings.matchSettings.activePresetKind,
        reason
    );
    trackFix(
        result,
        'fixed_preset_exists',
        'matchSettings.activePresetSourceId',
        previousSource,
        settings.matchSettings.activePresetSourceId,
        reason
    );
}

function applyFixedPresetExistsRule(settings, result) {
    if (!settings?.matchSettings || typeof settings.matchSettings !== 'object') return;
    const activePresetId = normalizeString(settings.matchSettings.activePresetId);
    const activePresetKind = normalizeString(settings.matchSettings.activePresetKind);
    if (!activePresetId || activePresetKind !== 'fixed') return;

    const fixedPreset = findFixedMenuPresetById(activePresetId);
    if (fixedPreset) return;
    clearActivePresetIdentity(settings, result, 'fixed_preset_not_found');
}

function applyFixedPresetBindingRule(settings, result) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    const activePresetId = normalizeString(settings?.matchSettings?.activePresetId);
    const activePresetKind = normalizeString(settings?.matchSettings?.activePresetKind);
    const fixedPresetId = normalizeString(settings.localSettings.fixedPresetId);

    if (activePresetId && activePresetKind === 'fixed') {
        if (fixedPresetId === activePresetId) return;
        const previousValue = settings.localSettings.fixedPresetId;
        settings.localSettings.fixedPresetId = activePresetId;
        addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_STATUS);
        trackFix(
            result,
            'fixed_preset_binding',
            'localSettings.fixedPresetId',
            previousValue,
            settings.localSettings.fixedPresetId,
            'sync_fixed_preset_id'
        );
        return;
    }

    if (!fixedPresetId) return;
    const previousValue = settings.localSettings.fixedPresetId;
    settings.localSettings.fixedPresetId = '';
    addChangedKey(result, SETTINGS_CHANGE_KEYS.PRESET_STATUS);
    trackFix(
        result,
        'fixed_preset_binding',
        'localSettings.fixedPresetId',
        previousValue,
        settings.localSettings.fixedPresetId,
        'clear_orphan_fixed_preset_id'
    );
}

function applyFixedLockRequiresFixedPresetRule(settings, result) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    if (!settings.localSettings.fixedPresetLockEnabled) return;
    const activePresetKind = normalizeString(settings?.matchSettings?.activePresetKind);
    if (activePresetKind === 'fixed') return;

    const previousValue = settings.localSettings.fixedPresetLockEnabled;
    settings.localSettings.fixedPresetLockEnabled = false;
    addChangedKey(result, SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK);
    trackFix(
        result,
        'fixed_lock_requires_fixed_preset',
        'localSettings.fixedPresetLockEnabled',
        previousValue,
        settings.localSettings.fixedPresetLockEnabled,
        'fixed_lock_without_fixed_preset'
    );
}

function applyDeveloperFeatureFlagGuardRule(settings, result) {
    if (settings?.menuFeatureFlags?.developerModeEnabled !== false) return;
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    if (!settings.localSettings.developerModeEnabled) return;

    const previousValue = settings.localSettings.developerModeEnabled;
    settings.localSettings.developerModeEnabled = false;
    addChangedKey(result, SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED);
    trackFix(
        result,
        'developer_feature_flag_guard',
        'localSettings.developerModeEnabled',
        previousValue,
        settings.localSettings.developerModeEnabled,
        'developer_feature_flag_disabled'
    );
}

function applyDeveloperReleasePreviewGuardRule(settings, result) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    if (!settings.localSettings.releasePreviewEnabled) return;
    if (!settings.localSettings.developerModeEnabled) return;

    const previousValue = settings.localSettings.developerModeEnabled;
    settings.localSettings.developerModeEnabled = false;
    addChangedKey(result, SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED);
    trackFix(
        result,
        'developer_release_preview_guard',
        'localSettings.developerModeEnabled',
        previousValue,
        settings.localSettings.developerModeEnabled,
        'release_preview_disables_developer_mode'
    );
}

function applyDeveloperVisibilityGuardRule(settings, result, accessContext) {
    if (!settings?.localSettings || typeof settings.localSettings !== 'object') return;
    const visibilityMode = normalizeString(settings.localSettings.developerModeVisibility);
    if (visibilityMode !== MENU_DEVELOPER_ACCESS_MODES.HIDDEN_FOR_PLAYERS) return;
    if (accessContext?.isOwner) return;
    if (!settings.localSettings.developerModeEnabled) return;

    const previousValue = settings.localSettings.developerModeEnabled;
    settings.localSettings.developerModeEnabled = false;
    addChangedKey(result, SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED);
    trackFix(
        result,
        'developer_visibility_guard',
        'localSettings.developerModeEnabled',
        previousValue,
        settings.localSettings.developerModeEnabled,
        'developer_hidden_for_players'
    );
}

export function getMenuCompatibilityRuleOrder() {
    return MENU_COMPATIBILITY_RULES
        .slice()
        .sort((left, right) => left.priority - right.priority)
        .map((rule) => rule.id);
}

export function applyMenuCompatibilityRules(settings, options = {}) {
    const source = settings && typeof settings === 'object' ? settings : null;
    const accessContext = options.accessContext && typeof options.accessContext === 'object'
        ? options.accessContext
        : null;
    const changedKeySet = Array.isArray(options.changedKeys)
        ? new Set(options.changedKeys.filter((key) => typeof key === 'string' && key.trim()))
        : null;
    const result = {
        contractVersion: MENU_COMPATIBILITY_CONTRACT_VERSION,
        appliedRuleIds: [],
        fixes: [],
        changedKeys: [],
        _changedKeySet: new Set(),
    };
    if (!source) {
        delete result._changedKeySet;
        return result;
    }

    const shouldRunRule = (ruleId) => {
        if (!(changedKeySet instanceof Set) || changedKeySet.size === 0) return true;
        const triggerKeys = MENU_COMPATIBILITY_RULE_TRIGGER_KEYS[ruleId];
        if (!Array.isArray(triggerKeys) || triggerKeys.length === 0) return true;
        return triggerKeys.some((key) => changedKeySet.has(key));
    };
    const runRule = (ruleId, callback) => {
        if (!shouldRunRule(ruleId)) return;
        callback();
    };

    runRule('session_type_mode_sync', () => applySessionTypeModeSyncRule(source, result));
    runRule('mode_path_game_mode_sync', () => applyModePathGameModeSyncRule(source, result));
    runRule('map_key_validity_guard', () => applyMapKeyValidityGuardRule(source, result));
    runRule('mode_hunt_respawn', () => applyModeHuntRespawnRule(source, result));
    runRule('theme_mode_local_guard', () => applyThemeModeLocalGuardRule(source, result));
    runRule('preset_identity_integrity', () => applyPresetIdentityIntegrityRule(source, result));
    runRule('fixed_preset_exists', () => applyFixedPresetExistsRule(source, result));
    runRule('fixed_preset_binding', () => applyFixedPresetBindingRule(source, result));
    runRule('fixed_lock_requires_fixed_preset', () => applyFixedLockRequiresFixedPresetRule(source, result));
    runRule('developer_feature_flag_guard', () => applyDeveloperFeatureFlagGuardRule(source, result));
    runRule('developer_release_preview_guard', () => applyDeveloperReleasePreviewGuardRule(source, result));
    runRule('developer_visibility_guard', () => applyDeveloperVisibilityGuardRule(source, result, accessContext));

    result.changedKeys = Array.from(result._changedKeySet);
    delete result._changedKeySet;
    return result;
}
