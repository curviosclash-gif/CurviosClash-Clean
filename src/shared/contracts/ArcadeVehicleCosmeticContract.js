import {
    ARCADE_TRAIL_STYLE_IDS,
    ARCADE_WEAPON_STYLE_FAMILIES,
    ARCADE_WEAPON_STYLE_IDS,
    normalizeArcadeTrailStyleId,
    normalizeArcadeWeaponStyleId,
    normalizeArcadeWeaponStyleIds,
} from './ArcadeVehicleProfileContract.js';

export { ARCADE_WEAPON_STYLE_FAMILIES };

export const ARCADE_COSMETIC_COLORS = Object.freeze({
    ion: 0x48d7ff,
    ember: 0xff7a3d,
    acid: 0x8cff4d,
    violet: 0xc678ff,
    frost: 0xbfefff,
    solar: 0xffd45a,
});

export const ARCADE_TRAIL_STYLE_UNLOCKS = Object.freeze({
    standard: 1,
    ion: 4,
    ember: 7,
    acid: 10,
    violet: 13,
    frost: 17,
    solar: 22,
    prism: 28,
});

export const ARCADE_WEAPON_STYLE_UNLOCKS = Object.freeze({
    standard: 1,
    ion: 5,
    ember: 12,
    nova: 20,
});

export const ARCADE_TRAIL_STYLE_LABELS = Object.freeze({
    standard: 'Standard', ion: 'Ion', ember: 'Ember', acid: 'Acid',
    violet: 'Violet', frost: 'Frost', solar: 'Solar', prism: 'Prism',
});

export const ARCADE_WEAPON_STYLE_LABELS = Object.freeze({
    standard: 'Standard', ion: 'Ion', ember: 'Ember', nova: 'Nova',
});

export const ARCADE_WEAPON_FAMILY_LABELS = Object.freeze({
    mg: 'Maschinengewehr', rockets: 'Raketen', flamethrower: 'Flammenwerfer',
    railgun: 'Railgun', lightning: 'Blitz',
});

const STANDARD_WEAPON_STYLES = Object.freeze(normalizeArcadeWeaponStyleIds());
const STANDARD_WEAPON_COLORS = Object.freeze([]);
const NOVA_WEAPON_COLORS = Object.freeze([
    ARCADE_COSMETIC_COLORS.violet,
    ARCADE_COSMETIC_COLORS.solar,
]);
const WEAPON_COLOR_SEQUENCES = Object.freeze({
    ion: Object.freeze([ARCADE_COSMETIC_COLORS.ion]),
    ember: Object.freeze([ARCADE_COSMETIC_COLORS.ember]),
    nova: NOVA_WEAPON_COLORS,
});

function resolveLevel(profileOrLevel) {
    const value = typeof profileOrLevel === 'object' ? profileOrLevel?.level : profileOrLevel;
    return Math.max(1, Math.min(30, Math.floor(Number(value) || 1)));
}

function updatedAt(nowMs) {
    return new Date(Math.max(0, Number(nowMs) || Date.now())).toISOString();
}

export function listUnlockedArcadeTrailStyles(profileOrLevel) {
    const level = resolveLevel(profileOrLevel);
    return ARCADE_TRAIL_STYLE_IDS.filter((styleId) => level >= ARCADE_TRAIL_STYLE_UNLOCKS[styleId]);
}

export function listUnlockedArcadeWeaponStyles(profileOrLevel, familyId) {
    if (!ARCADE_WEAPON_STYLE_FAMILIES.includes(String(familyId || '').toLowerCase())) return [];
    const level = resolveLevel(profileOrLevel);
    return ARCADE_WEAPON_STYLE_IDS.filter((styleId) => level >= ARCADE_WEAPON_STYLE_UNLOCKS[styleId]);
}

export function selectArcadeTrailStyle(profile, requestedStyleId, nowMs = Date.now()) {
    const styleId = normalizeArcadeTrailStyleId(requestedStyleId);
    const current = profile && typeof profile === 'object' ? profile : {};
    if (resolveLevel(current) < ARCADE_TRAIL_STYLE_UNLOCKS[styleId]) {
        return { ok: false, code: 'level_locked', requiredLevel: ARCADE_TRAIL_STYLE_UNLOCKS[styleId], profile: current };
    }
    return {
        ok: true,
        code: 'selected',
        requiredLevel: ARCADE_TRAIL_STYLE_UNLOCKS[styleId],
        profile: { ...current, trailStyleId: styleId, updatedAt: updatedAt(nowMs) },
    };
}

export function selectArcadeWeaponStyle(profile, requestedFamilyId, requestedStyleId, nowMs = Date.now()) {
    const familyId = String(requestedFamilyId || '').trim().toLowerCase();
    const current = profile && typeof profile === 'object' ? profile : {};
    if (!ARCADE_WEAPON_STYLE_FAMILIES.includes(familyId)) {
        return { ok: false, code: 'invalid_family', profile: current };
    }
    const styleId = normalizeArcadeWeaponStyleId(requestedStyleId);
    if (resolveLevel(current) < ARCADE_WEAPON_STYLE_UNLOCKS[styleId]) {
        return { ok: false, code: 'level_locked', requiredLevel: ARCADE_WEAPON_STYLE_UNLOCKS[styleId], profile: current };
    }
    return {
        ok: true,
        code: 'selected',
        requiredLevel: ARCADE_WEAPON_STYLE_UNLOCKS[styleId],
        profile: {
            ...current,
            weaponStyleIds: { ...normalizeArcadeWeaponStyleIds(current.weaponStyleIds), [familyId]: styleId },
            updatedAt: updatedAt(nowMs),
        },
    };
}

export function resolveArcadeCosmeticLoadout({ arcadeEnabled = false, isBot = false, profile = null } = {}) {
    if (!arcadeEnabled || isBot || !profile || typeof profile !== 'object') {
        return { trailStyleId: 'standard', weaponStyleIds: { ...STANDARD_WEAPON_STYLES } };
    }
    const unlockedTrails = listUnlockedArcadeTrailStyles(profile);
    const requestedTrail = normalizeArcadeTrailStyleId(profile.trailStyleId);
    const weaponStyleIds = normalizeArcadeWeaponStyleIds(profile.weaponStyleIds);
    for (const familyId of ARCADE_WEAPON_STYLE_FAMILIES) {
        if (!listUnlockedArcadeWeaponStyles(profile, familyId).includes(weaponStyleIds[familyId])) {
            weaponStyleIds[familyId] = 'standard';
        }
    }
    return {
        trailStyleId: unlockedTrails.includes(requestedTrail) ? requestedTrail : 'standard',
        weaponStyleIds,
    };
}

export function resolveArcadeTrailColor(styleId, playerColor, sequenceIndex = 0) {
    const normalized = normalizeArcadeTrailStyleId(styleId);
    if (normalized === 'standard') return Number(playerColor) || 0xffffff;
    if (normalized === 'prism') {
        return Math.abs(Math.floor(Number(sequenceIndex) || 0)) % 2 === 0
            ? ARCADE_COSMETIC_COLORS.ion
            : ARCADE_COSMETIC_COLORS.violet;
    }
    return ARCADE_COSMETIC_COLORS[normalized] || (Number(playerColor) || 0xffffff);
}

export function resolveArcadeWeaponColors(styleId) {
    const normalized = normalizeArcadeWeaponStyleId(styleId);
    return WEAPON_COLOR_SEQUENCES[normalized] || STANDARD_WEAPON_COLORS;
}

export function resolveArcadeWeaponColor(styleId, sequenceIndex = 0, fallbackColor = 0xffffff) {
    const colors = resolveArcadeWeaponColors(styleId);
    if (!colors.length) return fallbackColor;
    return colors[Math.abs(Math.floor(Number(sequenceIndex) || 0)) % colors.length];
}

export function nextPlayerArcadeWeaponColor(player, familyId, fallbackColor = 0xffffff) {
    const styleId = player?.arcadeCosmeticLoadout?.weaponStyleIds?.[familyId] || 'standard';
    if (styleId === 'standard') return fallbackColor;
    if (!player._arcadeCosmeticSequenceByFamily) player._arcadeCosmeticSequenceByFamily = Object.create(null);
    const sequence = Math.max(0, Number(player._arcadeCosmeticSequenceByFamily[familyId]) || 0);
    player._arcadeCosmeticSequenceByFamily[familyId] = sequence + 1;
    return resolveArcadeWeaponColor(styleId, sequence, fallbackColor);
}

export function applyArcadeCosmeticLoadoutToPlayer(player, profile, arcadeEnabled = false) {
    if (!player || typeof player !== 'object') return null;
    const loadout = resolveArcadeCosmeticLoadout({
        arcadeEnabled,
        isBot: player.isBot === true,
        profile,
    });
    player.arcadeCosmeticLoadout = loadout;
    player.trail?.setCosmeticStyle?.(loadout.trailStyleId);
    return loadout;
}
