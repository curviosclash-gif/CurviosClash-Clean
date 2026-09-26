// Map decoration jets reuse registered vehicle models by id; unknown ids fall back to the jet fighter.
import { isValidVehicleId } from '../vehicle-registry.js';

const AIRCRAFT_DECORATION_PALETTE = Object.freeze([
    0xe5e7eb,
    0x93c5fd,
    0xfca5a5,
    0xfde68a,
    0x86efac,
    0xc4b5fd,
]);
export function resolveAircraftDecorationVehicleId(jetId) {
    const normalized = String(jetId || '').trim().toLowerCase();
    if (normalized.startsWith('jet_ship')) {
        const suffix = normalized.slice('jet_'.length);
        if (isValidVehicleId(suffix)) return suffix;
    }
    if (normalized.startsWith('ship') && isValidVehicleId(normalized)) {
        return normalized;
    }
    if (isValidVehicleId(normalized)) {
        return normalized;
    }
    return 'aircraft';
}

export function resolveAircraftDecorationColor(index = 0) {
    return AIRCRAFT_DECORATION_PALETTE[index % AIRCRAFT_DECORATION_PALETTE.length];
}
