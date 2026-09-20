import { normalizeTeamId, TEAM_IDS } from './TeamCombatContract.js';

const EXPECTED_FLAG_COUNT = 6;
const FLAGS_PER_TEAM = 3;

function finiteCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizePosition(entry, scale) {
    const source = Array.isArray(entry?.position)
        ? entry.position
        : [entry?.x, entry?.y, entry?.z];
    const values = source.slice(0, 3).map(finiteCoordinate);
    if (values.length !== 3 || values.some((value) => value === null)) return null;
    return Object.freeze(values.map((value) => value * scale));
}

/**
 * Optional map authoring contract. A map must provide all six objectives (three per team),
 * otherwise the runtime deliberately falls back to its deterministic generated layout.
 */
export function resolveAuthoredFlagObjectives(mapDefinition = null, { spatialScale = 1 } = {}) {
    const source = Array.isArray(mapDefinition?.flagObjectives) ? mapDefinition.flagObjectives : [];
    if (source.length !== EXPECTED_FLAG_COUNT) return Object.freeze([]);
    const scale = Math.max(0.001, Number(spatialScale) || 1);
    const ids = new Set();
    const teamCounts = { [TEAM_IDS.ALPHA]: 0, [TEAM_IDS.BRAVO]: 0 };
    const normalized = [];
    for (let index = 0; index < source.length; index += 1) {
        const entry = source[index];
        const teamId = normalizeTeamId(entry?.teamId);
        const position = normalizePosition(entry, scale);
        const id = String(entry?.id || '').trim();
        if (!id || ids.has(id) || !teamId || !position) return Object.freeze([]);
        ids.add(id);
        teamCounts[teamId] += 1;
        normalized.push(Object.freeze({ id, teamId, position }));
    }
    if (teamCounts[TEAM_IDS.ALPHA] !== FLAGS_PER_TEAM || teamCounts[TEAM_IDS.BRAVO] !== FLAGS_PER_TEAM) {
        return Object.freeze([]);
    }
    return Object.freeze(normalized);
}

export default { resolveAuthoredFlagObjectives };
