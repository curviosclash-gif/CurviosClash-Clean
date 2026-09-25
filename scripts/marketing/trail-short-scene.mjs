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

export function installTrailShortFlight(game) {
    const manager = game.entityManager;
    if (manager?.players?.length !== 2 || manager.players.some((player) => player.isBot)) {
        throw new Error('The trail short requires exactly two human slots and no bots');
    }
    const state = { time: 0, history: [], lastSample: -1, clipStartedAt: null, finishedAt: null,
        closestPass: { distance: Infinity, time: 0 } };
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
        const input = { pitchAxis: 0, yawAxis: 0, rollAxis: 0 };
        const source = {
            type: 'marketing-sequence', active: true, playerIndex: index, time: 0, progress: { index: 0 },
            bind(slot) { this.playerIndex = slot; this.active = true; },
            unbind() { this.active = false; },
            dispose() { this.unbind(); },
            poll({ dt = 0 } = {}) {
                resolveTrailFlightTarget(index, this.time, player.position, target, this.progress);
                inverse.copy(player.quaternion).invert();
                desired.copy(target).sub(player.position).normalize().applyQuaternion(inverse);
                localUp.set(0, 1, 0).applyQuaternion(inverse);
                input.yawAxis = clamp(-Math.atan2(desired.x, -desired.z) * 2, -1, 1);
                const pitch = Math.atan2(desired.y, Math.hypot(desired.x, desired.z));
                input.pitchAxis = clamp(pitch * 2, -1, 1) * (player.invertPitchBase ? -1 : 1);
                input.rollAxis = clamp(-Math.atan2(localUp.x, localUp.y) * 1.5, -1, 1);
                this.time += Math.max(0, dt);
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
                        }
                    }
                }
                if (index === 0) {
                    state.time = this.time;
                    if (this.time >= TRAIL_SHORT.warmup && state.clipStartedAt === null) state.clipStartedAt = performance.now();
                    if (this.time >= TRAIL_SHORT.warmup + TRAIL_SHORT.duration && state.finishedAt === null) state.finishedAt = performance.now();
                    const subject = resolveTrailShortShot(this.time - TRAIL_SHORT.warmup).player || 0;
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
    game.renderer.setSplitScreen(false);
    document.getElementById('hud')?.classList.remove('split-screen');
    game.renderer.cameraModes.fill(0);
    return { state, sources };
}

export function createTrailShortCamera(templateCamera) {
    const camera = templateCamera.clone();
    const focus = camera.position.clone();
    const offset = camera.position.clone();
    const across = camera.position.clone();
    const smoothedFocus = camera.position.clone();
    const desiredPosition = camera.position.clone();
    let previousTime = -Infinity;
    const pose = { index: 0, position: {}, quaternion: {}, fov: 55, near: camera.near, far: camera.far, zoom: 1 };
    return {
        sample(projection, time, portrait = false) {
            const first = projection.players.find((player) => player.playerIndex === 0);
            const second = projection.players.find((player) => player.playerIndex === 1);
            if (!first?.position || !second?.position) throw new Error('Camera subjects missing');
            focus.set(first.position.x, first.position.y, first.position.z)
                .lerp(second.position, 0.5);
            across.set(second.position.x - first.position.x, 0, second.position.z - first.position.z);
            const span = Math.hypot(across.x, second.position.y - first.position.y, across.z);
            if (across.lengthSq() < 0.01) across.set(1, 0, 0);
            across.normalize();
            const orbit = 0.18 + Math.sin(time * 0.22) * 0.035;
            const radius = portrait ? span * 0.5 + 28 + Math.abs(second.position.y - first.position.y) * 0.9
                : Math.max(36, span * 0.8 + 16);
            offset.set(
                (across.x * Math.cos(orbit) - across.z * Math.sin(orbit)) * radius,
                5,
                (across.z * Math.cos(orbit) + across.x * Math.sin(orbit)) * radius,
            );
            if (!portrait) {
                // A stable side angle and gentle dolly keep the spatial duel readable.
                const angle = Math.PI / 4 + Math.sin(time * 0.12) * 0.07;
                offset.set(Math.cos(angle) * radius, 5, Math.sin(angle) * radius);
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
            // The native replay projection reuses this object and overwrites lens fields.
            pose.index = 0;
            pose.fov = 55;
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
