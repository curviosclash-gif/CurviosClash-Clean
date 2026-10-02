import { sanitizeMapUnitList } from './MapSchemaMapUnitOps.js';
import { sanitizeSecretRoomList } from './MapSchemaSecretRoomOps.js';
import { sanitizeWaterZone } from './MapSchemaWaterZoneOps.js';
import { sanitizeFlagObjectiveList } from './MapSchemaFlagObjectiveOps.js';
import { asLimitedArray } from './MapSchemaSanitizeOps.js';

/** @typedef {{ shape: 'cylinder', center: number[], radius: number, minY: number, maxY: number }
 * | { bounds: { min: number[], max: number[] } }} SanitizedPlayableVolume */

/** @returns {SanitizedPlayableVolume[]} */
function sanitizePlayableVolumes(source) {
    /** @type {SanitizedPlayableVolume[]} */
    const volumes = [];
    for (const entry of asLimitedArray(source, 'playableVolumes')) {
        if (entry?.shape === 'cylinder' && Array.isArray(entry.center)) {
            const center = entry.center.slice(0, 2).map(Number);
            const radius = Number(entry.radius);
            const minY = Number(entry.minY);
            const maxY = Number(entry.maxY);
            if (center.length === 2 && center.every(Number.isFinite) && Number.isFinite(radius)
                && radius > 0 && Number.isFinite(minY) && Number.isFinite(maxY) && maxY > minY
            ) volumes.push({ shape: 'cylinder', center, radius, minY, maxY });
            continue;
        }
        const min = entry?.bounds?.min;
        const max = entry?.bounds?.max;
        if (!Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) continue;
        const boundsMin = min.slice(0, 3).map(Number);
        const boundsMax = max.slice(0, 3).map(Number);
        if (![...boundsMin, ...boundsMax].every(Number.isFinite)
            || boundsMax.some((value, index) => value - boundsMin[index] < 0.1)) continue;
        volumes.push({ bounds: { min: boundsMin, max: boundsMax } });
    }
    return volumes;
}

export function toRuntimePlayableVolumes(source, invScale) {
    return sanitizePlayableVolumes(source).map((entry) => {
        if ('shape' in entry) {
            return { ...entry, center: entry.center.map((value) => value * invScale),
                radius: entry.radius * invScale, minY: entry.minY * invScale, maxY: entry.maxY * invScale };
        }
        return { bounds: { min: entry.bounds.min.map((value) => value * invScale),
            max: entry.bounds.max.map((value) => value * invScale) } };
    });
}

export function sanitizeMapExtendedContent(rawMap, warnings) {
    const result = {};
    const secretRooms = sanitizeSecretRoomList(rawMap.secretRooms, { warnings });
    if (secretRooms.length > 0) result.secretRooms = secretRooms;
    const mapUnits = sanitizeMapUnitList(rawMap.mapUnits, { warnings });
    if (mapUnits.length > 0) result.mapUnits = mapUnits;
    const waterZone = sanitizeWaterZone(rawMap.waterZone);
    if (waterZone) result.waterZone = waterZone;
    const flagObjectives = sanitizeFlagObjectiveList(rawMap.flagObjectives, { warnings });
    if (flagObjectives.length > 0) result.flagObjectives = flagObjectives;
    const playableVolumes = sanitizePlayableVolumes(rawMap.playableVolumes);
    if (playableVolumes.length > 0) result.playableVolumes = playableVolumes;
    return result;
}
