import { resolveArcadeDailySettings, ARCADE_DAILY_RULES_VERSION } from '../shared/contracts/ArcadeDailyRulesContract.js';
import { normalizeHuntWinCondition } from '../shared/contracts/HuntWinConditionContract.js';
import { CONFIG, CONFIG_BASE } from './Config.js';
import { GAME_MODE_TYPES, isHuntMode, resolveActiveGameMode } from '../hunt/HuntMode.js';
import { BOT_POLICY_TYPES, resolveMatchBotPolicyType } from '../entities/ai/BotPolicyTypes.js';
import { clampSettingValue, createControlBindingsSnapshot } from '../shared/contracts/SettingsRuntimeContract.js';
import { normalizeSessionType } from '../composition/core-ui/CoreSettingsPorts.js';
import {
    ARCADE_GHOST_DUEL_MODES,
    isArcadeGhostDuelPlaybackEnabled,
    normalizeArcadeGhostDuelMode,
    normalizeArcadeGhostTrailCollisionEnabled,
} from '../shared/contracts/ArcadeGhostDuelContract.js';
import {
    hasExplicitArcadeSeed,
    normalizeArcadeRunSettings,
} from '../shared/contracts/ArcadeRunSettingsContract.js';
import { FIVE_PORTALS_MAPS, isFivePortalsRunType } from '../shared/contracts/FivePortalsContract.js';
import {
    createDefaultRecordingCaptureSettings,
    normalizeRecordingCaptureSettings,
} from '../shared/contracts/RecordingCaptureContract.js';
import { createDefaultCameraPerspectiveSettings, normalizeCameraPerspectiveSettings } from '../shared/contracts/CameraPerspectiveContract.js';
import {
    MULTIPLAYER_TRANSPORTS,
    RUNTIME_SESSION_TYPES,
    resolveRuntimeSessionContract,
} from '../shared/contracts/RuntimeSessionContract.js';
import { cloneJsonValue } from '../shared/utils/JsonClone.js';
import { createRuntimeSettingsLimitsForRuntime } from './settings/SettingsRuntimeLimits.js';
import { normalizeFightMachineGunId } from '../shared/contracts/FightMachineGunContract.js';
import { VIEWPORT_LAYOUTS } from '../shared/contracts/ViewportLayoutContract.js';
import { resolveMapPortalEntryCount } from '../shared/contracts/PortalAuthoringContract.js';
import { normalizeTeamHuntSettings } from '../shared/contracts/TeamHuntContract.js';
import { normalizeTeamObjectiveType, TEAM_OBJECTIVE_TYPES } from '../shared/contracts/FlagObjectiveContract.js';
import {
    FOUR_PLAYER_PLANAR_MODES,
    SPLIT_SCREEN_VARIANTS,
    createFourPlayerPlanarRuntimeSelection,
    createThreePlayerSplitRuntimeSelection,
} from '../four-player-planar/FourPlayerPlanarContract.js';
import { getVehicleIds } from '../entities/vehicle-registry.js';
import { createBotHeuristicTuningSnapshot } from '../shared/contracts/BotHeuristicTuningContract.js';
function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFightBonuses(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const clamp = (input, min, max) => Math.max(min, Math.min(max, Number(input) || 0));
    return Object.freeze({
        speedBonusPct: clamp(value.speedBonusPct, -30, 30),
        turningBonusPct: clamp(value.turningBonusPct, -30, 30),
        maxHpBonus: clamp(value.maxHpBonus, -60, 60),
        ...(Object.hasOwn(value, 'machineGunId') ? { machineGunId: normalizeFightMachineGunId(value.machineGunId) } : {}),
    });
}

const DEFAULT_NEXT_CHECKPOINT_GLOW_INTENSITY = 1.35;

function clampInteger(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function hashSeed(input) {
    const source = String(input || '');
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
        hash = ((hash << 5) - hash) + source.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

/**
 * @param {Record<string, any> | null} [settings]
 * @param {string} [activeGameMode]
 * @returns {number}
 */
function resolveArcadeSeed(settings = null, activeGameMode = GAME_MODE_TYPES.CLASSIC) {
    const source = settings && typeof settings === 'object' ? settings : {};
    // Only a seed the player actually chose wins. Since the arcade block is persisted,
    // its default 0 must keep deriving the seed from map, mode and bot count.
    if (hasExplicitArcadeSeed(source.arcade)) {
        return clampInteger(source.arcade.seed, 0, 2_147_483_647, 0);
    }
    const mapKey = String(source.mapKey || 'standard');
    const numBots = clampInteger(source.numBots, 0, 12, 0);
    const modePath = String(source?.localSettings?.modePath || 'normal').trim().toLowerCase();
    return hashSeed(`${mapKey}|${activeGameMode}|${numBots}|${modePath}`);
}

function resolveArcadeGhostDuelMode(settings = null, { sessionType = '' } = {}) {
    if (sessionType !== 'single') {
        return ARCADE_GHOST_DUEL_MODES.OFF;
    }
    return normalizeArcadeGhostDuelMode(
        settings?.localSettings?.startSetup?.arcadeGhostDuelMode,
        ARCADE_GHOST_DUEL_MODES.OFF
    );
}

/**
 * @param {object|null} settings
 * @param {object} context
 * @param {string} [context.sessionType='']
 * @param {string} [context.ghostDuelMode=ARCADE_GHOST_DUEL_MODES.OFF]
 * @returns {boolean}
 */
function resolveArcadeGhostTrailCollisionEnabled(settings = null, { sessionType = '', ghostDuelMode = ARCADE_GHOST_DUEL_MODES.OFF } = {}) {
    if (sessionType !== 'single' || !isArcadeGhostDuelPlaybackEnabled(ghostDuelMode)) {
        return false;
    }
    return normalizeArcadeGhostTrailCollisionEnabled(
        settings?.localSettings?.startSetup?.arcadeGhostTrailCollisionEnabled,
        false
    );
}

function resolveBotDifficulty(requestedDifficulty, botConfig) {
    const botDefaults = botConfig || CONFIG.BOT;
    const fallback = botDefaults.DEFAULT_DIFFICULTY || 'NORMAL';
    const candidate = String(requestedDifficulty || fallback).toUpperCase();
    return Object.prototype.hasOwnProperty.call(botDefaults.DIFFICULTY_PROFILES || {}, candidate)
        ? candidate
        : fallback;
}

export const BOT_POLICY_STRATEGIES = Object.freeze({
    RULE_BASED: 'rule-based',
    HEURISTIC: 'heuristic',
    BRIDGE: 'bridge',
    AUTO: 'auto',
});
/** @type {Set<string>} */
const BOT_POLICY_STRATEGY_SET = new Set(Object.values(BOT_POLICY_STRATEGIES));
const BOT_POLICY_STRATEGY_ALIASES = Object.freeze({
    heuristics: BOT_POLICY_STRATEGIES.HEURISTIC,
    'pure-heuristic': BOT_POLICY_STRATEGIES.HEURISTIC,
});

/**
 * @param {unknown} strategy
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeBotPolicyStrategy(strategy, fallback = BOT_POLICY_STRATEGIES.AUTO) {
    const normalizedFallback = BOT_POLICY_STRATEGY_SET.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback).trim().toLowerCase()
        : BOT_POLICY_STRATEGIES.AUTO;
    const candidate = typeof strategy === 'string' ? strategy.trim().toLowerCase() : '';
    const aliasedCandidate = BOT_POLICY_STRATEGY_ALIASES[candidate] || candidate;
    return BOT_POLICY_STRATEGY_SET.has(aliasedCandidate) ? aliasedCandidate : normalizedFallback;
}

export function resolveBotPolicyType(
    strategy,
    activeGameMode,
    {
        huntFeatureEnabled = true,
        planarMode = false,
    } = {}
) {
    const normalizedStrategy = normalizeBotPolicyStrategy(strategy, BOT_POLICY_STRATEGIES.AUTO);
    const huntModeActive = isHuntMode(activeGameMode, huntFeatureEnabled);

    if (normalizedStrategy === BOT_POLICY_STRATEGIES.BRIDGE) {
        return huntModeActive ? BOT_POLICY_TYPES.HUNT_BRIDGE : BOT_POLICY_TYPES.CLASSIC_BRIDGE;
    }
    if (normalizedStrategy === BOT_POLICY_STRATEGIES.RULE_BASED) {
        return BOT_POLICY_TYPES.RULE_BASED;
    }
    if (normalizedStrategy === BOT_POLICY_STRATEGIES.HEURISTIC) {
        return BOT_POLICY_TYPES.HEURISTIC;
    }
    // AUTO strategy: always use bridge policy types so that local checkpoint
    // auto-loading works. The bridge policy gracefully falls back to rule-based
    // when no checkpoint and no WebSocket bridge are available.
    return resolveMatchBotPolicyType({
        huntModeActive,
        planarMode: !!planarMode,
    });
}

export function createRuntimeConfigSnapshot(settings, {
    baseConfig = CONFIG_BASE,
    settingsDefaultsPort = null,
    runtimeGlobal = globalThis,
} = {}) {
    const source = resolveArcadeDailySettings(settings && typeof settings === 'object' ? settings : {});
    const runtimeLimits = createRuntimeSettingsLimitsForRuntime(settingsDefaultsPort || runtimeGlobal);
    const gameplaySource = source.gameplay && typeof source.gameplay === 'object' ? source.gameplay : {};
    const huntSource = source.hunt && typeof source.hunt === 'object' ? source.hunt : {};
    const botBridgeSource = source.botBridge && typeof source.botBridge === 'object' ? source.botBridge : {};
    const arcadeSource = source.arcade && typeof source.arcade === 'object' ? source.arcade : {};
    const recordingSource = source.recording && typeof source.recording === 'object'
        ? source.recording
        : createDefaultRecordingCaptureSettings();
    const cameraPerspectiveSource = source.cameraPerspective && typeof source.cameraPerspective === 'object'
        ? source.cameraPerspective
        : createDefaultCameraPerspectiveSettings();

    const requestedSessionType = normalizeSessionType(
        source?.localSettings?.sessionType || (source.mode === '2p' ? 'splitscreen' : 'single')
    );
    const sessionContract = resolveRuntimeSessionContract({
        sessionType: requestedSessionType,
        multiplayerTransport: source?.localSettings?.multiplayerTransport,
    });
    const sessionType = sessionContract.sessionType;
    const fourPlayerPlanarSelection = createFourPlayerPlanarRuntimeSelection(source, {
        allowedMapKeys: new Set(Object.keys(baseConfig?.MAPS || CONFIG.MAPS || {})),
        allowedVehicleIds: new Set(getVehicleIds()),
        fallbackMapKey: String(source.mapKey || 'standard'),
        fallbackVehicleId: String(source?.vehicles?.PLAYER_1 || baseConfig?.PLAYER?.DEFAULT_VEHICLE_ID || 'ship5'),
    });
    const fourPlayerPlanarActive = sessionType === RUNTIME_SESSION_TYPES.SPLITSCREEN
        && fourPlayerPlanarSelection.active;
    const threePlayerSplitSelection = createThreePlayerSplitRuntimeSelection(source, {
        allowedMapKeys: new Set(Object.keys(baseConfig?.MAPS || CONFIG.MAPS || {})),
        allowedVehicleIds: new Set(getVehicleIds()),
        fallbackMapKey: String(source.mapKey || 'standard'),
        fallbackVehicleId: String(source?.vehicles?.PLAYER_1 || baseConfig?.PLAYER?.DEFAULT_VEHICLE_ID || 'ship5'),
    });
    const threePlayerSplitActive = sessionType === RUNTIME_SESSION_TYPES.SPLITSCREEN
        && !fourPlayerPlanarActive
        && threePlayerSplitSelection.active;
    const multiplayerTransport = sessionType === RUNTIME_SESSION_TYPES.LAN
        ? MULTIPLAYER_TRANSPORTS.LAN
        : (sessionType === RUNTIME_SESSION_TYPES.ONLINE
            ? MULTIPLAYER_TRANSPORTS.ONLINE
            : sessionContract.multiplayerTransport);
    const modePath = String(source?.localSettings?.modePath || 'normal').trim().toLowerCase();
    const arcadeEnabled = modePath === 'arcade';
    const fightBonusesByVehicle = modePath === 'fight'
        && source?.localSettings?.fightHangar?.activeBonusesByVehicle
        && typeof source.localSettings.fightHangar.activeBonusesByVehicle === 'object'
        ? source.localSettings.fightHangar.activeBonusesByVehicle
        : {};
    const networkEnabled = sessionContract.isNetworkSession;
    const mode = sessionType === 'splitscreen' ? '2p' : '1p';
    const numHumans = networkEnabled
        ? 1
        : (fourPlayerPlanarActive ? 4 : (threePlayerSplitActive ? 3 : (mode === '2p' ? 2 : 1)));
    const huntFeatureEnabled = baseConfig?.HUNT?.ENABLED !== false;
    const requestedGameMode = fourPlayerPlanarActive
        ? (fourPlayerPlanarSelection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? GAME_MODE_TYPES.HUNT : GAME_MODE_TYPES.CLASSIC)
        : (threePlayerSplitActive
            ? (threePlayerSplitSelection.mode === FOUR_PLAYER_PLANAR_MODES.HUNT ? GAME_MODE_TYPES.HUNT : GAME_MODE_TYPES.CLASSIC)
            : source.gameMode);
    const requestedTeamObjective = normalizeTeamObjectiveType(huntSource.teamObjective);
    const objectiveGameMode = requestedGameMode === GAME_MODE_TYPES.HUNT && huntSource.teamMode === true
        && requestedTeamObjective === GAME_MODE_TYPES.ESCORT
        ? GAME_MODE_TYPES.ESCORT
        : requestedGameMode;
    const activeGameMode = resolveActiveGameMode(objectiveGameMode, huntFeatureEnabled);
    const fivePortalsActive = arcadeEnabled && isFivePortalsRunType(arcadeSource.runType);
    const huntModeActive = isHuntMode(activeGameMode, huntFeatureEnabled);

    const playerDefaults = baseConfig.PLAYER || CONFIG.PLAYER;
    const gameplayDefaults = baseConfig.GAMEPLAY || CONFIG.GAMEPLAY;
    const trailDefaults = baseConfig.TRAIL || CONFIG.TRAIL;
    const powerupDefaults = baseConfig.POWERUP || CONFIG.POWERUP;
    const projectileDefaults = baseConfig.PROJECTILE || CONFIG.PROJECTILE;
    const botDefaults = baseConfig.BOT || CONFIG.BOT;
    const homingDefaults = baseConfig.HOMING || CONFIG.HOMING;
    const controlsDefaults = baseConfig.KEYS || CONFIG.KEYS;
    const planarMode = fourPlayerPlanarActive || !!gameplaySource.planarMode;
    const sharedFourPlayerVehicleId = fourPlayerPlanarSelection.vehicleId;
    const sharedThreePlayerVehicleId = threePlayerSplitSelection.vehicleId;

    const botDifficulty = resolveBotDifficulty(source.botDifficulty, botDefaults);
    const requestedHeuristicProfile = String(source.botHeuristicProfile || 'balanced').trim().toLowerCase();
    const botHeuristicProfile = ['defensive', 'balanced', 'aggressive'].includes(requestedHeuristicProfile)
        ? requestedHeuristicProfile
        : 'balanced';
    const botPolicyStrategy = normalizeBotPolicyStrategy(source.botPolicyStrategy, BOT_POLICY_STRATEGIES.AUTO);
    const trainerBridgeEnabled = !!botBridgeSource.enabled;
    const botPolicyType = resolveBotPolicyType(botPolicyStrategy, activeGameMode, {
        huntFeatureEnabled,
        planarMode,
    });
    const arcadeGhostDuelMode = resolveArcadeGhostDuelMode(source, { sessionType });
    const arcadeGhostTrailCollisionEnabled = resolveArcadeGhostTrailCollisionEnabled(source, {
        sessionType,
        ghostDuelMode: arcadeGhostDuelMode,
    });

    const sessionMapKey = fivePortalsActive ? FIVE_PORTALS_MAPS[0] : fourPlayerPlanarActive
        ? fourPlayerPlanarSelection.mapKey
        : (threePlayerSplitActive ? threePlayerSplitSelection.mapKey : String(source.mapKey || 'standard'));

    const teamHunt = normalizeTeamHuntSettings(huntSource);
    const runtimeConfig = {
        session: {
            sessionType,
            multiplayerTransport,
            mode,
            modePath,
            numHumans,
            networkEnabled,
            splitScreenVariant: fourPlayerPlanarActive
                ? SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR
                : (threePlayerSplitActive ? SPLIT_SCREEN_VARIANTS.THREE_PLAYER : SPLIT_SCREEN_VARIANTS.STANDARD),
            viewportLayout: networkEnabled || sessionType !== RUNTIME_SESSION_TYPES.SPLITSCREEN
                ? VIEWPORT_LAYOUTS.SINGLE
                : (fourPlayerPlanarActive
                    ? VIEWPORT_LAYOUTS.FOUR_GRID
                    : (threePlayerSplitActive ? threePlayerSplitSelection.viewportLayout : VIEWPORT_LAYOUTS.TWO_COLUMNS)),
            fourPlayerPlanar: fourPlayerPlanarActive ? {
                mode: fourPlayerPlanarSelection.mode,
                mapKey: fourPlayerPlanarSelection.mapKey,
                vehicleId: sharedFourPlayerVehicleId,
                botCount: fourPlayerPlanarSelection.botCount,
                rollBindings: fourPlayerPlanarSelection.rollBindings,
            } : null,
            threePlayerSplit: threePlayerSplitActive ? {
                mode: threePlayerSplitSelection.mode,
                mapKey: threePlayerSplitSelection.mapKey,
                vehicleId: sharedThreePlayerVehicleId,
                botCount: threePlayerSplitSelection.botCount,
                viewportLayout: threePlayerSplitSelection.viewportLayout,
                deviceAssignment: threePlayerSplitSelection.deviceAssignment,
            } : null,
            maxPlayers: clampSettingValue(source.maxPlayers, { min: 2, max: 10, step: 1 }, 10),
            numBots: fivePortalsActive ? 0 : fourPlayerPlanarActive
                ? fourPlayerPlanarSelection.botCount
                : (threePlayerSplitActive
                    ? threePlayerSplitSelection.botCount
                    : clampSettingValue(source.numBots, runtimeLimits.session.numBots, 0)),
            winsNeeded: clampSettingValue(source.winsNeeded, runtimeLimits.session.winsNeeded, 5),
            mapKey: sessionMapKey,
            portalsEnabled: fivePortalsActive || !!source.portalsEnabled,
            activeGameMode,
        },
        player: {
            speed: clampSettingValue(gameplaySource.speed, runtimeLimits.gameplay.speed, playerDefaults.SPEED),
            turnSpeed: clampSettingValue(gameplaySource.turnSensitivity, runtimeLimits.gameplay.turnSensitivity, playerDefaults.TURN_SPEED),
            modelScale: clampSettingValue(gameplaySource.planeScale, runtimeLimits.gameplay.planeScale, playerDefaults.MODEL_SCALE),
            autoRoll: typeof source.autoRoll === 'boolean' ? source.autoRoll : !!playerDefaults.AUTO_ROLL,
            invertPitch: {
                PLAYER_1: source?.invertPitch?.PLAYER_1 === true,
                PLAYER_2: source?.invertPitch?.PLAYER_2 === true, PLAYER_3: source?.invertPitch?.PLAYER_3 === true,
            },
            vehicles: {
                PLAYER_1: fourPlayerPlanarActive
                    ? sharedFourPlayerVehicleId
                    : (threePlayerSplitActive ? sharedThreePlayerVehicleId : (source?.vehicles?.PLAYER_1 || playerDefaults.DEFAULT_VEHICLE_ID || 'ship5')),
                PLAYER_2: fourPlayerPlanarActive
                    ? sharedFourPlayerVehicleId
                    : (threePlayerSplitActive ? sharedThreePlayerVehicleId : (source?.vehicles?.PLAYER_2 || playerDefaults.DEFAULT_VEHICLE_ID || 'ship5')),
                ...(fourPlayerPlanarActive ? {
                    PLAYER_3: sharedFourPlayerVehicleId,
                    PLAYER_4: sharedFourPlayerVehicleId,
                } : {}),
                ...(threePlayerSplitActive ? {
                    PLAYER_3: sharedThreePlayerVehicleId,
                } : {}),
            },
            fightLoadouts: modePath === 'fight' ? {
                PLAYER_1: normalizeFightBonuses(fightBonusesByVehicle[source?.vehicles?.PLAYER_1 || playerDefaults.DEFAULT_VEHICLE_ID || 'ship5']),
                PLAYER_2: normalizeFightBonuses(fightBonusesByVehicle[source?.vehicles?.PLAYER_2 || playerDefaults.DEFAULT_VEHICLE_ID || 'ship5']),
            } : null,
        },
        gameplay: {
            planarMode,
            // The map owns its portal count; there is no player setting for it.
            portalCount: resolveMapPortalEntryCount((baseConfig?.MAPS || CONFIG.MAPS || {})[sessionMapKey], { planarMode }),
            planarLevelCount: clampSettingValue(gameplaySource.planarLevelCount, runtimeLimits.gameplay.planarLevelCount, gameplayDefaults.PLANAR_LEVEL_COUNT || 5),
            nextCheckpointGlowIntensity: clampSettingValue(
                gameplaySource.nextCheckpointGlowIntensity,
                runtimeLimits.gameplay.nextCheckpointGlowIntensity,
                DEFAULT_NEXT_CHECKPOINT_GLOW_INTENSITY
            ),
            portalBeams: false,
            planarAimInputSpeed: toNumber(gameplayDefaults.PLANAR_AIM_INPUT_SPEED, 1.5),
            planarAimReturnSpeed: toNumber(gameplayDefaults.PLANAR_AIM_RETURN_SPEED, 0.6),
        },
        trail: {
            width: clampSettingValue(gameplaySource.trailWidth, runtimeLimits.gameplay.trailWidth, trailDefaults.WIDTH),
            maxSegments: clampSettingValue(gameplaySource.trailLength, runtimeLimits.gameplay.trailLength, trailDefaults.MAX_SEGMENTS),
            gapDuration: clampSettingValue(gameplaySource.gapSize, runtimeLimits.gameplay.gapSize, trailDefaults.GAP_DURATION),
            gapChance: clampSettingValue(gameplaySource.gapFrequency, runtimeLimits.gameplay.gapFrequency, trailDefaults.GAP_CHANCE),
        },
        powerup: {
            maxOnField: clampSettingValue(gameplaySource.itemAmount, runtimeLimits.gameplay.itemAmount, powerupDefaults.MAX_ON_FIELD),
        },
        projectile: {
            cooldown: clampSettingValue(gameplaySource.fireRate, runtimeLimits.gameplay.fireRate, projectileDefaults.COOLDOWN),
        },
        bot: {
            activeDifficulty: botDifficulty,
            heuristicProfile: botHeuristicProfile,
            heuristicTuning: createBotHeuristicTuningSnapshot(source.botHeuristicTuning),
            policyStrategy: botPolicyStrategy,
            policyType: botPolicyType,
            trainerBridgeEnabled,
            trainerBridgeUrl: typeof botBridgeSource.url === 'string' && botBridgeSource.url.trim()
                ? botBridgeSource.url.trim()
                : 'ws://127.0.0.1:8765',
            trainerBridgeTimeoutMs: clampSettingValue(botBridgeSource.timeoutMs, runtimeLimits.botBridge.timeoutMs, 80),
            trainerBridgeMaxRetries: clampSettingValue(botBridgeSource.maxRetries, runtimeLimits.botBridge.maxRetries, 1),
            trainerBridgeRetryDelayMs: clampSettingValue(botBridgeSource.retryDelayMs, runtimeLimits.botBridge.retryDelayMs, 0),
            trainerCheckpointResumeToken: typeof botBridgeSource.resumeCheckpoint === 'string'
                ? botBridgeSource.resumeCheckpoint.trim()
                : '',
            trainerCheckpointResumeStrict: botBridgeSource.resumeStrict === true,
        },
        homing: {
            lockOnAngle: clampSettingValue(gameplaySource.lockOnAngle, runtimeLimits.gameplay.lockOnAngle, homingDefaults.LOCK_ON_ANGLE),
        },
        controls: createControlBindingsSnapshot(source.controls, controlsDefaults, { guardCombatConflicts: true }),
        huntCombat: {
            mgTrailAimRadius: clampSettingValue(
                gameplaySource.mgTrailAimRadius,
                runtimeLimits.gameplay.mgTrailAimRadius,
                baseConfig?.HUNT?.MG?.TRAIL_HIT_RADIUS ?? CONFIG?.HUNT?.MG?.TRAIL_HIT_RADIUS ?? 0.78
            ),
            fightTuningEnabled: modePath === 'fight',
            fightPlayerHp: clampSettingValue(
                gameplaySource.fightPlayerHp,
                runtimeLimits.gameplay.fightPlayerHp,
                baseConfig?.HUNT?.PLAYER_MAX_HP ?? CONFIG?.HUNT?.PLAYER_MAX_HP ?? 100
            ),
            fightMgDamage: clampSettingValue(
                gameplaySource.fightMgDamage,
                runtimeLimits.gameplay.fightMgDamage,
                baseConfig?.HUNT?.MG?.DAMAGE ?? CONFIG?.HUNT?.MG?.DAMAGE ?? 7.75
            ),
        },
        hunt: {
            teamMode: activeGameMode === GAME_MODE_TYPES.ESCORT
                || (activeGameMode === GAME_MODE_TYPES.HUNT
                    && (requestedTeamObjective === TEAM_OBJECTIVE_TYPES.FLAGS || teamHunt.enabled)),
            teamObjective: requestedTeamObjective,
            teamSize: teamHunt.teamSize,
            teamBotDifficulty: teamHunt.botDifficulty,
            enabled: huntModeActive,
            respawnEnabled: huntModeActive
                ? ((activeGameMode === GAME_MODE_TYPES.HUNT && requestedTeamObjective === TEAM_OBJECTIVE_TYPES.FLAGS)
                    || !!huntSource.respawnEnabled)
                : false,
            deathmatchKillLimit: clampSettingValue(
                huntSource.deathmatchKillLimit,
                runtimeLimits.hunt.deathmatchKillLimit,
                baseConfig?.HUNT?.DEATHMATCH_KILL_LIMIT ?? CONFIG?.HUNT?.DEATHMATCH_KILL_LIMIT ?? 10
            ),
            timeLimitSeconds: huntSource.timeLimitEnabled === false ? 0 : 300,
            winCondition: normalizeHuntWinCondition(huntSource.winCondition),
        },
        arcade: {
            // Same normalizer the settings sanitizer uses, so persisted values and the
            // values a match runs with can never drift apart.
            ...normalizeArcadeRunSettings(arcadeSource),
            enabled: arcadeEnabled,
            dailyRulesVersion: arcadeSource.dailyChallenge === true ? ARCADE_DAILY_RULES_VERSION : null,
            seed: resolveArcadeSeed(source, activeGameMode),
            ghostDuelMode: arcadeGhostDuelMode,
            ghostTrailCollisionEnabled: arcadeGhostTrailCollisionEnabled,
        },
        recording: normalizeRecordingCaptureSettings(recordingSource, createDefaultRecordingCaptureSettings()),
        cameraPerspective: normalizeCameraPerspectiveSettings(
            cameraPerspectiveSource,
            createDefaultCameraPerspectiveSettings()
        ),
        settingsSnapshot: cloneJsonValue(source),
    };

    return runtimeConfig;
}

export function applyRuntimeConfigCompatibility(runtimeConfig, targetConfig = CONFIG_BASE) {
    const nextConfig = cloneJsonValue(targetConfig || CONFIG_BASE);
    if (!runtimeConfig || typeof runtimeConfig !== 'object') {
        return nextConfig;
    }

    nextConfig.PLAYER.SPEED = runtimeConfig.player.speed;
    nextConfig.PLAYER.TURN_SPEED = runtimeConfig.player.turnSpeed;
    nextConfig.PLAYER.MODEL_SCALE = runtimeConfig.player.modelScale;
    nextConfig.PLAYER.AUTO_ROLL = runtimeConfig.player.autoRoll;
    nextConfig.PLAYER.VEHICLES = {
        PLAYER_1: runtimeConfig.player.vehicles.PLAYER_1,
        PLAYER_2: runtimeConfig.player.vehicles.PLAYER_2,
    };

    nextConfig.GAMEPLAY.PLANAR_MODE = runtimeConfig.gameplay.planarMode;
    nextConfig.GAMEPLAY.PORTAL_COUNT = runtimeConfig.gameplay.portalCount;
    nextConfig.GAMEPLAY.PLANAR_LEVEL_COUNT = runtimeConfig.gameplay.planarLevelCount;
    nextConfig.GAMEPLAY.NEXT_CHECKPOINT_GLOW_INTENSITY = runtimeConfig.gameplay.nextCheckpointGlowIntensity;
    nextConfig.GAMEPLAY.PORTAL_BEAMS = runtimeConfig.gameplay.portalBeams;

    nextConfig.TRAIL.WIDTH = runtimeConfig.trail.width;
    nextConfig.TRAIL.MAX_SEGMENTS = runtimeConfig.trail.maxSegments;
    nextConfig.TRAIL.GAP_DURATION = runtimeConfig.trail.gapDuration;
    nextConfig.TRAIL.GAP_CHANCE = runtimeConfig.trail.gapChance;

    nextConfig.POWERUP.MAX_ON_FIELD = runtimeConfig.powerup.maxOnField;
    nextConfig.PROJECTILE.COOLDOWN = runtimeConfig.projectile.cooldown;
    nextConfig.BOT.ACTIVE_DIFFICULTY = runtimeConfig.bot.activeDifficulty;
    nextConfig.BOT.ACTIVE_POLICY_STRATEGY = runtimeConfig?.bot?.policyStrategy || BOT_POLICY_STRATEGIES.AUTO;
    nextConfig.BOT.ACTIVE_POLICY_TYPE = runtimeConfig?.bot?.policyType || BOT_POLICY_TYPES.RULE_BASED;
    nextConfig.BOT.TRAINER_BRIDGE_ENABLED = !!runtimeConfig.bot.trainerBridgeEnabled;
    nextConfig.BOT.TRAINER_BRIDGE_URL = runtimeConfig.bot.trainerBridgeUrl;
    nextConfig.BOT.TRAINER_BRIDGE_TIMEOUT_MS = runtimeConfig.bot.trainerBridgeTimeoutMs;
    nextConfig.BOT.TRAINER_BRIDGE_MAX_RETRIES = runtimeConfig.bot.trainerBridgeMaxRetries;
    nextConfig.BOT.TRAINER_BRIDGE_RETRY_DELAY_MS = runtimeConfig.bot.trainerBridgeRetryDelayMs;
    nextConfig.BOT.TRAINER_CHECKPOINT_RESUME_TOKEN = runtimeConfig.bot.trainerCheckpointResumeToken;
    nextConfig.BOT.TRAINER_CHECKPOINT_RESUME_STRICT = runtimeConfig.bot.trainerCheckpointResumeStrict;
    nextConfig.HOMING.LOCK_ON_ANGLE = runtimeConfig.homing.lockOnAngle;
    if (nextConfig.HUNT) {
        nextConfig.HUNT.ACTIVE_MODE = runtimeConfig?.session?.activeGameMode || GAME_MODE_TYPES.CLASSIC;
        nextConfig.HUNT.RESPAWN_ENABLED = !!runtimeConfig?.hunt?.respawnEnabled;
        nextConfig.HUNT.DEATHMATCH_KILL_LIMIT = Math.max(1, Number(runtimeConfig?.hunt?.deathmatchKillLimit) || 10);
        nextConfig.HUNT.DEATHMATCH_TIME_LIMIT_SECONDS = Math.max(0, Number(runtimeConfig?.hunt?.timeLimitSeconds) || 0);
        nextConfig.HUNT.WIN_CONDITION = normalizeHuntWinCondition(runtimeConfig?.hunt?.winCondition);
        nextConfig.HUNT.TEAM_MODE = runtimeConfig?.hunt?.teamMode === true;
        nextConfig.HUNT.TEAM_OBJECTIVE = normalizeTeamObjectiveType(runtimeConfig?.hunt?.teamObjective);
        nextConfig.HUNT.TEAM_SIZE = Math.max(1, Math.min(5, Number(runtimeConfig?.hunt?.teamSize) || 4));
        nextConfig.HUNT.TEAM_BOT_DIFFICULTY = { ...runtimeConfig?.hunt?.teamBotDifficulty };
        const fightTuningEnabled = runtimeConfig?.huntCombat?.fightTuningEnabled === true;
        if (fightTuningEnabled) {
            nextConfig.HUNT.PLAYER_MAX_HP = Math.max(
                1,
                Number(runtimeConfig?.huntCombat?.fightPlayerHp || nextConfig?.HUNT?.PLAYER_MAX_HP || 100)
            );
        }
        if (nextConfig.HUNT.MG && runtimeConfig?.huntCombat) {
            nextConfig.HUNT.MG = {
                ...nextConfig.HUNT.MG,
                TRAIL_HIT_RADIUS: runtimeConfig.huntCombat.mgTrailAimRadius,
                ...(fightTuningEnabled
                    ? {
                        DAMAGE: Math.max(
                            1,
                            Number(runtimeConfig?.huntCombat?.fightMgDamage || nextConfig?.HUNT?.MG?.DAMAGE || 7.75)
                        ),
                    }
                    : {}),
            };
        }
    }

    return nextConfig;
}
