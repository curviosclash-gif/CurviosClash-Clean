import { resolveAuthoredFlagObjectives } from '../../shared/contracts/FlagObjectivePlacementContract.js';
import { MAP_SCHEMA_COLLECTION_LIMITS } from './MapSchemaConstants.js';

export function sanitizeFlagObjectiveList(value, { warnings = null } = {}) {
    if (!Array.isArray(value) || value.length === 0) return [];
    if (value.length > MAP_SCHEMA_COLLECTION_LIMITS.flagObjectives) {
        throw new Error(`Map collection "flagObjectives" exceeds the limit of ${MAP_SCHEMA_COLLECTION_LIMITS.flagObjectives}.`);
    }
    const normalized = resolveAuthoredFlagObjectives({ flagObjectives: value });
    if (normalized.length === 0) {
        warnings?.push?.('Flag objectives were ignored because a unique 3v3 layout with numeric positions is required.');
        return [];
    }
    return normalized.map((entry) => ({
        id: entry.id,
        teamId: entry.teamId,
        position: [...entry.position],
    }));
}

export function toRuntimeFlagObjectives(value, invScale = 1) {
    const scale = Math.max(0.000001, Number(invScale) || 1);
    return (Array.isArray(value) ? value : []).map((entry) => ({
        id: entry.id,
        teamId: entry.teamId,
        position: entry.position.map((coordinate) => coordinate * scale),
    }));
}

export default { sanitizeFlagObjectiveList, toRuntimeFlagObjectives };
