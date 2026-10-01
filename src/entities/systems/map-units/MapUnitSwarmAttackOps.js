import { updateSwarmMembers } from './MapUnitSwarmOps.js';

const DIVE_CAUSE = 'PIGEON_DIVE';

function targetKey(player) {
    return Number.isInteger(player?.index) ? player.index : player;
}

function eligible(player) {
    return player?.alive === true && player.position
        && !(Number(player.spawnProtectionTimer) > 0);
}

function resetDive(unit) {
    const active = unit.activeDive;
    const member = active && unit.members?.[active.memberIndex];
    if (member) {
        member.offset.copy(member.homeOffset);
        member.diveTargetIndex = null;
    }
    unit.activeDive = null;
}

function applyDiveDamage(system, unit, member, player, attack) {
    const owner = system.entityManager;
    const impactPoint = member.position;
    owner?._applyModeDamage?.(player, attack.damage, DIVE_CAUSE, {
        sourcePlayer: unit.source,
        impactPoint,
    });
    owner?.particles?.spawnHit?.(impactPoint, 0xd8f4ff);
    owner?.recorder?.logEvent?.('MAP_UNIT_SWARM_DIVE', -1, `${unit.id}:${player.index ?? 'target'}`);
    unit.attacksFired = (unit.attacksFired || 0) + 1;
}

/** Host-only contact dive. One bird attacks one target at a time; targets have separate cooldowns. */
export function updateSwarmAttack(system, unit, dt, authoritative) {
    const attack = unit?.definition?.attack;
    if (!attack || unit?.kind !== 'swarm') return;

    unit.contactAttackCooldowns ||= new Map();
    for (const [key, remaining] of unit.contactAttackCooldowns) {
        const next = Math.max(0, remaining - dt);
        if (next <= 0) unit.contactAttackCooldowns.delete(key);
        else unit.contactAttackCooldowns.set(key, next);
    }
    for (const member of unit.members) member.diveCooldownRemaining = Math.max(0, member.diveCooldownRemaining - dt);

    if (!authoritative) return;
    const players = system.entityManager?.players || [];
    if (unit.activeDive) {
        const { memberIndex, targetIndex } = unit.activeDive;
        const member = unit.members[memberIndex];
        const player = players.find((entry) => entry?.index === targetIndex);
        const targetOutOfRange = player?.position
            && unit.position.distanceToSquared(player.position) > (attack.range * unit.scale) ** 2;
        if (!member?.alive || !eligible(player) || targetOutOfRange) {
            resetDive(unit);
            updateSwarmMembers(unit);
            return;
        }

        const cosine = Math.cos(unit.yaw);
        const sine = Math.sin(unit.yaw);
        const dx = player.position.x - unit.position.x;
        const dy = player.position.y - unit.position.y;
        const dz = player.position.z - unit.position.z;
        const targetX = dx * cosine - dz * sine;
        const targetZ = dx * sine + dz * cosine;
        const moveX = targetX - member.offset.x;
        const moveY = dy - member.offset.y;
        const moveZ = targetZ - member.offset.z;
        const distance = Math.hypot(moveX, moveY, moveZ);
        const step = Math.min(distance, attack.diveSpeed * unit.scale * dt);
        if (distance > 1e-6 && step > 0) {
            const factor = step / distance;
            member.offset.x += moveX * factor;
            member.offset.y += moveY * factor;
            member.offset.z += moveZ * factor;
        }
        updateSwarmMembers(unit);

        const contactRadius = attack.radius * unit.scale + unit.hitboxRadius;
        if (member.position.distanceToSquared(player.position) <= contactRadius * contactRadius) {
            applyDiveDamage(system, unit, member, player, attack);
            unit.contactAttackCooldowns.set(targetKey(player), attack.cooldown);
            member.diveCooldownRemaining = attack.cooldown;
            resetDive(unit);
            updateSwarmMembers(unit);
        }
        return;
    }

    const maxRange = attack.range * unit.scale;
    const maxRangeSq = maxRange * maxRange;
    for (const player of players) {
        if (!eligible(player) || unit.contactAttackCooldowns.has(targetKey(player))) continue;
        if (unit.position.distanceToSquared(player.position) > maxRangeSq) continue;
        const member = unit.members.find((entry) => entry.alive && entry.diveCooldownRemaining <= 0);
        if (!member) return;
        unit.activeDive = { memberIndex: member.index, targetIndex: player.index };
        member.diveTargetIndex = player.index;
        return;
    }
}
