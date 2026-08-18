// Every death used to spawn the same burst, so the game's loudest moment was
// also its least expressive one: a wall death and a mega rocket kill were
// visually identical. This resolves the single factor that scales the whole
// death effect, read from HUNT.FEEDBACK.DEATH_EXPLOSION so the tuning lives
// next to every other feedback effect instead of inside the particle system.

const DEFAULT_MIN_SCALE = 0.6;
const DEFAULT_MAX_SCALE = 1.6;

function toPositiveNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/**
 * Combines the death cause with the projectile that delivered it into one
 * multiplier. Unknown causes and non-projectile deaths resolve to 1, so a
 * missing config section leaves the baseline burst untouched rather than
 * collapsing it.
 *
 * @param {object|null} feedback - The DEATH_EXPLOSION config section.
 * @param {string|null} cause - Death cause, e.g. WALL, PLAYER_CRASH, PROJECTILE.
 * @param {string|null} projectileType - Projectile type, e.g. ROCKET_MEGA.
 * @returns {number} The clamped scale factor.
 */
export function resolveDeathExplosionScale(feedback, cause, projectileType) {
    const causeKey = String(cause || '').toUpperCase();
    const projectileKey = String(projectileType || '').toUpperCase();
    const causeScale = toPositiveNumber(feedback?.causeScale?.[causeKey], 1);
    const projectileScale = toPositiveNumber(feedback?.projectileScale?.[projectileKey], 1);
    const minScale = toPositiveNumber(feedback?.minScale, DEFAULT_MIN_SCALE);
    const maxScale = Math.max(minScale, toPositiveNumber(feedback?.maxScale, DEFAULT_MAX_SCALE));
    return Math.min(maxScale, Math.max(minScale, causeScale * projectileScale));
}
