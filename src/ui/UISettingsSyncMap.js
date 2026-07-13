import { SETTINGS_CHANGE_KEYS } from './SettingsChangeKeys.js';

export const UI_SETTINGS_SYNC_MAP = Object.freeze({
    [SETTINGS_CHANGE_KEYS.SESSION_TYPE]: ['syncSessionState', 'syncModes', 'syncMultiplayerState'],
    [SETTINGS_CHANGE_KEYS.MODE_PATH]: ['syncSessionState', 'syncGameplay'],
    [SETTINGS_CHANGE_KEYS.MULTIPLAYER_TRANSPORT]: ['syncSessionState', 'syncMultiplayerState'],
    [SETTINGS_CHANGE_KEYS.ARCADE_GHOST_DUEL_MODE]: ['syncSessionState'],
    [SETTINGS_CHANGE_KEYS.ARCADE_GHOST_TRAIL_COLLISION_ENABLED]: ['syncSessionState'],
    [SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE]: ['syncSessionState'],
    [SETTINGS_CHANGE_KEYS.LOCAL_SHADOW_QUALITY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.LOCAL_MOBILE_TILT_SENSITIVITY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.LOCAL_MOBILE_TILT_ASSIST_MODE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.LOCAL_MOBILE_TILT_PITCH_MODE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.LOCAL_MOBILE_TILT_DEBUG_VISIBLE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.LOCAL_MOBILE_TILT_SENSOR_HZ_VISIBLE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.MODE]: ['syncModes'],
    [SETTINGS_CHANGE_KEYS.GAME_MODE]: ['syncModes'],
    [SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED]: ['syncModes'],
    [SETTINGS_CHANGE_KEYS.MAP_KEY]: ['syncMap'],
    [SETTINGS_CHANGE_KEYS.BOTS_COUNT]: ['syncBots'],
    [SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY]: ['syncBots'],
    [SETTINGS_CHANGE_KEYS.BOTS_POLICY_STRATEGY]: ['syncBots'],
    [SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.RULES_INVERT_P1]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.RULES_INVERT_P2]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P1]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P2]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED]: ['syncRules'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_TURN_SENSITIVITY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANE_SCALE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_WIDTH]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_SIZE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_FREQUENCY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_ITEM_AMOUNT]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_FIRE_RATE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_LOCK_ON_ANGLE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_MG_TRAIL_AIM_RADIUS]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_PLAYER_HP]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_MG_DAMAGE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_PORTAL_COUNT]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_LEVEL_COUNT]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.RECORDING_PROFILE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.RECORDING_HUD_MODE]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_NORMAL]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_REDUCE_MOTION]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY]: ['syncGameplay'],
    [SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1]: ['syncVehicles'],
    [SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2]: ['syncVehicles'],
    [SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID]: ['syncPresetState'],
    [SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND]: ['syncPresetState'],
    [SETTINGS_CHANGE_KEYS.PRESET_LIST]: ['syncPresetState'],
    [SETTINGS_CHANGE_KEYS.PRESET_STATUS]: ['syncPresetState'],
    [SETTINGS_CHANGE_KEYS.MULTIPLAYER_STATUS]: ['syncMultiplayerState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_VISIBILITY_MODE]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_ACTOR_ID]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_RELEASE_PREVIEW]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES]: ['syncDeveloperState'],
    [SETTINGS_CHANGE_KEYS.MENU_TELEMETRY]: ['syncDeveloperState'],
});

const SYNC_METHOD_EXECUTION_ORDER = Object.freeze([
    'syncSessionState',
    'syncModes',
    'syncMap',
    'syncBots',
    'syncRules',
    'syncGameplay',
    'syncVehicles',
    'syncPresetState',
    'syncMultiplayerState',
    'syncDeveloperState',
]);

export function resolveSyncMethodNamesForChangeKeys(changedKeys) {
    if (!Array.isArray(changedKeys) || changedKeys.length === 0) {
        return [];
    }

    const seenMethods = new Set();

    for (const key of changedKeys) {
        const mappedMethods = UI_SETTINGS_SYNC_MAP[key];
        if (!Array.isArray(mappedMethods) || mappedMethods.length === 0) {
            return [];
        }
        for (const methodName of mappedMethods) {
            if (seenMethods.has(methodName)) continue;
            seenMethods.add(methodName);
        }
    }

    return SYNC_METHOD_EXECUTION_ORDER.filter((methodName) => seenMethods.has(methodName));
}
