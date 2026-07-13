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
    spawnProtection: 0.16,
});

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
        let normal = normalOverride;
        if (!normal) {
            const bounds = owner.arena.bounds;
            const dLeft = pos.x - bounds.minX;
            const dRight = bounds.maxX - pos.x;
            const dDown = pos.y - bounds.minY;
            const dUp = bounds.maxY - pos.y;
            const dBack = pos.z - bounds.minZ;
            const dFront = bounds.maxZ - pos.z;

            let minDist = dLeft;
            owner._tmpVec2.set(1, 0, 0);
            if (dRight < minDist) { minDist = dRight; owner._tmpVec2.set(-1, 0, 0); }
            if (dDown < minDist) { minDist = dDown; owner._tmpVec2.set(0, 1, 0); }
            if (dUp < minDist) { minDist = dUp; owner._tmpVec2.set(0, -1, 0); }
            if (dFront < minDist) { minDist = dFront; owner._tmpVec2.set(0, 0, 1); }
            if (dBack < minDist) { minDist = dBack; owner._tmpVec2.set(0, 0, -1); }
            normal = owner._tmpVec2;
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
        if (Number.isFinite(options.spawnProtection) && options.spawnProtection > 0) {
            player.spawnProtectionTimer = Math.max(player.spawnProtectionTimer || 0, options.spawnProtection);
        }

        const botAI = owner.botByPlayer.get(player);
        if (botAI?.onBounce) botAI.onBounce(source, normal);
        if (owner.recorder) {
            owner.recorder.logEvent(source === 'TRAIL' ? 'BOUNCE_TRAIL' : 'BOUNCE_WALL', player.index);
        }
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
