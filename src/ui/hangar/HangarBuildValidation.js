import { validateArcadeHangarBlueprintForLevel } from '../../shared/contracts/ArcadeHangarRulesContract.js';
import { HANGAR_SLOT_DEFINITIONS, resolveHangarPart } from './HangarPartCatalog.js';
import { normalizeHangarBuild } from './HangarBuildDraftState.js';

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function pushUnique(items, item) {
    if (!items.some((entry) => entry.code === item.code && entry.slotId === item.slotId)) items.push(item);
}

export function projectHangarBuildBlueprint(build) {
    const normalized = normalizeHangarBuild(build);
    const slots = {};
    const stats = { budgetUsed: 0, massUsed: 0, powerUsed: 0, heatUsed: 0, partCount: 0 };
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        slots[slot.id] = part ? 1 : 0;
        if (!part) continue;
        if (part.tier !== 'T1') slots[`${slot.id}_t2`] = 1;
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

function mapContractMessage(message) {
    const text = String(message || 'Ungültiger Build');
    if (text.includes('editorBudget')) return { code: 'editor_budget', message: text };
    if (text.includes('massBudget')) return { code: 'mass_budget', message: text };
    if (text.includes('powerBudget')) return { code: 'energy_budget', message: text };
    if (text.includes('heatBudget')) return { code: 'heat_budget', message: text };
    if (text.includes('partCount')) return { code: 'part_count_budget', message: text };
    if (text.includes('missing required slot')) return { code: 'required_slot', message: text };
    if (text.includes('not unlocked')) return { code: 'slot_locked', message: text };
    if (text.includes('part family')) return { code: 'part_family_locked', message: text };
    if (text.includes('tier')) return { code: 'tier_locked', message: text };
    if (text.includes('chassis')) return { code: 'chassis_locked', message: text };
    return { code: 'contract_rejected', message: text };
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

export function validateHangarBuild(build, level = 1) {
    const normalized = normalizeHangarBuild(build);
    const blueprint = projectHangarBuildBlueprint(normalized);
    const contractValidation = validateArcadeHangarBlueprintForLevel(blueprint, level);
    const errors = contractValidation.errors.map(mapContractMessage);
    const warnings = contractValidation.warnings.map((message) => ({ code: 'contract_warning', message }));
    const allowedTiers = new Set(contractValidation.allowedTiers);
    const allowedFamilies = new Set(contractValidation.allowedPartFamilies);
    const unlockedSlots = new Set(contractValidation.unlockedSlots);

    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        if (!part) {
            if (slot.required) pushUnique(errors, { code: 'required_slot', slotId: slot.id, message: `${slot.label} ist ein Pflichtslot` });
            continue;
        }
        if (!part.compatibleSlots.includes(slot.id)) {
            pushUnique(errors, { code: 'incompatible_slot', slotId: slot.id, partId: part.id, message: `${part.label} passt nicht auf ${slot.label}` });
        }
        if (Number(level) < part.minLevel) {
            pushUnique(errors, { code: 'level_locked', slotId: slot.id, partId: part.id, message: `${part.label} benötigt Level ${part.minLevel}` });
        }
        if (!allowedFamilies.has(part.family)) {
            pushUnique(errors, { code: 'part_family_locked', slotId: slot.id, partId: part.id, message: `Teilefamilie ${part.family} ist gesperrt` });
        }
        if (!allowedTiers.has(part.tier)) {
            pushUnique(errors, { code: 'tier_locked', slotId: slot.id, partId: part.id, message: `${part.tier} ist noch gesperrt` });
        }
        const tierSlot = `${slot.id}_${part.tier.toLowerCase()}`;
        if (!unlockedSlots.has(slot.id) && !unlockedSlots.has(tierSlot)) {
            pushUnique(errors, { code: 'slot_locked', slotId: slot.id, partId: part.id, message: `${slot.label} ist gesperrt` });
        }
    }

    return {
        ok: errors.length === 0,
        build: normalized,
        blueprint,
        stats: { ...blueprint.stats },
        limits: { ...contractValidation.limits },
        errors,
        warnings,
        level: contractValidation.level,
        allowedTiers: [...contractValidation.allowedTiers],
        allowedPartFamilies: [...contractValidation.allowedPartFamilies],
        unlockedSlots: [...contractValidation.unlockedSlots],
    };
}

export function validateHangarDrop(build, partId, slotId, level, install) {
    const installResult = install(build, partId, slotId);
    if (!installResult?.ok) {
        return { ok: false, code: installResult?.code || 'drop_rejected', build: normalizeHangarBuild(build), errors: [] };
    }
    const validation = validateHangarBuild(installResult.build, level);
    if (!validation.ok) {
        const relevant = validation.errors.find((error) => error.slotId === slotId)
            || validation.errors.find((error) => String(error.code).includes('budget'))
            || validation.errors[0];
        return {
            ...validation,
            ok: false,
            code: relevant?.code || 'drop_rejected',
            message: relevant?.message || 'Bauteil kann hier nicht montiert werden',
            build: normalizeHangarBuild(build),
            rejectedBuild: installResult.build,
        };
    }
    return { ...validation, ok: true, code: 'drop_accepted', build: installResult.build, changedSlots: installResult.changedSlots };
}

export function hangarBuildToProfileUpgrades(build) {
    const normalized = normalizeHangarBuild(build);
    const upgrades = {};
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        if (!part || part.tier === 'T1') continue;
        upgrades[`${slot.id}_t2`] = part.tier;
    }
    return upgrades;
}

export function hangarBuildToProfileBonuses(build) {
    const normalized = normalizeHangarBuild(build);
    const bonuses = { speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0 };
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const part = resolveHangarPart(normalized.slots[slot.id]);
        if (!part) continue;
        bonuses.speedBonusPct += Number(part.bonuses?.speedBonusPct) || 0;
        bonuses.turningBonusPct += Number(part.bonuses?.turningBonusPct) || 0;
        bonuses.maxHpBonus += Number(part.bonuses?.maxHpBonus) || 0;
    }
    return Object.fromEntries(Object.entries(bonuses).map(([key, value]) => [key, round1(value)]));
}
