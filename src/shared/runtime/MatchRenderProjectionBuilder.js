import * as THREE from 'three';
import { createMatchRenderProjection } from '../contracts/MatchRenderProjectionContract.js';
import {
    CONFIG_SECTIONS,
    getGameplayConfigSection,
} from '../contracts/GameplayConfigContract.js';

const TMP_RENDER_POSITION = new THREE.Vector3();
const TMP_RENDER_QUATERNION = new THREE.Quaternion();
const TMP_RENDER_DIRECTION = new THREE.Vector3();
const TMP_FIRST_PERSON_ANCHOR = new THREE.Vector3();
const TMP_CONFIG_SOURCE = { config: null, entityRuntimeConfig: null };

function toVector3Projection(value = null) {
    return {
        x: Number(value?.x) || 0,
        y: Number(value?.y) || 0,
        z: Number(value?.z) || 0,
    };
}

function toQuaternionProjection(value = null) {
    const w = Number(value?.w);
    return {
        x: Number(value?.x) || 0,
        y: Number(value?.y) || 0,
        z: Number(value?.z) || 0,
        w: Number.isFinite(w) ? w : 1,
    };
}

function resolveNetworkPlayerSlots(game) {
    const slots = game?.runtimeConfig?.session?.networkPlayerSlots;
    return Array.isArray(slots) ? slots : [];
}

function resolveSessionPlayers(facade, game = null) {
    const slots = resolveNetworkPlayerSlots(game);
    if (slots.length > 0) {
        return slots.map((slot) => ({
            id: String(slot?.peerId || slot?.playerId || slot?.id || ''),
            index: Number.isInteger(slot?.playerIndex) ? slot.playerIndex : 0,
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

function resolveLocalHumanCount(game, runtimeState) {
    return Math.max(1, Number(
        game?.runtimeConfig?.session?.localHumanCount
        || runtimeState?.localHumanCount
        || runtimeState?.numHumans
        || game?.numHumans
    ) || 1);
}

function copyPlayerRenderTransform(player, renderAlpha = 1) {
    const reusedRenderedTransform = player?.view?.copyRenderTransform?.(TMP_RENDER_POSITION, TMP_RENDER_QUATERNION);
    if (!reusedRenderedTransform && typeof player?.resolveRenderTransform === 'function') {
        player.resolveRenderTransform(renderAlpha, TMP_RENDER_POSITION, TMP_RENDER_QUATERNION);
    } else if (!reusedRenderedTransform) {
        TMP_RENDER_POSITION.set(
            Number(player?.position?.x) || 0,
            Number(player?.position?.y) || 0,
            Number(player?.position?.z) || 0
        );
        TMP_RENDER_QUATERNION.set(
            Number(player?.quaternion?.x) || 0,
            Number(player?.quaternion?.y) || 0,
            Number(player?.quaternion?.z) || 0,
            Number.isFinite(Number(player?.quaternion?.w)) ? Number(player.quaternion.w) : 1
        );
    }
    TMP_RENDER_DIRECTION.set(0, 0, -1).applyQuaternion(TMP_RENDER_QUATERNION);
    if (TMP_RENDER_DIRECTION.lengthSq() <= 0.000001) {
        TMP_RENDER_DIRECTION.set(0, 0, -1);
    } else {
        TMP_RENDER_DIRECTION.normalize();
    }
    const firstPersonAnchor = typeof player?.getFirstPersonCameraAnchor === 'function'
        ? player.getFirstPersonCameraAnchor(TMP_FIRST_PERSON_ANCHOR)
        : TMP_FIRST_PERSON_ANCHOR.copy(TMP_RENDER_POSITION).add(TMP_RENDER_DIRECTION);

    return {
        position: toVector3Projection(TMP_RENDER_POSITION),
        quaternion: toQuaternionProjection(TMP_RENDER_QUATERNION),
        direction: toVector3Projection(TMP_RENDER_DIRECTION),
        firstPersonAnchor: toVector3Projection(firstPersonAnchor),
    };
}

function buildPlayerRenderProjection({ runtimeState, game, player, renderAlpha = 1 }) {
    if (!player) return null;

    const configSource = TMP_CONFIG_SOURCE;
    configSource.config = runtimeState?.config || game?.config || null;
    configSource.entityRuntimeConfig = player?.entityRuntimeConfig || player?.gameplayConfig || null;
    const playerConfig = getGameplayConfigSection(configSource, CONFIG_SECTIONS.PLAYER);
    const cameraConfig = getGameplayConfigSection(configSource, CONFIG_SECTIONS.CAMERA);
    const gameplayConfig = getGameplayConfigSection(configSource, CONFIG_SECTIONS.GAMEPLAY);
    const cameraModeId = cameraConfig?.MODES?.[player?.cameraMode] || 'THIRD_PERSON';
    const boostCapacity = Math.max(0.001, Number(playerConfig.BOOST_DURATION) || 1);
    const renderTransform = copyPlayerRenderTransform(player, renderAlpha);

    return {
        playerIndex: Number.isInteger(player?.index) ? player.index : 0,
        isBot: player?.isBot === true,
        alive: player?.alive !== false,
        color: Number(player?.color) || 0xffffff,
        score: Math.max(0, Math.round(Number(player?.score) || 0)),
        speed: Number(player?.speed) || 0,
        boostCharge: Math.max(0, Math.min(boostCapacity, Number(player?.boostCharge) || 0)),
        boostCapacity,
        isBoosting: player?.isBoosting === true,
        hp: Math.max(0, Number(player?.hp) || 0),
        maxHp: Math.max(1, Number(player?.maxHp) || 1),
        cockpitCamera: player?.cockpitCamera === true,
        planarMode: gameplayConfig?.PLANAR_MODE === true,
        cameraModeId: String(cameraModeId || 'THIRD_PERSON'),
        position: renderTransform.position,
        quaternion: renderTransform.quaternion,
        direction: renderTransform.direction,
        firstPersonAnchor: renderTransform.firstPersonAnchor,
    };
}

export function buildMatchRenderProjection({
    game,
    runtimeState,
    facade,
    sessionRuntime,
    renderAlpha = 1,
}) {
    const entityManager = runtimeState?.entityManager || game?.entityManager || null;
    const sessionPlayers = resolveSessionPlayers(facade, game);
    const players = Array.isArray(entityManager?.players)
        ? entityManager.players
            .map((player) => buildPlayerRenderProjection({ runtimeState, game, player, renderAlpha }))
            .filter(Boolean)
            .sort((left, right) => (left?.playerIndex || 0) - (right?.playerIndex || 0))
        : [];
    const modeId = String(runtimeState?.activeGameMode || entityManager?.activeGameMode || game?.activeGameMode || '');
    const gameStateId = String(sessionRuntime?.lifecycle?.gameStateId || game?.state || '');

    return createMatchRenderProjection({
        updatedAt: Date.now(),
        gameStateId,
        modeId,
        isNetworkSession: facade?.isNetworkSession?.() === true,
        localPlayerIndex: resolveLocalPlayerIndex(facade, sessionPlayers, game),
        localHumanCount: resolveLocalHumanCount(game, runtimeState),
        players,
    });
}
