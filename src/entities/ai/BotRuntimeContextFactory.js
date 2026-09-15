// ============================================
// BotRuntimeContextFactory.js - centralized runtime context for bot policies
// ============================================

import { GAME_MODE_TYPES, normalizeGameMode } from '../../hunt/HuntMode.js';
import { createObservationContext } from './observation/ObservationSystem.js';
import { OBSERVATION_LENGTH_V1 } from './observation/ObservationSchemaV1.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

const RUNTIME_CONTEXT_BY_PLAYER = new WeakMap();
const CONTROL_PROFILE_VERSION = 'cp-v35';
const LEGACY_CONTROL_PROFILE_VERSION = 'legacy-v1';
const ANY_PROFILE_TOKENS = new Set(['*', 'any', 'multi', 'multi-profile', 'multi-profile-training']);

function resolveRuntimeMode(entityManager) {
    if (entityManager?.combatModeType === GAME_MODE_TYPES.HUNT) {
        return GAME_MODE_TYPES.HUNT;
    }
    if (entityManager?.runtimeConfig?.arcade?.enabled === true) {
        return GAME_MODE_TYPES.ARCADE;
    }
    const entityRuntimeConfig = resolveEntityRuntimeConfig(entityManager);
    const requestedMode = entityManager?.activeGameMode
        || entityManager?.runtimeConfig?.session?.activeGameMode
        || entityRuntimeConfig?.HUNT?.ACTIVE_MODE
        || GAME_MODE_TYPES.CLASSIC;
    const normalized = normalizeGameMode(requestedMode, GAME_MODE_TYPES.CLASSIC);
    if (normalized === GAME_MODE_TYPES.HUNT) {
        return GAME_MODE_TYPES.HUNT;
    }
    return entityManager?.huntEnabled ? GAME_MODE_TYPES.HUNT : GAME_MODE_TYPES.CLASSIC;
}

function toPositiveNumber(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return numeric;
}

function toProfileToken(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    const rounded = Math.round(numeric * 1000) / 1000;
    return String(rounded);
}

function normalizeProfileId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().toLowerCase();
    return trimmed;
}

function modeDimensionKey(mode, planarMode) {
    return `${mode}-${planarMode ? '2d' : '3d'}`;
}

function buildRampControlProfileId(mode, planarMode, control) {
    const dimensionKey = modeDimensionKey(mode, planarMode);
    return `${CONTROL_PROFILE_VERSION}:${dimensionKey}:s${toProfileToken(control.speed)}:t${toProfileToken(control.turnSpeed)}:r${toProfileToken(control.rollSpeed)}:ra${toProfileToken(control.rampAttackRate)}:rr${toProfileToken(control.rampReleaseRate)}`;
}

function buildLegacyControlProfileId(mode, planarMode, control) {
    const dimensionKey = modeDimensionKey(mode, planarMode);
    return `${LEGACY_CONTROL_PROFILE_VERSION}:${dimensionKey}:s${toProfileToken(control.speed)}:t${toProfileToken(control.turnSpeed)}:r${toProfileToken(control.rollSpeed)}`;
}

function matchesProfileList(value, rampControlProfileId) {
    if (!Array.isArray(value)) return false;
    const normalizedTarget = normalizeProfileId(rampControlProfileId);
    for (let i = 0; i < value.length; i++) {
        const token = normalizeProfileId(value[i]);
        if (!token) continue;
        if (token === normalizedTarget || ANY_PROFILE_TOKENS.has(token)) {
            return true;
        }
    }
    return false;
}

function hasConfiguredProfileMatch(botConfig, rampControlProfileId) {
    if (!botConfig || typeof botConfig !== 'object') {
        return false;
    }

    if (botConfig.multiProfileTraining === true) {
        return true;
    }

    const directProfile = normalizeProfileId(botConfig.controlProfileId);
    const normalizedTarget = normalizeProfileId(rampControlProfileId);
    if (directProfile) {
        if (directProfile === normalizedTarget || ANY_PROFILE_TOKENS.has(directProfile)) {
            return true;
        }
    }

    if (matchesProfileList(botConfig.controlProfileIds, rampControlProfileId)) {
        return true;
    }
    if (matchesProfileList(botConfig.rampControlProfileIds, rampControlProfileId)) {
        return true;
    }
    if (matchesProfileList(botConfig.allowedControlProfileIds, rampControlProfileId)) {
        return true;
    }
    if (matchesProfileList(botConfig.multiControlProfileIds, rampControlProfileId)) {
        return true;
    }

    return false;
}

function resolveControlDynamics(entityManager, player, target = null) {
    const entityRuntimeConfig = resolveEntityRuntimeConfig(entityManager);
    const runtimePlayerConfig = entityManager?.runtimeConfig?.player || null;
    const speed = toPositiveNumber(
        player?.baseSpeed ?? player?.speed,
        toPositiveNumber(runtimePlayerConfig?.speed, toPositiveNumber(entityRuntimeConfig?.PLAYER?.SPEED, 18))
    );
    const turnSpeed = toPositiveNumber(
        player?.turnSpeed,
        toPositiveNumber(runtimePlayerConfig?.turnSpeed, toPositiveNumber(entityRuntimeConfig?.PLAYER?.TURN_SPEED, 2.2))
    );
    const rollSpeed = toPositiveNumber(
        player?.rollSpeed,
        toPositiveNumber(entityRuntimeConfig?.PLAYER?.ROLL_SPEED, 2.0)
    );
    const rampAttackRate = toPositiveNumber(
        player?.controlRampRates?.attackRate ?? player?.controller?.rampAttackRate,
        12
    );
    const rampReleaseRate = toPositiveNumber(
        player?.controlRampRates?.releaseRate ?? player?.controller?.rampReleaseRate,
        8.5
    );

    const out = target || {};
    out.speed = speed;
    out.turnSpeed = turnSpeed;
    out.rollSpeed = rollSpeed;
    out.rampAttackRate = rampAttackRate;
    out.rampReleaseRate = rampReleaseRate;
    return out;
}

// Both profile ids are template strings over the control values, and this runs for every bot in
// every simulation step while those values practically never change. They are rebuilt only when one
// of the inputs actually differs.
function resolveControlProfileIds(cache, mode, planarMode, control) {
    if (cache.mode === mode
        && cache.planarMode === planarMode
        && cache.speed === control.speed
        && cache.turnSpeed === control.turnSpeed
        && cache.rollSpeed === control.rollSpeed
        && cache.rampAttackRate === control.rampAttackRate
        && cache.rampReleaseRate === control.rampReleaseRate) {
        return cache;
    }
    cache.mode = mode;
    cache.planarMode = planarMode;
    cache.speed = control.speed;
    cache.turnSpeed = control.turnSpeed;
    cache.rollSpeed = control.rollSpeed;
    cache.rampAttackRate = control.rampAttackRate;
    cache.rampReleaseRate = control.rampReleaseRate;
    cache.rampControlProfileId = buildRampControlProfileId(mode, planarMode, control);
    cache.legacyControlProfileId = buildLegacyControlProfileId(mode, planarMode, control);
    return cache;
}

function createCachedRuntimeContext() {
    return {
        dt: 0,
        entityManager: null,
        runtimeConfig: null,
        difficulty: '',
        player: null,
        arena: null,
        players: [],
        visiblePlayers: [],
        navigationPlayers: [],
        projectiles: [],
        powerups: [],
        visiblePowerups: [],
        trailSpatialIndex: null,
        mode: GAME_MODE_TYPES.CLASSIC,
        rules: {
            planarMode: false,
            huntEnabled: false,
            portalsEnabled: false,
            controlProfileId: '',
            controlProfileMatch: false,
            botRampEnabled: false,
            dynamicActionAdapterEnabled: false,
        },
        controlDynamics: {
            speed: 0,
            turnSpeed: 0,
            rollSpeed: 0,
            rampAttackRate: 0,
            rampReleaseRate: 0,
            rampEnabled: false,
            dynamicActionAdapterEnabled: false,
            discreteRateThreshold: 0.18,
        },
        controlProfileId: '',
        rampControlProfileId: '',
        legacyControlProfileId: '',
        controlProfileMatch: false,
        controlProfileAllowsRamps: false,
        dynamicActionAdapterEnabled: false,
        observationContext: null,
        observationBuffer: new Array(OBSERVATION_LENGTH_V1).fill(0),
        observation: null,
        huntTarget: null,
    };
}

function resolveCachedRuntimeContext(player) {
    if (!player || (typeof player !== 'object' && typeof player !== 'function')) {
        return createCachedRuntimeContext();
    }
    let cached = RUNTIME_CONTEXT_BY_PLAYER.get(player);
    if (!cached) {
        cached = createCachedRuntimeContext();
        RUNTIME_CONTEXT_BY_PLAYER.set(player, cached);
    }
    return cached;
}

export function createBotRuntimeContext(entityManager, player, dt = 0, options = {}) {
    const entityRuntimeConfig = resolveEntityRuntimeConfig(entityManager);
    const mode = resolveRuntimeMode(entityManager);
    const allPlayers = Array.isArray(entityManager?.players) ? entityManager.players : [];
    const projectiles = Array.isArray(entityManager?.projectiles) ? entityManager.projectiles : [];
    const allPowerups = Array.isArray(entityManager?.powerupManager?.items)
        ? entityManager.powerupManager.items
        : [];
    const globalFog = entityManager?._globalFogEffectSystem || null;
    const visiblePlayers = globalFog?.filterVisiblePlayers?.(player, allPlayers) || allPlayers;
    const visiblePowerups = globalFog?.filterVisiblePowerups?.(player, allPowerups) || allPowerups;
    const planarMode = !!(entityManager?.runtimeConfig?.gameplay?.planarMode ?? entityRuntimeConfig?.GAMEPLAY?.PLANAR_MODE);
    const includeObservationContext = options?.includeObservationContext !== false;
    const runtimeContext = resolveCachedRuntimeContext(player);
    const rules = runtimeContext.rules || (runtimeContext.rules = {
        planarMode: false,
        huntEnabled: false,
        portalsEnabled: false,
        controlProfileId: '',
        controlProfileMatch: false,
        botRampEnabled: false,
        dynamicActionAdapterEnabled: false,
    });
    const controlDynamics = runtimeContext.controlDynamics || (runtimeContext.controlDynamics = {
        speed: 0,
        turnSpeed: 0,
        rollSpeed: 0,
        rampAttackRate: 0,
        rampReleaseRate: 0,
        rampEnabled: false,
        dynamicActionAdapterEnabled: false,
        discreteRateThreshold: 0.18,
    });

    const profileCache = runtimeContext._controlProfileCache
        || (runtimeContext._controlProfileCache = { mode: '', planarMode: null, control: {} });
    const resolvedControl = resolveControlDynamics(entityManager, player, profileCache.control);
    const profileIds = resolveControlProfileIds(profileCache, mode, planarMode, resolvedControl);
    const rampControlProfileId = profileIds.rampControlProfileId;
    const legacyControlProfileId = profileIds.legacyControlProfileId;

    const runtimeBotConfig = entityManager?.runtimeConfig?.bot || null;
    const botRampFeatureEnabled = !!(
        runtimeBotConfig?.enableBotInputRamps
        ?? runtimeBotConfig?.inputRampEnabled
        ?? runtimeBotConfig?.rampEnabled
        ?? false
    );
    const controlProfileMatch = hasConfiguredProfileMatch(runtimeBotConfig, rampControlProfileId);
    const controlProfileAllowsRamps = player?.isBot
        ? (botRampFeatureEnabled && controlProfileMatch)
        : (player?.controlRampEnabled !== false);
    const dynamicActionAdapterEnabled = !!(
        runtimeBotConfig?.dynamicActionAdapterEnabled
        ?? runtimeBotConfig?.actionAdapterEnabled
        ?? false
    ) && controlProfileAllowsRamps;
    const activeControlProfileId = controlProfileAllowsRamps
        ? rampControlProfileId
        : legacyControlProfileId;

    runtimeContext.dt = Number.isFinite(dt) ? dt : 0;
    runtimeContext.entityManager = entityManager || null;
    runtimeContext.runtimeConfig = entityManager?.runtimeConfig || null;
    runtimeContext.difficulty = String(
        player?.endlessDifficulty
        || entityManager?.runtimeConfig?.bot?.activeDifficulty
        || entityManager?.botDifficulty
        || ''
    );
    runtimeContext.player = player || null;
    runtimeContext.arena = entityManager?.arena || null;
    runtimeContext.players = visiblePlayers;
    runtimeContext.visiblePlayers = visiblePlayers;
    runtimeContext.navigationPlayers = allPlayers;
    runtimeContext.projectiles = projectiles;
    runtimeContext.powerups = visiblePowerups;
    runtimeContext.visiblePowerups = visiblePowerups;
    runtimeContext.trailSpatialIndex = entityManager?.getTrailSpatialIndex?.() || entityManager?._trailSpatialIndex || null;
    runtimeContext.mode = mode;

    rules.planarMode = planarMode;
    rules.huntEnabled = entityManager?.huntEnabled === true || mode === GAME_MODE_TYPES.HUNT;
    rules.portalsEnabled = !!entityManager?.arena?.portalsEnabled;
    rules.controlProfileId = activeControlProfileId;
    rules.controlProfileMatch = controlProfileMatch;
    rules.botRampEnabled = controlProfileAllowsRamps;
    rules.dynamicActionAdapterEnabled = dynamicActionAdapterEnabled;

    controlDynamics.speed = resolvedControl.speed;
    controlDynamics.turnSpeed = resolvedControl.turnSpeed;
    controlDynamics.rollSpeed = resolvedControl.rollSpeed;
    controlDynamics.rampAttackRate = resolvedControl.rampAttackRate;
    controlDynamics.rampReleaseRate = resolvedControl.rampReleaseRate;
    controlDynamics.rampEnabled = controlProfileAllowsRamps;
    controlDynamics.dynamicActionAdapterEnabled = dynamicActionAdapterEnabled;

    runtimeContext.controlProfileId = activeControlProfileId;
    runtimeContext.rampControlProfileId = rampControlProfileId;
    runtimeContext.legacyControlProfileId = legacyControlProfileId;
    runtimeContext.controlProfileMatch = controlProfileMatch;
    runtimeContext.controlProfileAllowsRamps = controlProfileAllowsRamps;
    runtimeContext.dynamicActionAdapterEnabled = dynamicActionAdapterEnabled;

    if (player && typeof player === 'object') {
        if (player.isBot) {
            player.controlRampEnabled = controlProfileAllowsRamps;
            player.dynamicActionAdapterEnabled = dynamicActionAdapterEnabled;
        }
        player.controlProfileId = activeControlProfileId;
    }

    runtimeContext.observationContext = includeObservationContext
        ? createObservationContext({
            arena: runtimeContext.arena,
            players: visiblePlayers,
            projectiles,
            mode,
            planarMode: rules.planarMode,
        }, runtimeContext.observationContext)
        : null;
    if (!runtimeContext.observationBuffer || runtimeContext.observationBuffer.length !== OBSERVATION_LENGTH_V1) {
        runtimeContext.observationBuffer = new Array(OBSERVATION_LENGTH_V1).fill(0);
    }
    runtimeContext.observation = null;
    runtimeContext.huntTarget = rules.huntEnabled && typeof entityManager?._checkLockOn === 'function'
        ? entityManager._checkLockOn(player)
        : null;
    return runtimeContext;
}
