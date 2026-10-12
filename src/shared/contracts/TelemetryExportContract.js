// Local round telemetry for developer tools: the filters the tools send, the CSV layout of an
// export and the markers a release build must not contain. The F7 console, the playtest MCP
// and the release guard read this one definition, so an export looks the same everywhere.

export const TELEMETRY_EXPORT_SCHEMA_VERSION = 'curviosclash-telemetry-export.v1';

export const TELEMETRY_CONTROL_SOURCES = Object.freeze(['human', 'idle', 'automation', 'unknown']);

// Flat columns, so a file opens in a spreadsheet without rework. Combat and frame values are
// in on purpose: without them an export cannot answer a balancing question.
export const TELEMETRY_CSV_FIELDS = Object.freeze([
    'at', 'buildId', 'appVersion', 'mapKey', 'mapRevision', 'mode', 'modePath', 'sessionType',
    'platform', 'graphicsQuality', 'playerCount', 'humanCount', 'botCount', 'botDifficulty',
    'botPolicy', 'winnerType', 'reason', 'duration', 'selfCollisions', 'itemUses', 'emptyItemActions', 'stuckEvents',
    'kills', 'spawnDeaths', 'mgHits', 'rocketHits', 'hpDamage', 'shieldAbsorb',
    'parcoursCompleted', 'parcoursCompletionTimeMs', 'parcoursCheckpointCount',
]);

/** @type {ReadonlyArray<readonly [string, (row: any) => unknown]>} */
export const TELEMETRY_CSV_DERIVED_FIELDS = Object.freeze([
    // Without these columns a spreadsheet cannot tell who flew the round: a person, an
    // unattended window or a tool.
    ['controlSource', (row) => row?.control?.source],
    ['controlInputShare', (row) => row?.control?.inputShare],
    ['controlAutomationSignal', (row) => row?.control?.automationSignal],
    ['frameAvgMs', (row) => row?.performance?.frameAvgMs],
    ['frameP95Ms', (row) => row?.performance?.frameP95Ms],
    ['frameP99Ms', (row) => row?.performance?.frameP99Ms],
    ['frameSpikes', (row) => row?.performance?.spikeCount],
    ['arcadeScore', (row) => row?.arcade?.run?.score],
    ['arcadeSector', (row) => row?.arcade?.lastSector?.sectorIndex],
    ['arcadeModifier', (row) => row?.arcade?.lastSector?.modifierId],
]);

// Strings only the round telemetry carries (IndexedDB name, record and export schema). A
// release build that contains one of them still records or exports telemetry.
export const RELEASE_TELEMETRY_MARKERS = Object.freeze([
    'cuviosclash-telemetry',
    'round-telemetry.v1',
    TELEMETRY_EXPORT_SCHEMA_VERSION,
]);

/**
 * @param {unknown} rows
 * @returns {string}
 */
export function telemetryRowsToCsv(rows) {
    /** @param {unknown} value */
    const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const header = [...TELEMETRY_CSV_FIELDS, ...TELEMETRY_CSV_DERIVED_FIELDS.map(([name]) => name)];
    /** @param {any} row */
    const toLine = (row) => [
        ...TELEMETRY_CSV_FIELDS.map((field) => escapeCell(row?.[field])),
        ...TELEMETRY_CSV_DERIVED_FIELDS.map(([, read]) => escapeCell(read(row))),
    ].join(',');
    const list = Array.isArray(rows) ? rows : [];
    return [header.join(','), ...list.map(toLine)].join('\n');
}

/** @param {unknown} value */
function cleanText(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

/**
 * The tools default to rounds a person flew: unattended windows and tool runs would shift
 * every rate silently. `controlSource: 'all'` lifts that filter.
 * @param {unknown} source
 * @returns {{ buildId: string, mapKey: string, mode: string, controlSource: string, sinceDays: number }}
 */
export function normalizeTelemetryToolFilters(source) {
    const input = source && typeof source === 'object' && !Array.isArray(source)
        ? /** @type {Record<string, unknown>} */ (source)
        : {};
    const controlSource = cleanText(input.controlSource);
    const sinceDays = Number(input.sinceDays);
    return {
        buildId: cleanText(input.buildId),
        mapKey: cleanText(input.mapKey),
        mode: cleanText(input.mode),
        controlSource: controlSource === 'all' ? '' : (TELEMETRY_CONTROL_SOURCES.includes(controlSource) ? controlSource : 'human'),
        sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? Math.min(3650, Math.trunc(sinceDays)) : 0,
    };
}

/**
 * Distinct values for the filter lists, sorted.
 * @param {unknown} entries
 * @returns {{ buildIds: string[], mapKeys: string[], modes: string[] }}
 */
export function collectTelemetryFilterOptions(entries) {
    const list = Array.isArray(entries) ? entries : [];
    /** @param {string} field */
    const distinct = (field) => [...new Set(list.map((entry) => cleanText(entry?.[field])).filter(Boolean))].sort();
    return { buildIds: distinct('buildId'), mapKeys: distinct('mapKey'), modes: distinct('mode') };
}

/**
 * One short line per round for the tool lists.
 * @param {any} entry
 */
export function summarizeTelemetryRound(entry) {
    const duration = Number(entry?.duration);
    return {
        at: cleanText(entry?.at),
        mapKey: cleanText(entry?.mapKey),
        mode: cleanText(entry?.mode),
        winnerType: cleanText(entry?.winnerType),
        duration: Number.isFinite(duration) ? duration : 0,
        kills: Number(entry?.kills) || 0,
        spawnDeaths: Number(entry?.spawnDeaths) || 0,
        controlSource: cleanText(entry?.control?.source) || 'unknown',
        buildId: cleanText(entry?.buildId),
    };
}

/**
 * @param {string} format 'json' | 'csv'
 * @param {Date} [now]
 * @returns {string}
 */
export function createTelemetryExportFileName(format, now = new Date()) {
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `curviosclash-telemetry-${stamp}.${format === 'csv' ? 'csv' : 'json'}`;
}
