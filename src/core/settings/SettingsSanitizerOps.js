import { createGamepadControlsSnapshot } from '../../shared/contracts/GamepadControlsContract.js';
import { CONFIG } from '../Config.js';
import { CUSTOM_MAP_KEY } from '../../entities/MapSchema.js';
import {
    applyMenuCompatibilityRuleSet,
    ensureMenuContractState,
    MENU_SESSION_TYPES,
    normalizeSessionType,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import { GAME_MODE_TYPES, resolveActiveGameMode } from '../../hunt/HuntMode.js';
import {
    SETTINGS_LIMITS,
    clampSettingValue,
    normalizeControlBindings,
    normalizeGlobalControlBindings,
} from '../../shared/contracts/SettingsRuntimeContract.js';
import {
    BOT_DIFFICULTY_LEVELS,
    DEFAULT_VEHICLE_ID,
} from '../../shared/contracts/GameplayConfigContract.js';
import {
    normalizeBotPolicyStrategy,
} from '../RuntimeConfig.js';
import {
    createDefaultRecordingCaptureSettings,
    normalizeRecordingCaptureSettings,
} from '../../shared/contracts/RecordingCaptureContract.js';
import {
    createDefaultCameraPerspectiveSettings,
    normalizeCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';
import { normalizeArcadeRunSettings } from '../../shared/contracts/ArcadeRunSettingsContract.js';
import { GAMEPLAY_COCKPIT_CAMERA_ENABLED } from '../../shared/contracts/CameraModeContract.js';
import {
    deepClone,
    normalizeModePath,
} from './SettingsDomainUtils.js';
import { createRuntimeSettingsLimitsForRuntime } from './SettingsRuntimeLimits.js';
import { migrateSettingsSnapshot } from './SettingsVersionMigrations.js';
import {
    normalizeFourPlayerPlanarSettings,
    normalizeSplitScreenVariant,
    normalizeThreePlayerSplitSettings,
} from '../../four-player-planar/FourPlayerPlanarContract.js';
import { getVehicleIds } from '../../entities/vehicle-registry.js';
import { createBotHeuristicTuningSnapshot } from '../../shared/contracts/BotHeuristicTuningContract.js';

function applySessionSanitization({ merged, src, defaults, migratedSessionType, runtimeLimits }) {
    const huntFeatureEnabled = CONFIG.HUNT?.ENABLED !== false;
    merged.mode = migratedSessionType === MENU_SESSION_TYPES.SPLITSCREEN ? '2p' : '1p';
    merged.gameMode = resolveActiveGameMode(src.gameMode, huntFeatureEnabled);

    const requestedMapKey = String(src.mapKey || '');
    const hasConfiguredMap = Object.prototype.hasOwnProperty.call(CONFIG.MAPS || {}, requestedMapKey);
    merged.mapKey = (requestedMapKey === CUSTOM_MAP_KEY || hasConfiguredMap)
        ? requestedMapKey
        : defaults.mapKey;

    merged.numBots = clampSettingValue(
        src.numBots ?? defaults.numBots,
        runtimeLimits.session.numBots,
        defaults.numBots
    );
    merged.botDifficulty = BOT_DIFFICULTY_LEVELS.includes(src.botDifficulty)
        ? src.botDifficulty
        : defaults.botDifficulty;
    merged.botPolicyStrategy = normalizeBotPolicyStrategy(src.botPolicyStrategy, defaults.botPolicyStrategy);
    merged.botHeuristicProfile = ['defensive', 'balanced', 'aggressive'].includes(src.botHeuristicProfile)
        ? src.botHeuristicProfile
        : defaults.botHeuristicProfile;
    merged.botHeuristicTuning = createBotHeuristicTuningSnapshot(src.botHeuristicTuning);
    merged.winsNeeded = clampSettingValue(
        src.winsNeeded ?? defaults.winsNeeded,
        runtimeLimits.session.winsNeeded,
        defaults.winsNeeded
    );
    merged.autoRoll = typeof src.autoRoll === 'boolean' ? src.autoRoll : defaults.autoRoll;

    merged.invertPitch.PLAYER_1 = !!(src?.invertPitch?.PLAYER_1 ?? defaults.invertPitch.PLAYER_1);
    merged.invertPitch.PLAYER_2 = !!(src?.invertPitch?.PLAYER_2 ?? defaults.invertPitch.PLAYER_2);
    merged.cockpitCamera.PLAYER_1 = GAMEPLAY_COCKPIT_CAMERA_ENABLED;
    merged.cockpitCamera.PLAYER_2 = GAMEPLAY_COCKPIT_CAMERA_ENABLED;

    if (!merged.vehicles) {
        merged.vehicles = { PLAYER_1: DEFAULT_VEHICLE_ID, PLAYER_2: DEFAULT_VEHICLE_ID };
    }
    merged.vehicles.PLAYER_1 = src?.vehicles?.PLAYER_1 || defaults?.vehicles?.PLAYER_1 || DEFAULT_VEHICLE_ID;
    merged.vehicles.PLAYER_2 = src?.vehicles?.PLAYER_2 || defaults?.vehicles?.PLAYER_2 || DEFAULT_VEHICLE_ID;

    merged.portalsEnabled = src?.portalsEnabled !== undefined ? !!src.portalsEnabled : defaults.portalsEnabled;
    merged.hunt.respawnEnabled = !!(src?.hunt?.respawnEnabled ?? defaults.hunt.respawnEnabled);
    merged.hunt.deathmatchKillLimit = clampSettingValue(
        src?.hunt?.deathmatchKillLimit ?? defaults.hunt.deathmatchKillLimit,
        runtimeLimits.hunt.deathmatchKillLimit,
        defaults.hunt.deathmatchKillLimit
    );
    merged.hunt.timeLimitEnabled = src?.hunt?.timeLimitEnabled !== false;
    if (merged.gameMode !== GAME_MODE_TYPES.HUNT) {
        merged.hunt.respawnEnabled = false;
    }
    // Without this the whole arcade block was lost on every save, so the run seed,
    // the daily challenge flag and the sector count could never persist.
    merged.arcade = normalizeArcadeRunSettings(src?.arcade ?? defaults.arcade);
}

// Every numeric gameplay field is clamped against the same limit rule it declares in the
// contract, so a new rule there is enough to make the field survive a save.
const GAMEPLAY_CLAMP_FIELDS = Object.freeze(Object.keys(SETTINGS_LIMITS.gameplay));

function applyGameplaySanitization({ merged, src, defaults, runtimeLimits }) {
    for (const field of GAMEPLAY_CLAMP_FIELDS) {
        merged.gameplay[field] = clampSettingValue(
            src?.gameplay?.[field] ?? defaults.gameplay[field],
            runtimeLimits.gameplay[field],
            defaults.gameplay[field]
        );
    }
    merged.gameplay.planarMode = !!(src?.gameplay?.planarMode ?? defaults.gameplay.planarMode);
    merged.gameplay.portalBeams = false;
}

function applyBotBridgeSanitization({ merged, src, defaults, runtimeLimits }) {
    merged.botBridge = {
        enabled: !!(src?.botBridge?.enabled ?? defaults.botBridge.enabled),
        url: typeof src?.botBridge?.url === 'string' && src.botBridge.url.trim()
            ? src.botBridge.url.trim()
            : defaults.botBridge.url,
        timeoutMs: clampSettingValue(
            src?.botBridge?.timeoutMs ?? defaults.botBridge.timeoutMs,
            runtimeLimits.botBridge.timeoutMs,
            defaults.botBridge.timeoutMs
        ),
        maxRetries: clampSettingValue(
            src?.botBridge?.maxRetries ?? defaults.botBridge.maxRetries,
            runtimeLimits.botBridge.maxRetries,
            defaults.botBridge.maxRetries
        ),
        retryDelayMs: clampSettingValue(
            src?.botBridge?.retryDelayMs ?? defaults.botBridge.retryDelayMs,
            runtimeLimits.botBridge.retryDelayMs,
            defaults.botBridge.retryDelayMs
        ),
        resumeCheckpoint: typeof src?.botBridge?.resumeCheckpoint === 'string'
            ? src.botBridge.resumeCheckpoint.trim()
            : defaults.botBridge.resumeCheckpoint,
        resumeStrict: typeof src?.botBridge?.resumeStrict === 'boolean'
            ? src.botBridge.resumeStrict
            : defaults.botBridge.resumeStrict,
    };
}

function applyControlAndMediaSanitization({ merged, src, defaults }) {
    merged.recording = normalizeRecordingCaptureSettings(
        src?.recording,
        defaults.recording || createDefaultRecordingCaptureSettings()
    );
    merged.cameraPerspective = normalizeCameraPerspectiveSettings(
        src?.cameraPerspective,
        defaults.cameraPerspective || createDefaultCameraPerspectiveSettings()
    );
    merged.controls.PLAYER_1 = normalizeControlBindings(src?.controls?.PLAYER_1, defaults.controls.PLAYER_1, { guardCombatConflicts: true });
    merged.controls.PLAYER_2 = normalizeControlBindings(src?.controls?.PLAYER_2, defaults.controls.PLAYER_2, { guardCombatConflicts: true });
    merged.controls.GLOBAL = normalizeGlobalControlBindings(src?.controls?.GLOBAL, defaults.controls.GLOBAL);
    Object.assign(merged.controls, createGamepadControlsSnapshot(src?.controls));
}

function applyMenuContractPayloadSanitization({ merged, src }) {
    if (src?.menuFeatureFlags && typeof src.menuFeatureFlags === 'object') {
        merged.menuFeatureFlags = { ...src.menuFeatureFlags };
    }
    if (src?.menuContracts && typeof src.menuContracts === 'object') {
        merged.menuContracts = { ...src.menuContracts };
    }
    if (src?.matchSettings && typeof src.matchSettings === 'object') {
        merged.matchSettings = { ...src.matchSettings };
    }
    if (src?.playerLoadout && typeof src.playerLoadout === 'object') {
        merged.playerLoadout = { ...src.playerLoadout };
    }
    if (src?.localSettings && typeof src.localSettings === 'object') {
        merged.localSettings = { ...src.localSettings };
    }
}

function finalizeSanitizedSettings({ merged, migratedSessionType }) {
    ensureMenuContractState(merged);
    merged.localSettings.sessionType = migratedSessionType;
    merged.localSettings.splitScreenVariant = normalizeSplitScreenVariant(
        merged.localSettings.splitScreenVariant
    );
    merged.localSettings.fourPlayerPlanar = normalizeFourPlayerPlanarSettings(
        merged.localSettings.fourPlayerPlanar,
        {
            allowedMapKeys: new Set(Object.keys(CONFIG.MAPS || {})),
            allowedVehicleIds: new Set(getVehicleIds()),
            fallbackMapKey: merged.mapKey || 'standard',
            fallbackVehicleId: merged?.vehicles?.PLAYER_1 || DEFAULT_VEHICLE_ID,
        }
    );
    merged.localSettings.threePlayerSplit = normalizeThreePlayerSplitSettings(
        merged.localSettings.threePlayerSplit,
        {
            allowedMapKeys: new Set(Object.keys(CONFIG.MAPS || {})),
            allowedVehicleIds: new Set(getVehicleIds()),
            fallbackMapKey: merged.mapKey || 'standard',
            fallbackVehicleId: merged?.vehicles?.PLAYER_1 || DEFAULT_VEHICLE_ID,
        }
    );
    merged.localSettings.modePath = normalizeModePath(merged.localSettings.modePath, 'normal');
    applyMenuCompatibilityRuleSet(merged);
    return merged;
}

export function sanitizeSettingsSnapshot(saved, createDefaultSettings, runtimeGlobal = globalThis) {
    const defaults = createDefaultSettings();
    const runtimeLimits = createRuntimeSettingsLimitsForRuntime(runtimeGlobal);
    const rawSource = saved && typeof saved === 'object' ? saved : {};
    const src = migrateSettingsSnapshot(rawSource, defaults).settings;

    const merged = deepClone(defaults);
    const fallbackSessionType = src.mode === '2p'
        ? MENU_SESSION_TYPES.SPLITSCREEN
        : (src.mode === '1p'
            ? MENU_SESSION_TYPES.SINGLE
            : defaults?.localSettings?.sessionType || MENU_SESSION_TYPES.SINGLE);
    const migratedSessionType = normalizeSessionType(
        src?.localSettings?.sessionType || fallbackSessionType,
        defaults?.localSettings?.sessionType || MENU_SESSION_TYPES.SINGLE
    );

    applySessionSanitization({ merged, src, defaults, migratedSessionType, runtimeLimits });
    applyGameplaySanitization({ merged, src, defaults, runtimeLimits });
    applyBotBridgeSanitization({ merged, src, defaults, runtimeLimits });
    applyControlAndMediaSanitization({ merged, src, defaults });
    applyMenuContractPayloadSanitization({ merged, src });

    return finalizeSanitizedSettings({ merged, migratedSessionType });
}
