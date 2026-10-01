import {
    SETTINGS_CHANGE_KEYS,
    SETTINGS_CHANGE_PATH_ENTRIES,
} from '../../shared/settings/SettingsChangeKeys.js';

const MATCH_SNAPSHOT_SETTING_PATH_PREFIXES = Object.freeze([
    'arcade.',
    'gameplay.',
    'hunt.',
    'matchSettings.',
    'playerLoadout.',
    'vehicles.',
]);

const MATCH_SNAPSHOT_SETTING_PATHS = new Set([
    'localSettings.modePath',
    'localSettings.multiplayerTransport',
    'numBots',
    'botDifficulty',
    'winsNeeded',
    'autoRoll',
    'portalsEnabled',
]);

const MATCH_SNAPSHOT_EXPLICIT_CHANGE_KEYS = Object.freeze([
    SETTINGS_CHANGE_KEYS.MODE,
    SETTINGS_CHANGE_KEYS.GAME_MODE,
    SETTINGS_CHANGE_KEYS.MAP_KEY,
]);

function isMatchSnapshotSettingPath(path) {
    return MATCH_SNAPSHOT_SETTING_PATHS.has(path)
        || MATCH_SNAPSHOT_SETTING_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const MATCH_SETTING_CHANGE_KEY_SET = new Set([
    ...SETTINGS_CHANGE_PATH_ENTRIES
        .filter(([path]) => isMatchSnapshotSettingPath(path))
        .map(([, key]) => key),
    ...MATCH_SNAPSHOT_EXPLICIT_CHANGE_KEYS,
]);

export const START_VALIDATION_RELEVANT_KEY_SET = new Set([
    SETTINGS_CHANGE_KEYS.SESSION_TYPE,
    SETTINGS_CHANGE_KEYS.MODE_PATH,
    SETTINGS_CHANGE_KEYS.MAP_KEY,
    SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
    SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
    SETTINGS_CHANGE_KEYS.GAME_MODE,
    SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
    SETTINGS_CHANGE_KEYS.HUNT_TEAM_MODE,
    SETTINGS_CHANGE_KEYS.HUNT_TEAM_OBJECTIVE,
    SETTINGS_CHANGE_KEYS.HUNT_TEAM_SIZE,
]);
