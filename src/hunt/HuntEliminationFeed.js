function formatCombatantLabel(player) {
    const explicitLabel = typeof player?.combatLabel === 'string' ? player.combatLabel.trim() : '';
    if (explicitLabel) return explicitLabel;
    if (!player) return 'Umgebung';
    return player.isBot ? `Bot ${player.index + 1}` : `P${player.index + 1}`;
}

export function rememberFightAttacker(target, sourcePlayer) {
    if (target && sourcePlayer && target !== sourcePlayer && Number.isInteger(sourcePlayer.index)) {
        target.fightLastAttackerIndex = sourcePlayer.index;
    }
}

export function rememberFightDeath(player) {
    if (!player?.position) return;
    player.fightLastDeathPosition = {
        x: Number(player.position.x) || 0,
        y: Number(player.position.y) || 0,
        z: Number(player.position.z) || 0,
    };
}

export function emitHuntEliminationFeed(eventBus, players, target, killer, assistIndices = [], audio = null) {
    if (killer && killer !== target) {
        eventBus?.emitHuntFeed(`${formatCombatantLabel(killer)} -> ${formatCombatantLabel(target)}: ausgeschaltet`);
        if (!killer.isBot) audio?.play?.('FIGHT_KILL');
    }
    for (const assistIndex of assistIndices) {
        const assistant = players.find((candidate) => candidate?.index === assistIndex);
        if (assistant) {
            eventBus?.emitHuntFeed(`${formatCombatantLabel(assistant)}: Assist bei ${formatCombatantLabel(target)}`);
            if (!assistant.isBot) audio?.play?.('FIGHT_ASSIST');
        }
    }
}
