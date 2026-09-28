import { resolveArtifactVersionState } from './ArtifactVersionMigrationContract.js';
import { normalizeVehiclePartStyle } from './VehiclePartStyleContract.js';

// v3 (Paket 1): levels have no ceiling. Records of any other schema are dropped
// without migration and the vehicle starts fresh. The storage key keeps its v2
// suffix on purpose: the key is only the location, schemaVersion decides validity.
export const ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION = 'arcade-vehicle-profile.v3';
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
const ARCADE_VEHICLE_PROFILE_SUPPORTED_SCHEMAS = Object.freeze([ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION]);

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
    };
}

export function readArcadeVehicleProfileRecord(rawProfiles) {
    if (!rawProfiles || typeof rawProfiles !== 'object' || Array.isArray(rawProfiles)) {
        return { profiles: {}, shouldPersist: false };
    }

    const normalizedProfiles = {};
    let shouldPersist = false;
    Object.entries(rawProfiles).forEach(([vehicleId, entry]) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            shouldPersist = true;
            return;
        }
        const versionState = resolveArtifactVersionState(entry, {
            artifactType: 'arcade-vehicle-profile',
            versionFields: ARCADE_VEHICLE_PROFILE_VERSION_FIELDS,
            supportedVersions: ARCADE_VEHICLE_PROFILE_SUPPORTED_SCHEMAS,
            currentVersion: ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
        });
        if (versionState.shouldReject) {
            shouldPersist = true;
            return;
        }
        const normalized = normalizeArcadeVehicleProfileRecord(vehicleId, entry);
        normalizedProfiles[vehicleId] = normalized;
        if (
            versionState.shouldFallback
            || versionState.shouldUpgrade
            || String(entry.vehicleId || vehicleId) !== normalized.vehicleId
            || entry.schemaVersion !== ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION
            || entry.trailStyleId !== normalized.trailStyleId
            || JSON.stringify(entry.weaponStyleIds) !== JSON.stringify(normalized.weaponStyleIds)
        ) {
            shouldPersist = true;
        }
    });

    return {
        profiles: normalizedProfiles,
        shouldPersist,
    };
}

export function loadArcadeVehicleProfileRecord(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') {
        return { profiles: {}, shouldPersist: false, usedLegacyFallback: false };
    }
    const current = store.loadJsonRecord(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, null);
    const usedLegacyFallback = current === null || current === undefined;
    const rawProfiles = usedLegacyFallback
        ? store.loadJsonRecord(ARCADE_VEHICLE_PROFILE_LEGACY_STORAGE_KEY, {})
        : current;
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
