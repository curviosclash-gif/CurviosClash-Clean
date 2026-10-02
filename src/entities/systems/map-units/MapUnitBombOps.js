export function updateBomberBombs(system, unit, dt, canFire) {
    const bomb = unit.definition?.weapons?.bomb;
    if (!bomb) return;
    unit.bombCooldownRemaining = Math.max(0, unit.bombCooldownRemaining - dt);
    if (!canFire || unit.bombCooldownRemaining > 0.000001) return;
    const projectileSystem = system.entityManager?._projectileSystem;
    if (typeof projectileSystem?.spawnBomberBomb !== 'function') return;

    unit.bombCooldownRemaining = bomb.cooldown;
    const from = unit.path[unit.fromIndex];
    const to = unit.path[unit.toIndex];
    const dx = Number(to?.[0]) - Number(from?.[0]);
    const dz = Number(to?.[2]) - Number(from?.[2]);
    const horizontalLength = Math.hypot(dx, dz);
    const speed = Number(unit.speed) || 0;
    const velocity = system._tmpBombVelocity.set(
        horizontalLength > 0.000001 ? (dx / horizontalLength) * speed : 0,
        0,
        horizontalLength > 0.000001 ? (dz / horizontalLength) * speed : 0,
    );
    const position = system._tmpBombPoint.copy(unit.position);
    position.y -= 1;
    const sourcePlayer = unit.attackSourcePlayer || unit.source || null;
    if (!projectileSystem.spawnBomberBomb(sourcePlayer, position, velocity, {
        damage: bomb.damage,
        blastRadius: bomb.radius * unit.scale,
    })) {
        unit.bombCooldownRemaining = 0;
        return;
    }
    unit.bombsFired += 1;
}
