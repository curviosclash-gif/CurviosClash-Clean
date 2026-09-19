import { rewardMapUnitDestruction } from './MapUnitRewardOps.js';

const CRASH_FALL_SPEED = 24;
const CRASH_COLOR = 0xff6a24;

export function beginBomberCrash(unit, sourcePlayer = null) {
    unit.alive = false;
    unit.crashing = true;
    unit.crashSourcePlayer = sourcePlayer;
    unit.respawnRemaining = Infinity;
    if (unit.source) unit.source.alive = false;
    if (unit.root) unit.root.visible = true;
}

function applyCrashDamage(system, unit) {
    const crash = unit.definition.crash;
    const radius = crash.radius * unit.scale;
    for (const player of system.entityManager?.players || []) {
        if (!player?.alive || !player.position || Number(player.spawnProtectionTimer) > 0) continue;
        if (player.position.distanceTo(unit.position) > radius) continue;
        const result = player.takeDamage?.(crash.damage);
        system.entityManager?._emitHuntDamageEvent?.({
            target: player,
            sourcePlayer: unit.crashSourcePlayer,
            cause: 'BOMBER_CRASH',
            damageResult: result,
            impactPoint: unit.position,
        });
        if (result?.isDead) {
            system.entityManager?._killPlayer?.(player, 'PROJECTILE', {
                killer: unit.crashSourcePlayer,
                impactPoint: unit.position,
                projectileType: 'BOMBER_CRASH',
            });
        }
    }
}

function finishBomberCrash(system, unit) {
    unit.crashing = false;
    unit.position.y = Number(system.entityManager?.arena?.bounds?.min?.y) || 0;
    unit.groundPosition.copy(unit.position);
    if (unit.root) unit.root.visible = false;
    applyCrashDamage(system, unit);
    system.entityManager?.particles?.spawnExplosion?.(unit.position, CRASH_COLOR, {
        cause: 'PROJECTILE', projectileType: 'BOMBER_CRASH',
    });
    system.entityManager?.audio?.play?.('HIT', { intensity: 1 });
    unit.deaths += 1;
    unit.respawnRemaining = unit.definition.respawnSeconds > 0 ? unit.definition.respawnSeconds : Infinity;
    rewardMapUnitDestruction(system, unit, unit.crashSourcePlayer);
    unit.crashSourcePlayer = null;
}

export function updateBomberCrash(system, unit, dt) {
    if (!unit?.crashing) return false;
    const groundY = Number(system.entityManager?.arena?.bounds?.min?.y) || 0;
    unit.position.y = Math.max(groundY, unit.position.y - (CRASH_FALL_SPEED * dt));
    unit.groundPosition.copy(unit.position);
    if (unit.root) unit.root.visible = true;
    system._updateVisual(unit);
    system.entityManager?.particles?.spawnHit?.(unit.position, CRASH_COLOR);
    if (unit.position.y <= groundY + 0.000001) finishBomberCrash(system, unit);
    return true;
}
