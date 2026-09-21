import * as THREE from 'three';
import { getHydraMouthPosition } from './MapUnitHydraVisualOps.js';

const WARNING_SECONDS = 0.7;
const SNAP_SECONDS = 0.3;
const FIREBALL_SECONDS = 0.3;
const CONTACT_SECONDS = 1.5;
const mouth = new THREE.Vector3();
const targetPoint = new THREE.Vector3();
const shotDirection = new THREE.Vector3();

function nextRandom(system) {
    const value = Number(system.entityManager?.runtimeRng?.next?.());
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
}

function readyPlayer(player) {
    return player?.alive === true && !!player.position && (Number(player.spawnProtectionTimer) || 0) <= 0;
}

function applyHydraDamage(system, unit, player, amount, cause, impactPoint) {
    if (!readyPlayer(player)) return false;
    const owner = system.entityManager;
    const result = player.takeDamage?.(amount);
    owner?._emitHuntDamageEvent?.({
        target: player, sourcePlayer: unit.source, cause,
        damageResult: result, impactPoint,
    });
    if (result?.isDead) owner?._killPlayer?.(player, 'PROJECTILE', {
        killer: unit.source, impactPoint, projectileType: cause,
    });
    return true;
}

function hasSight(system, from, to) {
    const arena = system.entityManager?.arena;
    if (typeof arena?.raycast !== 'function') return true;
    shotDirection.subVectors(to, from);
    const distance = shotDirection.length();
    if (distance <= 0.0001) return true;
    shotDirection.divideScalar(distance);
    const hit = arena.raycast(from, shotDirection, distance - 0.5);
    return !hit?.hit || Number(hit.distance) >= distance - 0.5;
}

function chooseSpitTarget(system, unit) {
    const candidates = [];
    for (const player of system.entityManager?.players || []) {
        if (!readyPlayer(player)) continue;
        if (player.position.distanceToSquared(unit.position) > (60 * unit.scale) ** 2) continue;
        if (!hasSight(system, unit.position, player.position)) continue;
        candidates.push(player);
    }
    return candidates.length ? candidates[Math.floor(nextRandom(system) * candidates.length)] : null;
}

export function createHydraState() {
    return {
        action: 'idle', phase: 'idle', head: 0, event: 0,
        direction: new THREE.Vector3(0, 0, 1), moving: true,
        initialized: false, phaseRemaining: 0, snapRemaining: 0,
        spitRemaining: 0, target: null,
        hitPlayers: new Set(), contactLocks: new Map(),
    };
}

function startAttack(system, unit, action) {
    const state = unit.hydra;
    if (action === 'spit') {
        state.target = chooseSpitTarget(system, unit);
        if (!state.target) { state.spitRemaining = 1; return false; }
        state.head = 1 + Math.floor(nextRandom(system) * 5);
        state.spitRemaining = 7 + 3 * nextRandom(system);
        state.direction.subVectors(state.target.position, unit.position).normalize();
    } else {
        state.target = null;
        state.head = 1 + Math.floor(nextRandom(system) * 5);
        const angle = 2 * Math.PI * nextRandom(system);
        state.direction.set(Math.sin(angle), 0, Math.cos(angle));
        state.snapRemaining = 5 + 3 * nextRandom(system);
    }
    state.action = action;
    state.phase = 'warning';
    state.phaseRemaining = WARNING_SECONDS;
    state.moving = false;
    state.event += 1;
    state.hitPlayers.clear();
    return true;
}

function fireball(system, unit) {
    const state = unit.hydra;
    const target = state.target;
    if (!readyPlayer(target)) return;
    getHydraMouthPosition(unit, state.head, mouth);
    targetPoint.copy(target.position);
    shotDirection.subVectors(targetPoint, mouth);
    if (shotDirection.lengthSq() <= 0.000001) return;
    shotDirection.normalize();
    state.direction.copy(shotDirection);
    system.entityManager?._projectileSystem?.spawnHydraFireball?.(unit.source, mouth, shotDirection, unit.scale);
}

function snapHit(system, unit) {
    const state = unit.hydra;
    const direction = state.direction;
    const startX = unit.groundPosition.x + direction.x * 5.5 * unit.scale;
    const startZ = unit.groundPosition.z + direction.z * 5.5 * unit.scale;
    const endX = startX + direction.x * 4 * unit.scale;
    const endZ = startZ + direction.z * 4 * unit.scale;
    const lenSq = (endX - startX) ** 2 + (endZ - startZ) ** 2;
    for (const player of system.entityManager?.players || []) {
        if (!readyPlayer(player) || state.hitPlayers.has(player)) continue;
        if (Math.abs(player.position.y - unit.position.y) > 4 * unit.scale) continue;
        const t = Math.max(0, Math.min(1,
            ((player.position.x - startX) * (endX - startX)
                + (player.position.z - startZ) * (endZ - startZ)) / lenSq));
        const dx = player.position.x - (startX + t * (endX - startX));
        const dz = player.position.z - (startZ + t * (endZ - startZ));
        const radius = 1.6 * unit.scale + Math.max(0, Number(player.hitboxRadius) || 0);
        if (dx * dx + dz * dz <= radius * radius) {
            state.hitPlayers.add(player);
            applyHydraDamage(system, unit, player, 30, 'HYDRA_SNAP', player.position);
        }
    }
}

function contactHit(system, unit, dt) {
    const state = unit.hydra;
    for (const [player, remaining] of state.contactLocks) {
        if (remaining <= dt) state.contactLocks.delete(player);
        else state.contactLocks.set(player, remaining - dt);
    }
    for (const player of system.entityManager?.players || []) {
        if (!readyPlayer(player) || state.contactLocks.has(player)) continue;
        if (Math.abs(player.position.y - unit.position.y) > 4 * unit.scale) continue;
        const dx = player.position.x - unit.groundPosition.x;
        const dz = player.position.z - unit.groundPosition.z;
        const radius = unit.hitboxRadius + Math.max(0, Number(player.hitboxRadius) || 0);
        if (dx * dx + dz * dz <= radius * radius) {
            state.contactLocks.set(player, CONTACT_SECONDS);
            applyHydraDamage(system, unit, player, 10, 'HYDRA_CONTACT', player.position);
        }
    }
}

export function updateHydra(system, unit, dt, authority) {
    const state = unit.hydra;
    if (!state || !unit.alive || !authority) return;
    if (!state.initialized) {
        state.snapRemaining = 5 + 3 * nextRandom(system);
        state.spitRemaining = 7 + 3 * nextRandom(system);
        state.initialized = true;
    }
    contactHit(system, unit, dt);
    state.snapRemaining = Math.max(0, state.snapRemaining - dt);
    state.spitRemaining = Math.max(0, state.spitRemaining - dt);
    if (state.phase === 'idle') {
        state.moving = true;
        if (state.snapRemaining <= 0) startAttack(system, unit, 'snap');
        else if (state.spitRemaining <= 0) startAttack(system, unit, 'spit');
        return;
    }
    state.moving = false;
    state.phaseRemaining -= dt;
    if (state.phase === 'warning' && state.phaseRemaining <= 0) {
        state.phase = 'active';
        state.phaseRemaining += state.action === 'snap' ? SNAP_SECONDS : FIREBALL_SECONDS;
        if (state.action === 'spit') fireball(system, unit);
    }
    if (state.phase === 'active' && state.action === 'snap') snapHit(system, unit);
    if (state.phase === 'active' && state.phaseRemaining <= 0) {
        state.phase = 'idle';
        state.action = 'idle';
        state.target = null;
        state.moving = true;
    }
}

export function stopHydra(system, unit) {
    if (!unit.hydra) return;
    unit.hydra.phase = 'idle';
    unit.hydra.action = 'idle';
    unit.hydra.target = null;
    unit.hydra.hitPlayers.clear();
    unit.hydra.contactLocks.clear();
    system.entityManager?._projectileSystem?.clearForOwner?.(unit.source);
}
