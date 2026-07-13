/**
 * ArcadeHangarRulesContract - V76 76.3
 *
 * Arcade Hangar progression rules with deterministic rule paths for chassis,
 * part families, slot gates, tier gates and valid blueprint limits.
 * Arcade vehicles follow fixed contracts - free stat adjustments are not
 * allowed (DoD.3).
 *
 * References ArcadeVehicleProfile for XP/level state; does not duplicate it.
 */
import {
    ARCADE_HITBOX_CLASSES,
    ARCADE_REQUIRED_SLOTS,
} from '../../entities/arcade/ArcadeBlueprintSchema.js';

export const ARCADE_HANGAR_RULES_CONTRACT_VERSION = 'arcade-hangar-rules.v2';

// --- Level Bands ---
// Arcade hangar groups levels into bands that gate chassis, parts and budgets.

export const ARCADE_HANGAR_LEVEL_BANDS = Object.freeze({
    RECRUIT: Object.freeze({ id: 'recruit', minLevel: 1, maxLevel: 9, label: 'Recruit' }),
    VETERAN: Object.freeze({ id: 'veteran', minLevel: 10, maxLevel: 19, label: 'Veteran' }),
    ELITE: Object.freeze({ id: 'elite', minLevel: 20, maxLevel: 30, label: 'Elite' }),
});

// --- Chassis Paths ---
// Chassis classes are locked behind deterministic level gates.

export const ARCADE_HANGAR_CHASSIS_UNLOCK_GATES = Object.freeze({
    compact: 1,
    standard: 1,
    heavy: 10,
});

// --- Slot Unlock Gates ---
// Levels at which additional part slots are unlocked in Arcade hangar.
// Base slots (ARCADE_REQUIRED_SLOTS) are always available from level 1.

export const ARCADE_HANGAR_SLOT_UNLOCK_GATES = Object.freeze({
    utility: 5,
    wing_left_t2: 10,
    wing_right_t2: 10,
    engine_left_t2: 15,
    engine_right_t2: 15,
    core_t2: 20,
    nose_t2: 20,
    utility_t2: 25,
    core_t3: 28,
    nose_t3: 28,
});

// --- Part Families ---
// Families define which part groups are legal in a level range.

export const ARCADE_HANGAR_PART_FAMILY_UNLOCK_GATES = Object.freeze({
    core: 1,
    nose: 1,
    wing: 1,
    engine: 1,
    utility: 5,
    stabilizer: 14,
    signature: 22,
});

// --- Tier Gates ---
// Upgrade tier access is level-driven and independent from UI state.

export const ARCADE_HANGAR_TIER_UNLOCK_GATES = Object.freeze({
    T1: 1,
    T2: 10,
    T3: 20,
});

// --- Mastery Milestones ---
// Milestones are used to expose long-term, deterministic progression checkpoints.

export const ARCADE_HANGAR_MASTERY_MILESTONE_GATES = Object.freeze({
    initiate: 1,
    mechanic: 5,
    tactician: 10,
    specialist: 15,
    architect: 20,
    commander: 25,
    legend: 30,
});

// --- Blueprint Limits per Level Band ---
// Part budget, mass, power, heat, part count and hitbox allowance scale by band.

export const ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND = Object.freeze({
    [ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id]: Object.freeze({
        band: ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id,
        editorBudget: 60,
        massBudget: 55,
        powerBudget: 60,
        heatBudget: 52,
        maxPartCount: 24,
        allowedHitboxClasses: Object.freeze(['compact', 'standard']),
    }),
    [ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id]: Object.freeze({
        band: ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id,
        editorBudget: 80,
        massBudget: 72,
        powerBudget: 80,
        heatBudget: 70,
        maxPartCount: 36,
        allowedHitboxClasses: Object.freeze(['compact', 'standard', 'heavy']),
    }),
    [ARCADE_HANGAR_LEVEL_BANDS.ELITE.id]: Object.freeze({
        band: ARCADE_HANGAR_LEVEL_BANDS.ELITE.id,
        editorBudget: 100,
        massBudget: 90,
        powerBudget: 96,
        heatBudget: 88,
        maxPartCount: 48,
        allowedHitboxClasses: Object.freeze(['compact', 'standard', 'heavy']),
    }),
});

// Backward compatible export used by existing callers.
export const ARCADE_HANGAR_BUDGET_BY_BAND = Object.freeze({
    [ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id]: Object.freeze({
        band: ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id,
        editorBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id].editorBudget,
        massBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id].massBudget,
        powerBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id].powerBudget,
        heatBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id].heatBudget,
    }),
    [ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id]: Object.freeze({
        band: ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id,
        editorBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id].editorBudget,
        massBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id].massBudget,
        powerBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id].powerBudget,
        heatBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.VETERAN.id].heatBudget,
    }),
    [ARCADE_HANGAR_LEVEL_BANDS.ELITE.id]: Object.freeze({
        band: ARCADE_HANGAR_LEVEL_BANDS.ELITE.id,
        editorBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.ELITE.id].editorBudget,
        massBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.ELITE.id].massBudget,
        powerBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.ELITE.id].powerBudget,
        heatBudget: ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.ELITE.id].heatBudget,
    }),
});

const VALID_HITBOX_CLASS_SET = new Set(Object.keys(ARCADE_HITBOX_CLASSES));
const PART_FAMILY_BY_SLOT_PREFIX = Object.freeze({
    core: 'core',
    nose: 'nose',
    wing_left: 'wing',
    wing_right: 'wing',
    engine_left: 'engine',
    engine_right: 'engine',
    utility: 'utility',
    stabilizer: 'stabilizer',
    signature: 'signature',
});

function normalizeLevel(level) {
    return Math.max(1, Math.min(30, Math.floor(Number(level) || 1)));
}

function freezeList(values) {
    return Object.freeze([...new Set(values)]);
}

function normalizeSlotKey(slotKey) {
    return String(slotKey || '').trim().toLowerCase();
}

function normalizeTierKey(rawTier) {
    const tier = String(rawTier || '').trim().toUpperCase();
    if (!tier) return 'T1';
    return tier;
}

function resolveSlotTier(slotKey) {
    const key = normalizeSlotKey(slotKey);
    if (key.endsWith('_t3')) return 'T3';
    if (key.endsWith('_t2')) return 'T2';
    return 'T1';
}

function resolveBaseSlotKey(slotKey) {
    return normalizeSlotKey(slotKey).replace(/_t[23]$/, '');
}

export function resolveArcadeHangarPartFamily(slotKey) {
    const baseSlot = resolveBaseSlotKey(slotKey);
    return PART_FAMILY_BY_SLOT_PREFIX[baseSlot] || null;
}

export function resolveArcadeHangarBlueprintLimits(level) {
    const band = resolveArcadeHangarLevelBand(level);
    return ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[band.id]
        || ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id];
}

export function resolveArcadeHangarAllowedChassis(level) {
    const n = normalizeLevel(level);
    const allowed = [];
    const entries = Object.entries(ARCADE_HANGAR_CHASSIS_UNLOCK_GATES);
    for (let i = 0; i < entries.length; i += 1) {
        const hitboxClass = entries[i][0];
        const gate = Number(entries[i][1]) || 1;
        if (n >= gate && VALID_HITBOX_CLASS_SET.has(hitboxClass)) {
            allowed.push(hitboxClass);
        }
    }
    return freezeList(allowed);
}

export function resolveArcadeHangarAllowedPartFamilies(level) {
    const n = normalizeLevel(level);
    const allowed = [];
    const entries = Object.entries(ARCADE_HANGAR_PART_FAMILY_UNLOCK_GATES);
    for (let i = 0; i < entries.length; i += 1) {
        const family = entries[i][0];
        const gate = Number(entries[i][1]) || 1;
        if (n >= gate) allowed.push(family);
    }
    return freezeList(allowed);
}

export function resolveArcadeHangarAllowedTiers(level) {
    const n = normalizeLevel(level);
    const allowed = [];
    const entries = Object.entries(ARCADE_HANGAR_TIER_UNLOCK_GATES);
    for (let i = 0; i < entries.length; i += 1) {
        const tier = normalizeTierKey(entries[i][0]);
        const gate = Number(entries[i][1]) || 1;
        if (n >= gate) allowed.push(tier);
    }
    return freezeList(allowed);
}

export function resolveArcadeHangarMasteryMilestones(level) {
    const n = normalizeLevel(level);
    const milestones = [];
    const entries = Object.entries(ARCADE_HANGAR_MASTERY_MILESTONE_GATES);
    for (let i = 0; i < entries.length; i += 1) {
        const milestoneId = String(entries[i][0] || '').trim().toLowerCase();
        const gate = Number(entries[i][1]) || 1;
        if (!milestoneId) continue;
        if (n >= gate) milestones.push(milestoneId);
    }
    return freezeList(milestones);
}

// --- Rule Resolution ---

export function resolveArcadeHangarLevelBand(level) {
    const n = normalizeLevel(level);
    if (n >= ARCADE_HANGAR_LEVEL_BANDS.ELITE.minLevel) return ARCADE_HANGAR_LEVEL_BANDS.ELITE;
    if (n >= ARCADE_HANGAR_LEVEL_BANDS.VETERAN.minLevel) return ARCADE_HANGAR_LEVEL_BANDS.VETERAN;
    return ARCADE_HANGAR_LEVEL_BANDS.RECRUIT;
}

export function resolveArcadeHangarBudget(level) {
    const band = resolveArcadeHangarLevelBand(level);
    return ARCADE_HANGAR_BUDGET_BY_BAND[band.id] || ARCADE_HANGAR_BUDGET_BY_BAND[ARCADE_HANGAR_LEVEL_BANDS.RECRUIT.id];
}

export function resolveArcadeHangarUnlockedSlots(level) {
    const n = normalizeLevel(level);
    const slots = [...ARCADE_REQUIRED_SLOTS];
    const entries = Object.entries(ARCADE_HANGAR_SLOT_UNLOCK_GATES);
    for (let i = 0; i < entries.length; i += 1) {
        if (n >= entries[i][1]) slots.push(entries[i][0]);
    }
    return freezeList(slots);
}

export function validateArcadeHangarBlueprintForLevel(blueprint, level) {
    const resolvedLevel = normalizeLevel(level);
    const limits = resolveArcadeHangarBlueprintLimits(resolvedLevel);
    const allowedHitboxClasses = new Set(resolveArcadeHangarAllowedChassis(resolvedLevel));
    const allowedPartFamilies = new Set(resolveArcadeHangarAllowedPartFamilies(resolvedLevel));
    const allowedTiers = new Set(resolveArcadeHangarAllowedTiers(resolvedLevel));
    const unlockedSlots = new Set(resolveArcadeHangarUnlockedSlots(resolvedLevel));

    const record = blueprint && typeof blueprint === 'object' ? blueprint : {};
    const stats = record.stats && typeof record.stats === 'object' ? record.stats : {};
    const slots = record.slots && typeof record.slots === 'object' ? record.slots : {};
    const hitboxClass = String(record.hitboxClass || 'standard').trim().toLowerCase();
    const errors = [];
    const warnings = [];

    if (!allowedHitboxClasses.has(hitboxClass)) {
        errors.push(`chassis hitboxClass ${hitboxClass} is locked for level ${resolvedLevel}`);
    }

    if ((Number(stats.budgetUsed) || 0) > limits.editorBudget) {
        errors.push(`editorBudget exceeded (${stats.budgetUsed}/${limits.editorBudget})`);
    }
    if ((Number(stats.massUsed) || 0) > limits.massBudget) {
        errors.push(`massBudget exceeded (${stats.massUsed}/${limits.massBudget})`);
    }
    if ((Number(stats.powerUsed) || 0) > limits.powerBudget) {
        errors.push(`powerBudget exceeded (${stats.powerUsed}/${limits.powerBudget})`);
    }
    if ((Number(stats.heatUsed) || 0) > limits.heatBudget) {
        errors.push(`heatBudget exceeded (${stats.heatUsed}/${limits.heatBudget})`);
    }
    if ((Number(stats.partCount) || 0) > limits.maxPartCount) {
        errors.push(`partCount exceeded (${stats.partCount}/${limits.maxPartCount})`);
    }

    for (let i = 0; i < ARCADE_REQUIRED_SLOTS.length; i += 1) {
        const requiredSlot = ARCADE_REQUIRED_SLOTS[i];
        if ((Number(slots[requiredSlot]) || 0) <= 0) {
            errors.push(`missing required slot: ${requiredSlot}`);
        }
    }

    const slotEntries = Object.entries(slots);
    for (let i = 0; i < slotEntries.length; i += 1) {
        const slotKey = normalizeSlotKey(slotEntries[i][0]);
        const count = Number(slotEntries[i][1]) || 0;
        if (count <= 0) continue;

        const slotTier = resolveSlotTier(slotKey);
        const family = resolveArcadeHangarPartFamily(slotKey);
        if (!unlockedSlots.has(slotKey)) {
            errors.push(`slot ${slotKey} is not unlocked at level ${resolvedLevel}`);
        }
        if (!allowedTiers.has(slotTier)) {
            errors.push(`tier ${slotTier} is locked for slot ${slotKey} at level ${resolvedLevel}`);
        }
        if (family && !allowedPartFamilies.has(family)) {
            errors.push(`part family ${family} is locked for slot ${slotKey} at level ${resolvedLevel}`);
        }
        if (!family) {
            warnings.push(`slot ${slotKey} has no mapped part family`);
        }
    }

    return Object.freeze({
        ok: errors.length === 0,
        errors: Object.freeze(errors),
        warnings: Object.freeze(warnings),
        level: resolvedLevel,
        limits,
        allowedHitboxClasses: Object.freeze([...allowedHitboxClasses]),
        allowedPartFamilies: Object.freeze([...allowedPartFamilies]),
        allowedTiers: Object.freeze([...allowedTiers]),
        unlockedSlots: Object.freeze([...unlockedSlots]),
    });
}

export function resolveArcadeHangarRulesForLevel(level) {
    const band = resolveArcadeHangarLevelBand(level);
    const resolvedLevel = normalizeLevel(level);
    const blueprintLimits = resolveArcadeHangarBlueprintLimits(resolvedLevel);
    return Object.freeze({
        contractVersion: ARCADE_HANGAR_RULES_CONTRACT_VERSION,
        level: resolvedLevel,
        band: band.id,
        bandLabel: band.label,
        budget: resolveArcadeHangarBudget(resolvedLevel),
        blueprintLimits,
        allowedChassisClasses: resolveArcadeHangarAllowedChassis(resolvedLevel),
        allowedPartFamilies: resolveArcadeHangarAllowedPartFamilies(resolvedLevel),
        allowedTiers: resolveArcadeHangarAllowedTiers(resolvedLevel),
        unlockedSlots: resolveArcadeHangarUnlockedSlots(resolvedLevel),
    });
}

export function resolveArcadeHangarProgressionSnapshot(level) {
    const resolvedLevel = normalizeLevel(level);
    const band = resolveArcadeHangarLevelBand(resolvedLevel);
    const allowedPartFamilies = resolveArcadeHangarAllowedPartFamilies(resolvedLevel);
    const allowedTiers = resolveArcadeHangarAllowedTiers(resolvedLevel);
    const unlockedSlots = resolveArcadeHangarUnlockedSlots(resolvedLevel);
    const masteryMilestones = resolveArcadeHangarMasteryMilestones(resolvedLevel);
    return Object.freeze({
        contractVersion: ARCADE_HANGAR_RULES_CONTRACT_VERSION,
        level: resolvedLevel,
        band: band.id,
        bandLabel: band.label,
        allowedPartFamilies,
        allowedTiers,
        unlockedSlots,
        masteryMilestones,
    });
}

export default {
    ARCADE_HANGAR_RULES_CONTRACT_VERSION,
    ARCADE_HANGAR_LEVEL_BANDS,
    ARCADE_HANGAR_CHASSIS_UNLOCK_GATES,
    ARCADE_HANGAR_SLOT_UNLOCK_GATES,
    ARCADE_HANGAR_PART_FAMILY_UNLOCK_GATES,
    ARCADE_HANGAR_TIER_UNLOCK_GATES,
    ARCADE_HANGAR_MASTERY_MILESTONE_GATES,
    ARCADE_HANGAR_BLUEPRINT_LIMITS_BY_BAND,
    ARCADE_HANGAR_BUDGET_BY_BAND,
    resolveArcadeHangarLevelBand,
    resolveArcadeHangarBudget,
    resolveArcadeHangarBlueprintLimits,
    resolveArcadeHangarAllowedChassis,
    resolveArcadeHangarAllowedPartFamilies,
    resolveArcadeHangarAllowedTiers,
    resolveArcadeHangarMasteryMilestones,
    resolveArcadeHangarUnlockedSlots,
    resolveArcadeHangarPartFamily,
    validateArcadeHangarBlueprintForLevel,
    resolveArcadeHangarRulesForLevel,
    resolveArcadeHangarProgressionSnapshot,
};
