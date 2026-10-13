import {
    FREE_PLAY_VARIANTS,
    isMapEligibleForFreePlayVariant,
    normalizeFreePlayMapMemory,
} from './FreePlayVariantContract.js';

export const FREE_PLAY_MAP_CHOICE_CONTRACT_VERSION = 'free-play-map-choice.v1';

/** The random pick leaves out this many of the maps played last, as long as others remain. */
export const FREE_PLAY_RANDOM_RECENT_EXCLUSION = 3;

/** Short names for the counter line; they follow "passen zu". */
export const FREE_PLAY_VARIANT_LABELS = Object.freeze({
    ffa: 'Einzelkampf',
    team: 'Team',
    flags: 'Flaggen',
    escort: 'Eskorte',
    classic: 'Klassisch',
});

/** @param {unknown} variant @returns {variant is string} */
function isFreePlayVariant(variant) {
    return typeof variant === 'string' && FREE_PLAY_VARIANTS.includes(variant);
}

/**
 * Map keys of a catalog that fit a free play variant and pass the picker's own rules.
 * Without a variant (arcade, quick action) nothing is filtered.
 * @param {{ maps?: Record<string, unknown>|null, variant?: string|null, isOffered?: ((mapKey: string) => boolean)|null }} [options]
 * @returns {string[]}
 */
export function listFreePlayEligibleMapKeys({ maps, variant = null, isOffered = null } = {}) {
    const keys = Object.keys(maps && typeof maps === 'object' ? maps : {});
    if (!isFreePlayVariant(variant)) return keys;
    return keys.filter((mapKey) => isMapEligibleForFreePlayVariant(maps?.[mapKey], variant)
        && (typeof isOffered !== 'function' || isOffered(mapKey)));
}

/**
 * Text for the counter beside the map list, e.g. "24 Karten passen zu Flaggen".
 * @param {string|null|undefined} variant
 * @param {number} count
 * @returns {string}
 */
export function describeFreePlayMapCount(variant, count) {
    if (!isFreePlayVariant(variant)) return '';
    const label = FREE_PLAY_VARIANT_LABELS[/** @type {keyof typeof FREE_PLAY_VARIANT_LABELS} */ (variant)];
    const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (total === 0) return `Keine Karte passt zu ${label}`;
    return total === 1 ? `1 Karte passt zu ${label}` : `${total} Karten passen zu ${label}`;
}

/**
 * Returns a copy of the per-variant memory with the map of one variant replaced.
 * @param {unknown} memory
 * @param {unknown} variant
 * @param {unknown} mapKey
 * @returns {Readonly<Record<string, string>>}
 */
export function rememberFreePlayMap(memory, variant, mapKey) {
    const current = normalizeFreePlayMapMemory(memory);
    const key = typeof mapKey === 'string' ? mapKey.trim() : '';
    if (!isFreePlayVariant(variant) || !key) return current;
    return normalizeFreePlayMapMemory({ ...current, [variant]: key });
}

/**
 * Map to show after the variant changed: the remembered one if it still exists and fits,
 * else the current one if it fits, else '' (the caller then uses its normal fallback).
 * Without a variant the current map is returned untouched.
 * @param {{ variant?: string|null, memory?: unknown, maps?: Record<string, unknown>|null, currentMapKey?: string, isOffered?: ((mapKey: string) => boolean)|null }} [options]
 * @returns {string}
 */
export function resolveFreePlayVariantMapKey({ variant = null, memory, maps, currentMapKey = '', isOffered = null } = {}) {
    const current = String(currentMapKey || '').trim();
    if (!isFreePlayVariant(variant)) return current;
    /** @param {string} mapKey */
    const fits = (mapKey) => !!mapKey
        && isMapEligibleForFreePlayVariant(maps?.[mapKey], variant)
        && (typeof isOffered !== 'function' || isOffered(mapKey));
    const remembered = normalizeFreePlayMapMemory(memory)[variant] || '';
    if (fits(remembered)) return remembered;
    return fits(current) ? current : '';
}

/**
 * Random map for the "Zufällige Karte" button. The caller passes the already filtered list
 * (or the favourites alone) and the maps played last, newest first.
 * @param {{ candidates?: unknown[], recentKeys?: unknown[], rng?: (() => number)|null, exclude?: number }} [options]
 * @returns {string} '' when there is nothing to pick from
 */
export function pickRandomFreePlayMapKey({
    candidates = [],
    recentKeys = [],
    rng = null,
    exclude = FREE_PLAY_RANDOM_RECENT_EXCLUSION,
} = {}) {
    /** @type {string[]} */
    const unique = Array.from(new Set((Array.isArray(candidates) ? candidates : [])
        .filter(/** @returns {mapKey is string} */ (mapKey) => typeof mapKey === 'string' && mapKey.trim() !== '')));
    if (unique.length === 0) return '';
    const recent = new Set((Array.isArray(recentKeys) ? recentKeys : []).slice(0, Math.max(0, exclude)));
    const fresh = unique.filter((mapKey) => !recent.has(mapKey));
    const pool = fresh.length > 0 ? fresh : unique;
    const roll = Number(typeof rng === 'function' ? rng() : Math.random());
    const unit = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1) : 0;
    return pool[Math.min(pool.length - 1, Math.floor(unit * pool.length))];
}
