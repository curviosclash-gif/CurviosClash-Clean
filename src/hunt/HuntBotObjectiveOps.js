import { applyEscortBotMovement } from './HuntBotEscortOps.js';
import { applyFlagBotMovement } from './HuntBotFlagOps.js';

export function applyHuntBotObjectiveMovement(options = {}) {
    if (options.player) {
        options.player.botObjectiveType = '';
        options.player.flagBotTargetId = '';
    }
    const flagRole = applyFlagBotMovement(options);
    if (flagRole) return flagRole;

    const escortRole = applyEscortBotMovement(options);
    if (escortRole && options.player) options.player.botObjectiveType = 'ESCORT';
    return escortRole;
}
