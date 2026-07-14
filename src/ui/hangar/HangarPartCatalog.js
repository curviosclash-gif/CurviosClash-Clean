import { resolveArcadeHangarRulesForLevel } from '../../shared/contracts/ArcadeHangarRulesContract.js';

export const HANGAR_PART_CATALOG_VERSION = 'arcade-hangar-parts.v2';

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
        slots: ['core'], visual: 'core',
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
        variants: [
            { key: 'aegis', legacy: true, label: 'Aegis Core', role: 'Panzerung', color: 0x6aaeea, startTier: 0, costDelta: {}, statDelta: {}, bonuses: [{}, { maxHpBonus: 15 }, { maxHpBonus: 30 }] },
            { key: 'swift', label: 'Swift Core', role: 'Leicht & wendig', color: 0x3dd6b5, startTier: 0, costDelta: { budget: -1, mass: -2, energy: 1, heat: 1 }, statDelta: { maxHp: -4, agility: 3, speed: 1 }, bonuses: [{ turningBonusPct: 2 }, { turningBonusPct: 4, maxHpBonus: 8 }, { turningBonusPct: 6, maxHpBonus: 18 }] },
            { key: 'reactor', label: 'Reactor Core', role: 'Tempo & Energie', color: 0xb78cff, startTier: 1, costDelta: { budget: 1, mass: -1, energy: 3, heat: 2 }, statDelta: { maxHp: -8, agility: 1, speed: 4 }, bonuses: [null, { speedBonusPct: 4, maxHpBonus: 6 }, { speedBonusPct: 8, maxHpBonus: 16 }] },
            { key: 'bastion', label: 'Bastion Core', role: 'Maximale Struktur', color: 0xf3a85b, startTier: 2, costDelta: { budget: 4, mass: 4, energy: -1, heat: -1 }, statDelta: { maxHp: 16, agility: -1 }, bonuses: [null, null, { maxHpBonus: 45 }] },
        ],
    }),
    nose: Object.freeze({
        slots: ['nose'], visual: 'nose',
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
        variants: [
            { key: 'vector', legacy: true, label: 'Vector Nose', role: 'Ausgewogen', color: 0x6aaeea, startTier: 0, costDelta: {}, statDelta: {}, bonuses: [{}, {}, {}] },
            { key: 'razor', label: 'Razor Nose', role: 'Präzise Steuerung', color: 0x3dd6b5, startTier: 0, costDelta: { budget: 1, mass: -1.5, energy: 1, heat: 1 }, statDelta: { speed: -1, agility: 4 }, bonuses: [{ turningBonusPct: 2 }, { turningBonusPct: 4 }, { turningBonusPct: 6 }] },
            { key: 'bulwark', label: 'Bulwark Nose', role: 'Frontschutz', color: 0xf3a85b, startTier: 1, costDelta: { budget: 2, mass: 2, energy: -1, heat: -1 }, statDelta: { speed: -3, maxHp: 14 }, bonuses: [null, { maxHpBonus: 10 }, { maxHpBonus: 18 }] },
            { key: 'phantom', label: 'Phantom Nose', role: 'Hochgeschwindigkeit', color: 0xb78cff, startTier: 2, costDelta: { budget: 3, mass: -2, energy: 3, heat: 3 }, statDelta: { speed: 6, agility: 3 }, bonuses: [null, null, { speedBonusPct: 8, turningBonusPct: 3 }] },
        ],
    }),
    wing: Object.freeze({
        slots: ['wing_left', 'wing_right'], visual: 'wing',
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
        variants: [
            { key: 'falcon', legacy: true, label: 'Falcon Wing', role: 'Wendigkeit', color: 0x6aaeea, startTier: 0, costDelta: {}, statDelta: {}, bonuses: [{}, { turningBonusPct: 5 }, { turningBonusPct: 9 }] },
            { key: 'kestrel', label: 'Kestrel Wing', role: 'Leicht & schnell', color: 0x3dd6b5, startTier: 0, costDelta: { budget: -1, mass: -1.5, energy: 1, heat: 1 }, statDelta: { agility: -1, speed: 3 }, bonuses: [{ speedBonusPct: 1.5 }, { speedBonusPct: 2, turningBonusPct: 3 }, { speedBonusPct: 3, turningBonusPct: 6 }] },
            { key: 'guardian', label: 'Guardian Wing', role: 'Stabilität & Schutz', color: 0xf3a85b, startTier: 1, costDelta: { budget: 2, mass: 2, energy: -1, heat: -0.5 }, statDelta: { agility: -1, maxHp: 10 }, bonuses: [null, { turningBonusPct: 2, maxHpBonus: 5 }, { turningBonusPct: 4, maxHpBonus: 8 }] },
            { key: 'specter', label: 'Specter Wing', role: 'Extreme Agilität', color: 0xb78cff, startTier: 2, costDelta: { budget: 3, mass: -1, energy: 3, heat: 2 }, statDelta: { agility: 5, speed: 3 }, bonuses: [null, null, { turningBonusPct: 12, speedBonusPct: 2 }] },
        ],
    }),
    engine: Object.freeze({
        slots: ['engine_left', 'engine_right'], visual: 'engine',
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
        variants: [
            { key: 'ion', legacy: true, label: 'Ion Drive', role: 'Schubleistung', color: 0x6aaeea, startTier: 0, costDelta: {}, statDelta: {}, bonuses: [{}, { speedBonusPct: 4 }, { speedBonusPct: 8 }] },
            { key: 'eco', label: 'Eco Drive', role: 'Kühl & effizient', color: 0x3dd6b5, startTier: 0, costDelta: { budget: -0.5, mass: 1, energy: -3, heat: -3 }, statDelta: { speed: -1, agility: 1 }, bonuses: [{ turningBonusPct: 1 }, { speedBonusPct: 2, turningBonusPct: 1 }, { speedBonusPct: 5, turningBonusPct: 2 }] },
            { key: 'vector', label: 'Vector Drive', role: 'Agiler Schub', color: 0xb78cff, startTier: 1, costDelta: { budget: 2, mass: -0.5, energy: 2, heat: 3 }, statDelta: { speed: 3, agility: 3 }, bonuses: [null, { speedBonusPct: 6, turningBonusPct: 2 }, { speedBonusPct: 10, turningBonusPct: 3 }] },
            { key: 'nova', label: 'Nova Drive', role: 'Maximaler Schub', color: 0xf35b68, startTier: 2, costDelta: { budget: 4, mass: 1, energy: 3, heat: 6 }, statDelta: { speed: 8, agility: 2 }, bonuses: [null, null, { speedBonusPct: 14 }] },
        ],
    }),
    utility: Object.freeze({
        slots: ['utility'], visual: 'utility',
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
        variants: [
            { key: 'pulse', legacy: true, label: 'Pulse Utility', role: 'Strukturreserve', color: 0x6aaeea, startTier: 0, costDelta: {}, statDelta: {}, bonuses: [{ maxHpBonus: 5 }, { maxHpBonus: 10 }, { maxHpBonus: 18 }] },
            { key: 'flux', label: 'Flux Utility', role: 'Manövrierhilfe', color: 0x3dd6b5, startTier: 0, costDelta: { budget: 1, mass: -1, energy: 1, heat: 1 }, statDelta: { maxHp: -2, agility: 3, speed: 1 }, bonuses: [{ turningBonusPct: 3 }, { turningBonusPct: 5 }, { turningBonusPct: 8 }] },
            { key: 'shield', label: 'Shield Utility', role: 'Schildverstärker', color: 0xf3a85b, startTier: 1, costDelta: { budget: 3, mass: 2, energy: 2, heat: 1 }, statDelta: { maxHp: 12, agility: -1 }, bonuses: [null, { maxHpBonus: 20 }, { maxHpBonus: 30 }] },
            { key: 'overclock', label: 'Overclock Utility', role: 'Tempo-Boost', color: 0xb78cff, startTier: 2, costDelta: { budget: 4, mass: -1, energy: 4, heat: 4 }, statDelta: { maxHp: -4, agility: 3, speed: 8 }, bonuses: [null, null, { speedBonusPct: 12, turningBonusPct: 5 }] },
        ],
    }),
});

const TIER_LEVELS = Object.freeze({ T1: 1, T2: 10, T3: 20 });

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function mergeNumbers(base, delta, keys) {
    return Object.fromEntries(keys.map((key) => [key, round1((base?.[key] || 0) + (delta?.[key] || 0))]));
}

function createPartId(family, variant, tier) {
    return variant.legacy ? `${family}_${tier.toLowerCase()}` : `${family}_${variant.key}_${tier.toLowerCase()}`;
}

function createPartDefinition(family, template, variant, tierIndex) {
    const tier = `T${tierIndex + 1}`;
    const nextTier = tierIndex < 2 ? `T${tierIndex + 2}` : null;
    return Object.freeze({
        id: createPartId(family, variant, tier),
        label: `${variant.label} ${tier}`,
        role: variant.role,
        family,
        tier,
        minLevel: Math.max(family === 'utility' ? 5 : 1, TIER_LEVELS[tier]),
        compatibleSlots: Object.freeze([...template.slots]),
        symmetric: family === 'wing' || family === 'engine',
        visual: template.visual,
        appearance: Object.freeze({ color: variant.color }),
        costs: Object.freeze(mergeNumbers(template.costs[tierIndex], variant.costDelta, ['budget', 'mass', 'energy', 'heat'])),
        stats: Object.freeze(mergeNumbers(template.stats[tierIndex], variant.statDelta, ['speed', 'agility', 'maxHp'])),
        bonuses: Object.freeze({ speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0, ...(variant.bonuses[tierIndex] || {}) }),
        upgradeTo: nextTier ? createPartId(family, variant, nextTier) : null,
        searchTokens: Object.freeze(`${variant.label} ${variant.role} ${family} ${tier}`.toLowerCase().split(/\s+/)),
    });
}

export const HANGAR_PART_CATALOG = Object.freeze(
    Object.entries(FAMILY_TEMPLATES).flatMap(([family, template]) => (
        [0, 1, 2].flatMap((tierIndex) => template.variants
            .filter((variant) => variant.startTier <= tierIndex)
            .map((variant) => createPartDefinition(family, template, variant, tierIndex)))
    ))
);

const PART_BY_ID = new Map(HANGAR_PART_CATALOG.map((part) => [part.id, part]));
let publishedParts = [];

function normalizePublishedPart(part) {
    const family = String(part?.family || '').toLowerCase();
    const compatibleSlots = (Array.isArray(part?.compatibleSlots) ? part.compatibleSlots : [])
        .filter((slotId) => SLOT_BY_ID.get(slotId)?.family === family);
    const id = String(part?.id || '').trim().toLowerCase();
    if (!id || !FAMILY_TEMPLATES[family] || !compatibleSlots.length) return null;
    return Object.freeze({
        id,
        label: String(part.label || id).trim(),
        role: String(part.role || 'Vehicle Lab').trim(),
        family,
        tier: ['T1', 'T2', 'T3'].includes(part.tier) ? part.tier : 'T1',
        minLevel: Math.max(1, Number(part.minLevel) || 1),
        compatibleSlots: Object.freeze(compatibleSlots),
        symmetric: part.symmetric === true,
        visual: 'lab',
        appearance: Object.freeze({ ...(part.appearance || {}) }),
        costs: Object.freeze({ budget: 7, mass: 5, energy: 4, heat: 3, ...(part.costs || {}) }),
        stats: Object.freeze({ speed: 0, agility: 0, maxHp: 0, ...(part.stats || {}) }),
        bonuses: Object.freeze({ speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0 }),
        upgradeTo: null,
        searchTokens: Object.freeze(`${part.label || id} ${family} vehicle lab`.toLowerCase().split(/\s+/)),
        published: true,
    });
}

export function registerPublishedHangarParts(record) {
    const source = Array.isArray(record?.publications) ? record.publications.flatMap((entry) => entry?.parts || []) : [];
    publishedParts = source.map(normalizePublishedPart).filter(Boolean).slice(0, 120);
    for (const [id, part] of [...PART_BY_ID.entries()]) if (part?.published) PART_BY_ID.delete(id);
    publishedParts.forEach((part) => PART_BY_ID.set(part.id, part));
    return publishedParts.length;
}

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
        bonuses: { ...(part.bonuses || {}) },
        searchTokens: [...part.searchTokens],
        appearance: part.appearance ? { ...part.appearance, size: [...(part.appearance.size || [])] } : undefined,
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
    return [...HANGAR_PART_CATALOG, ...publishedParts].filter((part) => {
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
