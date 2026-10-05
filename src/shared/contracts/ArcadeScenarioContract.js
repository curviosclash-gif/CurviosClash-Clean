/**
 * Arcade scenarios ("Einsätze"): a sector of an arcade run that brings its own map, weapons and
 * objective instead of drawing them from the sector template pools. The run plan inserts them;
 * everything the plan does not override (score base, missions, difficulty) still follows the
 * slot the scenario takes.
 */

import { normalizeString } from './ContractNormalizeUtils.js';
import { normalizeMapUnits } from './MapUnitContract.js';

export const ARCADE_SCENARIO_CONTRACT_VERSION = 'arcade-scenario.v1';

const VALID_SLOTS = new Set(['sector', 'parcours', 'finale']);
const VALID_UNIT_KINDS = new Set(['tank', 'swarm', 'boss', 'bomber', 'creature']);
const OBJECTIVE_LABELS = Object.freeze({
    destroy_units: 'Einheiten zerstören',
    survive_window: 'Überleben',
});
const MAX_BOTS = 12;

function finiteNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeId(value) {
    return normalizeString(value, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function resolveArcadeScenarioObjectiveLabel(objectiveId) {
    return OBJECTIVE_LABELS[normalizeId(objectiveId)] || '';
}

function normalizeObjective(source) {
    const id = normalizeId(source?.id);
    if (!Object.prototype.hasOwnProperty.call(OBJECTIVE_LABELS, id)) return null;
    const objective = {
        id,
        label: normalizeString(source?.label, OBJECTIVE_LABELS[id]).trim() || OBJECTIVE_LABELS[id],
        durationSec: finiteNumber(source?.durationSec, 0, 0, 600),
        scoreWeight: finiteNumber(source?.scoreWeight, 1, 1, 3),
    };
    if (id === 'destroy_units') {
        const kind = normalizeId(source?.unitKind);
        objective.unitKind = VALID_UNIT_KINDS.has(kind) ? kind : 'creature';
        objective.count = Math.trunc(finiteNumber(source?.count, 1, 1, 16));
    }
    return Object.freeze(objective);
}

/**
 * @param {any} source
 * @returns {Readonly<Record<string, any>> | null} null when the scenario has no map or no known objective
 */
export function normalizeArcadeScenario(source) {
    const id = normalizeId(source?.id);
    const mapKey = normalizeString(source?.mapKey, '').trim();
    const objective = normalizeObjective(source?.objective || { id: 'survive_window', durationSec: 55 });
    if (!id || !mapKey || !objective) return null;
    // A missing bot count means "the squad decides"; Number(null) would read as zero bots.
    const botCount = source?.botCount === null || source?.botCount === undefined ? NaN : Number(source.botCount);
    const minSector = Math.trunc(finiteNumber(source?.minSector, 1, 1, 99));
    const slot = normalizeId(source?.slot);
    const mapUnits = normalizeMapUnits(source?.mapUnits, { preserveSpatial: true });
    return Object.freeze({
        id,
        label: normalizeString(source?.label, id).trim() || id,
        briefing: normalizeString(source?.briefing, '').trim(),
        slot: VALID_SLOTS.has(slot) ? slot : 'sector',
        mapKey,
        combatProfile: source?.combatProfile === 'hunt' ? 'hunt' : '',
        preserveObjective: source?.preserveObjective === true,
        mapUnits,
        mapUnitsMode: source?.mapUnitsMode === 'replace' ? 'replace' : 'overlay',
        // Seconds after the sector start at which the map's water zone floods; 0 leaves it to the map.
        waterZoneTriggerSec: finiteNumber(source?.waterZoneTriggerSec, 0, 0, 600),
        squadId: normalizeString(source?.squadId, '').trim() || null,
        botCount: Number.isFinite(botCount) ? Math.trunc(Math.max(0, Math.min(MAX_BOTS, botCount))) : null,
        objective,
        minSector,
        maxSector: Math.trunc(finiteNumber(source?.maxSector, 99, minSector, 99)),
    });
}

/**
 * The objective definition a sector plays: the shared definition with the scenario's own
 * parameters on top. A sector without parameters gets the shared definition unchanged.
 *
 * @param {any} baseDefinition
 * @param {any} sectorEntry
 */
export function resolveArcadeSectorObjectiveDefinition(baseDefinition, sectorEntry) {
    const params = sectorEntry?.objective;
    if (!params || typeof params !== 'object') return baseDefinition || null;
    return normalizeObjective({
        ...(baseDefinition || {}),
        ...params,
        id: sectorEntry?.objectiveId || params.id || baseDefinition?.id,
        label: params.label || baseDefinition?.label,
    });
}

export default {
    ARCADE_SCENARIO_CONTRACT_VERSION,
    normalizeArcadeScenario,
    resolveArcadeSectorObjectiveDefinition,
};
