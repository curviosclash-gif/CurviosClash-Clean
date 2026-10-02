import { normalizeMapUnit } from '../../../shared/contracts/MapUnitContract.js';
import { BOMBER_STRIKE_FORMATION, resolveBomberStrikeFormation } from '../../../shared/contracts/BomberStrikeFormationContract.js';

export function callBomberStrike(system, player) {
    const projectileSystem = system.entityManager?._projectileSystem;
    if (system.networkReplica || projectileSystem?.networkReplica || !player
        || system.entityManager?.isFightOutcomeAuthority === false
        || typeof projectileSystem?.spawnBomberBomb !== 'function') return false;
    const formation = resolveBomberStrikeFormation(system.entityManager?.arena?.bounds, player.position);
    if (!formation || formation.length !== BOMBER_STRIKE_FORMATION.count) return false;

    const sequence = system._summonCounter + 1;
    const created = [];
    try {
        for (let index = 0; index < formation.length; index += 1) {
            const member = formation[index];
            const definition = normalizeMapUnit({
                id: `called_bomber_${sequence}_${index + 1}`,
                kind: 'bomber', path: member.path, loop: false,
                speed: member.speed, maxHp: member.hitPoints, hitboxRadius: BOMBER_STRIKE_FORMATION.hitboxRadius,
                weapons: { bomb: { damage: 50, cooldown: BOMBER_STRIKE_FORMATION.bombCooldown, radius: 15 } },
                respawnSeconds: 0,
            }, 0, undefined, { preserveSpatial: true });
            if (!definition) throw new Error('Invalid bomber formation member');
            const unit = system._createUnit(definition, 1);
            unit.summoned = true;
            unit.calledByIndex = Number.isInteger(player.index) ? player.index : -1;
            unit.attackSourcePlayer = player;
            unit.bombCooldownRemaining = BOMBER_STRIKE_FORMATION.bombCooldown;
            const [from, to] = unit.path;
            unit.summonRemaining = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / unit.speed;
            created.push(unit);
        }
    } catch {
        for (const unit of created) {
            system.entityManager?.renderer?.removeFromScene?.(unit.root);
            unit.root = null;
        }
        return false;
    }
    system._summonCounter = sequence;
    system.units.push(...created);
    return true;
}
