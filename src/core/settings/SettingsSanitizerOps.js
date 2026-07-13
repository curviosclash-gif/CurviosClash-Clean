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
    clampSettingValue,
    normalizeControlBindings,
    normalizeGlobalControlBindings,
} from '../config/SettingsRuntimeContract.js';
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
import { GAMEPLAY_COCKPIT_CAMERA_ENABLED } from '../../shared/contracts/CameraModeContract.js';
import {
    deepClone,
    normalizeModePath,
} from './SettingsDomainUtils.js';
import { createRuntimeSettingsLimitsForRuntime } from './SettingsRuntimeLimits.js';

function applySessionSanitization({ merged, src, defaults, migratedSessionType, runtimeLimits }) {
    const huntFeatureEnabled = CONFIG.HUNT?.ENABLED !== false;
    merged.mode = migratedSessionType === MENU_SESSION_TYPES.SPLITSCREEN ? '2p' : '1p';
    merged.gameMode = resolveActiveGameMode(src.gameMode, huntFeatureEnabled);

    const requestedMapKey = String(src.mapKey || '');
    merged.mapKey = (requestedMapKey === CUSTOM_MAP_KEY || CONFIG.MAPS[requestedMapKey])
        ? requestedMapKey
        : defaults.mapKey;

    merged.numBots = clampSettingValue(
        src.numBots ?? defaults.numBots,
        runtimeLimits.session.numBots,
        defaults.numBots
    );
    merged.botDifficulty = ['EASY', 'NORMAL', 'HARD'].includes(src.botDifficulty)
        ? src.botDifficulty
        : defaults.botDifficulty;
    merged.botPolicyStrategy = normalizeBotPolicyStrategy(src.botPolicyStrategy, defaults.botPolicyStrategy);
    merged.winsNeeded = clampSettingValue(
        src.winsNeeded ?? defaults.winsNeeded,
        runtimeLimits.session.winsNeeded,
        defaults.winsNeeded
    );
    merged.autoRoll = typeof src.autoRoll === 'boolean' ? src.autoRoll : defaults.autoRoll;

    merged.invertPitch.PLAYER_1 = !!src?.invertPitch?.PLAYER_1;
    merged.invertPitch.PLAYER_2 = !!src?.invertPitch?.PLAYER_2;
    merged.cockpitCamera.PLAYER_1 = GAMEPLAY_COCKPIT_CAMERA_ENABLED;
    merged.cockpitCamera.PLAYER_2 = GAMEPLAY_COCKPIT_CAMERA_ENABLED;

    if (!merged.vehicles) merged.vehicles = { PLAYER_1: 'ship5', PLAYER_2: 'ship5' };
    merged.vehicles.PLAYER_1 = src?.vehicles?.PLAYER_1 || 'ship5';
    merged.vehicles.PLAYER_2 = src?.vehicles?.PLAYER_2 || 'ship5';

    merged.portalsEnabled = src?.portalsEnabled !== undefined ? !!src.portalsEnabled : defaults.portalsEnabled;
    merged.hunt.respawnEnabled = !!(src?.hunt?.respawnEnabled ?? defaults.hunt.respawnEnabled);
    if (merged.gameMode !== GAME_MODE_TYPES.HUNT) {
        merged.hunt.respawnEnabled = false;
    }
}

function applyGameplaySanitization({ merged, src, defaults, runtimeLimits }) {
    merged.gameplay.speed = clampSettingValue(
        src?.gameplay?.speed ?? defaults.gameplay.speed,
        runtimeLimits.gameplay.speed,
        defaults.gameplay.speed
    );
    merged.gameplay.turnSensitivity = clampSettingValue(
        src?.gameplay?.turnSensitivity ?? defaults.gameplay.turnSensitivity,
        runtimeLimits.gameplay.turnSensitivity,
        defaults.gameplay.turnSensitivity
    );
    merged.gameplay.planeScale = clampSettingValue(
        src?.gameplay?.planeScale ?? defaults.gameplay.planeScale,
        runtimeLimits.gameplay.planeScale,
        defaults.gameplay.planeScale
    );
    merged.gameplay.trailWidth = clampSettingValue(
        src?.gameplay?.trailWidth ?? defaults.gameplay.trailWidth,
        runtimeLimits.gameplay.trailWidth,
        defaults.gameplay.trailWidth
    );
    merged.gameplay.trailLength = clampSettingValue(
        src?.gameplay?.trailLength ?? defaults.gameplay.trailLength,
        runtimeLimits.gameplay.trailLength,
        defaults.gameplay.trailLength
    );
    merged.gameplay.gapSize = clampSettingValue(
        src?.gameplay?.gapSize ?? defaults.gameplay.gapSize,
        runtimeLimits.gameplay.gapSize,
        defaults.gameplay.gapSize
    );
    merged.gameplay.gapFrequency = clampSettingValue(
        src?.gameplay?.gapFrequency ?? defaults.gameplay.gapFrequency,
        runtimeLimits.gameplay.gapFrequency,
        defaults.gameplay.gapFrequency
    );
    merged.gameplay.itemAmount = clampSettingValue(
        src?.gameplay?.itemAmount ?? defaults.gameplay.itemAmount,
        runtimeLimits.gameplay.itemAmount,
        defaults.gameplay.itemAmount
    );
    merged.gameplay.fireRate = clampSettingValue(
        src?.gameplay?.fireRate ?? defaults.gameplay.fireRate,
        runtimeLimits.gameplay.fireRate,
        defaults.gameplay.fireRate
    );
    merged.gameplay.lockOnAngle = clampSettingValue(
        src?.gameplay?.lockOnAngle ?? defaults.gameplay.lockOnAngle,
        runtimeLimits.gameplay.lockOnAngle,
        defaults.gameplay.lockOnAngle
    );
    merged.gameplay.nextCheckpointGlowIntensity = clampSettingValue(
        src?.gameplay?.nextCheckpointGlowIntensity ?? defaults.gameplay.nextCheckpointGlowIntensity,
        runtimeLimits.gameplay.nextCheckpointGlowIntensity,
        defaults.gameplay.nextCheckpointGlowIntensity
    );
    merged.gameplay.mgTrailAimRadius = clampSettingValue(
        src?.gameplay?.mgTrailAimRadius ?? defaults.gameplay.mgTrailAimRadius,
        runtimeLimits.gameplay.mgTrailAimRadius,
        defaults.gameplay.mgTrailAimRadius
    );
    merged.gameplay.fightPlayerHp = clampSettingValue(
        src?.gameplay?.fightPlayerHp ?? defaults.gameplay.fightPlayerHp,
        runtimeLimits.gameplay.fightPlayerHp,
        defaults.gameplay.fightPlayerHp
    );
    merged.gameplay.fightMgDamage = clampSettingValue(
        src?.gameplay?.fightMgDamage ?? defaults.gameplay.fightMgDamage,
        runtimeLimits.gameplay.fightMgDamage,
        defaults.gameplay.fightMgDamage
    );
    merged.gameplay.planarMode = !!(src?.gameplay?.planarMode ?? defaults.gameplay.planarMode);
    merged.gameplay.portalCount = clampSettingValue(
        src?.gameplay?.portalCount ?? defaults.gameplay.portalCount,
        runtimeLimits.gameplay.portalCount,
        defaults.gameplay.portalCount
    );
    merged.gameplay.planarLevelCount = clampSettingValue(
        src?.gameplay?.planarLevelCount ?? defaults.gameplay.planarLevelCount,
        runtimeLimits.gameplay.planarLevelCount,
        defaults.gameplay.planarLevelCount
    );
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
    merged.localSettings.modePath = normalizeModePath(merged.localSettings.modePath, 'normal');
    applyMenuCompatibilityRuleSet(merged);
    return merged;
}

function migrateLegacySettingsSnapshot(src, defaults) {
    const sourceVersion = Number(src?.settingsVersion || 0);
    const targetVersion = Number(defaults?.settingsVersion || sourceVersion || 0);
    if (!Number.isFinite(targetVersion) || targetVersion <= 0) {
        return src;
    }
    if (!Number.isFinite(sourceVersion) || sourceVersion >= targetVersion) {
        return src;
    }
    const migrated = deepClone(src);
    migrated.settingsVersion = targetVersion;
    return migrated;
}

export function sanitizeSettingsSnapshot(saved, createDefaultSettings, runtimeGlobal = globalThis) {
    const defaults = createDefaultSettings();
    const runtimeLimits = createRuntimeSettingsLimitsForRuntime(runtimeGlobal);
    const rawSource = saved && typeof saved === 'object' ? saved : {};
    const src = migrateLegacySettingsSnapshot(rawSource, defaults);

    const merged = deepClone(defaults);
    const migratedSessionType = normalizeSessionType(
        src?.localSettings?.sessionType || (src.mode === '2p' ? MENU_SESSION_TYPES.SPLITSCREEN : MENU_SESSION_TYPES.SINGLE)
    );

    applySessionSanitization({ merged, src, defaults, migratedSessionType, runtimeLimits });
    applyGameplaySanitization({ merged, src, defaults, runtimeLimits });
    applyBotBridgeSanitization({ merged, src, defaults, runtimeLimits });
    applyControlAndMediaSanitization({ merged, src, defaults });
    applyMenuContractPayloadSanitization({ merged, src });

    return finalizeSanitizedSettings({ merged, migratedSessionType });
}
