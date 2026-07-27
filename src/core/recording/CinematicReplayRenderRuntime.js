// @ts-nocheck
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
        player.isBoosting = projected.isBoosting === true;
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
        player.view?.setVisible?.(true);
        player.view?.syncFromState?.();
        player.view?.updateVisuals?.(safeDt);
    }
}

function ensureProjectileProxy(renderer, proxies, index) {
    while (proxies.length <= index) {
        const geometry = new THREE.SphereGeometry(0.18, 8, 6);
        const material = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        renderer?.addToScene?.(mesh);
        proxies.push(mesh);
    }
    return proxies[index];
}

function applySnapshotToProjectiles(renderer, proxies, leftSnapshot) {
    const projected = Array.isArray(leftSnapshot?.projectiles) ? leftSnapshot.projectiles : [];
    for (let index = 0; index < proxies.length; index++) proxies[index].visible = false;
    for (let index = 0; index < projected.length; index++) {
        const state = projected[index];
        const mesh = ensureProjectileProxy(renderer, proxies, index);
        mesh.visible = true;
        mesh.position.set(
            toFiniteNumber(state.pos?.[0]),
            toFiniteNumber(state.pos?.[1]),
            toFiniteNumber(state.pos?.[2])
        );
        mesh.scale.setScalar(Math.max(0.35, toFiniteNumber(state.radius, 0.18) / 0.18));
        mesh.material.color.setHex(String(state.type || '').includes('rocket') ? 0xff6633 : 0xffdd66);
    }
}

function applySnapshotToParticles(particles, leftSnapshot) {
    const state = leftSnapshot?.particles;
    const count = Math.max(0, Math.min(
        Number(state?.count) || 0,
        Number(particles?.positions?.length || 0) / 3
    ));
    const values = Array.isArray(state?.values) ? state.values : [];
    if (!particles || count <= 0 || values.length < count * 12) {
        particles?.clear?.();
        return;
    }
    particles.count = count;
    for (let index = 0; index < count; index++) {
        const dst3 = index * 3;
        const src = index * 12;
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
        particles.scales[index] = Math.max(0.001, toFiniteNumber(values[src + 8], 0.1));
        particles.colors[dst3] = toFiniteNumber(values[src + 9], 1);
        particles.colors[dst3 + 1] = toFiniteNumber(values[src + 10], 1);
        particles.colors[dst3 + 2] = toFiniteNumber(values[src + 11], 1);
        if (particles.mesh?.setColorAt && particles._tmpColor?.setRGB) {
            particles._tmpColor.setRGB(
                particles.colors[dst3],
                particles.colors[dst3 + 1],
                particles.colors[dst3 + 2]
            );
            particles.mesh.setColorAt(index, particles._tmpColor);
        }
    }
    particles.update?.(0);
    if (particles.mesh?.instanceColor) particles.mesh.instanceColor.needsUpdate = true;
}

export function createCinematicReplayFrameRenderer({
    game,
    renderer,
    prepareReplaySession = prepareDefaultReplaySession,
    disposeReplaySession = disposeDefaultReplaySession,
} = {}) {
    const projectileProxies = [];
    const replayAliveState = new Map();
    let activeReplay = null;
    let activeReplaySession = null;
    let pendingReplaySession = null;
    let previousRecordingSettings = null;
    let previousCameraPerspectiveSettings = null;

    const applyReplayRendererSettings = (replay) => {
        const metadata = replay?.metadata && typeof replay.metadata === 'object' ? replay.metadata : {};
        previousRecordingSettings = renderer?.getRecordingCaptureSettings?.() || null;
        previousCameraPerspectiveSettings = renderer?.getCameraPerspectiveSettings?.() || null;
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
    };

    const restoreRendererSettings = () => {
        if (previousRecordingSettings) {
            renderer?.setRecordingCaptureSettings?.(previousRecordingSettings);
        }
        if (previousCameraPerspectiveSettings) {
            renderer?.setCameraPerspectiveSettings?.(previousCameraPerspectiveSettings);
        }
        previousRecordingSettings = null;
        previousCameraPerspectiveSettings = null;
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
        return activeReplaySession;
    };

    return async ({
        replay = null,
        projection = null,
        leftSnapshot = null,
        frameIndex = 0,
        dt = 1 / 60,
        reset = false,
    } = {}) => {
        if (reset) {
            const entityManager = activeReplaySession?.entityManager || null;
            for (const proxy of projectileProxies) {
                renderer?.removeFromScene?.(proxy);
                proxy.geometry?.dispose?.();
                proxy.material?.dispose?.();
            }
            projectileProxies.length = 0;
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
        applySnapshotToProjectiles(renderer, projectileProxies, leftSnapshot);
        applySnapshotToParticles(replaySession?.particles, leftSnapshot);
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
