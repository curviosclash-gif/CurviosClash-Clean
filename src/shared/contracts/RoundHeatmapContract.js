// ============================================
// RoundHeatmapContract.js - spatial event buckets for round telemetry
// ============================================
//
// Stuck- und Kollisionsereignisse werden bislang nur gezaehlt. Der Vertrag hier
// haengt an jedes Ereignis eine grob gerasterte Position, damit sich ueber viele
// Runden Haeufungspunkte einer Map erkennen lassen ("hier haengen alle fest").
//
// Bewusst zweidimensional: gerastert wird nur ueber X/Z, die Hoehe faellt weg.
// Die Auswertung ist eine Draufsicht, und ein Hoehenraster wuerde die Zellzahl
// vervielfachen, ohne die Frage "an welcher Stelle der Map" besser zu beantworten.

export const ROUND_HEATMAP_CONTRACT_VERSION = 'round-heatmap.v1';

/** Kantenlaenge einer Rasterzelle in Weltkoordinaten. */
export const ROUND_HEATMAP_CELL_SIZE = 10;

/** Obergrenze fuer die Zellen einer einzelnen Runde. */
export const ROUND_HEATMAP_MAX_ROUND_CELLS = 96;

/** Obergrenze fuer die ueber viele Runden zusammengefuehrten Zellen einer Map. */
export const ROUND_HEATMAP_MAX_MERGED_CELLS = 320;

export const ROUND_HEATMAP_KINDS = Object.freeze([
    'stuck',
    'bounce_wall',
    'bounce_trail',
    'kill',
]);

const EVENT_TYPE_TO_KIND = Object.freeze({
    STUCK: 'stuck',
    BOUNCE_WALL: 'bounce_wall',
    BOUNCE_TRAIL: 'bounce_trail',
    KILL: 'kill',
});

/**
 * @typedef {Object} RoundHeatmapCell
 * @property {string} kind Ereignisart aus ROUND_HEATMAP_KINDS.
 * @property {number} cx Rasterindex entlang X.
 * @property {number} cz Rasterindex entlang Z.
 * @property {number} count Anzahl der Ereignisse in dieser Zelle.
 */

/**
 * @typedef {Object} RoundHeatmapSummary
 * @property {number} cellCount Anzahl belegter Zellen.
 * @property {number} totalSamples Summe aller Ereignisse.
 * @property {Record<string, number>} byKind Ereignissumme je Art.
 * @property {RoundHeatmapCell[]} top Staerkste Zellen, absteigend.
 */

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toCellIndex(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const truncated = Math.trunc(parsed);
    // Ein Raster jenseits dieser Weite gehoert keiner realen Map mehr an und
    // wuerde nur kaputte Eingaben durch die Persistenz schleifen.
    return Math.abs(truncated) <= 4096 ? truncated : null;
}

function toPositiveCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.floor(parsed));
}

function toCellLimit(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(4096, Math.floor(parsed));
}

/**
 * @param {unknown} value
 * @returns {string} Normalisierte Ereignisart oder '' wenn unbekannt.
 */
export function normalizeHeatmapKind(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ROUND_HEATMAP_KINDS.includes(normalized) ? normalized : '';
}

/**
 * Uebersetzt einen Recorder-Ereignistyp in eine Heatmap-Art.
 *
 * @param {unknown} eventType
 * @returns {string} Heatmap-Art oder '' wenn der Typ nicht raeumlich ausgewertet wird.
 */
export function heatmapKindFromEventType(eventType) {
    const normalized = typeof eventType === 'string' ? eventType.trim().toUpperCase() : '';
    return EVENT_TYPE_TO_KIND[normalized] || '';
}

/**
 * @param {number} value Weltkoordinate.
 * @param {number} [cellSize]
 * @returns {number} Rasterindex.
 */
export function toHeatmapCellIndex(value, cellSize = ROUND_HEATMAP_CELL_SIZE) {
    const size = Number(cellSize) > 0 ? Number(cellSize) : ROUND_HEATMAP_CELL_SIZE;
    return Math.floor((Number(value) || 0) / size);
}

/**
 * Weltkoordinate der Zellmitte - fuer das Zeichnen der Draufsicht.
 *
 * @param {number} cellIndex
 * @param {number} [cellSize]
 * @returns {number}
 */
export function heatmapCellCenter(cellIndex, cellSize = ROUND_HEATMAP_CELL_SIZE) {
    const size = Number(cellSize) > 0 ? Number(cellSize) : ROUND_HEATMAP_CELL_SIZE;
    return ((Number(cellIndex) || 0) + 0.5) * size;
}

/**
 * @param {RoundHeatmapCell} cell
 * @returns {string}
 */
export function toHeatmapCellKey(cell) {
    return `${cell.kind}|${cell.cx}|${cell.cz}`;
}

function accumulateCell(target, kind, cx, cz, count) {
    const key = `${kind}|${cx}|${cz}`;
    const existing = target.get(key);
    if (existing) {
        existing.count += count;
        return;
    }
    target.set(key, { kind, cx, cz, count });
}

function collectCells(source, target) {
    if (!Array.isArray(source)) return;
    for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        const kind = normalizeHeatmapKind(/** @type {{ kind?: unknown }} */ (entry).kind);
        if (!kind) continue;
        const cx = toCellIndex(/** @type {{ cx?: unknown }} */ (entry).cx);
        const cz = toCellIndex(/** @type {{ cz?: unknown }} */ (entry).cz);
        if (cx === null || cz === null) continue;
        const count = toPositiveCount(/** @type {{ count?: unknown }} */ (entry).count);
        if (count <= 0) continue;
        accumulateCell(target, kind, cx, cz, count);
    }
}

function toSortedCells(collected, maxCells) {
    const cells = Array.from(collected.values());
    // Absteigend nach Haeufigkeit, danach stabil ueber die Rasterkoordinaten:
    // beim Kappen sollen die aussagekraeftigsten Zellen ueberleben, und zwei
    // gleich starke Zellen duerfen ihre Reihenfolge nicht zufaellig tauschen.
    cells.sort((a, b) => (
        b.count - a.count
        || a.kind.localeCompare(b.kind)
        || a.cx - b.cx
        || a.cz - b.cz
    ));
    return cells.length > maxCells ? cells.slice(0, maxCells) : cells;
}

/**
 * @param {unknown} source
 * @param {number} [maxCells]
 * @returns {RoundHeatmapCell[]}
 */
export function normalizeHeatmapCells(source, maxCells = ROUND_HEATMAP_MAX_ROUND_CELLS) {
    const limit = toCellLimit(maxCells, ROUND_HEATMAP_MAX_ROUND_CELLS);
    const collected = new Map();
    collectCells(source, collected);
    return toSortedCells(collected, limit);
}

/**
 * Fuehrt zwei Zellmengen zusammen; gleiche Zellen addieren ihre Zaehler.
 *
 * @param {unknown} baseCells
 * @param {unknown} incomingCells
 * @param {number} [maxCells]
 * @returns {RoundHeatmapCell[]}
 */
export function mergeHeatmapCells(baseCells, incomingCells, maxCells = ROUND_HEATMAP_MAX_MERGED_CELLS) {
    const limit = toCellLimit(maxCells, ROUND_HEATMAP_MAX_MERGED_CELLS);
    const collected = new Map();
    collectCells(baseCells, collected);
    collectCells(incomingCells, collected);
    return toSortedCells(collected, limit);
}

/**
 * @param {unknown} cells
 * @param {number} [topLimit]
 * @returns {RoundHeatmapSummary}
 */
export function summarizeHeatmapCells(cells, topLimit = 5) {
    const normalized = normalizeHeatmapCells(cells, ROUND_HEATMAP_MAX_MERGED_CELLS);
    /** @type {Record<string, number>} */
    const byKind = {};
    let totalSamples = 0;
    for (const cell of normalized) {
        byKind[cell.kind] = (byKind[cell.kind] || 0) + cell.count;
        totalSamples += cell.count;
    }
    const limit = toCellLimit(topLimit, 5);
    return {
        cellCount: normalized.length,
        totalSamples,
        byKind,
        top: normalized.slice(0, limit),
    };
}

/**
 * Weltausdehnung der belegten Zellen - Grundlage fuer die Zeichenflaeche.
 *
 * @param {unknown} cells
 * @param {number} [cellSize]
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number } | null}
 */
export function heatmapCellBounds(cells, cellSize = ROUND_HEATMAP_CELL_SIZE) {
    const normalized = normalizeHeatmapCells(cells, ROUND_HEATMAP_MAX_MERGED_CELLS);
    if (normalized.length === 0) return null;
    const size = toFiniteNumber(cellSize);
    const step = size !== null && size > 0 ? size : ROUND_HEATMAP_CELL_SIZE;
    let minCx = normalized[0].cx;
    let maxCx = normalized[0].cx;
    let minCz = normalized[0].cz;
    let maxCz = normalized[0].cz;
    for (const cell of normalized) {
        if (cell.cx < minCx) minCx = cell.cx;
        if (cell.cx > maxCx) maxCx = cell.cx;
        if (cell.cz < minCz) minCz = cell.cz;
        if (cell.cz > maxCz) maxCz = cell.cz;
    }
    return {
        minX: minCx * step,
        maxX: (maxCx + 1) * step,
        minZ: minCz * step,
        maxZ: (maxCz + 1) * step,
    };
}
