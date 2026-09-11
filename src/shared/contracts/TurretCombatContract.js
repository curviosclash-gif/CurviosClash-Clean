export function isDestructibleTurret(turret) {
    return turret?.destructible ?? turret?.deployed === true;
}

export function isTurretCombatActive(strategy, allowedModes = ['HUNT']) {
    const mode = String(strategy?.modeType || '').toUpperCase();
    if (!allowedModes.includes(mode) || strategy?.isSectorParcours?.()) return false;
    return mode === 'HUNT' || (mode === 'ARCADE' && strategy?.getPickupModeType?.() === 'HUNT');
}

export function isTurretTargetPlayerEligible(player, owner, targetPlayers = 'all') {
    return !!player?.position && player !== owner
        && !(Number.isInteger(owner?.index) && owner.index >= 0 && player.index === owner.index)
        && (player.spawnProtectionTimer || 0) <= 0
        && (targetPlayers !== 'humans' || !player.isBot);
}
