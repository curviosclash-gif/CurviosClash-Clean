import { evaluateFightHangarParts } from '../../shared/contracts/FightHangarBalanceContract.js';
import { resolveArcadeHangarBlueprintLimits } from '../../shared/contracts/ArcadeHangarRulesContract.js';
import { HANGAR_SLOT_DEFINITIONS, resolveHangarPart } from './HangarPartCatalog.js';
import { normalizeHangarBuild } from './HangarBuildDraftState.js';
import { projectHangarBuildBlueprint } from './HangarBuildValidation.js';

// Fight runs at the Elite band. Budgets are not enforced here — Fight is gated by
// the neutral power budget, not by progression — but the shared workshop surface
// reads stats/limits to draw its budget bars, so both must be present.
const FIGHT_HANGAR_LEVEL = 30;

export function validateFightHangarBuild(build) {
    const normalized = normalizeHangarBuild({ ...build, mode: 'fight' });
    const blueprint = projectHangarBuildBlueprint(normalized);
    const errors = [];
    const parts = [];
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        if (!part) {
            if (slot.required) errors.push({ code: 'required_slot', slotId: slot.id, message: `${slot.label} ist ein Pflichtslot` });
            continue;
        }
        if (!part.compatibleSlots.includes(slot.id)) {
            errors.push({ code: 'incompatible_slot', slotId: slot.id, message: `${part.label} passt nicht auf ${slot.label}` });
            continue;
        }
        parts.push(part);
    }
    const balance = evaluateFightHangarParts(parts);
    errors.push(...balance.errors);
    return {
        ok: errors.length === 0,
        build: normalized,
        blueprint,
        stats: { ...blueprint.stats },
        limits: { ...resolveArcadeHangarBlueprintLimits(FIGHT_HANGAR_LEVEL) },
        bonuses: balance.bonuses,
        balanceScore: balance.balanceScore,
        errors,
        warnings: [],
        level: FIGHT_HANGAR_LEVEL,
        allowedTiers: ['T1', 'T2', 'T3'],
        allowedPartFamilies: ['core', 'nose', 'wing', 'engine', 'utility', 'stone'],
        unlockedSlots: HANGAR_SLOT_DEFINITIONS.map((slot) => slot.id),
    };
}

export function validateFightHangarDrop(build, partId, slotId, install) {
    const installResult = install(build, partId, slotId);
    if (!installResult?.ok) {
        return { ok: false, code: installResult?.code || 'drop_rejected', build: normalizeHangarBuild(build), errors: [] };
    }
    const validation = validateFightHangarBuild(installResult.build);
    if (!validation.ok) {
        const relevant = validation.errors.find((error) => error.slotId === slotId) || validation.errors[0];
        return {
            ...validation,
            ok: false,
            code: relevant?.code || 'drop_rejected',
            message: relevant?.message || 'Fight-Build ist nicht ausgeglichen.',
            build: normalizeHangarBuild(build),
            rejectedBuild: installResult.build,
        };
    }
    return { ...validation, ok: true, code: 'drop_accepted', build: installResult.build, changedSlots: installResult.changedSlots };
}
