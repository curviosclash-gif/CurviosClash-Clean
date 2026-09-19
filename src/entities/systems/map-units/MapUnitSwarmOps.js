import * as THREE from 'three';

/** Builds the fixed formation once. Runtime ticks only move the existing vectors. */
export function createSwarmMembers(definition, scale, centre) {
    const count = Math.max(1, Math.trunc(Number(definition?.memberCount) || 1));
    const radius = Math.max(0, Number(definition?.formationRadius) || 0) * scale;
    const ringRadius = radius * 0.9;
    const layerHeight = radius * 0.25;
    const members = [];
    for (let index = 0; index < count; index += 1) {
        const offset = new THREE.Vector3();
        if (index > 0) {
            const angle = ((index - 1) / Math.max(1, count - 1)) * Math.PI * 2;
            offset.set(
                Math.cos(angle) * ringRadius,
                index % 2 === 0 ? layerHeight : -layerHeight,
                Math.sin(angle) * ringRadius,
            );
        }
        members.push({
            index,
            alive: true,
            hp: Number(definition?.memberHp) || 1,
            maxHp: Number(definition?.memberHp) || 1,
            offset,
            position: new THREE.Vector3().copy(centre).add(offset),
        });
    }
    return members;
}

/** Keeps target positions current without allocating in the update loop. */
export function updateSwarmMembers(unit) {
    const cosine = Math.cos(unit.yaw);
    const sine = Math.sin(unit.yaw);
    for (const member of unit?.members || []) {
        member.position.set(
            unit.position.x + member.offset.x * cosine + member.offset.z * sine,
            unit.position.y + member.offset.y,
            unit.position.z - member.offset.x * sine + member.offset.z * cosine,
        );
    }
}

function emptyDamageResult(member) {
    return {
        applied: 0,
        hpApplied: 0,
        absorbedByShield: 0,
        remainingHp: Math.max(0, Number(member?.hp) || 0),
        isDead: member?.alive === false,
    };
}

export function bindSwarmMemberCombat(system, unit) {
    for (const member of unit.members || []) {
        member.id = `${unit.id}:drone_${member.index + 1}`;
        member.kind = 'swarm';
        member.destructible = true;
        member.ownerIndex = -1;
        member.hitboxRadius = unit.hitboxRadius;
        member.mapUnit = unit;
        member.takeDamage = (amount, options = {}) => applySwarmMemberDamage(system, unit, member, amount, options);
    }
}

export function applySwarmMemberDamage(system, unit, member, amount, options = {}) {
    if (!member?.alive || system.networkReplica) return emptyDamageResult(member);
    const requested = Math.max(0, Number(amount) || 0);
    const hpBefore = member.hp;
    member.hp = Math.max(0, hpBefore - requested);
    const hpApplied = hpBefore - member.hp;
    unit.hp = Math.max(0, unit.hp - hpApplied);
    const owner = system.entityManager;
    if (hpApplied > 0) owner?.particles?.spawnHit?.(member.position, 0xd8f4ff);
    const isDead = member.hp <= 0;
    if (isDead) {
        member.alive = false;
        if (unit.root?.children[member.index]) unit.root.children[member.index].visible = false;
        owner?._huntScoring?.registerUnitDestroyed?.(options.sourcePlayer?.index, 'swarm');
        if (options.sourcePlayer?.isBot === false) owner?._notifyPlayerFeedback?.(options.sourcePlayer, 'Drohne zerstört');
        owner?.recorder?.logEvent?.(
            'MAP_UNIT_MEMBER_DESTROYED',
            Number.isInteger(options.sourcePlayer?.index) ? options.sourcePlayer.index : -1,
            member.id,
        );
        if (!unit.members.some((entry) => entry.alive)) {
            unit.alive = false;
            unit.hp = 0;
            if (unit.root) unit.root.visible = false;
            unit.respawnRemaining = unit.definition.respawnSeconds > 0 ? unit.definition.respawnSeconds : Infinity;
            if (unit.source) unit.source.alive = false;
        }
    }
    return { applied: requested, hpApplied, absorbedByShield: 0, remainingHp: member.hp, isDead };
}

export function resetSwarmMembers(unit) {
    let totalHp = 0;
    for (const member of unit.members || []) {
        member.alive = true;
        member.hp = member.maxHp;
        totalHp += member.hp;
    }
    unit.maxHp = totalHp;
    unit.hp = totalHp;
    if (unit.source) unit.source.alive = true;
}
