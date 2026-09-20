import { sanitizeMapUnitList } from './MapSchemaMapUnitOps.js';
import { sanitizeSecretRoomList } from './MapSchemaSecretRoomOps.js';
import { sanitizeWaterZone } from './MapSchemaWaterZoneOps.js';
import { sanitizeFlagObjectiveList } from './MapSchemaFlagObjectiveOps.js';

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
    return result;
}
