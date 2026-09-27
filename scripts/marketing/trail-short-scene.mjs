/* global document, performance */
import { CatmullRomCurve3, Vector3 } from 'three';

export const TRAIL_SHORT = Object.freeze({
    warmup: 6,
    duration: 16,
    fps: 60,
    shots: Object.freeze([
        { start: 0, end: 3, kind: 'cinematic', caption: 'Your trail is a weapon.' },
        { start: 3, end: 7, kind: 'third-person', player: 0, caption: '3D duels. Outfly. Outlast.' },
        { start: 7, end: 10, kind: 'cinematic', caption: 'Classic mode\nOne of several game modes.' },
        { start: 10, end: 16, kind: 'third-person', player: 1, caption: '' },
    ]),
});

export function resolveTrailShortShot(time) {
    return TRAIL_SHORT.shots.find((shot) => time >= shot.start && time < shot.end)
        || (time < 0 ? TRAIL_SHORT.shots[0] : TRAIL_SHORT.shots.at(-1));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function trailShortHudOpacity(clipTime) {
    const fade = (time) => clamp(time / 0.25, 0, 1);
    if (clipTime < 3) return 0;
    if (clipTime < 7) return Math.min(fade(clipTime - 3), fade(7 - clipTime));
    if (clipTime < 10) return 0;
    return fade(clipTime - 10);
}
// Irregular, open 3D routes in the built 240 x 90 x 240 Standard Arena.
const ROUTE_ANCHORS = [
    [[-48, 45, -38], [-15, 62, -54], [38, 47, -38], [25, 37, 5], [-38, 59, 8],
        [-48, 42, 44], [8, 36, 55], [42, 58, 25], [5, 70, -5], [-32, 50, -25],
        [20, 48, -38], [32, 49, 4], [70, 57, 42], [40, 67, 78]],
    [[-12, 41, 18], [55, 73, 55], [55, 48, -8], [2, 55, -30], [-50, 37, -48],
        [35, 40, 35], [10, 50, -15], [-22, 36, 30], [35, 54, 5], [80, 60, -29], [60, 62, -95]],
];
const ROUTES = ROUTE_ANCHORS.map((anchors) => {
    const curve = new CatmullRomCurve3(anchors.map((point) => new Vector3(...point)), false, 'centripetal');
    const length = curve.getLength();
    const divisions = Math.ceil(length / 0.75);
    return { points: curve.getSpacedPoints(divisions), spacing: length / divisions };
});

// A path is a steering target, never an assignment to a moving player's transform.
export function resolveTrailFlightTarget(index, time, position, out, progress = null) {
    const route = ROUTES[index];
    let nearest = progress?.index ?? Math.min(route.points.length - 1, Math.floor(time * 30 / route.spacing));
    let distance = Infinity;
    // A local, monotonic search cannot jump to a different leg at a crossing.
    const limit = Math.min(route.points.length - 1, nearest + 48);
    for (let candidate = nearest; candidate <= limit; candidate += 1) {
        const point = route.points[candidate];
        const squared = (point.x - position.x) ** 2 + (point.y - position.y) ** 2 + (point.z - position.z) ** 2;
        if (squared < distance) { distance = squared; nearest = candidate; }
    }
    if (progress) progress.index = nearest;
    const target = route.points[Math.min(route.points.length - 1, nearest + Math.round(12 / route.spacing))];
    out.x = target.x;
    out.y = target.y;
    out.z = target.z;
    return out;
}

export function installTrailShortFlight(game, { variant = 'thick' } = {}) {
    const ghost = variant === 'ghost';
    if (!ghost && variant !== 'thick') throw new Error(`Unknown trail short variant: ${variant}`);
    const manager = game.entityManager;
    if (manager?.players?.length !== 2 || manager.players.some((player) => player.isBot)) {
        throw new Error('The trail short requires exactly two human slots and no bots');
    }
    const state = { time: 0, history: [], lastSample: -1, clipStartedAt: null, finishedAt: null,
        closestPass: { distance: Infinity, time: 0 }, itemRequested: false, itemCollected: false,
        variant, crossingTarget: null, ghostActiveAtCrossing: false };
    game.input.clearPlayerSources();
    const sources = manager.players.map((player, index) => {
        const route = ROUTES[index];
        const start = player.position.clone().copy(route.points[0]);
        const direction = player.position.clone().copy(route.points[10]).sub(start).normalize();
        manager._spawnOps.spawnPlayerAt(player, start, direction);
        const target = start.clone();
        const inverse = player.quaternion.clone();
        const desired = start.clone();
        const localUp = start.clone();
        const input = { pitchAxis: 0, yawAxis: 0, rollAxis: 0, useItem: false };
        const source = {
            type: 'marketing-sequence', active: true, playerIndex: index, time: 0, progress: { index: 0 },
            bind(slot) { this.playerIndex = slot; this.active = true; },
            unbind() { this.active = false; },
            dispose() { this.unbind(); },
            poll({ dt = 0 } = {}) {
                resolveTrailFlightTarget(index, this.time, player.position, target, this.progress);
                if (ghost && index === 1 && this.time >= 18) {
                    if (!state.crossingTarget) {
                        let nearest = Infinity;
                        let crossX = 0; let crossY = 0; let crossZ = 0;
                        for (const ref of manager.players[0].trail?.segmentRefs || []) {
                            const segment = ref?.entry;
                            if (!segment) continue;
                            const dx = segment.toX - segment.fromX;
                            const dy = segment.toY - segment.fromY;
                            const dz = segment.toZ - segment.fromZ;
                            const fraction = clamp(((player.position.x - segment.fromX) * dx
                                + (player.position.y - segment.fromY) * dy
                                + (player.position.z - segment.fromZ) * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
                            const x = segment.fromX + dx * fraction;
                            const y = segment.fromY + dy * fraction;
                            const z = segment.fromZ + dz * fraction;
                            const distance = Math.hypot(player.position.x - x, player.position.y - y, player.position.z - z);
                            if (distance < nearest) { nearest = distance; crossX = x; crossY = y; crossZ = z; }
                        }
                        if (nearest < 25) {
                            const scale = 10 / (nearest || 1);
                            state.crossingTarget = { x: crossX + (crossX - player.position.x) * scale,
                                y: crossY + (crossY - player.position.y) * scale - 2,
                                z: crossZ + (crossZ - player.position.z) * scale };
                        }
                    }
                    if (state.crossingTarget) target.set(state.crossingTarget.x,
                        state.crossingTarget.y, state.crossingTarget.z);
                }
                inverse.copy(player.quaternion).invert();
                desired.copy(target).sub(player.position).normalize().applyQuaternion(inverse);
                localUp.set(0, 1, 0).applyQuaternion(inverse);
                input.yawAxis = clamp(-Math.atan2(desired.x, -desired.z) * 2, -1, 1);
                const pitch = Math.atan2(desired.y, Math.hypot(desired.x, desired.z));
                input.pitchAxis = clamp(pitch * 2, -1, 1) * (player.invertPitchBase ? -1 : 1);
                input.rollAxis = clamp(-Math.atan2(localUp.x, localUp.y) * 1.5, -1, 1);
                this.time += Math.max(0, dt);
                input.useItem = false;
                if (index === 0) {
                    document.body?.style?.setProperty('--trail-short-hud-opacity',
                        String(trailShortHudOpacity(this.time - TRAIL_SHORT.warmup)));
                }
                if (index === (ghost ? 1 : 0)) {
                    state.itemCollected ||= player.inventory?.includes(ghost ? 'GHOST' : 'THICK') === true;
                    if (state.itemCollected && !state.itemRequested
                        && this.time >= (ghost ? 16.3 : TRAIL_SHORT.warmup + 10.5)) {
                        input.useItem = true;
                        state.itemRequested = true;
                    }
                }
                if (index === 1 && this.time >= 16) {
                    for (const ref of manager.players[0].trail?.segmentRefs || []) {
                        const segment = ref?.entry;
                        if (!segment) continue;
                        const dx = segment.toX - segment.fromX;
                        const dy = segment.toY - segment.fromY;
                        const dz = segment.toZ - segment.fromZ;
                        const fraction = clamp(((player.position.x - segment.fromX) * dx
                            + (player.position.y - segment.fromY) * dy
                            + (player.position.z - segment.fromZ) * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
                        const distance = Math.hypot(player.position.x - segment.fromX - dx * fraction,
                            player.position.y - segment.fromY - dy * fraction, player.position.z - segment.fromZ - dz * fraction);
                        if (distance < state.closestPass.distance) {
                            state.closestPass.distance = distance;
                            state.closestPass.time = this.time;
                            if (ghost) {
                                state.closestPass.playerX = player.position.x;
                                state.closestPass.playerY = player.position.y;
                                state.closestPass.playerZ = player.position.z;
                                state.closestPass.trailX = segment.fromX + dx * fraction;
                                state.closestPass.trailY = segment.fromY + dy * fraction;
                                state.closestPass.trailZ = segment.fromZ + dz * fraction;
                            }
                            state.ghostActiveAtCrossing = player.isGhost === true;
                        }
                    }
                }
                if (index === 0) {
                    state.time = this.time;
                    if (this.time >= TRAIL_SHORT.warmup && state.clipStartedAt === null) state.clipStartedAt = performance.now();
                    if (this.time >= TRAIL_SHORT.warmup + TRAIL_SHORT.duration && state.finishedAt === null) state.finishedAt = performance.now();
                    const shot = resolveTrailShortShot(this.time - TRAIL_SHORT.warmup);
                    const subject = ghost && shot.kind === 'third-person' ? 1 : (shot.player || 0);
                    if (state.subject !== subject) {
                        state.subject = subject;
                        game.renderer.viewportSystem.setNetworkMode(true, subject, game.renderer.cameras, 1);
                        document.getElementById('p1-hud')?.classList.toggle('hidden', subject !== 0);
                        document.getElementById('p2-hud')?.classList.toggle('hidden', subject !== 1);
                        document.body?.setAttribute('data-trail-short-player', String(subject));
                    }
                    const sample = Math.floor(this.time * 2);
                    if (sample !== state.lastSample) {
                        state.lastSample = sample;
                        state.history.push({ time: this.time, players: manager.players.map((item) => ({
                            alive: item.alive, position: item.position.toArray(), trail: item.trail?.segmentCount,
                        })) });
                    }
                }
                return input;
            },
        };
        game.input.setPlayerSource(index, source);
        return source;
    });
    const pickup = game.powerupManager?.spawnAtAnchor?.({
        ownerId: 'marketing-trail-short', type: ghost ? 'GHOST' : 'THICK',
        x: ghost ? -24.1 : ROUTES[0].points[0].x,
        y: ghost ? 48.5 : ROUTES[0].points[0].y,
        z: ghost ? -40.8 : ROUTES[0].points[0].z,
    });
    if (!pickup) throw new Error(`The trail short needs a real ${ghost ? 'GHOST' : 'THICK'} pickup`);
    game.renderer.setSplitScreen(false);
    document.getElementById('hud')?.classList.remove('split-screen');
    game.renderer.cameraModes.fill(0);
    return { state, sources };
}

export function createTrailShortCamera(templateCamera, { handoff = false, variant = 'thick' } = {}) {
    const camera = templateCamera.clone();
    const focus = camera.position.clone();
    const offset = camera.position.clone();
    const across = camera.position.clone();
    const smoothedFocus = camera.position.clone();
    const desiredPosition = camera.position.clone();
    const followPosition = camera.position.clone();
    const followTarget = camera.position.clone();
    const followDirection = camera.position.clone();
    const followCamera = templateCamera.clone();
    let previousTime = -Infinity;
    const pose = { index: 0, position: {}, quaternion: {}, fov: 55, near: camera.near, far: camera.far, zoom: 1 };
    return {
        sample(projection, time, portrait = false) {
            const first = projection.players.find((player) => player.playerIndex === 0);
            const second = projection.players.find((player) => player.playerIndex === 1);
            if (!first?.position || !second?.position) throw new Error('Camera subjects missing');
            focus.set(first.position.x, first.position.y, first.position.z)
                .lerp(second.position, variant === 'ghost' ? 0.78 : 0.5);
            across.set(second.position.x - first.position.x, 0, second.position.z - first.position.z);
            const span = Math.hypot(across.x, second.position.y - first.position.y, across.z);
            if (across.lengthSq() < 0.01) across.set(1, 0, 0);
            across.normalize();
            const orbit = 0.18 + Math.sin(time * 0.22) * 0.035;
            const radius = variant === 'ghost' ? (portrait ? 48 : 46)
                : portrait ? span * 0.5 + 28 + Math.abs(second.position.y - first.position.y) * 0.9
                    : Math.max(36, span * 0.8 + 16);
            const side = variant !== 'ghost' && portrait && handoff && time < 7 ? -1 : 1;
            offset.set(
                (across.x * Math.cos(orbit) - across.z * Math.sin(orbit)) * radius * side,
                variant === 'ghost' ? 16 : 5,
                (across.z * Math.cos(orbit) + across.x * Math.sin(orbit)) * radius * side,
            );
            if (!portrait) {
                // A stable side angle and gentle dolly keep the spatial duel readable.
                const angle = Math.PI / 4 + Math.sin(time * 0.12) * 0.07;
                offset.set(Math.cos(angle) * radius, variant === 'ghost' ? 16 : 5,
                    Math.sin(angle) * radius);
            }
            desiredPosition.copy(focus).add(offset);
            const dt = time - previousTime;
            if (dt > 0 && dt <= 0.25) {
                camera.position.lerp(desiredPosition, 1 - Math.exp(-dt * 4));
                smoothedFocus.lerp(focus, 1 - Math.exp(-dt * 5));
            } else {
                camera.position.copy(desiredPosition);
                smoothedFocus.copy(focus);
            }
            previousTime = time;
            camera.up.set(0, 1, 0);
            camera.lookAt(smoothedFocus);
            // Fly into the same native third-person position before the HUD shot begins.
            const openingBlend = portrait ? clamp((time - 1.25) / 1.75, 0, 1)
                : clamp(time / 3, 0, 1);
            const openingPlayer = variant === 'ghost' ? second : first;
            const transition = time < 7 ? { player: openingPlayer, amount: openingBlend }
                : time >= 7 && time < 8 ? { player: openingPlayer, amount: 8 - time }
                    : time >= 9 ? { player: second, amount: clamp(time - 9, 0, 1) } : null;
            if (handoff && transition) {
                const player = transition.player;
                const recorded = projection.recordedCamera;
                if (recorded?.position && recorded?.quaternion) {
                    followCamera.position.set(recorded.position.x, recorded.position.y, recorded.position.z);
                    followCamera.quaternion.set(recorded.quaternion.x, recorded.quaternion.y,
                        recorded.quaternion.z, recorded.quaternion.w);
                    followCamera.fov = Number(recorded.fov) || 75;
                } else {
                    followDirection.set(player.direction?.x || 0, player.direction?.y || 0, player.direction?.z || -1);
                    followDirection.normalize();
                    followPosition.set(player.position.x, player.position.y, player.position.z)
                        .addScaledVector(followDirection, -9);
                    followPosition.y += 5;
                    followTarget.set(player.position.x, player.position.y, player.position.z)
                        .addScaledVector(followDirection, 7);
                    followCamera.position.copy(followPosition);
                    followCamera.lookAt(followTarget);
                    followCamera.fov = 75;
                }
                const amount = clamp(transition.amount, 0, 1);
                const blend = amount * amount * (3 - 2 * amount);
                camera.position.lerp(followCamera.position, blend);
                camera.quaternion.slerp(followCamera.quaternion, blend);
                camera.fov = 55 + (followCamera.fov - 55) * blend;
            } else camera.fov = 55;
            // The native replay projection reuses this object and overwrites lens fields.
            pose.index = 0;
            pose.fov = camera.fov;
            pose.near = camera.near;
            pose.far = camera.far;
            pose.zoom = 1;
            pose.position.x = camera.position.x;
            pose.position.y = camera.position.y;
            pose.position.z = camera.position.z;
            pose.quaternion.x = camera.quaternion.x;
            pose.quaternion.y = camera.quaternion.y;
            pose.quaternion.z = camera.quaternion.z;
            pose.quaternion.w = camera.quaternion.w;
            return pose;
        },
    };
}
