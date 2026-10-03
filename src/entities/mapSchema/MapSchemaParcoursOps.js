import { MAP_SCHEMA_COLLECTION_LIMITS } from './MapSchemaConstants.js';

function sanitizeOptionalId(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

export function sanitizeParcoursGuidancePaths(raw) {
    if (!Array.isArray(raw)) return [];
    if (raw.length > MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths) {
        throw new Error(`Map collection "parcoursGuidancePaths" exceeds the limit of ${MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths}.`);
    }
    return raw.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const branchCheckpointId = sanitizeOptionalId(entry.branchCheckpointId);
        const endCheckpointId = sanitizeOptionalId(entry.endCheckpointId);
        if (!branchCheckpointId || !endCheckpointId || !Array.isArray(entry.points)
            || entry.points.length < 2 || entry.points.length > MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePoints) return [];
        const points = entry.points.map((point) => {
            if (!Array.isArray(point) || point.length !== 3
                || !point.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
            return [...point];
        });
        if (points.some((point) => point === null)) return [];
        return [{ branchCheckpointId, endCheckpointId, points }];
    });
}

export function sanitizeParcoursGuidanceMetadata(raw, checkpoints, existingBranchIds = [], existingWindows = []) {
    if (Array.isArray(raw) && raw.length > MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths) {
        throw new Error(`Map collection "parcoursGuidancePaths" exceeds the limit of ${MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths}.`);
    }
    const entries = [...(Array.isArray(raw) ? raw : []),
        ...(Array.isArray(existingWindows) ? existingWindows.slice(0, MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths) : [])]
        .filter((path) => path && typeof path === 'object')
        .map((path) => ({
            branchCheckpointId: sanitizeOptionalId(path.branchCheckpointId),
            endCheckpointId: sanitizeOptionalId(path.endCheckpointId),
        }))
        .filter((path) => checkpoints.some((checkpoint) => checkpoint.id === path.branchCheckpointId)
            && checkpoints.some((checkpoint) => checkpoint.id === path.endCheckpointId));
    const windows = [...new Map(entries.filter((path) => {
        const branch = checkpoints.find((checkpoint) => checkpoint.id === path.branchCheckpointId);
        const end = checkpoints.find((checkpoint) => checkpoint.id === path.endCheckpointId);
        const indexOf = (checkpoint) => Number.isFinite(checkpoint?.routeIndex) ? checkpoint.routeIndex : checkpoints.indexOf(checkpoint);
        return branch && end && indexOf(end) > indexOf(branch);
    }).map((path) => [`${path.branchCheckpointId}:${path.endCheckpointId}`, path])).values()]
        .slice(0, MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths);
    const branchIds = [...new Set([
        ...windows.map((path) => path.branchCheckpointId),
        ...(Array.isArray(existingBranchIds) ? existingBranchIds.slice(0, MAP_SCHEMA_COLLECTION_LIMITS.parcoursGuidancePaths) : []),
    ].filter((id) => checkpoints.some((checkpoint) => checkpoint.id === id)))];
    return { guidanceBranchCheckpointIds: branchIds, guidancePathWindows: windows };
}
