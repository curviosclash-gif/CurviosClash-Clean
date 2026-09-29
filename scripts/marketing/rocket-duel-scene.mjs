/* global performance */
import { Quaternion, Vector3 } from 'three';

export const ROCKET_DUEL = Object.freeze({
    prerollSeconds: 120,
    durationSeconds: 40,
    cameraShots: Object.freeze([
        { start: 0, kind: 'player', player: 0 },
        { start: 6, kind: 'cinematic' },
        { start: 9, kind: 'player', player: 1 },
        { start: 15, kind: 'cinematic' },
        { start: 21, kind: 'player', player: 0 },
        { start: 27, kind: 'cinematic' },
        { start: 31, kind: 'player', player: 1 },
        { start: 36, kind: 'cinematic' },
    ]),
});

const PICKUP_TIMES = [
    { at: 18, player: 0 }, { at: 22, player: 1 },
    { at: 55, player: 0 }, { at: 60, player: 1 },
    { at: 94, player: 0 }, { at: 99, player: 1 },
    { at: 122, player: 0 }, { at: 130, player: 1 },
    { at: 145, player: 0 }, { at: 151, player: 1 },
];
const SHOT_TIMES = [
    { at: 28, player: 0 }, { at: 34, player: 1 },
    { at: 67, player: 0 }, { at: 73, player: 1 },
    { at: 107, player: 0 }, { at: 112, player: 1 },
    { at: 137, player: 0 }, { at: 143, player: 1 },
    { at: 153, player: 0 }, { at: 157, player: 1 },
];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const sampledRightRotation = new Quaternion();
const smooth = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};

export function rocketDuelShotAt(time) {
    return ROCKET_DUEL.cameraShots.findLast((shot) => time >= shot.start)
        || ROCKET_DUEL.cameraShots[0];
}

export function sampleRocketDuelRecordedCamera(leftSnapshot, rightSnapshot, alpha, playerIndex, out = null) {
    const left = leftSnapshot?.cameras?.find((camera) => camera.index === playerIndex);
    const right = rightSnapshot?.cameras?.find((camera) => camera.index === playerIndex) || left;
    if (!left || !right) throw new Error(`Recorded camera missing for player ${playerIndex}`);
    const amount = clamp(alpha, 0, 1);
    const pose = out || { position: {}, quaternion: new Quaternion(), fov: 75 };
    pose.position.x = left.position[0] + (right.position[0] - left.position[0]) * amount;
    pose.position.y = left.position[1] + (right.position[1] - left.position[1]) * amount;
    pose.position.z = left.position[2] + (right.position[2] - left.position[2]) * amount;
    sampledRightRotation.fromArray(right.quaternion);
    pose.quaternion.fromArray(left.quaternion).slerp(sampledRightRotation, amount);
    pose.fov = left.fov + (right.fov - left.fov) * amount;
    return pose;
}

export function installRocketDuelFlight(game) {
    const manager = game.entityManager;
    const humans = manager?.players?.filter((player) => !player.isBot) || [];
    const bots = manager?.players?.filter((player) => player.isBot) || [];
    if (humans.length !== 2 || bots.length !== 3) {
        throw new Error(`Rocket duel requires two players and three bots; got ${humans.length} + ${bots.length}`);
    }
    game.input.clearPlayerSources();
    const state = {
        time: 0, pickups: [], shots: [], events: [], samples: [],
        clipStartedAt: null, clipEndedAt: null, lastSample: -1,
    };
    const originalLogEvent = game.recorder?.logEvent;
    if (typeof originalLogEvent === 'function') {
        game.recorder.logEvent = function (type, playerIndex, data = '', position = null) {
            if ((type === 'ITEM_USE' && String(data).includes('ROCKET'))
                || (type === 'ITEM_PICKUP' && String(data).includes('ROCKET'))
                || type === 'KILL') {
                state.events.push({ at: state.time, type, player: playerIndex, data: String(data) });
            }
            return originalLogEvent.call(this, type, playerIndex, data, position);
        };
    }
    for (const [index, player] of humans.entries()) {
        const x = index === 0 ? 51 : -51;
        const z = index === 0 ? 0 : 0;
        const start = new Vector3(x, 39, z);
        const forward = new Vector3(0, 0, index === 0 ? 1 : -1);
        manager._spawnOps.spawnPlayerAt(player, start, forward);
    }
    const sources = humans.map((player, index) => {
        const target = new Vector3();
        const inverse = new Quaternion();
        const local = new Vector3();
        const up = new Vector3();
        const input = { pitchAxis: 0, yawAxis: 0, rollAxis: 0, shootRocket: false,
            shootMG: false, boost: false };
        const source = {
            type: 'marketing-rocket-duel', active: true, playerIndex: index,
            time: 0, pickup: null, nextPickup: 0, nextShot: 0,
            bind(slot) { this.playerIndex = slot; this.active = true; },
            unbind() { this.active = false; },
            dispose() { this.unbind(); },
            poll({ dt = 0 } = {}) {
                this.time += Math.max(0, dt);
                const time = this.time;
                const other = humans[1 - index];
                const pickupOrder = PICKUP_TIMES.filter((entry) => entry.player === index);
                const shotOrder = SHOT_TIMES.filter((entry) => entry.player === index);
                const next = pickupOrder[this.nextPickup];
                if (next && time >= next.at && player.alive) {
                    const ahead = new Vector3(0, 0, -1).applyQuaternion(player.quaternion).multiplyScalar(12);
                    const position = player.position.clone().add(ahead);
                    const item = manager.powerupManager.spawnAtAnchor({
                        ownerId: `marketing-duel-${index}-${this.nextPickup}`,
                        type: 'ROCKET_WEAK', x: position.x, y: position.y, z: position.z,
                    });
                    if (!item) throw new Error('Rocket pickup spawn failed');
                    this.pickup = item;
                    state.pickups.push({ player: index, at: time, position: position.toArray() });
                    this.nextPickup += 1;
                }
                if (this.pickup && !manager.powerupManager.items.includes(this.pickup)) this.pickup = null;
                if (this.pickup && time - pickupOrder[this.nextPickup - 1].at < 9) {
                    target.copy(this.pickup.mesh.position);
                } else if (time >= ROCKET_DUEL.prerollSeconds + 15 && other.alive) {
                    const radius = 22 + 5 * Math.sin(time * 0.7 + index);
                    target.copy(other.position);
                    target.x += (index ? -1 : 1) * radius * Math.cos(time * 0.35);
                    target.z += (index ? 1 : -1) * radius * Math.sin(time * 0.35);
                    target.y = clamp(target.y + (index ? -4 : 4)
                        + 5 * Math.sin(time * 0.55 + index), 32, 44);
                } else {
                    const angle = Math.atan2(player.position.z, player.position.x)
                        + (index ? -0.55 : 0.55);
                    target.set(Math.cos(angle) * (index ? 45 : 52),
                        39 + 5 * Math.sin(time * 0.21 + index),
                        Math.sin(angle) * (index ? 45 : 52));
                }
                inverse.copy(player.quaternion).invert();
                local.copy(target).sub(player.position).normalize().applyQuaternion(inverse);
                up.set(0, 1, 0).applyQuaternion(inverse);
                input.yawAxis = clamp(-Math.atan2(local.x, -local.z) * 2, -1, 1);
                input.pitchAxis = clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)) * 2, -1, 1)
                    * (player.invertPitchBase ? -1 : 1);
                input.rollAxis = clamp(-Math.atan2(up.x, up.y) * 1.5, -1, 1);
                input.boost = time >= 120 && ((index === 0 && time >= 143 && time < 149)
                    || (index === 1 && time >= 150 && time < 156));
                input.shootMG = time >= 135 && other.alive && player.position.distanceTo(other.position) < 55;
                input.shootRocket = false;
                const shot = shotOrder[this.nextShot];
                if (shot && time >= shot.at && player.rocketInventory?.length) {
                    input.shootRocket = true;
                    state.shots.push({ player: index, at: time, target: other.index });
                    this.nextShot += 1;
                }
                if (index === 0) {
                    state.time = time;
                    if (time >= ROCKET_DUEL.prerollSeconds && state.clipStartedAt === null
                        && humans.every((subject) => subject.alive)) state.clipStartedAt = performance.now();
                    if (state.clipStartedAt !== null && time >= ROCKET_DUEL.prerollSeconds + ROCKET_DUEL.durationSeconds
                        && state.clipEndedAt === null) state.clipEndedAt = performance.now();
                    const sample = Math.floor(time);
                    if (sample !== state.lastSample) {
                        state.lastSample = sample;
                        state.samples.push({ at: time, players: manager.players.map((subject) => ({
                            index: subject.index, bot: subject.isBot, alive: subject.alive,
                            hp: subject.hp, score: subject.score, position: subject.position.toArray(),
                            rockets: subject.rocketInventory?.length || 0,
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
    game.renderer.viewportSystem.setNetworkMode(true, 0, game.renderer.cameras, 1);
    game.renderer.cameraModes.fill(0);
    return { state, sources };
}

export function createRocketDuelCamera(template) {
    const camera = template.clone();
    const focus = new Vector3();
    const direction = new Vector3();
    const cinematic = template.clone();
    const poses = [template.clone(), template.clone()];
    const output = { index: 0, position: {}, quaternion: {}, fov: 55,
        near: template.near, far: template.far, zoom: 1 };
    function poseFor(shot, projection, recordedCameras, time) {
        if (shot.kind === 'player') {
            const recorded = recordedCameras[shot.player];
            if (!recorded) throw new Error(`Missing recorded camera ${shot.player}`);
            const pose = poses[shot.player];
            pose.position.set(recorded.position.x, recorded.position.y, recorded.position.z);
            pose.quaternion.set(recorded.quaternion.x, recorded.quaternion.y,
                recorded.quaternion.z, recorded.quaternion.w);
            pose.fov = recorded.fov;
            return pose;
        }
        let first = null;
        let second = null;
        for (const player of projection.players) {
            if (player.playerIndex === 0) first = player;
            if (player.playerIndex === 1) second = player;
        }
        if (!first || !second) throw new Error('Duel camera needs both players');
        focus.copy(first.position).add(second.position).multiplyScalar(0.5);
        direction.copy(second.position).sub(first.position);
        const span = clamp(direction.length(), 20, 110);
        const angle = Math.atan2(direction.z, direction.x) + 0.8 + Math.sin(time * 0.14) * 0.16;
        cinematic.position.set(focus.x + Math.cos(angle) * (span * 0.7 + 20),
            focus.y + 12 + span * 0.13, focus.z + Math.sin(angle) * (span * 0.7 + 20));
        cinematic.up.set(0, 1, 0);
        cinematic.lookAt(focus);
        cinematic.fov = 58;
        return cinematic;
    }
    return {
        sample(projection, recordedCameras, time) {
            const shots = ROCKET_DUEL.cameraShots;
            let index = 0;
            for (let candidate = 1; candidate < shots.length && time >= shots[candidate].start; candidate += 1) {
                index = candidate;
            }
            const current = poseFor(shots[index], projection, recordedCameras, time);
            camera.position.copy(current.position);
            camera.quaternion.copy(current.quaternion);
            camera.fov = current.fov;
            if (index > 0 && time < shots[index].start + 1.5) {
                const previous = poseFor(shots[index - 1], projection, recordedCameras, time);
                const alpha = smooth((time - shots[index].start) / 1.5);
                camera.position.copy(previous.position).lerp(current.position, alpha);
                camera.quaternion.copy(previous.quaternion).slerp(current.quaternion, alpha);
                camera.fov = previous.fov + (current.fov - previous.fov) * alpha;
            }
            output.position.x = camera.position.x;
            output.position.y = camera.position.y;
            output.position.z = camera.position.z;
            output.quaternion.x = camera.quaternion.x;
            output.quaternion.y = camera.quaternion.y;
            output.quaternion.z = camera.quaternion.z;
            output.quaternion.w = camera.quaternion.w;
            output.fov = camera.fov;
            return output;
        },
    };
}
