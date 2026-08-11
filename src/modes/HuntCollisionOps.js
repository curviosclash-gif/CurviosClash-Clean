// ============================================
// HuntCollisionOps.js - grading and recovery for hunt-mode contact damage
// ============================================

const BOT_COLLISION_RECOVERY_OPTIONS = Object.freeze({ collisionGrace: 0.16 });
const DEFAULT_WALL_IMPACT_SPEED_RATIO = 0.6;
const DEFAULT_WALL_IMPACT_DAMAGE = 120;

function toSafeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// Bots get the full bounce (heading included); human players only get moved clear so the
// recovery does not fight their steering. Both leave the geometry they collided with -
// staying inside it used to re-trigger the same collision on every following frame.
export function recoverPlayerFromCollision(player, collision, source, entityManager) {
    if (!player) return;
    if (player.isBot) {
        if (typeof entityManager?._bounceBot !== 'function') return;
        entityManager._bounceBot(
            player,
            collision?.normal || null,
            source,
            BOT_COLLISION_RECOVERY_OPTIONS
        );
        return;
    }
    if (typeof entityManager?._pushPlayerOutOfCollision !== 'function') return;
    if (entityManager._pushPlayerOutOfCollision(player, collision?.normal || null)) {
        player.arenaCollisionGraceTimer = Math.max(player.arenaCollisionGraceTimer || 0, 0.16);
    }
}

// Closing speed into the surface. Arena normals point away from the wall into free space,
// so only the negative projection of the velocity counts: a vehicle grinding along the
// wall barely moves into it however fast it travels, while a frontal hit reaches its full
// travel speed.
export function resolveWallImpactSpeed(player, normal) {
    const velocity = player?.velocity;
    if (!velocity || !normal) return 0;
    const closing = -(
        toSafeNumber(velocity.x, 0) * toSafeNumber(normal.x, 0)
        + toSafeNumber(velocity.y, 0) * toSafeNumber(normal.y, 0)
        + toSafeNumber(velocity.z, 0) * toSafeNumber(normal.z, 0)
    );
    return closing > 0 ? closing : 0;
}

// A crash at speed bills the full impact damage; anything slower keeps the rate-limited
// tick that the wall cooldown was introduced for. Without that split either grinding
// along a wall becomes lethal again, or flying into one stops being lethal at all.
export function resolveWallCollisionDamage(player, normal, activeConfig, tickDamage) {
    const table = activeConfig?.HUNT?.COLLISION_IMPACT || {};
    const speedRatio = Math.max(
        0,
        toSafeNumber(table.WALL_SPEED_RATIO, DEFAULT_WALL_IMPACT_SPEED_RATIO)
    );
    const baseSpeed = toSafeNumber(player?.baseSpeed, toSafeNumber(player?.speed, 0));
    if (speedRatio <= 0 || baseSpeed <= 0) return tickDamage;
    if (resolveWallImpactSpeed(player, normal) < speedRatio * baseSpeed) return tickDamage;
    return Math.max(tickDamage, toSafeNumber(table.WALL_DAMAGE, DEFAULT_WALL_IMPACT_DAMAGE));
}
