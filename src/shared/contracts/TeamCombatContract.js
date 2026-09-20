export const TEAM_IDS = Object.freeze({
    ALPHA: 'ALPHA',
    BRAVO: 'BRAVO',
});

// Team presentation deliberately reuses the established two-player split-screen identity:
// PLAYER_1 is blue, PLAYER_2 is orange. Every team surface resolves through this contract so
// vehicles, trails, objectives and HUD labels cannot drift apart again.
export const TEAM_COLORS = Object.freeze({
    [TEAM_IDS.ALPHA]: 0x00aaff,
    [TEAM_IDS.BRAVO]: 0xff8800,
});

export const TEAM_LABELS = Object.freeze({
    [TEAM_IDS.ALPHA]: 'Team Blau',
    [TEAM_IDS.BRAVO]: 'Team Orange',
});

export const TEAM_WEAPON_KINDS = Object.freeze({
    MACHINE_GUN: 'MACHINE_GUN',
    TRAIL: 'TRAIL',
    ROCKET: 'ROCKET',
    ITEM_PROJECTILE: 'ITEM_PROJECTILE',
});

/** @type {Set<string>} */
const FRIENDLY_FIRE_WEAPONS = new Set([
    TEAM_WEAPON_KINDS.MACHINE_GUN,
    TEAM_WEAPON_KINDS.TRAIL,
]);

export function normalizeTeamId(value, fallback = null) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === TEAM_IDS.ALPHA || normalized === TEAM_IDS.BRAVO) return normalized;
    return fallback;
}

export function resolveTeamColor(teamId, fallback = null) {
    const normalized = normalizeTeamId(teamId);
    return normalized ? TEAM_COLORS[normalized] : fallback;
}

export function resolveTeamLabel(teamId, fallback = '') {
    const normalized = normalizeTeamId(teamId);
    return normalized ? TEAM_LABELS[normalized] : fallback;
}

export function resolveBalancedTeamId(playerIndex) {
    const index = Math.max(0, Math.trunc(Number(playerIndex) || 0));
    return index % 2 === 0 ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO;
}

export function areTeammates(first, second) {
    const firstTeam = normalizeTeamId(first?.teamId);
    return firstTeam !== null && firstTeam === normalizeTeamId(second?.teamId);
}

export function canTargetEnemy(source, target) {
    return !!target && source !== target && !areTeammates(source, target);
}

export function canDamage(attacker, target, weaponKind) {
    if (!attacker || !target || !areTeammates(attacker, target)) return true;
    return FRIENDLY_FIRE_WEAPONS.has(String(weaponKind || '').trim().toUpperCase());
}
