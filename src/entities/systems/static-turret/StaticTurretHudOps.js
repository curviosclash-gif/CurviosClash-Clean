function resolveOwnerIndex(turret) {
    return Number.isInteger(turret?.ownerIndex)
        ? turret.ownerIndex
        : (Number.isInteger(turret?.ownerPlayer?.index) ? turret.ownerPlayer.index : -1);
}

export function getStaticTurretHudState(turrets, playerIndex, weapon = null) {
    let active = null;
    let count = 0;
    for (const turret of turrets) {
        if (!turret?.deployed || resolveOwnerIndex(turret) !== playerIndex
            || (weapon && turret.weapon !== weapon)) continue;
        count += 1;
        if (!active || turret.createdSequence > active.createdSequence) active = turret;
    }
    if (!active) return null;
    return {
        count,
        remainingSeconds: Math.max(0, Number(active.expiresRemaining) || 0),
        hp: Math.max(0, Number(active.hp) || 0),
        maxHp: Math.max(1, Number(active.maxHp) || 1),
        range: Math.max(0, Number(active.range) || 0),
    };
}

export function getStaticTurretHudStates(turrets, playerIndex) {
    const states = [];
    for (const weapon of ['mg', 'rocket']) {
        const state = getStaticTurretHudState(turrets, playerIndex, weapon);
        if (state) states.push({ ...state, weapon });
    }
    return states;
}
