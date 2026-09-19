import { normalizeTeamId } from '../../../shared/contracts/TeamCombatContract.js';

export function addObjectiveGuard(system, { id, teamId, position }) {
    if (!Array.isArray(position) || position.length < 3) return null;
    const turret = system._createTurret({
        id, teamId, pos: position, weapon: 'mg', allowedModes: ['HUNT'],
        targetPlayers: 'all', targetTrails: false, range: 60, cooldown: 0.3,
        damage: 3, phase: 0, destructible: true, maxHp: 45, hitboxRadius: 2.2,
    });
    turret.objectiveGuard = true;
    system.turrets.push(turret);
    return turret;
}

export function setTurretTeam(turret, teamId) {
    if (!turret) return null;
    turret.teamId = normalizeTeamId(teamId);
    if (turret.source) turret.source.teamId = turret.teamId;
    turret.target = null;
    return turret.teamId;
}
