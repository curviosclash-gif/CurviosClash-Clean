// @ts-nocheck
import * as THREE from 'three';
import {
    RECORDING_CAPTURE_PROFILE,
    RECORDING_EXPORT_PRESET,
} from '../../shared/contracts/RecordingCaptureContract.js';

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clearReplayTrails(entityManager) {
    const players = Array.isArray(entityManager?.players) ? entityManager.players : [];
    for (let index = 0; index < players.length; index++) {
        players[index]?.trail?.clear?.();
    }
}

function resolveReplaySessionConfig(game, replay) {
    const metadata = replay?.metadata && typeof replay.metadata === 'object' ? replay.metadata : {};
    const recordedSettings = metadata.settings && typeof metadata.settings === 'object'
        ? metadata.settings
        : {};
    const settings = {
        ...(game?.settings || {}),
        ...recordedSettings,
        vehicles: {
            ...(game?.settings?.vehicles || {}),
            ...(recordedSettings.vehicles || {}),
        },
    };
    const configuredRuntime = metadata.runtimeConfig && typeof metadata.runtimeConfig === 'object'
        ? metadata.runtimeConfig
        : game?.settingsManager?.createRuntimeConfig?.(settings);
    const baseRuntime = configuredRuntime && typeof configuredRuntime === 'object'
        ? configuredRuntime
        : (game?.runtimeConfig || {});
    const players = Array.isArray(replay?.snapshots?.[0]?.players)
        ? replay.snapshots[0].players
        : [];
    const humanPlayers = players.filter((player) => player?.isBot !== true);
    const botPlayers = players.filter((player) => player?.isBot === true);
    const numHumans = Math.max(1, humanPlayers.length || Number(metadata.numHumans) || 1);
    const numBots = Math.max(0, botPlayers.length || Number(metadata.numBots) || 0);
    const vehicles = {
        ...(baseRuntime?.player?.vehicles || {}),
    };
    for (let index = 0; index < Math.min(2, humanPlayers.length); index++) {
        const vehicleId = String(humanPlayers[index]?.vehicleId || '').trim();
        if (vehicleId) vehicles[`PLAYER_${index + 1}`] = vehicleId;
    }
    const requestedMapKey = String(
        metadata.mapKey
        || baseRuntime?.session?.mapKey
        || game?.settings?.mapKey
        || game?.mapKey
        || 'standard'
    );
    const runtimeConfig = {
        ...baseRuntime,
        session: {
            ...(baseRuntime?.session || {}),
            mapKey: requestedMapKey,
            numHumans,
            localHumanCount: numHumans,
            humanEntityCount: numHumans,
            numBots,
            localPlayerIndex: 0,
            networkEnabled: false,
            activeGameMode: metadata.activeGameMode || baseRuntime?.session?.activeGameMode,
            winsNeeded: Math.max(1, Number(metadata.winsNeeded || baseRuntime?.session?.winsNeeded) || 1),
        },
        player: {
            ...(baseRuntime?.player || {}),
            vehicles,
        },
    };
    return { settings, runtimeConfig, requestedMapKey };
}

async function prepareDefaultReplaySession({ game, renderer, replay }) {
    const entityManager = game?.entityManager || game?.runtimeBundle?.runtimeState?.entityManager || null;
    if (!renderer || !entityManager) {
        throw new Error('replay_render_session_unavailable');
    }
    return {
        entityManager,
        particles: game?.particles || null,
        arena: game?.arena || null,
        replay,
    };
}

function disposeDefaultReplaySession() {}

function applyProjectionToPlayers(entityManager, projection, dt, replayAliveState, replayRestarted) {
    const livePlayers = Array.isArray(entityManager?.players) ? entityManager.players : [];
    const projectedPlayers = Array.isArray(projection?.players) ? projection.players : [];
    const safeDt = Math.max(1 / 240, Math.min(0.05, toFiniteNumber(dt, 1 / 60)));
    for (let liveIndex = 0; liveIndex < livePlayers.length; liveIndex++) {
        const player = livePlayers[liveIndex];
        if (!player) continue;
        let projected = null;
        for (let index = 0; index < projectedPlayers.length; index++) {
            const candidate = projectedPlayers[index];
            if (Number(candidate?.playerIndex) === Number(player.index)) {
                projected = candidate;
                break;
            }
        }
        if (!projected) {
            player.view?.setVisible?.(false);
            continue;
        }
        player.position?.set?.(
            toFiniteNumber(projected.position?.x),
            toFiniteNumber(projected.position?.y),
            toFiniteNumber(projected.position?.z)
        );
        player.previousPosition?.copy?.(player.position);
        player.quaternion?.set?.(
            toFiniteNumber(projected.quaternion?.x),
            toFiniteNumber(projected.quaternion?.y),
            toFiniteNumber(projected.quaternion?.z),
            toFiniteNumber(projected.quaternion?.w, 1)
        );
        player.previousQuaternion?.copy?.(player.quaternion);
        player.alive = projected.alive !== false;
        player.hp = Math.max(0, toFiniteNumber(projected.hp, player.hp));
        player.score = Math.max(0, Math.round(toFiniteNumber(projected.score, player.score)));
        player.speed = Math.max(0, toFiniteNumber(projected.speed, player.speed));
        player.boostCharge = Math.max(0, toFiniteNumber(projected.boostCharge, player.boostCharge));
        player.isBoosting = projected.isBoosting === true;
        player.hasShield = projected.hasShield === true;
        player.shieldHP = Math.max(0, toFiniteNumber(projected.shieldHP, player.shieldHP));
        player.maxShieldHp = Math.max(0, toFiniteNumber(projected.maxShieldHp, player.maxShieldHp));
        player.shieldHitFeedback = Math.max(
            0,
            toFiniteNumber(projected.shieldHitFeedback, player.shieldHitFeedback)
        );
        player.inventory = Array.isArray(projected.inventory) ? projected.inventory.slice() : [];
        player.activeEffects = Array.isArray(projected.effects)
            ? projected.effects.map((effect) => ({ ...effect }))
            : [];
        player.animationState = String(projected.animation || '');
        player.activeWeapon = String(projected.weapon || '');
        player.skinId = String(projected.skinId || player.skinId || '');
        const projectedScale = Math.max(0.01, toFiniteNumber(projected.modelScale, player.modelScale || 1));
        if (Math.abs(projectedScale - toFiniteNumber(player.modelScale, 1)) > 0.0001) {
            player.modelScale = projectedScale;
            player.view?.applyModelScale?.();
        }
        const previousAlive = replayAliveState.get(player.index);
        player.trail?.setWidth?.(Math.max(0.01, toFiniteNumber(projected.trailWidth, player.trail?.width || 0.6)));
        player.trail?.updateReplayVisual?.(
            safeDt,
            player.position,
            projected.direction,
            {
                inGap: !player.alive || projected.trailInGap === true,
                discontinuity: replayRestarted || previousAlive !== player.alive,
            }
        );
        replayAliveState.set(player.index, player.alive);
        player.view?.setVisible?.(player.alive);
        player.view?.syncFromState?.();
        player.view?.updateVisuals?.(safeDt, { emitParticles: false });
    }
}

function findEntryById(entries, id) {
    const list = Array.isArray(entries) ? entries : [];
    for (let index = 0; index < list.length; index++) {
        if (String(list[index]?.id ?? index) === id) return list[index];
    }
    return null;
}

function interpolateSceneEntries(target, leftEntries, rightEntries, alpha) {
    const selected = alpha < 0.5
        ? (Array.isArray(leftEntries) ? leftEntries : [])
        : (Array.isArray(rightEntries) ? rightEntries : []);
    while (target.length < selected.length) {
        target.push({ pos: [0, 0, 0], vel: [0, 0, 0], aim: [1, 0, 0] });
    }
    for (let index = 0; index < selected.length; index++) {
        const source = selected[index];
        const id = String(source?.id ?? index);
        const left = findEntryById(leftEntries, id) || source;
        const right = findEntryById(rightEntries, id) || source;
        const out = target[index];
        const leftPosition = Array.isArray(left?.pos) ? left.pos : [0, 0, 0];
        const rightPosition = Array.isArray(right?.pos) ? right.pos : leftPosition;
        const leftVelocity = Array.isArray(left?.vel) ? left.vel : [0, 0, 0];
        const rightVelocity = Array.isArray(right?.vel) ? right.vel : leftVelocity;
        const leftAim = Array.isArray(left?.aim) ? left.aim : [1, 0, 0];
        const rightAim = Array.isArray(right?.aim) ? right.aim : leftAim;
        out.id = id;
        out.type = String(source?.type || left?.type || right?.type || '');
        out.weapon = String(source?.weapon || left?.weapon || right?.weapon || '');
        out.rocketType = String(source?.rocketType || left?.rocketType || right?.rocketType || 'ROCKET_WEAK');
        out.owner = Math.trunc(toFiniteNumber(source?.owner ?? left?.owner ?? right?.owner, -1));
        out.deployed = source?.deployed === true;
        out.ttl = Math.max(0, THREE.MathUtils.lerp(
            toFiniteNumber(left?.ttl, 0),
            toFiniteNumber(right?.ttl, left?.ttl),
            alpha
        ));
        out.radius = Math.max(0, toFiniteNumber(source?.radius ?? left?.radius, 0));
        out.range = Math.max(0, toFiniteNumber(source?.range ?? left?.range, 0));
        out.cooldown = Math.max(0, toFiniteNumber(source?.cooldown ?? left?.cooldown, 0));
        out.cooldownRemaining = Math.max(0, THREE.MathUtils.lerp(
            toFiniteNumber(left?.cooldownRemaining, 0),
            toFiniteNumber(right?.cooldownRemaining, left?.cooldownRemaining),
            alpha
        ));
        out.damage = Math.max(0, toFiniteNumber(source?.damage ?? left?.damage, 0));
        out.hp = THREE.MathUtils.lerp(
            toFiniteNumber(left?.hp, -1),
            toFiniteNumber(right?.hp, left?.hp),
            alpha
        );
        out.maxHp = toFiniteNumber(source?.maxHp ?? left?.maxHp, -1);
        out.shotsFired = Math.max(0, Math.trunc(toFiniteNumber(source?.shotsFired ?? left?.shotsFired, 0)));
        out.flashRemaining = Math.max(0, toFiniteNumber(source?.flashRemaining ?? left?.flashRemaining, 0));
        out.color = Math.trunc(toFiniteNumber(source?.color ?? left?.color, 0xffaa00));
        out.visualScale = Math.max(0.01, toFiniteNumber(source?.visualScale ?? left?.visualScale, 1));
        out.visible = source?.visible !== false;
        out.rotationY = THREE.MathUtils.lerp(
            toFiniteNumber(left?.rotationY, 0),
            toFiniteNumber(right?.rotationY, left?.rotationY),
            alpha
        );
        for (let axis = 0; axis < 3; axis++) {
            out.pos[axis] = THREE.MathUtils.lerp(
                toFiniteNumber(leftPosition[axis]),
                toFiniteNumber(rightPosition[axis], leftPosition[axis]),
                alpha
            );
            out.vel[axis] = THREE.MathUtils.lerp(
                toFiniteNumber(leftVelocity[axis]),
                toFiniteNumber(rightVelocity[axis], leftVelocity[axis]),
                alpha
            );
            out.aim[axis] = THREE.MathUtils.lerp(
                toFiniteNumber(leftAim[axis]),
                toFiniteNumber(rightAim[axis], leftAim[axis]),
                alpha
            );
        }
    }
    target.length = selected.length;
}

function buildReplayNetworkSnapshot(target, leftSnapshot, rightSnapshot, alpha) {
    target.mapElapsedSeconds = THREE.MathUtils.lerp(
        toFiniteNumber(leftSnapshot?.mapElapsedSeconds, toFiniteNumber(leftSnapshot?.timeMs, 0) * 0.001),
        toFiniteNumber(rightSnapshot?.mapElapsedSeconds, toFiniteNumber(rightSnapshot?.timeMs, 0) * 0.001),
        alpha
    );
    interpolateSceneEntries(
        target.projectiles,
        leftSnapshot?.projectiles,
        rightSnapshot?.projectiles,
        alpha
    );
    interpolateSceneEntries(
        target.powerups,
        leftSnapshot?.powerups,
        rightSnapshot?.powerups,
        alpha
    );
    interpolateSceneEntries(
        target.turrets,
        leftSnapshot?.turrets,
        rightSnapshot?.turrets,
        alpha
    );
    return target;
}

function applySnapshotToParticles(particles, leftSnapshot, timeOffsetSeconds = 0) {
    const state = leftSnapshot?.particles;
    const count = Math.max(0, Math.min(
        Number(state?.count) || 0,
        Number(particles?.positions?.length || 0) / 3
    ));
    const values = Array.isArray(state?.values) ? state.values : [];
    const stride = values.length >= count * 13 ? 13 : 12;
    if (!particles || count <= 0 || values.length < count * stride) {
        particles?.clear?.();
        return;
    }
    particles.count = count;
    for (let index = 0; index < count; index++) {
        const dst3 = index * 3;
        const src = index * stride;
        particles.positions[dst3] = toFiniteNumber(values[src]);
        particles.positions[dst3 + 1] = toFiniteNumber(values[src + 1]);
        particles.positions[dst3 + 2] = toFiniteNumber(values[src + 2]);
        particles.velocities[dst3] = toFiniteNumber(values[src + 3]);
        particles.velocities[dst3 + 1] = toFiniteNumber(values[src + 4]);
        particles.velocities[dst3 + 2] = toFiniteNumber(values[src + 5]);
        particles.lifetimes[index] = Math.max(0.0001, toFiniteNumber(values[src + 6], 0.0001));
        particles.maxLifetimes[index] = Math.max(
            particles.lifetimes[index],
            toFiniteNumber(values[src + 7], particles.lifetimes[index])
        );
        particles.gravities[index] = stride === 13 ? toFiniteNumber(values[src + 8], 0) : 0;
        particles.scales[index] = Math.max(
            0.001,
            toFiniteNumber(values[src + (stride === 13 ? 9 : 8)], 0.1)
        );
        const colorOffset = stride === 13 ? 10 : 9;
        particles.colors[dst3] = toFiniteNumber(values[src + colorOffset], 1);
        particles.colors[dst3 + 1] = toFiniteNumber(values[src + colorOffset + 1], 1);
        particles.colors[dst3 + 2] = toFiniteNumber(values[src + colorOffset + 2], 1);
        if (particles.mesh?.setColorAt && particles._tmpColor?.setRGB) {
            particles._tmpColor.setRGB(
                particles.colors[dst3],
                particles.colors[dst3 + 1],
                particles.colors[dst3 + 2]
            );
            particles.mesh.setColorAt(index, particles._tmpColor);
        }
    }
    particles.update?.(Math.max(0, toFiniteNumber(timeOffsetSeconds, 0)));
    if (particles.mesh?.instanceColor) particles.mesh.instanceColor.needsUpdate = true;
}

export function createCinematicReplayFrameRenderer({
    game,
    renderer,
    prepareReplaySession = prepareDefaultReplaySession,
    disposeReplaySession = disposeDefaultReplaySession,
} = {}) {
    const networkSnapshot = { projectiles: [], powerups: [], turrets: [] };
    const replayAliveState = new Map();
    let activeReplay = null;
    let activeReplaySession = null;
    let pendingReplaySession = null;
    let previousRecordingSettings = null;
    let previousCameraPerspectiveSettings = null;
    let previousGraphicsStyle = null;
    let previousMapBrightness = null;
    let previousViewDistance = null;
    let previousShadowQuality = null;
    let previousBloomQuality = null;

    const applyReplayRendererSettings = (replay) => {
        const metadata = replay?.metadata && typeof replay.metadata === 'object' ? replay.metadata : {};
        previousRecordingSettings = renderer?.getRecordingCaptureSettings?.() || null;
        previousCameraPerspectiveSettings = renderer?.getCameraPerspectiveSettings?.() || null;
        previousGraphicsStyle = renderer?.getGraphicsStyle?.() || null;
        previousMapBrightness = renderer?.getMapBrightness?.() || null;
        previousViewDistance = renderer?.getViewDistance?.() ?? null;
        previousShadowQuality = renderer?.getShadowQuality?.() ?? null;
        previousBloomQuality = renderer?.getBloomQuality?.() ?? null;
        renderer?.setRecordingCaptureSettings?.({
            ...(previousRecordingSettings || {}),
            profile: RECORDING_CAPTURE_PROFILE.CINEMATIC,
            hudMode: metadata.hudMode
                || metadata.settings?.recording?.hudMode
                || previousRecordingSettings?.hudMode,
            exportPreset: RECORDING_EXPORT_PRESET.YOUTUBE_MP4,
        });
        renderer?.setCameraPerspectiveSettings?.(
            metadata.settings?.cameraPerspective || previousCameraPerspectiveSettings
        );
        const recordedLocalSettings = metadata.settings?.localSettings || {};
        renderer?.setGraphicsStyle?.(
            recordedLocalSettings.graphicsStyle
            || metadata.settings?.graphicsStyle
            || previousGraphicsStyle
        );
        renderer?.setMapBrightness?.(
            recordedLocalSettings.mapBrightness
            || previousMapBrightness
        );
        renderer?.setViewDistance?.(
            recordedLocalSettings.viewDistance ?? previousViewDistance
        );
        if (recordedLocalSettings.shadowQuality != null) {
            renderer?.setShadowQuality?.(recordedLocalSettings.shadowQuality);
        }
        if (recordedLocalSettings.bloomQuality != null) {
            renderer?.setBloomQuality?.(recordedLocalSettings.bloomQuality);
        }
    };

    const restoreRendererSettings = () => {
        if (previousRecordingSettings) {
            renderer?.setRecordingCaptureSettings?.(previousRecordingSettings);
        }
        if (previousCameraPerspectiveSettings) {
            renderer?.setCameraPerspectiveSettings?.(previousCameraPerspectiveSettings);
        }
        if (previousGraphicsStyle) renderer?.setGraphicsStyle?.(previousGraphicsStyle);
        if (previousMapBrightness) renderer?.setMapBrightness?.(previousMapBrightness);
        if (previousViewDistance != null) renderer?.setViewDistance?.(previousViewDistance);
        if (previousShadowQuality != null) renderer?.setShadowQuality?.(previousShadowQuality);
        if (previousBloomQuality != null) renderer?.setBloomQuality?.(previousBloomQuality);
        previousRecordingSettings = null;
        previousCameraPerspectiveSettings = null;
        previousGraphicsStyle = null;
        previousMapBrightness = null;
        previousViewDistance = null;
        previousShadowQuality = null;
        previousBloomQuality = null;
    };

    const resetReplaySession = async () => {
        let session = activeReplaySession;
        if (!session && pendingReplaySession) {
            session = await pendingReplaySession.catch(() => null);
        }
        activeReplaySession = null;
        pendingReplaySession = null;
        try {
            if (session) {
                await disposeReplaySession({ game, renderer, session });
            }
        } finally {
            restoreRendererSettings();
        }
    };

    const ensureReplaySession = async (replay) => {
        if (activeReplay === replay && activeReplaySession) return activeReplaySession;
        if (activeReplay !== replay) {
            await resetReplaySession();
            activeReplay = replay;
            applyReplayRendererSettings(replay);
        }
        if (!pendingReplaySession) {
            const sessionConfig = resolveReplaySessionConfig(game, replay);
            pendingReplaySession = Promise.resolve(prepareReplaySession({
                game,
                renderer,
                replay,
                ...sessionConfig,
            }));
        }
        activeReplaySession = await pendingReplaySession;
        pendingReplaySession = null;
        activeReplaySession?.entityManager?.setNetworkReplica?.(true);
        return activeReplaySession;
    };

    return async ({
        replay = null,
        projection = null,
        leftSnapshot = null,
        rightSnapshot = null,
        alpha = 0,
        frameIndex = 0,
        timeMs = 0,
        dt = 1 / 60,
        reset = false,
    } = {}) => {
        if (reset) {
            const entityManager = activeReplaySession?.entityManager || null;
            networkSnapshot.projectiles.length = 0;
            networkSnapshot.powerups.length = 0;
            networkSnapshot.turrets.length = 0;
            clearReplayTrails(entityManager);
            replayAliveState.clear();
            activeReplay = null;
            renderer?.setRecordingActive?.(false);
            renderer?.setRecordingQualityLock?.(false, 'cinematic-replay-render');
            await resetReplaySession();
            game?.runtimeCoordinator?.getRuntimeFacade?.()?.scheduleMatchPrewarm?.();
            return null;
        }
        const replaySession = await ensureReplaySession(replay);
        const entityManager = replaySession?.entityManager || null;
        if (!renderer || !entityManager || !projection) return null;
        const replayRestarted = Number(frameIndex) === 0;
        if (replayRestarted) {
            clearReplayTrails(entityManager);
            replayAliveState.clear();
        }
        applyProjectionToPlayers(entityManager, projection, dt, replayAliveState, replayRestarted);
        entityManager.applyNetworkSnapshot?.(
            buildReplayNetworkSnapshot(
                networkSnapshot,
                leftSnapshot,
                rightSnapshot || leftSnapshot,
                THREE.MathUtils.clamp(toFiniteNumber(alpha, 0), 0, 1)
            )
        );
        const leftTimeMs = toFiniteNumber(leftSnapshot?.timeMs, 0);
        applySnapshotToParticles(
            replaySession?.particles,
            leftSnapshot,
            Math.max(0, toFiniteNumber(timeMs, leftTimeMs) - leftTimeMs) / 1000
        );
        replaySession?.arena?.update?.(Math.max(0, toFiniteNumber(dt, 1 / 60)));
        replaySession?.arena?.setGlbAnimationElapsedSeconds?.(networkSnapshot.mapElapsedSeconds);
        renderer.setRecordingActive?.(true);
        renderer.setRecordingQualityLock?.(true, 'cinematic-replay-render');
        renderer.prepareRecordingCaptureFrame?.({
            recordingActive: true,
            renderProjection: projection,
            arena: replaySession?.arena || null,
            renderAlpha: 1,
            renderDelta: Math.max(1 / 240, Math.min(0.05, toFiniteNumber(dt, 1 / 60))),
            splitScreen: false,
        });
        return renderer.getRecordingCaptureCanvas?.() || null;
    };
}
