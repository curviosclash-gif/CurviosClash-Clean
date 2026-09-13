function findPlayerByIndex(players, playerIndex) {
    if (!Number.isInteger(playerIndex) || !Array.isArray(players)) return null;
    for (let i = 0; i < players.length; i++) {
        if (Number(players[i]?.index) === playerIndex) return players[i];
    }
    return null;
}

export function emitArcadeGameplayEvent(owner, event) {
    if (!event || typeof owner?.onArcadeGameplayEvent !== 'function') return;
    const playerIndex = Number(event.playerIndex);
    const sourcePlayer = findPlayerByIndex(owner.players, playerIndex);
    if (sourcePlayer?.isBot === true) return;
    owner.onArcadeGameplayEvent(event);
}

export function emitArcadeDamageEvent(owner, event) {
    const target = event?.target || null;
    const applied = Math.max(0, Number(event?.damageResult?.applied) || 0);
    if (target?.isBot === true || applied <= 0) return;
    emitArcadeGameplayEvent(owner, {
        type: 'damage',
        playerIndex: target?.index,
        hp: Math.max(0, Number(target?.hp) || 0),
        maxHp: Math.max(1, Number(target?.maxHp) || 1),
    });
    if (String(event?.cause || '').toUpperCase() === 'TRAIL_SELF') {
        emitArcadeGameplayEvent(owner, { type: 'self_collision', playerIndex: target?.index });
    }
}

export function emitArcadeEliminationEvents(owner, player, cause, options = {}) {
    const killer = options?.killer || null;
    if (killer && killer !== player && killer.isBot !== true) {
        emitArcadeGameplayEvent(owner, {
            type: 'kill',
            playerIndex: killer.index,
            victimIndex: player?.index,
            count: 1,
            runId: options?.runId || '',
            botSlot: Number.isInteger(options?.botSlot) ? options.botSlot : null,
            activationGeneration: Number.isInteger(options?.activationGeneration)
                ? options.activationGeneration
                : null,
        });
    }
}
