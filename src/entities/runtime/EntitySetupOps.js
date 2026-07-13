import { Player } from '../Player.js';
import {
    normalizeBotPolicyType,
    resolveMatchBotPolicyType,
} from '../ai/BotPolicyTypes.js';
import { getVehicleIds, isValidVehicleId } from '../vehicle-registry.js';
import { createGameModeStrategy } from '../../modes/GameModeRegistry.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';

function normalizeActiveMode(mode) {
    return String(mode || '').trim().toLowerCase();
}

function resolvePolicyFallbackByMode(activeMode, planarMode = false) {
    return resolveMatchBotPolicyType({
        huntModeActive: normalizeActiveMode(activeMode) === 'hunt',
        planarMode: !!planarMode,
    });
}

function resolveConfiguredBotPolicyType({ requestedPolicyType, runtimeConfig, activeGameMode, planarMode, bridgeEnabled } = {}) {
    const runtimePolicyType = runtimeConfig?.bot?.policyType || null;
    const effectivePlanarMode = typeof planarMode === 'boolean'
        ? planarMode
        : !!runtimeConfig?.gameplay?.planarMode;
    const effectiveBridgeEnabled = typeof bridgeEnabled === 'boolean'
        ? bridgeEnabled
        : !!runtimeConfig?.bot?.trainerBridgeEnabled;
    const fallbackPolicyType = resolvePolicyFallbackByMode(activeGameMode, effectivePlanarMode);
    const resolvedPolicyType = normalizeBotPolicyType(requestedPolicyType || runtimePolicyType || fallbackPolicyType);
    return resolvedPolicyType;
}

function resolveDesktopRuntimeProbeOption(rawValue) {
    if (rawValue === true) {
        return () => true;
    }
    if (typeof rawValue === 'function') {
        return () => {
            try {
                return rawValue() === true;
            } catch {
                return false;
            }
        };
    }
    return () => false;
}

export class EntitySetupOps {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
    }

    runSetup(numHumans, numBots, options = {}) {
        const owner = this.entityManager;
        if (!owner) return;
        this.applySetupRuntimeOptions(options);
        const setupContext = this.resolveSetupPlayerContext(options);
        this.resetSetupCollections();
        this.setupHumanPlayers(numHumans, setupContext);
        this.setupBotPlayers(numHumans, numBots, setupContext);
    }

    applySetupRuntimeOptions(options = {}) {
        const owner = this.entityManager;
        if (!owner) return;
        owner.runtimeConfig = options.runtimeConfig || null;
        owner.entityRuntimeConfig = resolveEntityRuntimeConfig(options.entityRuntimeConfig || owner.entityRuntimeConfig || owner);
        owner.activeGameMode = options.activeGameMode
            || owner.runtimeConfig?.session?.activeGameMode
            || owner.entityRuntimeConfig?.HUNT?.ACTIVE_MODE
            || owner.activeGameMode
            || 'CLASSIC';
        owner.activeGameMode = String(owner.activeGameMode || 'CLASSIC').trim().toUpperCase();
        const activeModeLower = String(owner.activeGameMode || '').toLowerCase();
        const setupPlanarMode = typeof options.planarMode === 'boolean'
            ? options.planarMode
            : owner.entityRuntimeConfig?.GAMEPLAY?.PLANAR_MODE;
        const runtimePolicyStrategy = String(owner.runtimeConfig?.bot?.policyStrategy || '').trim().toLowerCase();
        const strategyForcesBridge = runtimePolicyStrategy === 'bridge';
        const setupBridgeEnabled = typeof options.bridgeEnabled === 'boolean'
            ? options.bridgeEnabled
            : (strategyForcesBridge || !!owner.runtimeConfig?.bot?.trainerBridgeEnabled);
        const runtimeSeed = Number(owner.runtimeConfig?.arcade?.seed);
        owner.runtimeRng = options.runtimeRng && typeof options.runtimeRng.next === 'function'
            ? options.runtimeRng
            : createRuntimeRng({
                seed: Number.isFinite(runtimeSeed) ? runtimeSeed : 0,
                random: typeof owner.runtimeRng?.next === 'function' ? owner.runtimeRng.next : Math.random,
            });
        owner.huntEnabled = activeModeLower === 'hunt' && owner.entityRuntimeConfig?.HUNT?.ENABLED !== false;
        owner.gameModeStrategy = createGameModeStrategy(owner.activeGameMode, {
            entityRuntimeConfig: owner.entityRuntimeConfig,
            runtimeRng: owner.runtimeRng,
        });
        owner.botDifficulty = options.botDifficulty
            || owner.entityRuntimeConfig?.BOT?.ACTIVE_DIFFICULTY
            || owner.botDifficulty;
        owner.botBridgeEnabled = setupBridgeEnabled;
        owner.botIsDesktopRuntime = resolveDesktopRuntimeProbeOption(options.isDesktopRuntime);
        owner.botPolicyType = resolveConfiguredBotPolicyType({
            requestedPolicyType: options.botPolicyType,
            runtimeConfig: owner.runtimeConfig,
            activeGameMode: owner.activeGameMode,
            planarMode: setupPlanarMode,
            bridgeEnabled: setupBridgeEnabled,
        });
    }

    resolveSetupPlayerContext(options = {}) {
        const entityRuntimeConfig = resolveEntityRuntimeConfig(options.entityRuntimeConfig || this.entityManager?.entityRuntimeConfig || null);
        const availableVehicleIds = getVehicleIds();
        const defaultVehicleId = String(entityRuntimeConfig.PLAYER?.DEFAULT_VEHICLE_ID || availableVehicleIds[0] || 'aircraft');
        const normalizeVehicleId = (value) => {
            const candidate = String(value || '').trim();
            if (isValidVehicleId(candidate)) {
                return candidate;
            }
            return defaultVehicleId;
        };
        const botVehicleSource = Array.isArray(options.botVehicleIds) && options.botVehicleIds.length > 0
            ? options.botVehicleIds
            : availableVehicleIds;
        const botVehicleIds = botVehicleSource.map((id) => normalizeVehicleId(id));
        return {
            humanConfigs: Array.isArray(options.humanConfigs) ? options.humanConfigs : [],
            modelScale: typeof options.modelScale === 'number'
                ? options.modelScale
                : (entityRuntimeConfig.PLAYER?.MODEL_SCALE || 1),
            defaultVehicleId,
            normalizeVehicleId,
            botVehicleIds,
        };
    }

    resetSetupCollections() {
        const owner = this.entityManager;
        if (!owner) return;
        owner.humanPlayers = [];
        owner.botByPlayer.clear();
    }

    setupHumanPlayers(numHumans, setupContext) {
        const owner = this.entityManager;
        if (!owner) return;
        const humanColors = [
            owner.entityRuntimeConfig?.COLORS?.PLAYER_1,
            owner.entityRuntimeConfig?.COLORS?.PLAYER_2,
        ];
        for (let i = 0; i < numHumans; i++) {
            const playerVehicleId = setupContext.normalizeVehicleId(setupContext.humanConfigs[i]?.vehicleId);
            const player = new Player(owner.renderer, i, humanColors[i], false, {
                vehicleId: playerVehicleId,
                entityManager: owner,
                entityRuntimeConfig: owner.entityRuntimeConfig,
            });
            player.setControlOptions({
                invertPitch: !!setupContext.humanConfigs[i]?.invertPitch,
                cockpitCamera: !!setupContext.humanConfigs[i]?.cockpitCamera,
                modelScale: setupContext.modelScale,
            });
            owner.players.push(player);
            owner.humanPlayers.push(player);
        }
    }

    setupBotPlayers(numHumans, numBots, setupContext) {
        const owner = this.entityManager;
        if (!owner) return;
        const botColors = Array.isArray(owner.entityRuntimeConfig?.COLORS?.BOT_COLORS)
            ? owner.entityRuntimeConfig.COLORS.BOT_COLORS
            : [0xff8a65];
        for (let i = 0; i < numBots; i++) {
            const color = botColors[i % botColors.length];
            const botVehicleId = setupContext.botVehicleIds.length > 0
                ? setupContext.botVehicleIds[i % setupContext.botVehicleIds.length]
                : setupContext.defaultVehicleId;
            const player = new Player(owner.renderer, numHumans + i, color, true, {
                vehicleId: botVehicleId,
                entityManager: owner,
                entityRuntimeConfig: owner.entityRuntimeConfig,
            });
            player.setControlOptions({ modelScale: setupContext.modelScale, invertPitch: false });
            const ai = owner.botPolicyRegistry.create(owner.botPolicyType, {
                difficulty: owner.botDifficulty,
                recorder: owner.recorder,
                runtimeConfig: owner.runtimeConfig,
                runtimeProfiler: owner.runtimeProfiler,
                entityRuntimeConfig: owner.entityRuntimeConfig,
                bridgeEnabled: owner.botBridgeEnabled,
                activeGameMode: owner.activeGameMode,
                isDesktopRuntime: owner.botIsDesktopRuntime,
            });
            const sensePhase = i % 4;
            if (typeof ai?.setSensePhase === 'function') {
                ai.setSensePhase(sensePhase); // Time-slicing for batched bot scans
            }
            ai.sensePhase = sensePhase;
            owner.players.push(player);
            owner.bots.push({ player, ai });
            owner.botByPlayer.set(player, ai);
        }
    }
}
