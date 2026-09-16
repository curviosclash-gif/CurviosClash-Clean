import * as THREE from 'three';
import { GAME_STATE_IDS } from '../contracts/GameStateIds.js';
import {
    CONFIG_SECTIONS,
    getGameplayConfigSection,
} from '../contracts/GameplayConfigContract.js';
import {
    assembleMatchRuntimeProjection,
    createMatchRuntimeLockTargetProjection,
    createMatchRuntimePlayerProjection,
    createMatchRuntimeSessionPlayerProjection,
} from '../contracts/MatchRuntimeProjectionContract.js';

const TMP_AIM_DIRECTION = new THREE.Vector3();
const TMP_CONFIG_SOURCE = { config: null, entityRuntimeConfig: null };

function resolveNetworkPlayerSlots(game) {
    const slots = game?.runtimeConfig?.session?.networkPlayerSlots;
    return Array.isArray(slots) ? slots : [];
}

function resolveSessionPlayers(facade, game = null) {
    const slots = resolveNetworkPlayerSlots(game);
    if (slots.length > 0) {
        return slots.map((slot) => ({
            id: String(slot?.peerId || slot?.playerId || slot?.id || ''),
            peerId: String(slot?.peerId || slot?.playerId || slot?.id || ''),
            index: Number.isInteger(slot?.playerIndex) ? slot.playerIndex : 0,
            ping: Number(slot?.ping) || -1,
            isLocal: slot?.isLocal === true,
        }));
    }
    return facade?.session?.getPlayers?.() || [];
}

function resolveLocalPlayerIndex(facade, sessionPlayers = resolveSessionPlayers(facade), game = null) {
    const configuredLocalIndex = game?.runtimeConfig?.session?.localPlayerIndex;
    if (Number.isInteger(configuredLocalIndex)) {
        return configuredLocalIndex;
    }
    const localPlayerId = facade?.session?.localPlayerId;
    if (localPlayerId) {
        const localIndex = sessionPlayers.findIndex((player) => player.id === localPlayerId);
        if (localIndex >= 0) {
            return localIndex;
        }
    }
    return 0;
}

function buildSessionPlayersProjection(facade, sessionPlayers = resolveSessionPlayers(facade)) {
    const localPlayerId = facade?.session?.localPlayerId || '';
    return sessionPlayers.map((player, index) => createMatchRuntimeSessionPlayerProjection({
        playerIndex: Number.isInteger(player?.index) ? player.index : index,
        playerId: String(player?.id || ''),
        pingMs: Number.isFinite(Number(player?.ping)) ? Math.max(0, Math.round(Number(player.ping))) : -1,
        isLocal: player?.isLocal === true || (!!localPlayerId && player?.id === localPlayerId),
    }));
}

function resolveLocalHumanCount(game, runtimeState) {
    return Math.max(1, Number(
        game?.runtimeConfig?.session?.localHumanCount
        || runtimeState?.localHumanCount
        || runtimeState?.numHumans
        || game?.numHumans
    ) || 1);
}

function buildTraversalProjection(entityManager, playerIndex) {
    if (!entityManager?.arena?.getTraversalSignalForEntity) {
        return null;
    }
    return entityManager.arena.getTraversalSignalForEntity(playerIndex);
}

function buildPlayerHudProjection({ runtimeState, game, entityManager, player }) {
    if (!player) return null;
    const configSource = TMP_CONFIG_SOURCE;
    configSource.config = runtimeState?.config || game?.config || null;
    configSource.entityRuntimeConfig = player?.entityRuntimeConfig || player?.gameplayConfig || null;
    const playerConfig = getGameplayConfigSection(configSource, CONFIG_SECTIONS.PLAYER);
    const cameraConfig = getGameplayConfigSection(configSource, CONFIG_SECTIONS.CAMERA);
    const gameplayConfig = getGameplayConfigSection(configSource, CONFIG_SECTIONS.GAMEPLAY);
    const cameraModeId = cameraConfig?.MODES?.[player?.cameraMode] || 'THIRD_PERSON';
    const aimDirection = typeof player?.getAimDirection === 'function'
        ? player.getAimDirection(TMP_AIM_DIRECTION)
        : null;
    const boostCapacity = Math.max(0.001, Number(playerConfig.BOOST_DURATION) || 1);
    const boostCharge = Math.max(0, Math.min(boostCapacity, Number(player?.boostCharge) || 0));
    const slowMoCapacity = Math.max(0.001, Number(playerConfig.SLOWMO_DURATION) || 1);
    const slowMoCharge = Math.max(0, Math.min(slowMoCapacity, Number(player?.slowMoCharge) || 0));
    return createMatchRuntimePlayerProjection({
        playerIndex: Number.isInteger(player?.index) ? player.index : 0,
        isBot: player?.isBot === true,
        alive: player?.alive !== false,
        score: Math.max(0, Math.round(Number(player?.score) || 0)),
        speed: Number(player?.speed) || 0,
        boostCharge,
        boostCapacity,
        boostRecharging: !player?.manualBoostActive && boostCharge < (boostCapacity - 0.001),
        slowMoCharge,
        slowMoCapacity,
        slowMoRecharging: !player?.manualSlowMoActive && slowMoCharge < (slowMoCapacity - 0.001),
        slowMoActive: player?.manualSlowMoActive === true,
        hp: Math.max(0, Number(player?.hp) || 0),
        maxHp: Math.max(1, Number(player?.maxHp) || 1),
        shieldHP: Math.max(0, Number(player?.shieldHP) || 0),
        maxShieldHp: Math.max(1, Number(player?.maxShieldHp) || 1),
        position: player?.position,
        quaternion: player?.quaternion,
        aimDirection,
        inventory: player?.inventory,
        rocketInventory: player?.rocketInventory,
        activeEffects: player?.activeEffects,
        selectedItemIndex: Number(player?.selectedItemIndex) || 0,
        itemUseCooldownRemaining: Math.max(0, Number(player?.itemUseCooldownRemaining) || 0),
        shootCooldown: Math.max(0, Number(player?.shootCooldown) || 0),
        planarMode: gameplayConfig?.PLANAR_MODE === true,
        cameraModeId: String(cameraModeId || 'THIRD_PERSON'),
        exclusionZoneState: player?.exclusionZoneState,
        mapExpansion: entityManager?.arena?.getMapExpansionHudState?.() || null,
        mapDestructible: entityManager?._mapDestructibleSystem?.getHudState?.() || null,
        traversal: buildTraversalProjection(entityManager, player?.index),
        turrets: entityManager?._staticTurretSystem?.getHudStatesForPlayer?.(player?.index) || [],
        turret: entityManager?._staticTurretSystem?.getHudStateForPlayer?.(player?.index) || null,
    });
}

function buildLockTargetProjection(entityManager, playerIndex) {
    if (!entityManager?.getLockOnTarget) {
        return null;
    }
    const target = entityManager.getLockOnTarget(playerIndex);
    if (!target) {
        return null;
    }
    return createMatchRuntimeLockTargetProjection({
        playerIndex,
        targetPlayerIndex: Number.isInteger(target?.index)
            ? target.index
            : (Number.isInteger(target?.playerIndex) ? target.playerIndex : -1),
        alive: target?.alive !== false,
        position: target?.position,
    });
}

export function buildMatchRuntimeProjection({ game, runtimeState, facade, sessionRuntime }) {
    const entityManager = runtimeState?.entityManager || game?.entityManager || null;
    const authoritativeFightState = entityManager?._authoritativeHuntState || null;
    const localDeathmatchState = entityManager?._roundOutcomeSystem?.getDeathmatchState?.() || null;
    const deathmatchState = authoritativeFightState || localDeathmatchState || {};
    const sessionPlayers = resolveSessionPlayers(facade, game);
    const localPlayerIndex = resolveLocalPlayerIndex(facade, sessionPlayers, game);
    const players = Array.isArray(entityManager?.players)
        ? entityManager.players
            .map((player) => buildPlayerHudProjection({ runtimeState, game, entityManager, player }))
            .filter(Boolean)
        : [];
    const lockTargets = players
        .map((player) => buildLockTargetProjection(entityManager, player?.playerIndex))
        .filter(Boolean);
    const huntState = game?.huntState && typeof game.huntState === 'object'
        ? game.huntState
        : {};
    const modeId = String(runtimeState?.activeGameMode || entityManager?.activeGameMode || game?.activeGameMode || '');
    const combatModeId = String(entityManager?.gameModeStrategy?.getPickupModeType?.() || modeId);
    const gameStateId = String(sessionRuntime?.lifecycle?.gameStateId || game?.state || '');
    const parcoursHudState = entityManager?.getParcoursHudState?.(localPlayerIndex) || null;
    const scoreboardRows = authoritativeFightState?.scoreboardRows
        || entityManager?.getHuntScoreboard?.()
        || [];

    return assembleMatchRuntimeProjection({
        updatedAt: Date.now(),
        gameStateId,
        modeId,
        combatModeId,
        isNetworkSession: facade?.isNetworkSession?.() === true,
        localPlayerIndex,
        localHumanCount: resolveLocalHumanCount(game, runtimeState),
        players,
        sessionPlayers: buildSessionPlayersProjection(facade, sessionPlayers),
        lockTargets,
        globalFog: entityManager?.getGlobalFogState?.(),
        parcours: parcoursHudState,
        hunt: {
            active: entityManager?.gameModeStrategy?.hasCombatHud?.() === true
                && gameStateId !== GAME_STATE_IDS.MENU,
            killFeed: Array.isArray(huntState.killFeed) ? huntState.killFeed : [],
            overheatByPlayer: huntState.overheatByPlayer || {},
            damageIndicatorsByPlayer: huntState.damageIndicatorsByPlayer || {},
            damageIndicator: huntState.damageIndicator || null,
            respawnEnabled: entityManager?.gameModeStrategy?.isRespawnEnabled?.() === true,
            deathmatchKillLimit: authoritativeFightState?.killLimit || entityManager?.entityRuntimeConfig?.HUNT?.DEATHMATCH_KILL_LIMIT || 10,
            respawnRemainingByPlayer: entityManager?.getHuntRespawnRemainingByPlayer?.() || {},
            scoreboardRows,
            scoreboardSummary: entityManager?.getHuntScoreboardSummary?.(4, scoreboardRows) || '',
            elapsedSeconds: deathmatchState.elapsedSeconds || 0,
            timeLimitSeconds: deathmatchState.timeLimitSeconds || 0,
            timeRemainingSeconds: deathmatchState.timeRemainingSeconds || 0,
            overtime: deathmatchState.overtime === true,
            authoritativeClient: entityManager?.isFightOutcomeAuthority === false,
        },
        arcade: entityManager?.endlessParcoursRuntime?.getHudState?.()
            || facade?.arcadeRunRuntime?.getHudState?.()
            || null,
    });
}
