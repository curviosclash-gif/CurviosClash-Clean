// @ts-nocheck
import * as THREE from 'three';
import { updateReplaySandstormState } from './CinematicReplayProjection.js';

export function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
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

export function buildReplayNetworkSnapshot(target, leftSnapshot, rightSnapshot, alpha) {
    const fogSnapshot = alpha < 0.5 ? leftSnapshot?.globalFog : rightSnapshot?.globalFog;
    const fogRemaining = Math.max(0, toFiniteNumber(fogSnapshot?.remainingSeconds, 0));
    target.globalFog = { active: fogSnapshot?.active === true && fogRemaining > 0, remainingSeconds: fogRemaining,
        visibilityRange: Math.max(0, toFiniteNumber(fogSnapshot?.visibilityRange, 0)) };
    target.sandstorm = updateReplaySandstormState(target.sandstorm, leftSnapshot?.sandstorm, rightSnapshot?.sandstorm, alpha);
    target.mapElapsedSeconds = THREE.MathUtils.lerp(
        toFiniteNumber(leftSnapshot?.mapElapsedSeconds, toFiniteNumber(leftSnapshot?.timeMs, 0) * 0.001),
        toFiniteNumber(rightSnapshot?.mapElapsedSeconds, toFiniteNumber(rightSnapshot?.timeMs, 0) * 0.001),
        alpha
    );
    const cherryLeafEvents = Array.isArray(rightSnapshot?.cherryLeaves)
        ? rightSnapshot.cherryLeaves
        : leftSnapshot?.cherryLeaves;
    target.cherryLeaves.length = 0;
    if (Array.isArray(cherryLeafEvents)) {
        for (const event of cherryLeafEvents) {
            if (Number.isFinite(Number(event?.[1])) && Number(event[1]) <= target.mapElapsedSeconds) {
                target.cherryLeaves.push(event);
            }
        }
    }
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
