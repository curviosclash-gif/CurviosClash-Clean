// Data shape of the post-match scoreboard ("Ergebnistafel").
//
// The round-end coordinator (src/ui) produces this summary, the overlay DOM (src/ui) renders it and
// the match lifecycle carries it through MatchUiStateContract. Producer and renderer therefore need
// one agreed shape, and this file is the only place that defines it.
//
// The point of v2 is the split between value and presentation: a block carries raw numbers plus a
// type ('duration', 'count', ...) instead of an already formatted string like "12,5 s". Only the
// renderer formats, so the same number can be shown differently (table, card, tooltip) and a test
// can assert the number instead of a text. `extra` keeps room for later counters (intercepts,
// destroyed units, burned trail meters) without another version bump.

import { normalizeString } from './ContractNormalizeUtils.js';
import { resolveArtifactVersionState } from './ArtifactVersionMigrationContract.js';

export const POST_MATCH_STATS_CONTRACT_VERSION = 'post-match-stats.v2';
export const POST_MATCH_STATS_LEGACY_CONTRACT_VERSION = 'post-match-stats.v1';
export const POST_MATCH_STATS_VERSION_FIELDS = Object.freeze(['contractVersion']);
export const POST_MATCH_STATS_SUPPORTED_VERSIONS = Object.freeze([POST_MATCH_STATS_CONTRACT_VERSION]);
export const POST_MATCH_STATS_FALLBACK_VERSIONS = Object.freeze([POST_MATCH_STATS_LEGACY_CONTRACT_VERSION]);
export const POST_MATCH_STATS_VERSION_POLICY = Object.freeze({
    currentVersion: POST_MATCH_STATS_CONTRACT_VERSION,
    legacyMissingVersion: 'read-as-v2',
    legacyVersion: 'upgrade-v1-rows-to-text',
    unknownVersion: 'reject-to-empty-summary',
});

export const POST_MATCH_STATS_BLOCK_KINDS = Object.freeze(['standings', 'values']);
export const POST_MATCH_STATS_BLOCK_TIERS = Object.freeze(['primary', 'detail']);
export const POST_MATCH_STATS_VALUE_TYPES = Object.freeze([
    'duration', 'percent', 'count', 'distance', 'ratio', 'text',
]);

export const POST_MATCH_STATS_DEFAULT_BLOCK_KIND = 'values';
export const POST_MATCH_STATS_DEFAULT_BLOCK_TIER = 'primary';
export const POST_MATCH_STATS_DEFAULT_VALUE_TYPE = 'text';

export const POST_MATCH_STATS_LIMITS = Object.freeze({
    maxBlocks: 12,
    maxRowsPerBlock: 40,
    // Every participant is listed (humans plus bots plus arcade waves), so this stays generous.
    maxEntriesPerBlock: 32,
    maxExtraKeys: 24,
    maxIdLength: 64,
    maxLabelLength: 80,
    maxTextLength: 120,
    precision: Object.freeze({ min: 0, max: 3 }),
});

// Per value type: is the value a number, may it go below zero, is it a whole number, and how many
// decimals the renderer should use unless the producer overrides it.
const VALUE_TYPE_RULES = Object.freeze({
    duration: Object.freeze({ numeric: true, allowNegative: false, integer: false, precision: 1 }),
    percent: Object.freeze({ numeric: true, allowNegative: false, integer: false, precision: 0 }),
    count: Object.freeze({ numeric: true, allowNegative: false, integer: true, precision: 0 }),
    distance: Object.freeze({ numeric: true, allowNegative: false, integer: false, precision: 0 }),
    ratio: Object.freeze({ numeric: true, allowNegative: true, integer: false, precision: 1 }),
    text: Object.freeze({ numeric: false, allowNegative: true, integer: false, precision: 0 }),
});

/**
 * @typedef {'standings'|'values'} PostMatchBlockKind
 * @typedef {'primary'|'detail'} PostMatchBlockTier
 * @typedef {'duration'|'percent'|'count'|'distance'|'ratio'|'text'} PostMatchValueType
 */

/**
 * @typedef {object} PostMatchValueRow
 * @property {string} key stable row id, also used as `data-stats-row-key`
 * @property {string} label human readable caption
 * @property {number|string} value raw number, or plain text for `type: 'text'`
 * @property {PostMatchValueType} type tells the renderer how to format `value`
 * @property {number} precision decimals the renderer should use
 */

/**
 * @typedef {object} PostMatchStandingsEntry
 * @property {number} playerIndex
 * @property {string} label
 * @property {boolean} isBot
 * @property {boolean} isLocal
 * @property {string} color css color of the player, or '' when unknown
 * @property {number} roundWins
 * @property {number} requiredWins
 * @property {boolean} isRoundWinner
 * @property {boolean} isMatchPoint
 * @property {number|null} kills
 * @property {number|null} deaths
 * @property {number|null} assists
 * @property {Record<string, number>} extra open counters, kept as raw finite numbers
 */

/**
 * @typedef {object} PostMatchStatsBlock
 * @property {string} id
 * @property {string} title
 * @property {PostMatchBlockKind} kind
 * @property {PostMatchBlockTier} tier
 * @property {PostMatchValueRow[]} rows filled for `kind: 'values'`
 * @property {PostMatchStandingsEntry[]} entries filled for `kind: 'standings'`
 */

/**
 * @typedef {object} PostMatchStatsSummary
 * @property {string} contractVersion
 * @property {boolean} visible
 * @property {PostMatchStatsBlock[]} blocks
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeCappedString(value, maxLength, fallback = '') {
    return normalizeString(value, fallback).slice(0, maxLength);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeNonNegativeInt(value) {
    return Math.max(0, Math.trunc(toFiniteNumber(value, 0)));
}

/**
 * Optional counters stay `null` when the producer has nothing to say, so the renderer can tell
 * "no kill tracking in this mode" apart from "zero kills".
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeOptionalCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
}

/**
 * Accepts a css hex string or a numeric three.js color; anything else becomes ''.
 * @param {unknown} value
 * @returns {string}
 */
function normalizePlayerColor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
        return `#${clamped.toString(16).padStart(6, '0')}`;
    }
    const text = normalizeString(value, '').toLowerCase();
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text) ? text : '';
}

/**
 * @param {unknown} value
 * @returns {PostMatchValueType}
 */
function normalizeValueType(value) {
    const text = normalizeString(value, '');
    return /** @type {PostMatchValueType} */ (
        POST_MATCH_STATS_VALUE_TYPES.includes(text) ? text : POST_MATCH_STATS_DEFAULT_VALUE_TYPE
    );
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePrecision(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const { min, max } = POST_MATCH_STATS_LIMITS.precision;
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

/**
 * @param {unknown} value
 * @param {PostMatchValueType} type
 * @returns {number|string}
 */
function normalizeRowValue(value, type) {
    const rule = VALUE_TYPE_RULES[type];
    if (!rule.numeric) {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? String(value) : '';
        }
        if (typeof value === 'boolean') return String(value);
        return normalizeCappedString(value, POST_MATCH_STATS_LIMITS.maxTextLength);
    }
    let numeric = toFiniteNumber(value, 0);
    if (!rule.allowNegative) numeric = Math.max(0, numeric);
    return rule.integer ? Math.trunc(numeric) : numeric;
}

/**
 * @param {unknown} source
 * @returns {PostMatchValueRow|null}
 */
export function createPostMatchValueRow(source) {
    if (!isPlainObject(source)) return null;
    const key = normalizeCappedString(source.key, POST_MATCH_STATS_LIMITS.maxIdLength);
    if (!key) return null;
    const type = normalizeValueType(source.type);
    return {
        key,
        label: normalizeCappedString(source.label, POST_MATCH_STATS_LIMITS.maxLabelLength),
        value: normalizeRowValue(source.value, type),
        type,
        precision: normalizePrecision(source.precision, VALUE_TYPE_RULES[type].precision),
    };
}

/**
 * @param {unknown} source
 * @returns {Record<string, number>}
 */
function normalizeExtraCounters(source) {
    /** @type {Record<string, number>} */
    const extra = {};
    if (!isPlainObject(source)) return extra;
    let used = 0;
    for (const [rawKey, rawValue] of Object.entries(source)) {
        if (used >= POST_MATCH_STATS_LIMITS.maxExtraKeys) break;
        const key = normalizeCappedString(rawKey, POST_MATCH_STATS_LIMITS.maxIdLength);
        if (!key || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue;
        extra[key] = rawValue;
        used += 1;
    }
    return extra;
}

/**
 * @param {unknown} source
 * @returns {PostMatchStandingsEntry}
 */
export function createPostMatchStandingsEntry(source) {
    const input = isPlainObject(source) ? source : {};
    return {
        playerIndex: normalizeNonNegativeInt(input.playerIndex),
        label: normalizeCappedString(input.label, POST_MATCH_STATS_LIMITS.maxLabelLength),
        isBot: input.isBot === true,
        isLocal: input.isLocal === true,
        color: normalizePlayerColor(input.color),
        roundWins: normalizeNonNegativeInt(input.roundWins),
        requiredWins: Math.max(1, Math.trunc(toFiniteNumber(input.requiredWins, 1))),
        isRoundWinner: input.isRoundWinner === true,
        isMatchPoint: input.isMatchPoint === true,
        kills: normalizeOptionalCount(input.kills),
        deaths: normalizeOptionalCount(input.deaths),
        assists: normalizeOptionalCount(input.assists),
        extra: normalizeExtraCounters(input.extra),
    };
}

/**
 * @param {unknown} source
 * @returns {PostMatchValueRow[]}
 */
function normalizeBlockRows(source) {
    if (!Array.isArray(source)) return [];
    /** @type {PostMatchValueRow[]} */
    const rows = [];
    const seen = new Set();
    for (const entry of source) {
        if (rows.length >= POST_MATCH_STATS_LIMITS.maxRowsPerBlock) break;
        const row = createPostMatchValueRow(entry);
        if (!row || seen.has(row.key)) continue;
        seen.add(row.key);
        rows.push(row);
    }
    return rows;
}

/**
 * @param {unknown} source
 * @returns {PostMatchStandingsEntry[]}
 */
function normalizeBlockEntries(source) {
    if (!Array.isArray(source)) return [];
    return source
        .slice(0, POST_MATCH_STATS_LIMITS.maxEntriesPerBlock)
        .map((entry) => createPostMatchStandingsEntry(entry));
}

/**
 * A block is dropped when it has no id or no content at all — an empty card is noise on the board.
 * @param {unknown} source
 * @returns {PostMatchStatsBlock|null}
 */
export function createPostMatchBlock(source) {
    if (!isPlainObject(source)) return null;
    const id = normalizeCappedString(source.id, POST_MATCH_STATS_LIMITS.maxIdLength);
    if (!id) return null;
    const kindText = normalizeString(source.kind, '');
    const kind = /** @type {PostMatchBlockKind} */ (
        POST_MATCH_STATS_BLOCK_KINDS.includes(kindText) ? kindText : POST_MATCH_STATS_DEFAULT_BLOCK_KIND
    );
    const tierText = normalizeString(source.tier, '');
    const tier = /** @type {PostMatchBlockTier} */ (
        POST_MATCH_STATS_BLOCK_TIERS.includes(tierText) ? tierText : POST_MATCH_STATS_DEFAULT_BLOCK_TIER
    );
    const rows = kind === 'values' ? normalizeBlockRows(source.rows) : [];
    const entries = kind === 'standings' ? normalizeBlockEntries(source.entries) : [];
    if (rows.length === 0 && entries.length === 0) return null;
    return {
        id,
        title: normalizeCappedString(source.title, POST_MATCH_STATS_LIMITS.maxLabelLength),
        kind,
        tier,
        rows,
        entries,
    };
}

/**
 * @param {unknown} source
 * @returns {PostMatchStatsBlock[]}
 */
function normalizeBlocks(source) {
    if (!Array.isArray(source)) return [];
    /** @type {PostMatchStatsBlock[]} */
    const blocks = [];
    const seen = new Set();
    for (const entry of source) {
        if (blocks.length >= POST_MATCH_STATS_LIMITS.maxBlocks) break;
        const block = createPostMatchBlock(entry);
        if (!block || seen.has(block.id)) continue;
        seen.add(block.id);
        blocks.push(block);
    }
    return blocks;
}

/**
 * @returns {PostMatchStatsSummary}
 */
export function createEmptyPostMatchStats() {
    return {
        contractVersion: POST_MATCH_STATS_CONTRACT_VERSION,
        visible: false,
        blocks: [],
    };
}

/**
 * @param {PostMatchStatsBlock[]} blocks
 * @param {boolean} visible
 * @returns {PostMatchStatsSummary}
 */
function createSummary(blocks, visible) {
    return {
        contractVersion: POST_MATCH_STATS_CONTRACT_VERSION,
        visible: visible && blocks.length > 0,
        blocks,
    };
}

/**
 * @param {unknown} payload
 * @returns {ReturnType<typeof resolveArtifactVersionState>}
 */
export function classifyPostMatchStatsVersion(payload) {
    return resolveArtifactVersionState(payload, {
        artifactType: 'post-match-stats',
        versionFields: POST_MATCH_STATS_VERSION_FIELDS,
        supportedVersions: POST_MATCH_STATS_SUPPORTED_VERSIONS,
        fallbackVersions: POST_MATCH_STATS_FALLBACK_VERSIONS,
        currentVersion: POST_MATCH_STATS_CONTRACT_VERSION,
        allowMissingVersion: true,
    });
}

/**
 * Carries a v1 summary across: its values are already formatted strings, so every row becomes a
 * `text` row inside a `values` block. Nothing is reinterpreted here — P3 decides tiers and raw
 * numbers once the producer is switched over.
 * @param {unknown} summary
 * @returns {PostMatchStatsSummary}
 */
export function upgradePostMatchStatsV1(summary) {
    if (!isPlainObject(summary) || !Array.isArray(summary.blocks)) {
        return createEmptyPostMatchStats();
    }
    const blocks = normalizeBlocks(summary.blocks.map((block) => {
        if (!isPlainObject(block)) return block;
        return {
            id: block.id,
            title: block.title,
            kind: POST_MATCH_STATS_DEFAULT_BLOCK_KIND,
            tier: POST_MATCH_STATS_DEFAULT_BLOCK_TIER,
            rows: Array.isArray(block.rows)
                ? block.rows.map((row) => (isPlainObject(row)
                    ? { key: row.key, label: row.label, value: row.value, type: POST_MATCH_STATS_DEFAULT_VALUE_TYPE }
                    : row))
                : [],
        };
    }));
    return createSummary(blocks, summary.visible !== false);
}

/**
 * Takes anything — `null`, an array, a v1 summary, a half-built v2 payload — and always returns a
 * complete summary. It never throws, so an overlay can render whatever survived.
 * @param {unknown} payload
 * @returns {PostMatchStatsSummary}
 */
export function normalizePostMatchStats(payload) {
    if (!isPlainObject(payload)) {
        return createEmptyPostMatchStats();
    }
    const versionState = classifyPostMatchStatsVersion(payload);
    if (versionState.shouldReject) {
        return createEmptyPostMatchStats();
    }
    if (versionState.reason === 'legacy_version') {
        return upgradePostMatchStatsV1(payload);
    }
    return createSummary(normalizeBlocks(payload.blocks), payload.visible !== false);
}
