import { ARCADE_COLOR_PALETTE, ARCADE_COLOR_REQUIREMENTS, listUnlockedArcadeColors } from './ArcadeColorProgressContract.js';
import {
    ARCADE_WEAPON_STYLE_FAMILIES,
    normalizeArcadeTrailStyleId,
    normalizeArcadeWeaponStyleId,
    normalizeArcadeWeaponStyleIds,
} from './ArcadeVehicleProfileContract.js';

export { ARCADE_WEAPON_STYLE_FAMILIES };

export const ARCADE_COSMETIC_COLORS = ARCADE_COLOR_PALETTE;

export const ARCADE_TRAIL_STYLE_UNLOCKS = ARCADE_COLOR_REQUIREMENTS;

export const ARCADE_WEAPON_STYLE_UNLOCKS = ARCADE_COLOR_REQUIREMENTS;

export const ARCADE_TRAIL_STYLE_LABELS = Object.freeze({standard:'Standard',frost:'Frost',ember:'Ember',ion:'Ion',solar:'Solar',violet:'Violet',prism:'Prism'});

export const ARCADE_WEAPON_STYLE_LABELS = ARCADE_TRAIL_STYLE_LABELS;

export const ARCADE_WEAPON_FAMILY_LABELS = Object.freeze({
    mg: 'Maschinengewehr', rockets: 'Raketen', flamethrower: 'Flammenwerfer',
    railgun: 'Railgun', lightning: 'Blitz',
});

const STANDARD_WEAPON_STYLES = Object.freeze(normalizeArcadeWeaponStyleIds());
const STANDARD_WEAPON_COLORS = Object.freeze([]);
const WEAPON_COLOR_SEQUENCES = Object.freeze({
    ...Object.fromEntries(Object.entries(ARCADE_COLOR_PALETTE).map(([id,color])=>[id,Object.freeze([color])])),
    prism: Object.freeze([ARCADE_COSMETIC_COLORS.ion,ARCADE_COSMETIC_COLORS.violet]),
});

function updatedAt(nowMs) {
    return new Date(Math.max(0, Number(nowMs) || Date.now())).toISOString();
}

export function listUnlockedArcadeTrailStyles(profileOrLevel, colorRecord = null) {
    return listUnlockedArcadeColors(colorRecord);
}
export function listUnlockedArcadeWeaponStyles(profileOrLevel, familyId, colorRecord = null) {
    return ARCADE_WEAPON_STYLE_FAMILIES.includes(String(familyId || '').toLowerCase()) ? listUnlockedArcadeColors(colorRecord) : [];
}

export function selectArcadeTrailStyle(profile, requestedStyleId, nowMs = Date.now(), colorRecord = null) {
    const styleId = normalizeArcadeTrailStyleId(requestedStyleId);
    const current = profile && typeof profile === 'object' ? profile : {};
    if (!listUnlockedArcadeColors(colorRecord).includes(styleId)) {
        return { ok: false, code: 'color_locked', requirement: ARCADE_TRAIL_STYLE_UNLOCKS[styleId], profile: current };
    }
    return {
        ok: true,
        code: 'selected',
        requirement: ARCADE_TRAIL_STYLE_UNLOCKS[styleId],
        profile: { ...current, trailStyleId: styleId, updatedAt: updatedAt(nowMs) },
    };
}

export function selectArcadeWeaponStyle(profile, requestedFamilyId, requestedStyleId, nowMs = Date.now(), colorRecord = null) {
    const familyId = String(requestedFamilyId || '').trim().toLowerCase();
    const current = profile && typeof profile === 'object' ? profile : {};
    if (!ARCADE_WEAPON_STYLE_FAMILIES.includes(familyId)) {
        return { ok: false, code: 'invalid_family', profile: current };
    }
    const styleId = normalizeArcadeWeaponStyleId(requestedStyleId);
    if (!listUnlockedArcadeColors(colorRecord).includes(styleId)) {
        return { ok: false, code: 'color_locked', requirement: ARCADE_WEAPON_STYLE_UNLOCKS[styleId], profile: current };
    }
    return {
        ok: true,
        code: 'selected',
        requirement: ARCADE_WEAPON_STYLE_UNLOCKS[styleId],
        profile: {
            ...current,
            weaponStyleIds: { ...normalizeArcadeWeaponStyleIds(current.weaponStyleIds), [familyId]: styleId },
            updatedAt: updatedAt(nowMs),
        },
    };
}

export function resolveArcadeCosmeticLoadout({ arcadeEnabled = false, isBot = false, profile = null, colorRecord = null } = {}) {
    if (!arcadeEnabled || isBot || !profile || typeof profile !== 'object') {
        return { trailStyleId: 'standard', weaponStyleIds: { ...STANDARD_WEAPON_STYLES } };
    }
    const unlockedTrails = listUnlockedArcadeTrailStyles(profile, colorRecord);
    const requestedTrail = normalizeArcadeTrailStyleId(profile.trailStyleId);
    const weaponStyleIds = normalizeArcadeWeaponStyleIds(profile.weaponStyleIds);
    for (const familyId of ARCADE_WEAPON_STYLE_FAMILIES) {
        if (!listUnlockedArcadeWeaponStyles(profile, familyId, colorRecord).includes(weaponStyleIds[familyId])) {
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

export function applyArcadeCosmeticLoadoutToPlayer(player, profile, arcadeEnabled = false, colorRecord = null) {
    if (!player || typeof player !== 'object') return null;
    const loadout = resolveArcadeCosmeticLoadout({
        arcadeEnabled,
        isBot: player.isBot === true,
        profile, colorRecord,
    });
    player.arcadeCosmeticLoadout = loadout;
    player.trail?.setCosmeticStyle?.(loadout.trailStyleId);
    return loadout;
}
