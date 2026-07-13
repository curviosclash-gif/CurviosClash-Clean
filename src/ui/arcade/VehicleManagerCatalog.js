import { VEHICLE_DEFINITIONS } from '../../entities/vehicle-registry.js';

const LIGHT_CATEGORY_IDS = new Set(['aircraft', 'arrow', 'drone']);
const SPECIAL_CATEGORY_IDS = new Set(['manta', 'orb']);
const DEFAULT_PREVIEW_TOKEN = 'vehicle:placeholder';
const VEHICLE_MANAGER_UPGRADE_SLOT_COUNT = 7;

const VEHICLE_MANAGER_CATEGORY_TABS = Object.freeze([
    Object.freeze({ id: 'all', label: 'Alle', order: 0 }),
    Object.freeze({ id: 'jaeger', label: 'Jaeger', order: 1 }),
    Object.freeze({ id: 'kreuzer', label: 'Kreuzer', order: 2 }),
    Object.freeze({ id: 'spezial', label: 'Spezial', order: 3 }),
    Object.freeze({ id: 'custom', label: 'Custom', order: 4 }),
]);

const VEHICLE_MANAGER_INTERACTION_RULES = Object.freeze({
    version: '66.1',
    categories: VEHICLE_MANAGER_CATEGORY_TABS,
    filterChips: Object.freeze({
        category: Object.freeze(['jaeger', 'kreuzer', 'spezial', 'custom']),
        hitboxKlasse: Object.freeze(['kompakt', 'standard', 'schwer']),
        unlockState: Object.freeze(['all', 'unlockable', 'maxed']),
        levelBand: Object.freeze(['rookie', 'mid', 'elite']),
    }),
    preview: Object.freeze({
        mode: 'interactive-3d',
        allowOrbit: true,
        keepPlayerColor: true,
        fallbackToken: DEFAULT_PREVIEW_TOKEN,
    }),
    upgradeFlow: Object.freeze({
        clickBehavior: 'open-tier-selector',
        maxTier: 'T3',
        autoSave: true,
    }),
    responsiveBreakpoints: Object.freeze({
        stackedPanelMaxWidth: 1000,
        compactListMaxWidth: 700,
    }),
});

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function toKeywordTokens(value) {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return [];
    return normalized
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .map((token) => token.trim())
        .filter(Boolean);
}

function resolveVehicleCategory(vehicleDefinition) {
    const id = normalizeString(vehicleDefinition?.id).toLowerCase();
    if (vehicleDefinition?.isGeneratedModular) return 'custom';
    if (LIGHT_CATEGORY_IDS.has(id)) return 'jaeger';
    if (SPECIAL_CATEGORY_IDS.has(id)) return 'spezial';
    return 'kreuzer';
}

function resolveHitboxClass(radius) {
    if (radius <= 1.0) return 'kompakt';
    if (radius >= 1.35) return 'schwer';
    return 'standard';
}

function resolveShortDescription({ category, hitboxClass }) {
    if (category === 'custom') return 'Modulares Vehicle-Lab-Setup mit frei konfigurierbaren Teilen.';
    if (category === 'jaeger') return 'Leichtes Dogfight-Chassis fuer hohe Agilitaet und schnelle Kurswechsel.';
    if (category === 'spezial') return 'Spezialrahmen fuer situative Spielstile und Utility-Setup.';
    if (hitboxClass === 'schwer') return 'Robustes Cruiser-Chassis mit Fokus auf Stabilitaet und Upgrade-Synergien.';
    if (hitboxClass === 'kompakt') return 'Kompakter Cruiser mit hohem Tempo und niedrigem Profil.';
    return 'Ausgewogenes Cruiser-Chassis fuer flexible Allround-Loadouts.';
}

function resolveStatsSummary({ radius, category, hitboxClass }) {
    const armorScore = clamp(Math.round(2 + radius * 2), 1, 5);
    const agilityBase = clamp(Math.round(6 - radius * 2), 1, 5);
    const agilityScore = category === 'jaeger' ? clamp(agilityBase + 1, 1, 5) : agilityBase;
    const controlBonus = category === 'spezial' ? 1 : 0;
    const controlScore = clamp(Math.round((agilityScore + armorScore) / 2) + controlBonus, 1, 5);
    return Object.freeze({
        armor: armorScore,
        agility: agilityScore,
        control: controlScore,
        upgradePotential: VEHICLE_MANAGER_UPGRADE_SLOT_COUNT,
        hitboxRadius: Number(radius.toFixed(2)),
        hitboxClass,
    });
}

function buildKeywords({ vehicleId, label, category, hitboxClass, shortDescription }) {
    const keywordSet = new Set();
    const pools = [
        vehicleId,
        label,
        category,
        hitboxClass,
        shortDescription,
        category === 'custom' ? 'vehicle lab modular custom' : '',
    ];
    for (let i = 0; i < pools.length; i += 1) {
        const tokens = toKeywordTokens(pools[i]);
        for (let j = 0; j < tokens.length; j += 1) {
            keywordSet.add(tokens[j]);
        }
    }
    return Object.freeze([...keywordSet]);
}

function buildCatalogEntry(vehicleDefinition, index) {
    const vehicleId = normalizeString(vehicleDefinition?.id, `vehicle-${index + 1}`);
    const label = normalizeString(vehicleDefinition?.label, vehicleId);
    const category = resolveVehicleCategory(vehicleDefinition);
    const radius = toNumber(vehicleDefinition?.hitbox?.radius, 1.1);
    const hitboxClass = resolveHitboxClass(radius);
    const shortDescription = resolveShortDescription({ category, hitboxClass });
    const previewToken = category === 'custom' ? `custom:${vehicleId}` : `vehicle:${vehicleId}`;
    return Object.freeze({
        vehicleId,
        label,
        kategorie: category,
        hitboxKlasse: hitboxClass,
        kurzbeschreibung: shortDescription,
        sortOrder: index + 1,
        keywords: buildKeywords({
            vehicleId,
            label,
            category,
            hitboxClass,
            shortDescription,
        }),
        previewToken: normalizeString(previewToken, DEFAULT_PREVIEW_TOKEN),
        statsSummary: resolveStatsSummary({ radius, category, hitboxClass }),
    });
}

const VEHICLE_MANAGER_CATALOG_ENTRIES = Object.freeze(
    VEHICLE_DEFINITIONS.map((vehicleDefinition, index) => buildCatalogEntry(vehicleDefinition, index))
);

const VEHICLE_MANAGER_CATALOG_BY_ID = new Map(
    VEHICLE_MANAGER_CATALOG_ENTRIES.map((entry) => [entry.vehicleId, entry])
);

function cloneCatalogEntry(entry) {
    return {
        vehicleId: entry.vehicleId,
        label: entry.label,
        kategorie: entry.kategorie,
        hitboxKlasse: entry.hitboxKlasse,
        kurzbeschreibung: entry.kurzbeschreibung,
        sortOrder: entry.sortOrder,
        keywords: [...entry.keywords],
        previewToken: entry.previewToken,
        statsSummary: { ...entry.statsSummary },
    };
}

export function listVehicleManagerCatalogEntries() {
    return VEHICLE_MANAGER_CATALOG_ENTRIES.map((entry) => cloneCatalogEntry(entry));
}

export function resolveVehicleManagerCatalogEntry(vehicleId) {
    const key = normalizeString(vehicleId).toLowerCase();
    const knownEntry = VEHICLE_MANAGER_CATALOG_BY_ID.get(key);
    if (knownEntry) return cloneCatalogEntry(knownEntry);

    const fallbackEntry = {
        vehicleId: key || 'unknown_vehicle',
        label: key || 'Unknown Vehicle',
        kategorie: 'custom',
        hitboxKlasse: 'standard',
        kurzbeschreibung: 'Unbekannte Fahrzeug-ID; nutze Standardwerte fuer sicheren Fallback.',
        sortOrder: Number.MAX_SAFE_INTEGER,
        keywords: key ? toKeywordTokens(key) : ['unknown', 'vehicle'],
        previewToken: DEFAULT_PREVIEW_TOKEN,
        statsSummary: {
            armor: 3,
            agility: 3,
            control: 3,
            upgradePotential: VEHICLE_MANAGER_UPGRADE_SLOT_COUNT,
            hitboxRadius: 1.1,
            hitboxClass: 'standard',
        },
    };
    return fallbackEntry;
}

export function getVehicleManagerInteractionRules() {
    return {
        version: VEHICLE_MANAGER_INTERACTION_RULES.version,
        categories: VEHICLE_MANAGER_INTERACTION_RULES.categories.map((entry) => ({ ...entry })),
        filterChips: {
            category: [...VEHICLE_MANAGER_INTERACTION_RULES.filterChips.category],
            hitboxKlasse: [...VEHICLE_MANAGER_INTERACTION_RULES.filterChips.hitboxKlasse],
            unlockState: [...VEHICLE_MANAGER_INTERACTION_RULES.filterChips.unlockState],
            levelBand: [...VEHICLE_MANAGER_INTERACTION_RULES.filterChips.levelBand],
        },
        preview: { ...VEHICLE_MANAGER_INTERACTION_RULES.preview },
        upgradeFlow: { ...VEHICLE_MANAGER_INTERACTION_RULES.upgradeFlow },
        responsiveBreakpoints: { ...VEHICLE_MANAGER_INTERACTION_RULES.responsiveBreakpoints },
    };
}
