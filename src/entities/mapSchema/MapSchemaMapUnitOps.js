import { normalizeMapUnits } from '../../shared/contracts/MapUnitContract.js';

/**
 * Map units (tanks) in the map schema. The schema is a positive list, so this is where the
 * `mapUnits` block is recognised and survives a save/load round trip. Like secret rooms the block
 * stays optional: a map without units keeps exactly the document it had before.
 */

/**
 * @param {any} unit
 * @param {number} invScale
 */
function toPlainUnit(unit, invScale) {
    return {
        id: unit.id,
        kind: unit.kind,
        path: unit.path.map((/** @type {number[]} */ point) => point.map((value) => value * invScale)),
        loop: unit.loop,
        speed: unit.speed,
        maxHp: unit.maxHp,
        hitboxRadius: unit.hitboxRadius,
        respawnSeconds: unit.respawnSeconds,
        weapons: {
            mg: unit.weapons.mg ? { ...unit.weapons.mg, range: unit.weapons.mg.range * invScale } : false,
            rocket: unit.weapons.rocket ? { ...unit.weapons.rocket, range: unit.weapons.rocket.range * invScale } : false,
        },
        loot: { ...unit.loot },
        allowedModes: [...unit.allowedModes],
        targetPlayers: unit.targetPlayers,
    };
}

/**
 * @param {unknown} rawUnits
 * @param {{ warnings?: string[] | null }} [options]
 */
export function sanitizeMapUnitList(rawUnits, options = {}) {
    const warnings = Array.isArray(options?.warnings) ? options.warnings : undefined;
    return normalizeMapUnits(rawUnits, warnings ? { warnings } : {}).map((unit) => toPlainUnit(unit, 1));
}

/**
 * Divided by the map scale like every other authored position; the runtime multiplies it back.
 * @param {unknown} mapUnits
 * @param {number} invScale
 */
export function toRuntimeMapUnits(mapUnits, invScale) {
    const units = normalizeMapUnits(mapUnits);
    if (units.length === 0) return null;
    return units.map((unit) => toPlainUnit(unit, invScale));
}
