import * as THREE from 'three';

// Broadphase slack for vehicle-vs-vehicle checks: the hitbox sphere is much smaller than
// the vehicle body, so the sphere test only preselects and the oriented box decides.
const CRASH_BROADPHASE_SCALE = 3;
const CRASH_SWEEP_MAX_STEPS = 16;

export class PlayerCollisionPhase {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this._tmpSweepDelta = new THREE.Vector3();
        this._tmpSweepPoint = new THREE.Vector3();
        this._tmpSweepLastFree = new THREE.Vector3();
        this._tmpCrashNormal = new THREE.Vector3();
        this._tmpArenaNormal = new THREE.Vector3();
        this._arenaCollisionResponse = {
            hit: false,
            kind: 'wall',
            isWall: false,
            normal: null,
            responseHasProbe: false,
            responseAlreadySeparated: false,
            responseProbeOffsetX: 0,
            responseProbeOffsetY: 0,
            responseProbeOffsetZ: 0,
        };
    }

    run(player, prevPos, strategy) {
        const entityManager = this.entityManager;
        const spawnProtected = (player.spawnProtectionTimer || 0) > 0;
        if (player.isGhost || spawnProtected) {
            return false;
        }

        const hRadius = Math.max(0.05, Number(player.hitboxRadius) || 0.4);
        let bouncedOnFoam = false;

        // A bounce just pushed this player off a surface; re-testing the arena immediately
        // would resolve the very same contact again. Trails stay armed on purpose.
        if ((player.arenaCollisionGraceTimer || 0) <= 0) {
            const arenaCollision = this._resolveArenaCollision(player, prevPos, hRadius);
            if (arenaCollision?.hit) {
                const hitKind = String(arenaCollision.kind || 'wall').toLowerCase();
                if (hitKind === 'foam') {
                    if (entityManager.audio) entityManager.audio.play('HIT');
                    if (entityManager.particles) entityManager.particles.spawnHit(player.position, 0x34d399);
                    entityManager._bouncePlayerOnFoam(player, arenaCollision.normal || null);
                    bouncedOnFoam = true;
                } else {
                    const died = strategy.handleWallCollision(player, arenaCollision, entityManager);
                    if (died) return true;
                }
            }
        }

        if (!bouncedOnFoam) {
            const selfTrailSkipRecent = entityManager.constructor.deriveSelfTrailSkipRecentSegments(player);
            const collision = this._resolveTrailCollision(player, prevPos, hRadius * 2.0, selfTrailSkipRecent);
            if (collision?.hit) {
                const trailCause = collision.playerIndex === player.index ? 'TRAIL_SELF' : 'TRAIL_OTHER';
                const sourcePlayer = collision.playerIndex >= 0 && collision.playerIndex !== player.index
                    ? entityManager.players[collision.playerIndex]
                    : null;
                const died = strategy.handleTrailCollision(player, collision, trailCause, sourcePlayer, entityManager);
                if (died) return true;
            }
        }

        if (player.alive && this._resolvePlayerCrash(player, hRadius, strategy)) {
            return true;
        }

        return false;
    }

    _resolveArenaCollision(player, prevPos, hRadius) {
        const entityManager = this.entityManager;

        // Swept first: the point probes below only see where the player ended up this
        // frame, so on a frame spike a fast vehicle passes straight through a thin wall.
        const sweptCollision = this._probeSweptArenaCollision(player, prevPos, hRadius);
        if (sweptCollision) {
            return this._prepareArenaCollisionResponse(sweptCollision, player.position, player, true);
        }

        let arenaCollision = this._probeArenaCollision(player.position, hRadius);
        if (arenaCollision) {
            return this._prepareArenaCollisionResponse(arenaCollision, player.position, player);
        }

        player.getAimDirection(entityManager._tmpDir).multiplyScalar(4).add(player.position);
        arenaCollision = this._probeArenaCollision(entityManager._tmpDir, hRadius);
        if (arenaCollision) {
            return this._prepareArenaCollisionResponse(arenaCollision, entityManager._tmpDir, player);
        }

        player.getDirection(entityManager._tmpVec).multiplyScalar(-1.5).add(player.position);
        arenaCollision = this._probeArenaCollision(entityManager._tmpVec, hRadius);
        if (arenaCollision) {
            return this._prepareArenaCollisionResponse(arenaCollision, entityManager._tmpVec, player);
        }

        entityManager._tmpVec.set(0, 1, 0).applyQuaternion(player.quaternion);
        entityManager._tmpDir.crossVectors(entityManager._tmpVec, player.getDirection(entityManager._tmpVec2)).normalize();

        entityManager._tmpVec2.copy(entityManager._tmpDir).multiplyScalar(2).add(player.position);
        arenaCollision = this._probeArenaCollision(entityManager._tmpVec2, hRadius);
        if (arenaCollision) {
            return this._prepareArenaCollisionResponse(arenaCollision, entityManager._tmpVec2, player);
        }

        entityManager._tmpVec2.copy(entityManager._tmpDir).multiplyScalar(-2).add(player.position);
        arenaCollision = this._probeArenaCollision(entityManager._tmpVec2, hRadius);
        if (arenaCollision) {
            return this._prepareArenaCollisionResponse(arenaCollision, entityManager._tmpVec2, player);
        }

        return null;
    }

    _prepareArenaCollisionResponse(collision, probePoint, player, alreadySeparated = false) {
        const response = this._arenaCollisionResponse;
        response.hit = collision?.hit === true;
        response.kind = collision?.kind || 'wall';
        response.isWall = collision?.isWall === true;
        response.normal = collision?.normal
            ? this._tmpArenaNormal.copy(collision.normal)
            : null;
        response.responseHasProbe = !alreadySeparated && !!probePoint && !!player?.position;
        response.responseAlreadySeparated = alreadySeparated;
        response.responseProbeOffsetX = response.responseHasProbe ? probePoint.x - player.position.x : 0;
        response.responseProbeOffsetY = response.responseHasProbe ? probePoint.y - player.position.y : 0;
        response.responseProbeOffsetZ = response.responseHasProbe ? probePoint.z - player.position.z : 0;
        return response;
    }

    _probeSweptArenaCollision(player, prevPos, probeRadius) {
        if (!prevPos) return null;
        this._tmpSweepDelta.subVectors(player.position, prevPos);
        const travelled = this._tmpSweepDelta.length();
        // Anything shorter than one probe radius is already covered by the point probe on
        // the end pose - sweeping it would only cost time.
        if (!Number.isFinite(travelled) || travelled <= probeRadius) return null;

        const steps = Math.min(
            CRASH_SWEEP_MAX_STEPS,
            Math.max(2, Math.ceil(travelled / probeRadius))
        );
        this._tmpSweepLastFree.copy(prevPos);
        for (let step = 1; step <= steps; step++) {
            this._tmpSweepPoint.lerpVectors(prevPos, player.position, step / steps);
            const info = this._probeArenaCollision(this._tmpSweepPoint, probeRadius);
            if (!info) {
                this._tmpSweepLastFree.copy(this._tmpSweepPoint);
                continue;
            }
            // Pull the player back onto the last free sample so the impact resolves at the
            // wall instead of somewhere behind it.
            player.position.copy(this._tmpSweepLastFree);
            player.refreshObbCollisionQuery?.();
            return info;
        }
        return null;
    }

    _resolvePlayerCrash(player, probeRadius, strategy) {
        const entityManager = this.entityManager;
        if (typeof strategy?.handlePlayerCrash !== 'function') return false;
        if ((player.crashDamageCooldown || 0) > 0) return false;
        const players = entityManager.players;
        if (!Array.isArray(players)) return false;

        for (const other of players) {
            if (!other || other === player || !other.alive || other.isGhost) continue;
            if ((other.spawnProtectionTimer || 0) > 0) continue;
            if ((other.crashDamageCooldown || 0) > 0) continue;

            const otherRadius = Math.max(0.05, Number(other.hitboxRadius) || 0.4);
            const contactRadius = probeRadius + otherRadius;
            const broadphaseRadius = contactRadius * CRASH_BROADPHASE_SCALE;
            const distanceSq = player.position.distanceToSquared(other.position);
            if (distanceSq > broadphaseRadius * broadphaseRadius) continue;

            const touching = typeof other.isSphereInOBB === 'function'
                ? other.isSphereInOBB(player.position, probeRadius)
                : distanceSq <= contactRadius * contactRadius;
            if (!touching) continue;

            this._tmpCrashNormal.subVectors(player.position, other.position);
            if (this._tmpCrashNormal.lengthSq() <= 0.000001) {
                this._tmpCrashNormal.set(0, 1, 0);
            } else {
                this._tmpCrashNormal.normalize();
            }

            return strategy.handlePlayerCrash(player, other, this._tmpCrashNormal, entityManager) === true;
        }

        return false;
    }

    _probeArenaCollision(point, probeRadius = 0.4) {
        const entityManager = this.entityManager;
        if (typeof entityManager.arena.getCollisionInfo === 'function') {
            const info = entityManager.arena.getCollisionInfo(point, probeRadius);
            return info?.hit ? info : null;
        }
        if (entityManager.arena.checkCollision(point, probeRadius)) {
            return entityManager._fallbackArenaCollision;
        }
        return null;
    }

    _resolveTrailCollision(player, prevPos, radius, selfTrailSkipRecent) {
        const entityManager = this.entityManager;
        const directHit = entityManager.checkGlobalCollision(
            player.position,
            radius,
            player.index,
            selfTrailSkipRecent,
            player
        );
        if (directHit?.hit) {
            return directHit;
        }

        entityManager._tmpVec.subVectors(player.position, prevPos);
        const traveledDistance = entityManager._tmpVec.length();
        const minSweepDistance = Math.max(0.45, radius * 0.35);
        if (!Number.isFinite(traveledDistance) || traveledDistance <= minSweepDistance) {
            return null;
        }

        const stepDistance = Math.max(0.6, radius * 0.85);
        let steps = Math.ceil(traveledDistance / stepDistance);
        const gridSize = Number(entityManager?.trails?.spatialIndex?.gridSize || 0);
        if (gridSize > 0) {
            const prevCellX = Math.floor(prevPos.x / gridSize);
            const prevCellZ = Math.floor(prevPos.z / gridSize);
            const nextCellX = Math.floor(player.position.x / gridSize);
            const nextCellZ = Math.floor(player.position.z / gridSize);
            if (prevCellX === nextCellX && prevCellZ === nextCellZ) {
                steps = Math.min(10, steps);
            }
        }
        steps = Math.min(12, Math.max(2, steps));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            entityManager._tmpVec2.lerpVectors(prevPos, player.position, t);
            const sweptHit = entityManager.checkGlobalCollision(
                entityManager._tmpVec2,
                radius,
                player.index,
                selfTrailSkipRecent,
                null
            );
            if (sweptHit?.hit) {
                return sweptHit;
            }
        }

        return null;
    }
}
