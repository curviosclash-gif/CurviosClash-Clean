// @ts-nocheck

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

export function createCinematicReplayFrameRenderer({ game, renderer } = {}) {
    const projectileProxies = [];
    const replayAliveState = new Map();
    let activeReplay = null;
    return async ({
        replay = null,
        projection = null,
        leftSnapshot = null,
        frameIndex = 0,
        dt = 1 / 60,
        reset = false,
    } = {}) => {
        const entityManager = game?.entityManager || game?.runtimeBundle?.runtimeState?.entityManager || null;
        if (reset) {
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
            return null;
        }
        if (!renderer || !entityManager || !projection) return null;
        const replayRestarted = replay !== activeReplay || Number(frameIndex) === 0;
        if (replayRestarted) {
            clearReplayTrails(entityManager);
            replayAliveState.clear();
            activeReplay = replay;
        }
        applyProjectionToPlayers(entityManager, projection, dt, replayAliveState, replayRestarted);
        applySnapshotToProjectiles(renderer, projectileProxies, leftSnapshot);
        applySnapshotToParticles(game?.particles, leftSnapshot);
        renderer.setRecordingActive?.(true);
        renderer.setRecordingQualityLock?.(true, 'cinematic-replay-render');
        renderer.prepareRecordingCaptureFrame?.({
            recordingActive: true,
            renderProjection: projection,
            arena: game?.arena || null,
            renderAlpha: 1,
            renderDelta: Math.max(1 / 240, Math.min(0.05, toFiniteNumber(dt, 1 / 60))),
            splitScreen: false,
        });
        return renderer.getRecordingCaptureCanvas?.() || null;
    };
}
