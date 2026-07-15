import { resolveArcadeHangarRulesForLevel } from '../../shared/contracts/ArcadeHangarRulesContract.js';

export const HANGAR_PART_CATALOG_VERSION = 'arcade-hangar-stones.v1';

export const HANGAR_SLOT_DEFINITIONS = Object.freeze([
    Object.freeze({ id: 'core', label: 'Core-Fassung', family: 'core', required: true, pair: null }),
    Object.freeze({ id: 'nose', label: 'Nasen-Fassung', family: 'nose', required: true, pair: null }),
    Object.freeze({ id: 'wing_left', label: 'Flügel L', family: 'wing', required: true, pair: 'wing_right' }),
    Object.freeze({ id: 'wing_right', label: 'Flügel R', family: 'wing', required: true, pair: 'wing_left' }),
    Object.freeze({ id: 'engine_left', label: 'Antrieb L', family: 'engine', required: true, pair: 'engine_right' }),
    Object.freeze({ id: 'engine_right', label: 'Antrieb R', family: 'engine', required: true, pair: 'engine_left' }),
    Object.freeze({ id: 'utility', label: 'Utility-Fassung', family: 'utility', required: false, pair: null }),
]);

const SLOT_BY_ID = new Map(HANGAR_SLOT_DEFINITIONS.map((slot) => [slot.id, slot]));
const UNIVERSAL_SLOTS = Object.freeze(HANGAR_SLOT_DEFINITIONS.map((slot) => slot.id));

export const HANGAR_STONE_COLORS = Object.freeze([
    Object.freeze({ id: 'blue', label: 'Blau', name: 'Impulsstein', role: 'Geschwindigkeit', trait: 'speed', color: 0x35a7ff }),
    Object.freeze({ id: 'green', label: 'Grün', name: 'Wendestein', role: 'Wendigkeit', trait: 'agility', color: 0x35d07f }),
    Object.freeze({ id: 'gold', label: 'Gold', name: 'Bollwerkstein', role: 'Lebenspunkte & Schutz', trait: 'armor', color: 0xf6c453 }),
    Object.freeze({ id: 'cyan', label: 'Cyan', name: 'Kühlstein', role: 'Energie & Hitze', trait: 'efficiency', color: 0x36e1d5 }),
    Object.freeze({ id: 'violet', label: 'Violett', name: 'Resonanzstein', role: 'Gemischte Boni', trait: 'balanced', color: 0xa875ff }),
]);

const COLOR_BY_ID = new Map(HANGAR_STONE_COLORS.map((entry) => [entry.id, entry]));
const TIER_CONFIG = Object.freeze({
    T1: Object.freeze({ index: 1, minLevel: 1, purchaseLevel: 5, price: 100, size: 0.78, costs: { budget: 5, mass: 4, energy: 3, heat: 2 } }),
    T2: Object.freeze({ index: 2, minLevel: 10, purchaseLevel: 10, price: 350, size: 1.04, costs: { budget: 8, mass: 5, energy: 5, heat: 4 } }),
    T3: Object.freeze({ index: 3, minLevel: 20, purchaseLevel: 20, price: 900, size: 1.34, costs: { budget: 12, mass: 6, energy: 8, heat: 7 } }),
});

const STONE_EFFECTS = Object.freeze({
    blue: Object.freeze({
        stats: [{ speed: 3 }, { speed: 7 }, { speed: 12 }],
        bonuses: [{ speedBonusPct: 2 }, { speedBonusPct: 5 }, { speedBonusPct: 9 }],
        costs: { energy: 1, heat: 1 },
    }),
    green: Object.freeze({
        stats: [{ agility: 3 }, { agility: 7 }, { agility: 12 }],
        bonuses: [{ turningBonusPct: 2 }, { turningBonusPct: 5 }, { turningBonusPct: 9 }],
        costs: { mass: -1, energy: 1 },
    }),
    gold: Object.freeze({
        stats: [{ maxHp: 10 }, { maxHp: 22 }, { maxHp: 40 }],
        bonuses: [{ maxHpBonus: 6 }, { maxHpBonus: 15 }, { maxHpBonus: 30 }],
        costs: { budget: 1, mass: 2 },
    }),
    cyan: Object.freeze({
        stats: [{ agility: 1 }, { agility: 2, speed: 1 }, { agility: 3, speed: 2 }],
        bonuses: [{ turningBonusPct: 1 }, { turningBonusPct: 2 }, { turningBonusPct: 3, speedBonusPct: 2 }],
        costs: { budget: -1, energy: -2, heat: -1 },
    }),
    violet: Object.freeze({
        stats: [{ speed: 1, agility: 1, maxHp: 4 }, { speed: 3, agility: 3, maxHp: 10 }, { speed: 6, agility: 6, maxHp: 18 }],
        bonuses: [{ speedBonusPct: 1, turningBonusPct: 1 }, { speedBonusPct: 3, turningBonusPct: 3, maxHpBonus: 6 }, { speedBonusPct: 6, turningBonusPct: 6, maxHpBonus: 12 }],
        costs: { budget: 1, energy: 2, heat: 2 },
    }),
});

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function stoneId(colorId, tier) {
    return `stone_${colorId}_${tier.toLowerCase()}`;
}

function createStone(color, tier) {
    const tierConfig = TIER_CONFIG[tier];
    const effect = STONE_EFFECTS[color.id];
    const effectStats = effect.stats[tierConfig.index - 1];
    return Object.freeze({
        id: stoneId(color.id, tier),
        kind: 'stone',
        colorId: color.id,
        colorLabel: color.label,
        label: `${color.name} ${tier}`,
        role: color.role,
        trait: color.trait,
        family: 'stone',
        tier,
        minLevel: tierConfig.minLevel,
        compatibleSlots: UNIVERSAL_SLOTS,
        symmetric: true,
        visual: 'stone',
        appearance: Object.freeze({ color: color.color, variant: 'universal-stone', style: 'crystal', sizeScale: tierConfig.size }),
        costs: Object.freeze(Object.fromEntries(Object.entries(tierConfig.costs).map(([key, value]) => [key, round1(value + (effect.costs[key] || 0))]))),
        stats: Object.freeze({ speed: 0, agility: 0, maxHp: 0, ...effectStats }),
        bonuses: Object.freeze({ speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0, ...effect.bonuses[tierConfig.index - 1] }),
        inventory: Object.freeze({
            initialCount: tier === 'T1' ? 2 : 0,
            purchaseUnlockLevel: tierConfig.purchaseLevel,
            priceXrp: tierConfig.price,
            maxOwned: 7,
        }),
        upgradeTo: tier === 'T1' ? stoneId(color.id, 'T2') : (tier === 'T2' ? stoneId(color.id, 'T3') : null),
        searchTokens: Object.freeze(`${color.label} ${color.name} ${color.role} ${tier} stein kristall`.toLowerCase().split(/\s+/)),
    });
}

export const HANGAR_PART_CATALOG = Object.freeze(
    HANGAR_STONE_COLORS.flatMap((color) => ['T1', 'T2', 'T3'].map((tier) => createStone(color, tier)))
);

const PART_BY_ID = new Map(HANGAR_PART_CATALOG.map((part) => [part.id, part]));
let publishedParts = [];

function clonePart(part) {
    return part ? {
        ...part,
        compatibleSlots: [...part.compatibleSlots],
        costs: { ...part.costs },
        stats: { ...part.stats },
        bonuses: { ...(part.bonuses || {}) },
        inventory: part.inventory ? { ...part.inventory } : undefined,
        searchTokens: [...part.searchTokens],
        appearance: part.appearance ? { ...part.appearance, size: [...(part.appearance.size || [])] } : undefined,
    } : null;
}

function colorForPublishedFamily(family) {
    return { core: 'gold', nose: 'blue', wing: 'green', engine: 'cyan', utility: 'violet' }[family] || 'violet';
}

function normalizePublishedPart(part) {
    const id = String(part?.id || '').trim().toLowerCase();
    if (!id) return null;
    const color = COLOR_BY_ID.get(colorForPublishedFamily(String(part.family || '').toLowerCase()));
    const tier = ['T1', 'T2', 'T3'].includes(part.tier) ? part.tier : 'T1';
    const base = createStone(color, tier);
    return Object.freeze({
        ...base,
        id,
        label: `${String(part.label || id).trim()} · Lab-Stein`,
        published: true,
        searchTokens: Object.freeze(`${part.label || id} ${color.label} vehicle lab stein`.toLowerCase().split(/\s+/)),
    });
}

export function registerPublishedHangarParts(record) {
    const source = Array.isArray(record?.publications) ? record.publications.flatMap((entry) => entry?.parts || []) : [];
    publishedParts = source.map(normalizePublishedPart).filter(Boolean).slice(0, 120);
    for (const [id, part] of [...PART_BY_ID.entries()]) if (part?.published) PART_BY_ID.delete(id);
    publishedParts.forEach((part) => PART_BY_ID.set(part.id, part));
    return publishedParts.length;
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
    const color = String(filters.color || filters.family || 'all').trim().toLowerCase();
    const tier = String(filters.tier || 'all').trim().toUpperCase();
    const trait = String(filters.trait || 'all').trim().toLowerCase();
    return [...HANGAR_PART_CATALOG, ...publishedParts].filter((part) => {
        if (color !== 'all' && part.colorId !== color) return false;
        if (tier !== 'ALL' && part.tier !== tier) return false;
        if (trait !== 'all' && part.trait !== trait) return false;
        if (!search) return true;
        return part.label.toLowerCase().includes(search) || part.searchTokens.some((token) => token.includes(search));
    }).map(clonePart);
}

export function resolveHangarPartUnlockLevel(part) {
    return part?.kind === 'stone' ? Math.max(1, Number(part.minLevel) || 1) : 30;
}

const DEFAULT_LAYOUT = Object.freeze({
    core: Object.freeze({ position: [0, 0.28, 0], rotation: [0, 0, 0], scale: 0.9 }),
    nose: Object.freeze({ position: [0, 0.06, -1.48], rotation: [-Math.PI / 2, 0, 0], scale: 0.82 }),
    wing_left: Object.freeze({ position: [-1.1, 0.04, -0.05], rotation: [0, 0, 0.08], scale: 0.88 }),
    wing_right: Object.freeze({ position: [1.1, 0.04, -0.05], rotation: [0, 0, -0.08], scale: 0.88 }),
    engine_left: Object.freeze({ position: [-0.78, 0, 1.05], rotation: [Math.PI / 2, 0, 0], scale: 0.82 }),
    engine_right: Object.freeze({ position: [0.78, 0, 1.05], rotation: [Math.PI / 2, 0, 0], scale: 0.82 }),
    utility: Object.freeze({ position: [0, 0.72, 0.25], rotation: [0, 0, 0], scale: 0.72 }),
});

const VEHICLE_LAYOUT_SPECS = Object.freeze({
    ship5: Object.freeze({ scale: 1.1, length: 1.08, width: 1.02 }), aircraft: Object.freeze({ scale: 1.05, length: 1.18, width: 1.18 }),
    spaceship: Object.freeze({ scale: 1.05, length: 0.9, width: 1.12 }), arrow: Object.freeze({ scale: 0.82, length: 1.35, width: 0.7 }),
    manta: Object.freeze({ scale: 1.12, length: 0.92, width: 1.34 }), drone: Object.freeze({ scale: 0.9, length: 0.92, width: 1.08 }),
    orb: Object.freeze({ scale: 0.9, length: 0.82, width: 1.12 }), ship1: Object.freeze({ scale: 0.98, length: 1.05, width: 0.94 }),
    ship2: Object.freeze({ scale: 1.18, length: 1.08, width: 1.1 }), ship3: Object.freeze({ scale: 0.86, length: 1.02, width: 0.82 }),
    ship4: Object.freeze({ scale: 1.24, length: 1.12, width: 1.16 }), ship6: Object.freeze({ scale: 1.06, length: 1.04, width: 1.02 }),
    ship7: Object.freeze({ scale: 1.12, length: 1.02, width: 1.06 }), ship8: Object.freeze({ scale: 1, length: 1.1, width: 1 }),
    ship9: Object.freeze({ scale: 0.94, length: 1.05, width: 0.9 }),
});

export function resolveVehicleHardpoints(vehicleId) {
    const spec = VEHICLE_LAYOUT_SPECS[String(vehicleId || '').trim().toLowerCase()] || { scale: 1, length: 1, width: 1 };
    return HANGAR_SLOT_DEFINITIONS.map((slot) => {
        const anchor = DEFAULT_LAYOUT[slot.id];
        return {
            ...slot,
            position: [anchor.position[0] * spec.scale * spec.width, anchor.position[1] * spec.scale, anchor.position[2] * spec.scale * spec.length],
            rotation: [...anchor.rotation],
            scale: anchor.scale * spec.scale,
        };
    });
}

export function createDefaultHangarSlots() {
    return {
        core: 'stone_gold_t1', nose: 'stone_blue_t1',
        wing_left: 'stone_green_t1', wing_right: 'stone_green_t1',
        engine_left: 'stone_cyan_t1', engine_right: 'stone_cyan_t1', utility: null,
    };
}

export function resolveLegacyHangarStoneId(partId, slotId) {
    const raw = String(partId || '').toLowerCase();
    if (raw.startsWith('stone_') && PART_BY_ID.has(raw)) return raw;
    const slot = resolveHangarSlot(slotId);
    const color = { core: 'gold', nose: 'blue', wing: 'green', engine: 'cyan', utility: 'violet' }[slot?.family] || 'violet';
    return stoneId(color, 'T1');
}

export function resolvePartLockReason(part, level, buildValidation = null) {
    if (!part) return { code: 'unknown_part', message: 'Unbekannter Stein' };
    const unlockLevel = resolveHangarPartUnlockLevel(part);
    if (Number(level) < unlockLevel) return { code: 'level_locked', unlockLevel, message: `Freischaltung auf Level ${unlockLevel}` };
    const rules = resolveArcadeHangarRulesForLevel(level);
    if (!rules.allowedTiers.includes(part.tier)) return { code: 'tier_locked', unlockLevel, message: `${part.tier} ist noch gesperrt` };
    if (buildValidation && buildValidation.ok === false) {
        const error = buildValidation.errors?.[0];
        return { code: error?.code || buildValidation.code || 'build_invalid', message: error?.message || buildValidation.message || 'Build-Limit überschritten' };
    }
    return null;
}
