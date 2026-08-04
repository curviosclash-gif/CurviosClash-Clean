export function deployMine(system, player) {
    const config = system?.entityRuntimeConfig;
    const power = config?.POWERUP?.TYPES?.MINE;
    if (!player?.position || !power) return false;

    player.getDirection(system._tmpDir);
    if (system._tmpDir.lengthSq() <= 0.000001) system._tmpDir.set(0, 0, -1);
    else system._tmpDir.normalize();
    system._tmpVec.copy(player.position).addScaledVector(
        system._tmpDir,
        -Math.max(2, (Number(player.hitboxRadius) || 0.8) * 2.5)
    );

    const mesh = system._acquireProjectileMesh('MINE', power.color);
    mesh.scale.setScalar(0.8);
    mesh.position.copy(system._tmpVec);
    const projectile = system._acquireProjectileState();
    projectile.mesh = mesh;
    projectile.flame = mesh.userData.flame || null;
    if (projectile.flame) projectile.flame.visible = false;
    projectile.poolKey = 'MINE';
    projectile.owner = player;
    projectile.type = 'MINE';
    projectile.isMine = true;
    projectile.position.copy(system._tmpVec);
    projectile.previousPosition.copy(system._tmpVec);
    projectile.velocity.set(0, 0, 0);
    projectile.radius = Math.max(1.1, Number(config?.PROJECTILE?.RADIUS) || 0.5);
    projectile.ttl = 10;
    projectile.maxDistance = Infinity;
    projectile.traveled = 0;
    projectile.homingEnabled = false;
    projectile.huntRocket = false;
    system.projectiles.push(projectile);
    system.onShoot(player, 'MINE', projectile);
    return true;
}
