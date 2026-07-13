export const SETTINGS_CHANGE_KEYS = Object.freeze({
    SESSION_TYPE: 'session.type',
    MODE_PATH: 'session.modePath',
    MULTIPLAYER_TRANSPORT: 'multiplayer.transport',
    ARCADE_GHOST_DUEL_MODE: 'startSetup.arcadeGhostDuelMode',
    ARCADE_GHOST_TRAIL_COLLISION_ENABLED: 'startSetup.arcadeGhostTrailCollisionEnabled',
    LOCAL_THEME_MODE: 'local.themeMode',
    LOCAL_SHADOW_QUALITY: 'local.shadowQuality',
    LOCAL_MOBILE_TILT_SENSITIVITY: 'local.mobileControls.tiltSensitivity',
    LOCAL_MOBILE_TILT_ASSIST_MODE: 'local.mobileControls.tiltAssistMode',
    LOCAL_MOBILE_TILT_PITCH_MODE: 'local.mobileControls.tiltPitchMode',
    LOCAL_MOBILE_TILT_DEBUG_VISIBLE: 'local.mobileControls.tiltDebugVisible',
    LOCAL_MOBILE_TILT_SENSOR_HZ_VISIBLE: 'local.mobileControls.tiltSensorHzVisible',
    MODE: 'mode',
    GAME_MODE: 'gameMode',
    MAP_KEY: 'mapKey',
    BOTS_COUNT: 'bots.count',
    BOTS_DIFFICULTY: 'bots.difficulty',
    BOTS_POLICY_STRATEGY: 'bots.policyStrategy',
    RULES_WINS_NEEDED: 'rules.winsNeeded',
    RULES_AUTO_ROLL: 'rules.autoRoll',
    RULES_INVERT_P1: 'rules.invertPitch.player1',
    RULES_INVERT_P2: 'rules.invertPitch.player2',
    RULES_COCKPIT_P1: 'rules.cockpitCamera.player1',
    RULES_COCKPIT_P2: 'rules.cockpitCamera.player2',
    RULES_PORTALS_ENABLED: 'rules.portalsEnabled',
    VEHICLES_PLAYER_1: 'vehicles.player1',
    VEHICLES_PLAYER_2: 'vehicles.player2',
    HUNT_RESPAWN_ENABLED: 'hunt.respawnEnabled',
    GAMEPLAY_SPEED: 'gameplay.speed',
    GAMEPLAY_TURN_SENSITIVITY: 'gameplay.turnSensitivity',
    GAMEPLAY_PLANE_SCALE: 'gameplay.planeScale',
    GAMEPLAY_TRAIL_WIDTH: 'gameplay.trailWidth',
    GAMEPLAY_GAP_SIZE: 'gameplay.gapSize',
    GAMEPLAY_GAP_FREQUENCY: 'gameplay.gapFrequency',
    GAMEPLAY_ITEM_AMOUNT: 'gameplay.itemAmount',
    GAMEPLAY_FIRE_RATE: 'gameplay.fireRate',
    GAMEPLAY_LOCK_ON_ANGLE: 'gameplay.lockOnAngle',
    GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY: 'gameplay.nextCheckpointGlowIntensity',
    GAMEPLAY_MG_TRAIL_AIM_RADIUS: 'gameplay.mgTrailAimRadius',
    GAMEPLAY_FIGHT_PLAYER_HP: 'gameplay.fightPlayerHp',
    GAMEPLAY_FIGHT_MG_DAMAGE: 'gameplay.fightMgDamage',
    GAMEPLAY_PLANAR_MODE: 'gameplay.planarMode',
    GAMEPLAY_PORTAL_COUNT: 'gameplay.portalCount',
    GAMEPLAY_PLANAR_LEVEL_COUNT: 'gameplay.planarLevelCount',
    RECORDING_PROFILE: 'recording.profile',
    RECORDING_HUD_MODE: 'recording.hudMode',
    CAMERA_PERSPECTIVE_NORMAL: 'cameraPerspective.normal',
    CAMERA_PERSPECTIVE_REDUCE_MOTION: 'cameraPerspective.reduceMotion',
    CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED: 'cameraPerspective.speedFovEnabled',
    CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY: 'cameraPerspective.speedFovIntensity',
    CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED: 'cameraPerspective.thrusterExhaustEnabled',
    CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY: 'cameraPerspective.thrusterExhaustIntensity',
    PRESET_ACTIVE_ID: 'preset.activeId',
    PRESET_ACTIVE_KIND: 'preset.activeKind',
    PRESET_LIST: 'preset.list',
    PRESET_STATUS: 'preset.status',
    MULTIPLAYER_STATUS: 'multiplayer.status',
    DEVELOPER_MODE_ENABLED: 'developer.modeEnabled',
    DEVELOPER_THEME_ID: 'developer.themeId',
    DEVELOPER_VISIBILITY_MODE: 'developer.visibilityMode',
    DEVELOPER_FIXED_PRESET_LOCK: 'developer.fixedPresetLock',
    DEVELOPER_ACTOR_ID: 'developer.actorId',
    DEVELOPER_RELEASE_PREVIEW: 'developer.releasePreview',
    DEVELOPER_TEXT_OVERRIDES: 'developer.textOverrides',
    MENU_TELEMETRY: 'menu.telemetry',
});

const SETTINGS_CHANGE_KEY_SET = new Set(Object.values(SETTINGS_CHANGE_KEYS));

const CHANGE_KEY_PATH_OVERRIDES = Object.freeze({
    [SETTINGS_CHANGE_KEYS.SESSION_TYPE]: 'localSettings.sessionType',
    [SETTINGS_CHANGE_KEYS.MODE_PATH]: 'localSettings.modePath',
    [SETTINGS_CHANGE_KEYS.MULTIPLAYER_TRANSPORT]: 'localSettings.multiplayerTransport',
    [SETTINGS_CHANGE_KEYS.ARCADE_GHOST_DUEL_MODE]: 'localSettings.startSetup.arcadeGhostDuelMode',
    [SETTINGS_CHANGE_KEYS.ARCADE_GHOST_TRAIL_COLLISION_ENABLED]: 'localSettings.startSetup.arcadeGhostTrailCollisionEnabled',
    [SETTINGS_CHANGE_KEYS.BOTS_COUNT]: 'numBots',
    [SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY]: 'botDifficulty',
    [SETTINGS_CHANGE_KEYS.BOTS_POLICY_STRATEGY]: 'botPolicyStrategy',
    [SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED]: 'winsNeeded',
    [SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL]: 'autoRoll',
    [SETTINGS_CHANGE_KEYS.RULES_INVERT_P1]: 'invertPitch.PLAYER_1',
    [SETTINGS_CHANGE_KEYS.RULES_INVERT_P2]: 'invertPitch.PLAYER_2',
    [SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P1]: 'cockpitCamera.PLAYER_1',
    [SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P2]: 'cockpitCamera.PLAYER_2',
    [SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED]: 'portalsEnabled',
    [SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1]: 'vehicles.PLAYER_1',
    [SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2]: 'vehicles.PLAYER_2',
    [SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID]: 'matchSettings.activePresetId',
    [SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND]: 'matchSettings.activePresetKind',
    [SETTINGS_CHANGE_KEYS.PRESET_STATUS]: 'matchSettings.activePresetSourceId',
    [SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED]: 'localSettings.developerModeEnabled',
    [SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID]: 'localSettings.developerThemeId',
    [SETTINGS_CHANGE_KEYS.DEVELOPER_VISIBILITY_MODE]: 'localSettings.developerModeVisibility',
    [SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK]: 'localSettings.fixedPresetLockEnabled',
    [SETTINGS_CHANGE_KEYS.DEVELOPER_ACTOR_ID]: 'localSettings.actorId',
    [SETTINGS_CHANGE_KEYS.DEVELOPER_RELEASE_PREVIEW]: 'localSettings.releasePreviewEnabled',
});

const CHANGE_KEY_ROOT_PATHS = Object.freeze({
    cameraPerspective: 'cameraPerspective',
    gameplay: 'gameplay',
    hunt: 'hunt',
    local: 'localSettings',
    recording: 'recording',
    rules: '',
    vehicles: 'vehicles',
});

function capitalize(value) {
    const source = String(value || '');
    return source ? `${source[0].toUpperCase()}${source.slice(1)}` : '';
}

function stripLeadingDot(value) {
    return String(value || '').replace(/^\./, '');
}

function deriveSettingsPathFromChangeKey(changeKey) {
    if (Object.prototype.hasOwnProperty.call(CHANGE_KEY_PATH_OVERRIDES, changeKey)) {
        return CHANGE_KEY_PATH_OVERRIDES[changeKey];
    }
    const [root, ...segments] = String(changeKey || '').split('.');
    if (!root) return '';
    if (segments.length === 0) return root;
    if (!Object.prototype.hasOwnProperty.call(CHANGE_KEY_ROOT_PATHS, root)) return '';

    const rootPath = CHANGE_KEY_ROOT_PATHS[root];
    if (root === 'rules' && segments[0] === 'invertPitch') {
        return segments.join('.');
    }
    if (root === 'rules' && segments[0] === 'cockpitCamera') {
        return segments.join('.');
    }
    if (root === 'local') {
        return stripLeadingDot(`${rootPath}.${segments.join('.')}`);
    }
    if (root === 'developer') {
        return `localSettings.developer${capitalize(segments.join('.'))}`;
    }
    return stripLeadingDot(`${rootPath}.${segments.join('.')}`);
}

export const SETTINGS_CHANGE_PATH_ENTRIES = Object.freeze(
    Object.values(SETTINGS_CHANGE_KEYS)
        .map((changeKey) => [deriveSettingsPathFromChangeKey(changeKey), changeKey])
        .filter(([path]) => path)
);

export const SETTINGS_CHANGE_PATHS = Object.freeze(
    Object.fromEntries(SETTINGS_CHANGE_PATH_ENTRIES)
);

export function isSettingsChangeKey(value) {
    return SETTINGS_CHANGE_KEY_SET.has(value);
}

export function normalizeSettingsChangeKeys(changedKeys) {
    if (!Array.isArray(changedKeys) || changedKeys.length === 0) {
        return [];
    }

    const normalized = [];
    const seen = new Set();
    for (const key of changedKeys) {
        if (typeof key !== 'string') continue;
        const value = key.trim();
        if (!value || seen.has(value)) continue;
        if (!isSettingsChangeKey(value)) continue;
        seen.add(value);
        normalized.push(value);
    }
    return normalized;
}
