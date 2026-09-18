import { formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';

function formatCombatantLabel(player) {
    const explicitLabel = typeof player?.combatLabel === 'string' ? player.combatLabel.trim() : '';
    if (explicitLabel) return explicitLabel;
    if (!player) return 'Umgebung';
    return formatPlayerDisplayLabel(player);
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

function formatEliminationVerb(creditKind, cause) {
    if (creditKind !== 'hit' && creditKind !== 'threat') return 'ausgeschaltet';
    return String(cause || '').toUpperCase().startsWith('TRAIL')
        ? 'in die Spur getrieben'
        : 'in die Wand getrieben';
}

export function emitHuntEliminationFeed(
    eventBus,
    players,
    target,
    killer,
    assistIndices = [],
    audio = null,
    creditOptions = null
) {
    if (killer && killer !== target) {
        const verb = formatEliminationVerb(creditOptions?.credit, creditOptions?.cause);
        eventBus?.emitHuntFeed(`${formatCombatantLabel(killer)} -> ${formatCombatantLabel(target)}: ${verb}`);
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
