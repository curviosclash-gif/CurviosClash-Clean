import { resolveArtifactVersionState } from './ArtifactVersionMigrationContract.js';
import { normalizeVehiclePartStyle } from './VehiclePartStyleContract.js';
import { normalizeArcadeSizeProfileFields } from './ArcadeVehicleBuildContract.js';
import { normalizeArcadeStoneSlotPackages } from './ArcadeStoneWorkshopContract.js';

// v3 (Paket 1): levels have no ceiling. v2 profiles are upgraded in place; v1
// profiles retain the previous fallback behavior. The storage key is a location,
// while each record's schemaVersion decides how it is normalized.
export const ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION = 'arcade-vehicle-profile.v3';
export const ARCADE_VEHICLE_PROFILE_V2_SCHEMA_VERSION = 'arcade-vehicle-profile.v2';
export const ARCADE_VEHICLE_PROFILE_LEGACY_SCHEMA_VERSION = 'arcade-vehicle-profile.v1';
export const ARCADE_VEHICLE_PROFILE_STORAGE_KEY = 'cuviosclash.arcade-vehicle-profile.v2';
export const ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY = 'cuviosclash.arcade-vehicle-profile.v1';
const XP_BASE = 100;
const XP_EXPONENT = 1.5;
export const ARCADE_TRAIL_STYLE_IDS = Object.freeze([
    'standard', 'ion', 'ember', 'acid', 'violet', 'frost', 'solar', 'prism',
]);
export const ARCADE_WEAPON_STYLE_IDS = Object.freeze(['standard', 'ion', 'ember', 'nova']);
export const ARCADE_WEAPON_STYLE_FAMILIES = Object.freeze([
    'mg', 'rockets', 'flamethrower', 'railgun', 'lightning',
]);
export const ARCADE_VEHICLE_PROFILE_UPGRADE_SLOTS = Object.freeze([
    'core',
    'nose',
    'wing_left',
    'wing_right',
    'engine_left',
    'engine_right',
    'utility',
]);

const BASE_SLOTS = Object.freeze([
    'core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right',
]);
const ARCADE_VEHICLE_PROFILE_VERSION_FIELDS = Object.freeze(['schemaVersion']);
const ARCADE_VEHICLE_PROFILE_SUPPORTED_SCHEMAS = Object.freeze([
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_V2_SCHEMA_VERSION,
]);
const ARCADE_VEHICLE_PROFILE_FALLBACK_SCHEMAS = Object.freeze([ARCADE_VEHICLE_PROFILE_LEGACY_SCHEMA_VERSION]);

function toIsoString(nowMs) {
    return new Date(Math.max(0, Number(nowMs) || Date.now())).toISOString();
}

/**
 * Whole number in [0, MAX_SAFE_INTEGER]; +Infinity saturates, NaN uses the fallback.
 * @param {unknown} value
 * @param {number} [fallback]
 */
export function clampArcadeProfileCount(value, fallback = 0) {
    const n = Number(value);
    if (Number.isNaN(n)) return fallback;
    return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n)));
}

/** @param {number} level */
function rawXpForLevel(level) {
    return level <= 1 ? 0 : Math.floor(XP_BASE * Math.pow(level, XP_EXPONENT));
}

/**
 * Total XP needed to reach a level (100 * n^1.5), saturated at MAX_SAFE_INTEGER.
 * @param {unknown} level
 */
export function arcadeVehicleXpForLevel(level) {
    return Math.min(Number.MAX_SAFE_INTEGER, rawXpForLevel(Math.floor(Number(level) || 1)));
}

/**
 * Inverse of arcadeVehicleXpForLevel without a level ceiling.
 * @param {unknown} xp
 */
export function arcadeVehicleLevelForXp(xp) {
    const value = clampArcadeProfileCount(xp);
    // ponytail: closed-form inverse, then nudge off pow() rounding; the curve is monotonic.
    let level = Math.max(1, Math.floor(Math.pow(value / XP_BASE, 1 / XP_EXPONENT)));
    while (level > 1 && rawXpForLevel(level) > value) level -= 1;
    while (rawXpForLevel(level + 1) <= value) level += 1;
    return level;
}

export function isArcadeVehicleUpgradeSlot(slotName) {
    const normalized = String(slotName || '').trim().toLowerCase();
    return ARCADE_VEHICLE_PROFILE_UPGRADE_SLOTS.includes(normalized);
}

function cloneProfileValue(value) {
    if (Array.isArray(value)) return value.map((entry) => cloneProfileValue(entry));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneProfileValue(entry)]));
}

export function normalizeArcadeTrailStyleId(value) {
    const styleId = String(value || '').trim().toLowerCase();
    return ARCADE_TRAIL_STYLE_IDS.includes(styleId) ? styleId : 'standard';
}

export function normalizeArcadeWeaponStyleId(value) {
    const styleId = String(value || '').trim().toLowerCase();
    return ARCADE_WEAPON_STYLE_IDS.includes(styleId) ? styleId : 'standard';
}

export function normalizeArcadeWeaponStyleIds(source) {
    const styles = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    return Object.fromEntries(ARCADE_WEAPON_STYLE_FAMILIES.map((familyId) => [
        familyId,
        normalizeArcadeWeaponStyleId(styles[familyId]),
    ]));
}

export function createArcadeVehicleProfileRecord(vehicleId, nowMs = Date.now()) {
    return {
        schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
        vehicleId: String(vehicleId || 'ship1'),
        xp: 0,
        level: 1,
        unlockedSlots: [...BASE_SLOTS],
        upgrades: {},
        trailStyleId: 'standard',
        weaponStyleIds: normalizeArcadeWeaponStyleIds(),
        partStyle: {},
        ...normalizeArcadeSizeProfileFields(null),
        stoneSlotPackages: [],
        createdAt: toIsoString(nowMs),
        updatedAt: toIsoString(nowMs),
    };
}

export function normalizeArcadeVehicleProfileRecord(vehicleId, source) {
    const fallback = createArcadeVehicleProfileRecord(vehicleId);
    const candidate = source && typeof source === 'object' && !Array.isArray(source)
        ? cloneProfileValue(source)
        : {};
    return {
        ...fallback,
        ...candidate,
        schemaVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
        vehicleId: String(candidate.vehicleId || vehicleId),
        unlockedSlots: Array.isArray(candidate.unlockedSlots)
            ? candidate.unlockedSlots.slice()
            : fallback.unlockedSlots.slice(),
        upgrades: candidate.upgrades && typeof candidate.upgrades === 'object' && !Array.isArray(candidate.upgrades)
            ? { ...candidate.upgrades }
            : {},
        trailStyleId: normalizeArcadeTrailStyleId(candidate.trailStyleId),
        weaponStyleIds: normalizeArcadeWeaponStyleIds(candidate.weaponStyleIds),
        partStyle: normalizeVehiclePartStyle(candidate.partStyle),
        // Paket 2a: Größenumbau; Summenregel und Grenzen wie beim Kauf.
        ...normalizeArcadeSizeProfileFields(candidate),
        // Paket 3: gekaufte Steinplatz-Pakete (die Steine selbst liegen im Werkstatt-Pool).
        stoneSlotPackages: normalizeArcadeStoneSlotPackages(candidate.stoneSlotPackages),
    };
}

function hasValidStoredProfileFieldTypes(entry) {
    const countFields = [
        'xp', 'level', 'xpBank', 'totalXpEarned', 'spentUpgradeXp', 'upgradesApplied',
        'purchasedSizeSteps', 'purchasedItemSlots', 'purchasedRocketSlots',
    ];
    for (const field of countFields) {
        if (!Object.prototype.hasOwnProperty.call(entry, field)) continue;
        const value = entry[field];
        if (!Number.isSafeInteger(value) || value < (field === 'level' ? 1 : 0)) return false;
    }
    const typedFields = /** @type {Array<[string, (value: unknown) => boolean]>} */ ([
        ['vehicleId', (value) => typeof value === 'string'],
        ['sizeWorkshopUnlocked', (value) => typeof value === 'boolean'],
        ['unlockedSlots', Array.isArray],
        ['upgrades', (value) => !!value && typeof value === 'object' && !Array.isArray(value)],
        ['partSizes', (value) => !!value && typeof value === 'object' && !Array.isArray(value)],
    ]);
    for (const [field, predicate] of typedFields) {
        if (Object.prototype.hasOwnProperty.call(entry, field) && !predicate(entry[field])) return false;
    }
    if (entry.partSizes && typeof entry.partSizes === 'object' && !Array.isArray(entry.partSizes)) {
        for (const value of Object.values(entry.partSizes)) {
            if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        }
    }
    return true;
}

function hasValidStoredCosmeticFields(entry) {
    if (Object.prototype.hasOwnProperty.call(entry, 'trailStyleId')
        && (typeof entry.trailStyleId !== 'string'
            || !ARCADE_TRAIL_STYLE_IDS.includes(entry.trailStyleId.trim().toLowerCase()))) return false;
    if (Object.prototype.hasOwnProperty.call(entry, 'weaponStyleIds')
        && (!entry.weaponStyleIds || typeof entry.weaponStyleIds !== 'object' || Array.isArray(entry.weaponStyleIds))) return false;
    if (entry.weaponStyleIds && typeof entry.weaponStyleIds === 'object' && !Array.isArray(entry.weaponStyleIds)) {
        for (const [family, styleId] of Object.entries(entry.weaponStyleIds)) {
            if (!ARCADE_WEAPON_STYLE_FAMILIES.includes(family)
                || typeof styleId !== 'string'
                || !ARCADE_WEAPON_STYLE_IDS.includes(styleId.trim().toLowerCase())) return false;
        }
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'partStyle')
        && (!entry.partStyle || typeof entry.partStyle !== 'object' || Array.isArray(entry.partStyle))) return false;
    if (entry.partStyle && typeof entry.partStyle === 'object' && !Array.isArray(entry.partStyle)) {
        for (const value of Object.values(entry.partStyle)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            if (Object.keys(value).some((field) => !['color', 'scale', 'variant'].includes(field))) return false;
            if (Object.prototype.hasOwnProperty.call(value, 'color')) {
                const color = value.color;
                const isHexColor = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
                const isNumericColor = typeof color === 'number' && Number.isInteger(color);
                if (!isHexColor && !isNumericColor) return false;
                const numericColor = typeof color === 'number' ? color : Number.parseInt(color.slice(1), 16);
                if (numericColor < 0 || numericColor > 0xffffff) return false;
            }
            if (Object.prototype.hasOwnProperty.call(value, 'scale')
                && (typeof value.scale !== 'number' || !Number.isFinite(value.scale))) return false;
            if (Object.prototype.hasOwnProperty.call(value, 'variant') && typeof value.variant !== 'string') return false;
        }
    }
    return true;
}

export function readArcadeVehicleProfileRecord(rawProfiles) {
    if (!rawProfiles || typeof rawProfiles !== 'object' || Array.isArray(rawProfiles)) {
        return { profiles: {}, preservedProfiles: {}, preservedCosmeticProfiles: {}, shouldPersist: false, canPersist: false };
    }

    const normalizedProfiles = {};
    const preservedProfiles = {};
    const preservedCosmeticProfiles = {};
    let shouldPersist = false;
    Object.entries(rawProfiles).forEach(([vehicleId, entry]) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            preservedProfiles[vehicleId] = cloneProfileValue(entry);
            return;
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'schemaVersion')
            && (typeof entry.schemaVersion !== 'string' || !entry.schemaVersion.trim())) {
            preservedProfiles[vehicleId] = cloneProfileValue(entry);
            return;
        }
        const versionState = resolveArtifactVersionState(entry, {
            artifactType: 'arcade-vehicle-profile',
            versionFields: ARCADE_VEHICLE_PROFILE_VERSION_FIELDS,
            supportedVersions: ARCADE_VEHICLE_PROFILE_SUPPORTED_SCHEMAS,
            fallbackVersions: ARCADE_VEHICLE_PROFILE_FALLBACK_SCHEMAS,
            currentVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
            allowMissingVersion: true,
        });
        if (versionState.shouldReject) {
            // Keep future or otherwise unsupported records opaque. A newer game may
            // understand fields this version must not overwrite with a fresh profile.
            preservedProfiles[vehicleId] = cloneProfileValue(entry);
            return;
        }
        if (!hasValidStoredProfileFieldTypes(entry)) {
            // Invalid progress or structural types remain opaque so defaults never
            // replace values that cannot safely be interpreted.
            preservedProfiles[vehicleId] = cloneProfileValue(entry);
            return;
        }
        const embeddedVehicleId = String(entry.vehicleId || '').trim();
        if (embeddedVehicleId && embeddedVehicleId.toLowerCase() !== String(vehicleId).trim().toLowerCase()) {
            preservedProfiles[vehicleId] = cloneProfileValue(entry);
            return;
        }
        const normalized = normalizeArcadeVehicleProfileRecord(vehicleId, entry);
        normalizedProfiles[vehicleId] = normalized;
        const preserveCosmetics = !hasValidStoredCosmeticFields(entry);
        if (preserveCosmetics) {
            // Keep the unknown or damaged selections as storage data while exposing
            // normalized fallback cosmetics alongside usable progression at runtime.
            preservedCosmeticProfiles[vehicleId] = cloneProfileValue(entry);
        }
        if (
            versionState.shouldFallback
            || versionState.shouldUpgrade
            || String(entry.vehicleId || vehicleId) !== normalized.vehicleId
            || entry.schemaVersion !== ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION
            || (!preserveCosmetics && (
                entry.trailStyleId !== normalized.trailStyleId
                || JSON.stringify(entry.weaponStyleIds) !== JSON.stringify(normalized.weaponStyleIds)
            ))
        ) {
            shouldPersist = true;
        }
    });

    return {
        profiles: normalizedProfiles,
        preservedProfiles,
        preservedCosmeticProfiles,
        shouldPersist,
        canPersist: true,
    };
}

export function loadArcadeVehicleProfileRecord(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') {
        return { profiles: {}, preservedProfiles: {}, preservedCosmeticProfiles: {}, shouldPersist: false, canPersist: false, usedLegacyFallback: false };
    }
    const readRecord = (key, fallback) => {
        if (typeof store.readJsonRecordResult === 'function') {
            const result = store.readJsonRecordResult(key);
            if (result?.status === 'found') return { status: 'found', value: result.value };
            if (result?.status === 'missing') return { status: 'missing', value: fallback };
            return { status: result?.status || 'read_failed', value: undefined };
        }
        const value = store.loadJsonRecord(key, fallback);
        return value === null || value === undefined
            ? { status: 'missing', value: fallback }
            : { status: 'found', value };
    };
    const current = readRecord(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, null);
    if (!['found', 'missing'].includes(current.status)) {
        return { profiles: {}, preservedProfiles: {}, preservedCosmeticProfiles: {}, shouldPersist: false, canPersist: false, usedLegacyFallback: false };
    }
    const usedLegacyFallback = current.status === 'missing';
    const legacy = usedLegacyFallback
        ? readRecord(ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY, {})
        : null;
    if (legacy && !['found', 'missing'].includes(legacy.status)) {
        return { profiles: {}, preservedProfiles: {}, preservedCosmeticProfiles: {}, shouldPersist: false, canPersist: false, usedLegacyFallback: true };
    }
    const rawProfiles = usedLegacyFallback ? legacy.value : current.value;
    return {
        ...readArcadeVehicleProfileRecord(rawProfiles),
        usedLegacyFallback,
    };
}

export function getArcadeVehicleProfileRecord(profiles, vehicleId, nowMs = Date.now()) {
    const map = profiles && typeof profiles === 'object' ? profiles : {};
    const key = String(vehicleId || 'ship1');
    if (map[key] && typeof map[key] === 'object') return map[key];
    return createArcadeVehicleProfileRecord(key, nowMs);
}
