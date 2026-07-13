export class PlayerCollisionPhase {
    constructor(entityManager) {
        this.entityManager = entityManager;
    }

    run(player, prevPos, strategy) {
        const entityManager = this.entityManager;
        const spawnProtected = (player.spawnProtectionTimer || 0) > 0;
        if (player.isGhost || spawnProtected) {
            return false;
        }

        const hRadius = Math.max(0.05, Number(player.hitboxRadius) || 0.4);
        let arenaCollision = this._probeArenaCollision(player.position, hRadius);
        let bouncedOnFoam = false;

        if (!arenaCollision) {
            player.getAimDirection(entityManager._tmpDir).multiplyScalar(4).add(player.position);
            arenaCollision = this._probeArenaCollision(entityManager._tmpDir, hRadius);
        }

        if (!arenaCollision) {
            player.getDirection(entityManager._tmpVec).multiplyScalar(-1.5).add(player.position);
            arenaCollision = this._probeArenaCollision(entityManager._tmpVec, hRadius);
        }

        if (!arenaCollision) {
            entityManager._tmpVec.set(0, 1, 0).applyQuaternion(player.quaternion);
            entityManager._tmpDir.crossVectors(entityManager._tmpVec, player.getDirection(entityManager._tmpVec2)).normalize();

            entityManager._tmpVec2.copy(entityManager._tmpDir).multiplyScalar(2).add(player.position);
            arenaCollision = this._probeArenaCollision(entityManager._tmpVec2, hRadius);

            if (!arenaCollision) {
                entityManager._tmpVec2.copy(entityManager._tmpDir).multiplyScalar(-2).add(player.position);
                arenaCollision = this._probeArenaCollision(entityManager._tmpVec2, hRadius);
            }
        }

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
