// Shared blueprint projection and drop failure text of the hangar workshop. The Fight hangar
// validates with FightHangarValidation, the Arcade hangar with the stone panel (Paket 3:
// ArcadeStonePanel); the old Arcade level/budget validation of the colour stones is gone.
import { HANGAR_SLOT_DEFINITIONS, resolveHangarPart } from './HangarPartCatalog.js';
import { normalizeHangarBuild } from './HangarBuildDraftState.js';

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

export function projectHangarBuildBlueprint(build) {
    const normalized = normalizeHangarBuild(build);
    const slots = {};
    const stats = { budgetUsed: 0, massUsed: 0, powerUsed: 0, heatUsed: 0, partCount: 0 };
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        slots[slot.id] = part ? 1 : 0;
        if (!part) continue;
        if (part.kind !== 'stone' && part.tier !== 'T1') slots[`${slot.id}_t2`] = 1;
        stats.budgetUsed += part.costs.budget;
        stats.massUsed += part.costs.mass;
        stats.powerUsed += part.costs.energy;
        stats.heatUsed += part.costs.heat;
        stats.partCount += 1;
    }
    for (const key of ['budgetUsed', 'massUsed', 'powerUsed', 'heatUsed']) stats[key] = round1(stats[key]);
    return {
        schemaVersion: 'arcade-blueprint-v1',
        blueprintId: normalized.buildId,
        label: normalized.name,
        hitboxClass: normalized.hitboxClass,
        stats,
        slots,
        source: 'desktop-hangar',
    };
}

export function describeHangarDropFailure(result) {
    if (result?.message) return result.message;
    return {
        incompatible_slot: 'Dieses Bauteil passt nicht auf den gewählten Slot.',
        required_slot: 'Ein Pflichtslot kann nur durch ein anderes Teil ersetzt werden.',
        slot_locked: 'Dieser Slot ist noch gesperrt.',
        tier_locked: 'Dieses Teile-Tier ist noch gesperrt.',
        part_family_locked: 'Diese Teilefamilie ist noch gesperrt.',
        level_locked: 'Dein Fahrzeuglevel ist für dieses Bauteil zu niedrig.',
    }[String(result?.code || '')] || 'Der Umbau wurde abgelehnt; der Entwurf blieb unverändert.';
}
