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
    for (const member of unit?.members || []) {
        member.position.copy(unit.position).add(member.offset);
    }
}
