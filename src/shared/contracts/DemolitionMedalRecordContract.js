import { resolveDemolitionMapProfile } from './DemolitionContract.js';

// Per-profile best demolition result for each map; the player record store scopes this key per profile.
export const DEMOLITION_MEDAL_RECORD_STORAGE_KEY = 'cuviosclash.arcade-demolition-medals.v1';
export const DEMOLITION_MEDAL_RECORD_VERSION = 1;

/** Worst to best; '' means the map was finished below bronze. */
export const DEMOLITION_MEDAL_ORDER = Object.freeze(['', 'bronze', 'silver', 'gold']);
const MEDAL_LABELS = Object.freeze({ bronze: 'Bronze', silver: 'Silber', gold: 'Gold' });
const MAP_KEY_PATTERN = /^[a-z0-9_]{1,64}$/;

function medalRank(medal) {
    return Math.max(0, DEMOLITION_MEDAL_ORDER.indexOf(String(medal || '')));
}

function normalizeEntry(value) {
    const medal = DEMOLITION_MEDAL_ORDER[medalRank(value?.medal)];
    const score = Number(value?.bestScore);
    return { medal, bestScore: Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0 };
}

/**
 * Broken, missing or foreign data becomes an empty record; unknown map keys of a safe shape survive
 * so a newer build's maps are not lost when an older build saves.
 * @returns {{version: number, maps: Record<string, {medal: string, bestScore: number}>}}
 */
export function normalizeDemolitionMedalRecord(value) {
    /** @type {Record<string, {medal: string, bestScore: number}>} */
    const maps = {};
    const source = value && typeof value === 'object' && !Array.isArray(value)
        && value.version === DEMOLITION_MEDAL_RECORD_VERSION ? value.maps : null;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
        for (const [mapKey, entry] of Object.entries(source)) {
            if (!MAP_KEY_PATTERN.test(mapKey) || !entry || typeof entry !== 'object') continue;
            maps[mapKey] = normalizeEntry(entry);
        }
    }
    return { version: DEMOLITION_MEDAL_RECORD_VERSION, maps };
}

/** Only an absent record or one of this version may be saved over; a newer or foreign shape is left alone. */
export function isWritableDemolitionMedalRecord(value) {
    if (value === null || value === undefined) return true;
    return typeof value === 'object' && !Array.isArray(value) && value.version === DEMOLITION_MEDAL_RECORD_VERSION;
}

/** Medal and score each keep their best value: a weaker result never replaces a stronger one. */
export function mergeDemolitionMedalResult(record, { mapKey = '', medal = '', score = 0 } = {}) {
    const normalized = normalizeDemolitionMedalRecord(record);
    const key = String(mapKey || '').trim();
    if (!MAP_KEY_PATTERN.test(key)) return { record: normalized, changed: false };
    const previous = normalized.maps[key] || { medal: '', bestScore: 0 };
    const incoming = normalizeEntry({ medal, bestScore: score });
    const next = {
        medal: medalRank(incoming.medal) > medalRank(previous.medal) ? incoming.medal : previous.medal,
        bestScore: Math.max(previous.bestScore, incoming.bestScore),
    };
    const changed = !normalized.maps[key] || next.medal !== previous.medal || next.bestScore !== previous.bestScore;
    normalized.maps[key] = next;
    return { record: normalized, changed };
}

/** "Beste Medaillen: Eiffelturm Gold · Skyline Silber", or '' when no medal was won yet. */
export function formatDemolitionBestMedalsLine(record) {
    const parts = Object.entries(normalizeDemolitionMedalRecord(record).maps)
        .filter(([, entry]) => entry.medal)
        .map(([mapKey, entry]) => `${resolveDemolitionMapProfile(mapKey)?.label || mapKey} ${MEDAL_LABELS[entry.medal]}`);
    return parts.length ? `Beste Medaillen: ${parts.join(' · ')}` : '';
}
