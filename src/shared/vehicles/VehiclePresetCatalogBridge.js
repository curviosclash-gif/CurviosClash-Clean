import { VEHICLE_PRESETS } from './VehiclePresets.js';
import { estimateVehicleLabHitboxRadius } from '../contracts/VehicleLabConfigContract.js';

export const BUILT_IN_COMPLEX_VEHICLE_IDS = Object.freeze([
    'lab_helix_interceptor',
    'lab_eclipse_phantom',
    'lab_valkyrie_gunship',
    'lab_atlas_salvager',
    'lab_aegis_carrier',
    'lab_leviathan_dreadnought',
]);

const BUILT_IN_COMPLEX_VEHICLE_ID_SET = new Set(BUILT_IN_COMPLEX_VEHICLE_IDS);

function toGameLabel(label, fallback) {
    return String(label || fallback || 'Vehicle')
        .replace(/^Lab-Vorlage:\s*/i, '')
        .trim();
}

export const BUILT_IN_COMPLEX_VEHICLE_CONFIGS = Object.freeze(
    VEHICLE_PRESETS
        .filter((preset) => BUILT_IN_COMPLEX_VEHICLE_ID_SET.has(preset.id))
        .map((preset) => Object.freeze({
            id: preset.id,
            label: toGameLabel(preset.label, preset.id),
            config: preset,
            hitbox: Object.freeze({ radius: estimateVehicleLabHitboxRadius(preset) }),
        }))
);

export default BUILT_IN_COMPLEX_VEHICLE_CONFIGS;
