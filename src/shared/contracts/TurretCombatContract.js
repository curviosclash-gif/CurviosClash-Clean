/**
 * @param {{ destructible?: boolean | null, deployed?: boolean | null } | null | undefined} turret
 * @returns {boolean}
 */
export function isDestructibleTurret(turret) {
    return turret?.destructible ?? turret?.deployed === true;
}

/**
 * @param {{ modeType?: unknown, isSectorParcours?: () => boolean, allowsParcoursScenarioTurrets?: () => boolean, getPickupModeType?: () => unknown } | null | undefined} strategy
 * @param {readonly string[]} [allowedModes]
 * @returns {boolean}
 */
export function isTurretCombatActive(strategy, allowedModes = ['HUNT']) {
    const mode = String(strategy?.modeType || '').toUpperCase();
    const parcoursBlocksTurrets = strategy?.isSectorParcours?.()
        && strategy?.allowsParcoursScenarioTurrets?.() !== true;
    if (!allowedModes.includes(mode) || parcoursBlocksTurrets) return false;
    return mode === 'HUNT' || mode === 'ESCORT' || (mode === 'ARCADE' && strategy?.getPickupModeType?.() === 'HUNT');
}

/**
 * @param {{ position?: unknown, index?: number, teamId?: unknown, spawnProtectionTimer?: number, isBot?: unknown } | null | undefined} player
 * @param {{ index?: number, teamId?: unknown } | null | undefined} owner
 * @param {string} [targetPlayers]
 * @returns {boolean}
 */
export function isTurretTargetPlayerEligible(player, owner, targetPlayers = 'all') {
    return !!player?.position && player !== owner
        && !(Number.isInteger(owner?.index) && /** @type {number} */ (owner?.index) >= 0 && player.index === owner?.index)
        && !areTeammates(player, owner)
        && (player.spawnProtectionTimer || 0) <= 0
        && (targetPlayers !== 'humans' || !player.isBot);
}
import { areTeammates } from './TeamCombatContract.js';
