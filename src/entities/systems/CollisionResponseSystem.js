// ============================================
// CollisionResponseSystem.js - bot bounce/clamp/collision response helpers
// ============================================
//
// Contract:
// - Inputs: owner (EntityManager-like), spawnPlacementSystem
// - Outputs: collision-safe bot direction/position adjustments
// - Side effects: mutates player quaternion/position and owner temp vectors
// - Hotpath guardrail: no per-frame object/array allocations in response methods

import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

const DEFAULT_FOAM_BOUNCE_DISTANCES = Object.freeze([4.0, 7.0, 10.0, 2.0]);
const DEFAULT_FOAM_BOUNCE_OPTIONS = Object.freeze({
    normalBias: 0.0,
    randomScale: 0.0,
    preRotateShove: 2.4,
    distances: DEFAULT_FOAM_BOUNCE_DISTANCES,
    normalPush: 4.8,
    extraPush: 3.2,
    trailGap: 0.45,
    collisionGrace: 0.16,
});

// Wiederverwendetes Sample-Objekt: der Recorder liest x/z synchron aus, deshalb
// braucht der Aufprallort keine eigene Allokation pro Bounce.
const BOUNCE_HEATMAP_SAMPLE = { x: 0, z: 0 };

function readBounceRandom(owner, options = {}) {
    const random = typeof options.random === 'function'
        ? options.random
        : owner?.runtimeRng?.next;
    if (typeof random !== 'function') return 0.5;
    const value = Number(random());
    if (!Number.isFinite(value)) return 0.5;
    if (value <= 0) return 0;
    if (value >= 1) return 0.999999999;
    return value;
}

/**
 * Picks the nearest arena wall and writes its inward normal into outVec.
 *
 * "Inward" means the normal points from the wall towards the arena centre, matching
 * ArenaCollision.getCollisionInfo(): the minX wall reports +X, the maxX wall reports -X.
 * Kept free of player/trail state so the sign convention stays testable on its own.
 */
export function resolveNearestBoundsNormal(bounds, pos, outVec) {
    if (!bounds || !pos || !outVec) return outVec;

    const dLeft = pos.x - bounds.minX;
    const dRight = bounds.maxX - pos.x;
    const dDown = pos.y - bounds.minY;
    const dUp = bounds.maxY - pos.y;
    const dBack = pos.z - bounds.minZ;
    const dFront = bounds.maxZ - pos.z;

    let minDist = dLeft;
    outVec.set(1, 0, 0);
    if (dRight < minDist) { minDist = dRight; outVec.set(-1, 0, 0); }
    if (dDown < minDist) { minDist = dDown; outVec.set(0, 1, 0); }
    if (dUp < minDist) { minDist = dUp; outVec.set(0, -1, 0); }
    if (dFront < minDist) { minDist = dFront; outVec.set(0, 0, -1); }
    if (dBack < minDist) { outVec.set(0, 0, 1); }

    return outVec;
}

export class CollisionResponseSystem {
    constructor(owner, spawnPlacementSystem = null) {
        this.owner = owner || null;
        this.spawnPlacementSystem = spawnPlacementSystem || null;
    }

    isBotPositionSafe(player, position) {
        const owner = this.owner;
        if (!owner || !player || !position) return false;
        if (owner.arena.checkCollision(position, player.hitboxRadius)) return false;
        const hit = owner.checkGlobalCollision(position, player.hitboxRadius, player.index, 20);
        return !hit;
    }

    clampBotPosition(vec) {
        const owner = this.owner;
        const bounds = owner?.arena?.bounds;
        if (!bounds || !vec) return;
        vec.x = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, vec.x));
        vec.y = Math.max(bounds.minY + 2, Math.min(bounds.maxY - 2, vec.y));
        vec.z = Math.max(bounds.minZ + 2, Math.min(bounds.maxZ - 2, vec.z));
    }

    bounceBot(player, normalOverride = null, source = 'WALL', options = {}) {
        const owner = this.owner;
        if (!owner || !player) return;

        const pos = player.position;
        // Der Bounce schiebt den Spieler gleich aus der Geometrie heraus. Fuer die
        // Heatmap zaehlt aber der Aufprallort, also hier festhalten.
        BOUNCE_HEATMAP_SAMPLE.x = pos.x;
        BOUNCE_HEATMAP_SAMPLE.z = pos.z;
        let normal = normalOverride;
        if (!normal) {
            normal = resolveNearestBoundsNormal(owner.arena.bounds, pos, owner._tmpVec2);
        }

        player.getDirection(owner._tmpDir).normalize();
        const dot = owner._tmpDir.dot(normal);
        owner._tmpDir.x -= 2 * dot * normal.x;
        owner._tmpDir.y -= 2 * dot * normal.y;
        owner._tmpDir.z -= 2 * dot * normal.z;
        owner._tmpDir.normalize();

        const normalBias = Number.isFinite(options.normalBias) ? options.normalBias : 0.25;
        owner._tmpDir.addScaledVector(normal, normalBias);

        const randomScale = Number.isFinite(options.randomScale)
            ? options.randomScale
            : (source === 'TRAIL' ? 0.35 : 0.24);
        if (randomScale > 0) {
            owner._tmpDir.x += (readBounceRandom(owner, options) - 0.5) * randomScale;
            owner._tmpDir.y += (readBounceRandom(owner, options) - 0.5) * randomScale;
            owner._tmpDir.z += (readBounceRandom(owner, options) - 0.5) * randomScale;
        }
        if (resolveGameplayConfig(owner).GAMEPLAY.PLANAR_MODE) owner._tmpDir.y = 0;

        owner._tmpDir.normalize();
        const preRotateShove = Number.isFinite(options.preRotateShove) ? options.preRotateShove : 1;
        owner._tmpDir.addScaledVector(owner._tmpDir, preRotateShove);
        owner._tmpVec.copy(owner._tmpDir).normalize();
        player.quaternion.setFromUnitVectors(owner._tmpVec2.set(0, 0, -1), owner._tmpVec);

        if (this.spawnPlacementSystem?.findSafeBouncePosition) {
            this.spawnPlacementSystem.findSafeBouncePosition(player, owner._tmpDir, normal, options);
        }

        if (Number.isFinite(options.extraPush) && options.extraPush > 0) {
            owner._tmpVec2.copy(player.position).addScaledVector(owner._tmpDir, options.extraPush);
            if (this.isBotPositionSafe(player, owner._tmpVec2)) {
                player.position.copy(owner._tmpVec2);
            }
        }

        player.trail.forceGap(Number.isFinite(options.trailGap) ? options.trailGap : 0.3);
        if (Number.isFinite(options.collisionGrace) && options.collisionGrace > 0) {
            player.arenaCollisionGraceTimer = Math.max(
                player.arenaCollisionGraceTimer || 0,
                options.collisionGrace
            );
        }

        const botAI = owner.botByPlayer.get(player);
        if (botAI?.onBounce) botAI.onBounce(source, normal);
        if (owner.recorder) {
            owner.recorder.logEvent(
                source === 'TRAIL' ? 'BOUNCE_TRAIL' : 'BOUNCE_WALL',
                player.index,
                '',
                BOUNCE_HEATMAP_SAMPLE
            );
        }
    }

    /**
     * Nudges a player out of the geometry it is stuck in, without touching its heading.
     *
     * bounceBot() rewrites the quaternion, which is fine for a bot but fights a human's
     * steering input. Human players therefore used to stay inside the wall and take the
     * wall damage again on every following frame; this moves them clear instead.
     */
    pushPlayerOutOfCollision(player, normal = null, distance = 1.6) {
        const owner = this.owner;
        if (!owner || !player || !normal) return false;

        const pushDistance = Number.isFinite(distance) && distance > 0 ? distance : 1.6;
        owner._tmpVec2.copy(normal);
        if (owner._tmpVec2.lengthSq() <= 0.000001) return false;
        owner._tmpVec2.normalize();

        for (let step = 1; step <= 3; step++) {
            owner._tmpVec.copy(player.position).addScaledVector(owner._tmpVec2, pushDistance * step);
            if (!owner.arena.checkCollision(owner._tmpVec, player.hitboxRadius)) {
                player.position.copy(owner._tmpVec);
                player.refreshObbCollisionQuery?.();
                player.trail?.forceGap?.(0.3);
                player.markRenderDiscontinuity?.('collision-pushout');
                return true;
            }
        }
        return false;
    }

    bouncePlayerOnFoam(player, normalOverride = null) {
        this.bounceBot(player, normalOverride, 'FOAM', DEFAULT_FOAM_BOUNCE_OPTIONS);
        if (typeof player?.lockSteering === 'function') {
            player.lockSteering(0.28);
        } else if (player) {
            player.steeringLockTimer = Math.max(player.steeringLockTimer || 0, 0.28);
        }
    }
}
