import { createAuthoredWreck } from './MapUnitModelCache.js';

/**
 * What a destroyed tank leaves on the ground (B4). Before this, a tank blinked out of existence the
 * moment its hit points ran out, which read as a bug rather than as a kill.
 *
 * A wreck is pure picture. It is in no target list, it is no obstacle, and it takes no damage - it
 * only stands where the tank stood until it has burned down. That keeps the fight exactly as it
 * was and still leaves a mark on the map.
 *
 * Without the authored model there is no wreck: the box tank has no wreck shape, and an untextured
 * crate lying about would be worse than nothing.
 */

/** How long a wreck stays on the ground. */
export const MAP_UNIT_WRECK_SECONDS = 12;

/**
 * Puts a wreck where a unit died. Answers the wreck record, or null when there is nothing to draw.
 */
export function spawnMapUnitWreck(system, unit) {
    if (unit?.kind !== 'tank' && unit?.kind !== 'boss') return null;
    const renderer = system?.entityManager?.renderer;
    const wreck = createAuthoredWreck(system?._modelLibrary);
    if (!wreck || typeof renderer?.addToScene !== 'function') return null;
    wreck.userData.mapUnitWreck = true;
    wreck.userData.mapUnitId = unit.id;
    wreck.position.copy(unit.groundPosition);
    wreck.rotation.y = unit.yaw;
    wreck.scale.copy(unit.root?.scale ?? wreck.scale);
    renderer.addToScene(wreck);
    const record = { root: wreck, unitId: unit.id, remaining: MAP_UNIT_WRECK_SECONDS };
    system._wrecks.push(record);
    return record;
}

function dropWreck(system, record) {
    system?.entityManager?.renderer?.removeFromScene?.(record.root);
}

/** Burns the wrecks down by `dt` and takes the finished ones out of the scene. */
export function tickMapUnitWrecks(system, dt) {
    const wrecks = system._wrecks;
    if (wrecks.length === 0) return;
    const step = Math.max(0, Number(dt) || 0);
    for (let index = wrecks.length - 1; index >= 0; index -= 1) {
        const record = wrecks[index];
        record.remaining -= step;
        if (record.remaining > 0) continue;
        dropWreck(system, record);
        wrecks.splice(index, 1);
    }
}

/** A unit that comes back takes its own wreck with it, however long it had left. */
export function clearMapUnitWreck(system, unitId) {
    const wrecks = system._wrecks;
    for (let index = wrecks.length - 1; index >= 0; index -= 1) {
        if (wrecks[index].unitId !== unitId) continue;
        dropWreck(system, wrecks[index]);
        wrecks.splice(index, 1);
    }
}

/** Takes every wreck out of the scene, at the end of a round and on teardown. */
export function clearAllMapUnitWrecks(system) {
    for (const record of system._wrecks) dropWreck(system, record);
    system._wrecks.length = 0;
}
