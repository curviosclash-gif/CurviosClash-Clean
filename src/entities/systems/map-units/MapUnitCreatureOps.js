const ATTACK_COLOR = 0xd4773f;

export function updateCreatureAttack(system, unit, dt, canAttack) {
    const attack = unit.definition?.attack;
    if (!attack) return;
    unit.attackCooldownRemaining = Math.max(0, unit.attackCooldownRemaining - dt);
    if (!canAttack || unit.attackCooldownRemaining > 0.000001) return;
    unit.attackCooldownRemaining = attack.cooldown;
    const radius = attack.radius * unit.scale;
    for (const player of system.entityManager?.players || []) {
        if (!player?.alive || !player.position || Number(player.spawnProtectionTimer) > 0) continue;
        if (player.position.distanceTo(unit.position) > radius) continue;
        const result = player.takeDamage?.(attack.damage);
        system.entityManager?._emitHuntDamageEvent?.({
            target: player, sourcePlayer: unit.source, cause: 'CREATURE_ATTACK',
            damageResult: result, impactPoint: unit.position,
        });
        if (result?.isDead) {
            system.entityManager?._killPlayer?.(player, 'PROJECTILE', {
                killer: unit.source, impactPoint: unit.position, projectileType: 'CREATURE_ATTACK',
            });
        }
    }
    unit.attacksFired += 1;
    system.entityManager?.particles?.spawnExplosion?.(unit.position, ATTACK_COLOR, {
        cause: 'PROJECTILE', projectileType: 'CREATURE_ATTACK',
    });
}
