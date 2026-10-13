import SHIP5 from './ship5.js';
import SPACESHIP from './spaceship.js';
import ARROW from './arrow.js';
import MANTA from './manta.js';
import DRONE from './drone.js';
import SHIP1 from './ship1.js';
import SHIP9 from './ship9.js';
import { VEHICLE_PRESETS } from '../VehiclePresets.js';

// Game vehicles players may pick, rebuilt from Vehicle Lab parts. Each config keeps the
// game id, so saved selections, bots and map decoration pick up the part-built model.
export const PLAYER_SHIP_PART_CONFIGS = Object.freeze([SHIP5, SPACESHIP, ARROW, MANTA, DRONE, SHIP1, SHIP9]);

/** @type {ReadonlyArray<{id: string, label: string, config: object}>} */
export const PLAYER_SHIP_PART_CATALOG = Object.freeze(
    PLAYER_SHIP_PART_CONFIGS
        .filter((config) => Array.isArray(config?.parts) && config.parts.length > 0)
        .map((config) => Object.freeze({ id: config.id, label: config.label, config }))
);

/**
 * Ships whose role parts a player may borrow as shape variants in the arcade hangar:
 * the part-built game vehicles plus the Helix Interceptor.
 * @returns {Array<{id: string, label: string, parts: object[]}>}
 */
export function listPlayerShipPartDonors() {
    const helix = VEHICLE_PRESETS.find((preset) => preset.id === 'lab_helix_interceptor');
    return [
        ...PLAYER_SHIP_PART_CATALOG.map((entry) => ({ id: entry.id, label: entry.label, parts: entry.config.parts })),
        ...(helix ? [{ id: helix.id, label: 'Helix Interceptor', parts: helix.parts }] : []),
    ];
}

/**
 * Factory version of a part-built game vehicle, or null when the vehicle has none.
 * @param {string} vehicleId
 * @returns {object|null}
 */
export function getPlayerShipPartConfig(vehicleId) {
    const key = String(vehicleId || '').trim();
    return PLAYER_SHIP_PART_CATALOG.find((entry) => entry.id === key)?.config || null;
}
