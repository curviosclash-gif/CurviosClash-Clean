const BOMB_COLOR = 0xffb347;

function applyBombToPlayer(system, unit, player, bomb, impactPoint) {
    if (!player?.alive || !player.position || Number(player.spawnProtectionTimer) > 0) return;
    if (unit.summoned && player.index === unit.calledByIndex) return;
    const dx = player.position.x - impactPoint.x;
    const dz = player.position.z - impactPoint.z;
    const radius = bomb.radius * unit.scale;
    if ((dx * dx) + (dz * dz) > radius * radius) return;
    const result = player.takeDamage?.(bomb.damage);
    system.entityManager?._emitHuntDamageEvent?.({
        target: player,
        sourcePlayer: unit.attackSourcePlayer || unit.source,
        cause: 'BOMBER_BOMB',
        damageResult: result,
        impactPoint,
    });
    if (result?.isDead) {
        system.entityManager?._killPlayer?.(player, 'PROJECTILE', {
            killer: unit.attackSourcePlayer || unit.source,
            impactPoint,
            projectileType: 'BOMBER_BOMB',
        });
    }
}

export function updateBomberBombs(system, unit, dt, canFire) {
    const bomb = unit.definition?.weapons?.bomb;
    if (!bomb) return;
    unit.bombCooldownRemaining = Math.max(0, unit.bombCooldownRemaining - dt);
    if (!canFire || unit.bombCooldownRemaining > 0.000001) return;
    unit.bombCooldownRemaining = bomb.cooldown;
    const impactPoint = system._tmpBombPoint.copy(unit.groundPosition);
    impactPoint.y = Number(system.entityManager?.arena?.bounds?.min?.y) || 0;
    for (const player of system.entityManager?.players || []) {
        applyBombToPlayer(system, unit, player, bomb, impactPoint);
    }
    unit.bombsFired += 1;
    system.entityManager?.particles?.spawnExplosion?.(impactPoint, BOMB_COLOR, {
        cause: 'PROJECTILE', projectileType: 'BOMBER_BOMB',
    });
}
