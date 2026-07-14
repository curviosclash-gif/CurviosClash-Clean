import { resolveArcadeHangarRulesForLevel } from '../../shared/contracts/ArcadeHangarRulesContract.js';

export const HANGAR_PART_CATALOG_VERSION = 'arcade-hangar-parts.v1';

export const HANGAR_SLOT_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'core', label: 'Core', family: 'core', required: true, pair: null }),
    Object.freeze({ id: 'nose', label: 'Nose', family: 'nose', required: true, pair: null }),
    Object.freeze({ id: 'wing_left', label: 'Wing L', family: 'wing', required: true, pair: 'wing_right' }),
    Object.freeze({ id: 'wing_right', label: 'Wing R', family: 'wing', required: true, pair: 'wing_left' }),
    Object.freeze({ id: 'engine_left', label: 'Engine L', family: 'engine', required: true, pair: 'engine_right' }),
    Object.freeze({ id: 'engine_right', label: 'Engine R', family: 'engine', required: true, pair: 'engine_left' }),
    Object.freeze({ id: 'utility', label: 'Utility', family: 'utility', required: false, pair: null }),
]);

const SLOT_BY_ID = new Map(HANGAR_SLOT_DEFINITIONS.map((slot) => [slot.id, slot]));

const FAMILY_TEMPLATES = Object.freeze({
    core: Object.freeze({
        label: 'Aegis Core', slots: ['core'], visual: 'core',
        costs: [
            { budget: 10, mass: 9, energy: 5, heat: 3 },
            { budget: 14, mass: 9.5, energy: 7, heat: 4 },
            { budget: 19, mass: 10, energy: 9, heat: 5 },
        ],
        stats: [
            { maxHp: 8 },
            { maxHp: 18, agility: 1 },
            { maxHp: 34, agility: 2 },
        ],
    }),
    nose: Object.freeze({
        label: 'Vector Nose', slots: ['nose'], visual: 'nose',
        costs: [
            { budget: 7, mass: 5, energy: 4, heat: 3 },
            { budget: 10, mass: 5.5, energy: 6, heat: 4 },
            { budget: 14, mass: 6, energy: 8, heat: 5 },
        ],
        stats: [
            { speed: 2 },
            { speed: 5, agility: 1 },
            { speed: 9, agility: 2 },
        ],
    }),
    wing: Object.freeze({
        label: 'Falcon Wing', slots: ['wing_left', 'wing_right'], visual: 'wing',
        costs: [
            { budget: 6, mass: 5.5, energy: 3, heat: 2 },
            { budget: 8, mass: 5.7, energy: 4, heat: 2.5 },
            { budget: 11, mass: 6, energy: 5, heat: 3 },
        ],
        stats: [
            { agility: 2 },
            { agility: 4, speed: 1 },
            { agility: 7, speed: 2 },
        ],
    }),
    engine: Object.freeze({
        label: 'Ion Drive', slots: ['engine_left', 'engine_right'], visual: 'engine',
        costs: [
            { budget: 6.5, mass: 6, energy: 7, heat: 6 },
            { budget: 9, mass: 6.3, energy: 9, heat: 8 },
            { budget: 13, mass: 6.8, energy: 12, heat: 11 },
        ],
        stats: [
            { speed: 4 },
            { speed: 8 },
            { speed: 14, agility: 1 },
        ],
    }),
    utility: Object.freeze({
        label: 'Pulse Utility', slots: ['utility'], visual: 'utility',
        costs: [
            { budget: 5, mass: 3, energy: 5, heat: 4 },
            { budget: 8, mass: 3.5, energy: 7, heat: 6 },
            { budget: 12, mass: 4, energy: 10, heat: 8 },
        ],
        stats: [
            { maxHp: 4 },
            { maxHp: 8, agility: 2 },
            { maxHp: 14, agility: 3, speed: 3 },
        ],
    }),
});

const TIER_LEVELS = Object.freeze({ T1: 1, T2: 10, T3: 20 });

function createPartDefinition(family, template, tierIndex) {
    const tier = `T${tierIndex + 1}`;
    const suffix = tier.toLowerCase();
    return Object.freeze({
        id: `${family}_${suffix}`,
        label: `${template.label} ${tier}`,
        family,
        tier,
        minLevel: Math.max(family === 'utility' ? 5 : 1, TIER_LEVELS[tier]),
        compatibleSlots: Object.freeze([...template.slots]),
        symmetric: family === 'wing' || family === 'engine',
        visual: template.visual,
        costs: Object.freeze({ ...template.costs[tierIndex] }),
        stats: Object.freeze({ speed: 0, agility: 0, maxHp: 0, ...template.stats[tierIndex] }),
        searchTokens: Object.freeze(`${template.label} ${family} ${tier}`.toLowerCase().split(/\s+/)),
    });
}

export const HANGAR_PART_CATALOG = Object.freeze(
    Object.entries(FAMILY_TEMPLATES).flatMap(([family, template]) => (
        [0, 1, 2].map((tierIndex) => createPartDefinition(family, template, tierIndex))
    ))
);

const PART_BY_ID = new Map(HANGAR_PART_CATALOG.map((part) => [part.id, part]));

const DEFAULT_LAYOUT = Object.freeze({
    core: Object.freeze({ position: [0, 0.15, 0], rotation: [0, 0, 0], scale: 0.72 }),
    nose: Object.freeze({ position: [0, 0.05, -1.25], rotation: [-Math.PI / 2, 0, 0], scale: 0.64 }),
    wing_left: Object.freeze({ position: [-1.05, 0, -0.05], rotation: [0, 0, 0.08], scale: 0.72 }),
    wing_right: Object.freeze({ position: [1.05, 0, -0.05], rotation: [0, 0, -0.08], scale: 0.72 }),
    engine_left: Object.freeze({ position: [-0.72, 0, 0.95], rotation: [Math.PI / 2, 0, 0], scale: 0.68 }),
    engine_right: Object.freeze({ position: [0.72, 0, 0.95], rotation: [Math.PI / 2, 0, 0], scale: 0.68 }),
    utility: Object.freeze({ position: [0, 0.72, 0.25], rotation: [0, 0, 0], scale: 0.58 }),
});

const VEHICLE_LAYOUT_SPECS = Object.freeze({
    ship5: Object.freeze({ scale: 1.1, length: 1.08, width: 1.02 }),
    aircraft: Object.freeze({ scale: 1.05, length: 1.18, width: 1.18 }),
    spaceship: Object.freeze({ scale: 1.05, length: 0.9, width: 1.12 }),
    arrow: Object.freeze({ scale: 0.82, length: 1.35, width: 0.7 }),
    manta: Object.freeze({ scale: 1.12, length: 0.92, width: 1.34 }),
    drone: Object.freeze({ scale: 0.9, length: 0.92, width: 1.08 }),
    orb: Object.freeze({ scale: 0.9, length: 0.82, width: 1.12 }),
    ship1: Object.freeze({ scale: 0.98, length: 1.05, width: 0.94 }),
    ship2: Object.freeze({ scale: 1.18, length: 1.08, width: 1.1 }),
    ship3: Object.freeze({ scale: 0.86, length: 1.02, width: 0.82 }),
    ship4: Object.freeze({ scale: 1.24, length: 1.12, width: 1.16 }),
    ship6: Object.freeze({ scale: 1.06, length: 1.04, width: 1.02 }),
    ship7: Object.freeze({ scale: 1.12, length: 1.02, width: 1.06 }),
    ship8: Object.freeze({ scale: 1.0, length: 1.1, width: 1 }),
    ship9: Object.freeze({ scale: 0.94, length: 1.05, width: 0.9 }),
});

function clonePart(part) {
    return part ? {
        ...part,
        compatibleSlots: [...part.compatibleSlots],
        costs: { ...part.costs },
        stats: { ...part.stats },
        searchTokens: [...part.searchTokens],
    } : null;
}

export function resolveHangarSlot(slotId) {
    const slot = SLOT_BY_ID.get(String(slotId || '').trim().toLowerCase());
    return slot ? { ...slot } : null;
}

export function resolveHangarPart(partId) {
    return clonePart(PART_BY_ID.get(String(partId || '').trim().toLowerCase()));
}

export function listHangarParts(filters = {}) {
    const search = String(filters.search || '').trim().toLowerCase();
    const family = String(filters.family || 'all').trim().toLowerCase();
    const tier = String(filters.tier || 'all').trim().toUpperCase();
    return HANGAR_PART_CATALOG.filter((part) => {
        if (family !== 'all' && part.family !== family) return false;
        if (tier !== 'ALL' && part.tier !== tier) return false;
        if (!search) return true;
        return part.label.toLowerCase().includes(search) || part.searchTokens.some((token) => token.includes(search));
    }).map(clonePart);
}

export function resolveVehicleHardpoints(vehicleId) {
    const spec = VEHICLE_LAYOUT_SPECS[String(vehicleId || '').trim().toLowerCase()]
        || Object.freeze({ scale: 1, length: 1, width: 1 });
    return HANGAR_SLOT_DEFINITIONS.map((slot) => {
        const anchor = DEFAULT_LAYOUT[slot.id];
        const position = [...anchor.position];
        position[0] *= spec.scale * spec.width;
        position[1] *= spec.scale;
        position[2] *= spec.scale * spec.length;
        return {
            ...slot,
            position,
            rotation: [...anchor.rotation],
            scale: anchor.scale * spec.scale,
        };
    });
}

export function createDefaultHangarSlots() {
    return {
        core: 'core_t1',
        nose: 'nose_t1',
        wing_left: 'wing_t1',
        wing_right: 'wing_t1',
        engine_left: 'engine_t1',
        engine_right: 'engine_t1',
        utility: null,
    };
}

export function resolvePartLockReason(part, level, buildValidation = null) {
    if (!part) return { code: 'unknown_part', message: 'Unbekanntes Bauteil' };
    const rules = resolveArcadeHangarRulesForLevel(level);
    if (level < part.minLevel) {
        return { code: 'level_locked', message: `Benötigtes Level: ${part.minLevel}` };
    }
    if (!rules.allowedPartFamilies.includes(part.family)) {
        return { code: 'part_family_locked', message: `Teilefamilie ${part.family} ist gesperrt` };
    }
    if (!rules.allowedTiers.includes(part.tier)) {
        return { code: 'tier_locked', message: `Tier ${part.tier} ist gesperrt` };
    }
    if (!part.compatibleSlots.some((slotId) => rules.unlockedSlots.includes(slotId)
        || rules.unlockedSlots.includes(`${slotId}_${part.tier.toLowerCase()}`))) {
        return { code: 'slot_locked', message: 'Kompatibler Slot ist noch gesperrt' };
    }
    const budgetError = buildValidation?.errors?.find((error) => String(error.code || '').includes('budget'));
    if (budgetError) return { code: budgetError.code, message: budgetError.message };
    return null;
}
