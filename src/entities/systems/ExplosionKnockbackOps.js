import { HUNT_CONFIG } from '../../hunt/HuntConfig.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

/**
 * Pushes a player away from an explosion's center, using the vehicle's only mechanism for a
 * temporary external impulse: Player.activateSlingshot. PlayerMotionOps re-derives velocity
 * from steering input every frame, so one bare addition to `velocity` would be gone before the
 * next frame ever rendered - the timer-driven slingshot addition is what survives that reset.
 *
 * `falloff` is the same 0..1 (or 0.5..1) scalar the caller already used for its own damage
 * falloff, so a grazing hit barely nudges a vehicle while a center hit throws it clear - the
 * shove is exactly as hard as the hit that caused it, not a separately tuned effect.
 */
export function applyExplosionKnockback(target, sourcePosition, falloff, runtimeConfigSource = target) {
    if (!target?.alive || !target.position || !sourcePosition || typeof target.activateSlingshot !== 'function') return;
    const dx = target.position.x - sourcePosition.x;
    const dz = target.position.z - sourcePosition.z;
    const horizontalDistance = Math.hypot(dx, dz);
    if (horizontalDistance <= 0.0001) return;

    const config = resolveEntityRuntimeConfig(runtimeConfigSource)?.HUNT?.ROCKET || HUNT_CONFIG.ROCKET;
    const strength = Math.max(0, Math.min(1, Number(falloff) || 0));
    // PlayerMotionOps treats an omitted/zero forward impulse as its default slingshot. At the
    // exact blast radius there is no force to apply, so never enter that path.
    if (strength <= 0) return;
    target.activateSlingshot(
        {
            duration: Number(config.EXPLOSION_KNOCKBACK_DURATION) || 0.6,
            forwardImpulse: (Number(config.EXPLOSION_KNOCKBACK_IMPULSE) || 22) * strength,
            liftImpulse: (Number(config.EXPLOSION_KNOCKBACK_LIFT) || 6) * strength,
        },
        { x: dx / horizontalDistance, y: 0, z: dz / horizontalDistance },
        { x: 0, y: 1, z: 0 },
    );
}
