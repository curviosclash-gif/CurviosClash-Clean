export const TEAM_IDS = Object.freeze({
    ALPHA: 'ALPHA',
    BRAVO: 'BRAVO',
});
/** @typedef {'ALPHA' | 'BRAVO'} TeamId */

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

/** @param {unknown} value @param {TeamId | null} [fallback] @returns {TeamId | null} */
export function normalizeTeamId(value, fallback = null) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === TEAM_IDS.ALPHA || normalized === TEAM_IDS.BRAVO) return /** @type {TeamId} */ (normalized);
    return fallback;
}

/** @param {unknown} teamId @param {number | null} [fallback] @returns {number | null} */
export function resolveTeamColor(teamId, fallback = null) {
    const normalized = normalizeTeamId(teamId);
    return normalized ? TEAM_COLORS[normalized] : fallback;
}

/** @param {unknown} teamId @param {string} [fallback] @returns {string} */
export function resolveTeamLabel(teamId, fallback = '') {
    const normalized = normalizeTeamId(teamId);
    return normalized ? TEAM_LABELS[normalized] : fallback;
}

/** @param {unknown} playerIndex @returns {string} */
export function resolveBalancedTeamId(playerIndex) {
    const index = Math.max(0, Math.trunc(Number(playerIndex) || 0));
    return index % 2 === 0 ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO;
}

/**
 * @param {{ teamId?: unknown } | null | undefined} first
 * @param {{ teamId?: unknown } | null | undefined} second
 * @returns {boolean}
 */
export function areTeammates(first, second) {
    const firstTeam = normalizeTeamId(first?.teamId);
    return firstTeam !== null && firstTeam === normalizeTeamId(second?.teamId);
}

/**
 * @param {{ teamId?: unknown } | null | undefined} source
 * @param {{ teamId?: unknown } | null | undefined} target
 * @returns {boolean}
 */
export function canTargetEnemy(source, target) {
    return !!target && source !== target && !areTeammates(source, target);
}

/**
 * @param {{ teamId?: unknown } | null | undefined} attacker
 * @param {{ teamId?: unknown } | null | undefined} target
 * @param {unknown} weaponKind
 * @returns {boolean}
 */
export function canDamage(attacker, target, weaponKind) {
    if (!attacker || !target || !areTeammates(attacker, target)) return true;
    return FRIENDLY_FIRE_WEAPONS.has(String(weaponKind || '').trim().toUpperCase());
}
