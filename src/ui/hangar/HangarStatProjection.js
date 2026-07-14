import { resolveVehicleManagerCatalogEntry } from '../arcade/VehicleManagerCatalog.js';
import { HANGAR_SLOT_DEFINITIONS, resolveHangarPart } from './HangarPartCatalog.js';
import { normalizeHangarBuild } from './HangarBuildDraftState.js';
import { projectHangarBuildBlueprint } from './HangarBuildValidation.js';

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

export const HANGAR_STAT_DEFINITIONS = Object.freeze([
    Object.freeze({ key: 'speed', label: 'Geschwindigkeit', unit: '' }),
    Object.freeze({ key: 'agility', label: 'Wendigkeit', unit: '' }),
    Object.freeze({ key: 'maxHp', label: 'Max. Lebenspunkte', unit: '' }),
    Object.freeze({ key: 'mass', label: 'Masse', unit: '' }),
    Object.freeze({ key: 'energy', label: 'Energieverbrauch', unit: '' }),
    Object.freeze({ key: 'heat', label: 'Hitze', unit: '' }),
    Object.freeze({ key: 'partCount', label: 'Teile', unit: '' }),
    Object.freeze({ key: 'budget', label: 'Budget', unit: '' }),
]);

export function projectHangarStats(build) {
    const normalized = normalizeHangarBuild(build);
    const entry = resolveVehicleManagerCatalogEntry(normalized.vehicleId);
    const blueprint = projectHangarBuildBlueprint(normalized);
    let speed = 108 + (Number(entry.statsSummary.agility) || 0) * 10;
    let agility = 34 + (Number(entry.statsSummary.control) || 0) * 8;
    let maxHp = 70 + (Number(entry.statsSummary.armor) || 0) * 20;
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        if (!part) continue;
        speed += part.stats.speed;
        agility += part.stats.agility;
        maxHp += part.stats.maxHp;
    }
    return {
        speed: round1(speed),
        agility: round1(agility),
        maxHp: round1(maxHp),
        mass: blueprint.stats.massUsed,
        energy: blueprint.stats.powerUsed,
        heat: blueprint.stats.heatUsed,
        partCount: blueprint.stats.partCount,
        budget: blueprint.stats.budgetUsed,
    };
}

export function compareHangarStats(current, reference) {
    const left = current && typeof current === 'object' ? current : {};
    const right = reference && typeof reference === 'object' ? reference : {};
    return HANGAR_STAT_DEFINITIONS.map((definition) => {
        const value = round1(left[definition.key]);
        const referenceValue = round1(right[definition.key]);
        const rawDelta = round1(value - referenceValue);
        const lowerIsBetter = ['mass', 'energy', 'heat', 'budget'].includes(definition.key);
        return {
            ...definition,
            value,
            referenceValue,
            delta: rawDelta,
            tone: rawDelta === 0 ? 'neutral' : ((rawDelta > 0) !== lowerIsBetter ? 'positive' : 'negative'),
        };
    });
}
