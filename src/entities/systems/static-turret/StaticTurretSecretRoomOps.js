export function isStaticTurretSecretRoomActive(system, turret) {
    const roomId = String(turret?.secretRoomId || '');
    return !roomId || system?.entityManager?._secretRoomSystem?.isRoomOpen?.(roomId) === true;
}

export function syncStaticTurretSecretRoomState(system, turret) {
    const active = isStaticTurretSecretRoomActive(system, turret);
    turret.roomGuardActive = active;
    if (turret.root) turret.root.visible = active;
    return active;
}

export function collectActiveStaticTurrets(system) {
    const targets = system._targetableTurrets;
    targets.length = 0;
    for (const turret of system.turrets) {
        if (isStaticTurretSecretRoomActive(system, turret)) targets.push(turret);
    }
    return targets;
}
