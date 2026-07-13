import { SETTINGS_CHANGE_KEYS } from '../SettingsChangeKeys.js';

const PRESET_VALUE_PATH_TO_CHANGE_KEY = Object.freeze({
    mode: SETTINGS_CHANGE_KEYS.MODE,
    gameMode: SETTINGS_CHANGE_KEYS.GAME_MODE,
    mapKey: SETTINGS_CHANGE_KEYS.MAP_KEY,
    numBots: SETTINGS_CHANGE_KEYS.BOTS_COUNT,
    botDifficulty: SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY,
    botPolicyStrategy: SETTINGS_CHANGE_KEYS.BOTS_POLICY_STRATEGY,
    winsNeeded: SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED,
    autoRoll: SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL,
    portalsEnabled: SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED,
    'hunt.respawnEnabled': SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
    'vehicles.PLAYER_1': SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
    'vehicles.PLAYER_2': SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
    'gameplay.speed': SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED,
    'gameplay.turnSensitivity': SETTINGS_CHANGE_KEYS.GAMEPLAY_TURN_SENSITIVITY,
    'gameplay.planeScale': SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANE_SCALE,
    'gameplay.trailWidth': SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_WIDTH,
    'gameplay.gapSize': SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_SIZE,
    'gameplay.gapFrequency': SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_FREQUENCY,
    'gameplay.itemAmount': SETTINGS_CHANGE_KEYS.GAMEPLAY_ITEM_AMOUNT,
    'gameplay.fireRate': SETTINGS_CHANGE_KEYS.GAMEPLAY_FIRE_RATE,
    'gameplay.lockOnAngle': SETTINGS_CHANGE_KEYS.GAMEPLAY_LOCK_ON_ANGLE,
    'gameplay.nextCheckpointGlowIntensity': SETTINGS_CHANGE_KEYS.GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY,
    'gameplay.mgTrailAimRadius': SETTINGS_CHANGE_KEYS.GAMEPLAY_MG_TRAIL_AIM_RADIUS,
    'gameplay.fightPlayerHp': SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_PLAYER_HP,
    'gameplay.fightMgDamage': SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_MG_DAMAGE,
    'gameplay.planarMode': SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE,
    'gameplay.portalCount': SETTINGS_CHANGE_KEYS.GAMEPLAY_PORTAL_COUNT,
    'gameplay.planarLevelCount': SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_LEVEL_COUNT,
    'localSettings.shadowQuality': SETTINGS_CHANGE_KEYS.LOCAL_SHADOW_QUALITY,
    'localSettings.startSetup.arcadeGhostDuelMode': SETTINGS_CHANGE_KEYS.ARCADE_GHOST_DUEL_MODE,
    'localSettings.startSetup.arcadeGhostTrailCollisionEnabled': SETTINGS_CHANGE_KEYS.ARCADE_GHOST_TRAIL_COLLISION_ENABLED,
    'recording.profile': SETTINGS_CHANGE_KEYS.RECORDING_PROFILE,
    'recording.hudMode': SETTINGS_CHANGE_KEYS.RECORDING_HUD_MODE,
    'cameraPerspective.normal': SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_NORMAL,
    'cameraPerspective.reduceMotion': SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_REDUCE_MOTION,
    'cameraPerspective.speedFovEnabled': SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED,
    'cameraPerspective.speedFovIntensity': SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY,
    'cameraPerspective.thrusterExhaustEnabled': SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED,
    'cameraPerspective.thrusterExhaustIntensity': SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY,
});

const SNAPSHOT_PATHS = Object.freeze([
    'mode',
    'gameMode',
    'mapKey',
    'numBots',
    'botDifficulty',
    'botPolicyStrategy',
    'winsNeeded',
    'autoRoll',
    'portalsEnabled',
    'hunt.respawnEnabled',
    'vehicles.PLAYER_1',
    'vehicles.PLAYER_2',
    'gameplay.speed',
    'gameplay.turnSensitivity',
    'gameplay.planeScale',
    'gameplay.trailWidth',
    'gameplay.gapSize',
    'gameplay.gapFrequency',
    'gameplay.itemAmount',
    'gameplay.fireRate',
    'gameplay.lockOnAngle',
    'gameplay.nextCheckpointGlowIntensity',
    'gameplay.mgTrailAimRadius',
    'gameplay.fightPlayerHp',
    'gameplay.fightMgDamage',
    'gameplay.planarMode',
    'gameplay.portalCount',
    'gameplay.planarLevelCount',
    'localSettings.shadowQuality',
    'localSettings.startSetup.arcadeGhostDuelMode',
    'localSettings.startSetup.arcadeGhostTrailCollisionEnabled',
    'recording.profile',
    'recording.hudMode',
    'cameraPerspective.normal',
    'cameraPerspective.reduceMotion',
    'cameraPerspective.speedFovEnabled',
    'cameraPerspective.speedFovIntensity',
    'cameraPerspective.thrusterExhaustEnabled',
    'cameraPerspective.thrusterExhaustIntensity',
]);

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function isPrimitiveEqual(left, right) {
    if (Number.isNaN(left) && Number.isNaN(right)) return true;
    return left === right;
}

function toPathSegments(path) {
    return String(path || '')
        .split('.')
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function getValueAtPath(source, path) {
    if (!source || typeof source !== 'object') return undefined;
    const segments = toPathSegments(path);
    if (segments.length === 0) return undefined;
    let current = source;
    for (const segment of segments) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[segment];
    }
    return current;
}

function setValueAtPath(target, path, value) {
    if (!target || typeof target !== 'object') return;
    const segments = toPathSegments(path);
    if (segments.length === 0) return;

    let current = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!current[segment] || typeof current[segment] !== 'object') {
            current[segment] = {};
        }
        current = current[segment];
    }
    current[segments[segments.length - 1]] = value;
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return { ...value };
    return value;
}

function normalizePresetValues(preset) {
    const sourceValues = preset?.values && typeof preset.values === 'object' ? preset.values : {};
    const out = {};
    for (const [path, value] of Object.entries(sourceValues)) {
        const normalizedPath = normalizeString(path);
        if (!normalizedPath) continue;
        out[normalizedPath] = cloneValue(value);
    }
    return out;
}

export function applyPresetToSettings(options = {}) {
    const settings = options.settings;
    const preset = options.preset;
    if (!settings || typeof settings !== 'object' || !preset || typeof preset !== 'object') {
        return {
            applied: false,
            changedKeys: [],
            appliedPaths: [],
            blockedPaths: [],
            reason: 'invalid_payload',
        };
    }

    const values = normalizePresetValues(preset);
    const lockedFields = Array.isArray(preset?.metadata?.lockedFields) ? preset.metadata.lockedFields : [];
    const isOwner = options.accessContext?.isOwner !== false;
    const blockedByFixedPreset = preset?.metadata?.kind === 'fixed' && !isOwner;
    const changedKeys = new Set();
    const appliedPaths = [];
    const blockedPaths = [];

    for (const [path, nextValue] of Object.entries(values)) {
        if (blockedByFixedPreset && lockedFields.includes(path)) {
            blockedPaths.push(path);
            continue;
        }

        const previousValue = getValueAtPath(settings, path);
        if (isPrimitiveEqual(previousValue, nextValue)) continue;

        setValueAtPath(settings, path, cloneValue(nextValue));
        appliedPaths.push(path);

        const changedKey = PRESET_VALUE_PATH_TO_CHANGE_KEY[path];
        if (changedKey) changedKeys.add(changedKey);
    }

    if (!settings.matchSettings || typeof settings.matchSettings !== 'object') {
        settings.matchSettings = {};
    }
    settings.matchSettings.activePresetId = normalizeString(preset.id);
    settings.matchSettings.activePresetKind = normalizeString(preset?.metadata?.kind, 'open');
    settings.matchSettings.activePresetSourceId = normalizeString(preset?.metadata?.sourcePresetId);

    return {
        applied: appliedPaths.length > 0,
        changedKeys: Array.from(changedKeys),
        appliedPaths,
        blockedPaths,
        reason: appliedPaths.length > 0 ? 'applied' : 'no_changes',
    };
}

export function capturePresetValuesFromSettings(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const values = {};
    for (const path of SNAPSHOT_PATHS) {
        const value = getValueAtPath(source, path);
        if (typeof value === 'undefined') continue;
        values[path] = cloneValue(value);
    }
    return values;
}

export function createPresetMetadata(options = {}) {
    const presetId = normalizeString(options.id);
    const kind = normalizeString(options.kind, 'open');
    const ownerId = normalizeString(options.ownerId, 'owner');
    const sourcePresetId = normalizeString(options.sourcePresetId);
    const nowIso = new Date(options.timestamp || Date.now()).toISOString();
    const createdAt = normalizeString(options.createdAt, nowIso);
    const updatedAt = normalizeString(options.updatedAt, nowIso);
    return {
        id: presetId,
        kind,
        ownerId,
        lockedFields: Array.isArray(options.lockedFields) ? options.lockedFields.slice() : [],
        sourcePresetId,
        createdAt,
        updatedAt,
    };
}
