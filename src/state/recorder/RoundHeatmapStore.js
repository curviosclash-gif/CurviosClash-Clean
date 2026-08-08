// ============================================
// RoundHeatmapStore.js - collects where round events happened, not just how often
// ============================================

import {
    ROUND_HEATMAP_CELL_SIZE,
    ROUND_HEATMAP_MAX_ROUND_CELLS,
    heatmapKindFromEventType,
    normalizeHeatmapCells,
    toHeatmapCellIndex,
} from '../../shared/contracts/RoundHeatmapContract.js';

// Waehrend der Runde darf das Raster feiner sein als die Ausgabe: gekappt wird
// erst beim Abschluss, damit das Kappen die staerksten Zellen behaelt und nicht
// die zuerst getroffenen.
const LIVE_CELL_HEADROOM = 6;

export class RoundHeatmapStore {
    constructor({ cellSize = ROUND_HEATMAP_CELL_SIZE, maxCells = ROUND_HEATMAP_MAX_ROUND_CELLS } = {}) {
        this.cellSize = Number(cellSize) > 0 ? Number(cellSize) : ROUND_HEATMAP_CELL_SIZE;
        this.maxCells = Math.max(1, Math.floor(Number(maxCells) || ROUND_HEATMAP_MAX_ROUND_CELLS));
        this.maxLiveCells = this.maxCells * LIVE_CELL_HEADROOM;
        /** @type {Map<string, { kind: string, cx: number, cz: number, count: number }>} */
        this._cells = new Map();
        this._droppedSamples = 0;
    }

    reset() {
        this._cells.clear();
        this._droppedSamples = 0;
    }

    /**
     * @param {unknown} eventType Recorder-Ereignistyp, z. B. 'STUCK'.
     * @param {unknown} position Objekt mit x/z in Weltkoordinaten.
     * @returns {boolean} true wenn das Ereignis raeumlich erfasst wurde.
     */
    addEventSample(eventType, position) {
        const kind = heatmapKindFromEventType(eventType);
        if (!kind) return false;
        if (!position || typeof position !== 'object') return false;

        const x = Number(/** @type {{ x?: unknown }} */ (position).x);
        const z = Number(/** @type {{ z?: unknown }} */ (position).z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return false;

        const cx = toHeatmapCellIndex(x, this.cellSize);
        const cz = toHeatmapCellIndex(z, this.cellSize);
        const key = `${kind}|${cx}|${cz}`;
        const existing = this._cells.get(key);
        if (existing) {
            existing.count += 1;
            return true;
        }
        if (this._cells.size >= this.maxLiveCells) {
            this._droppedSamples += 1;
            return false;
        }
        this._cells.set(key, { kind, cx, cz, count: 1 });
        return true;
    }

    isEmpty() {
        return this._cells.size === 0;
    }

    getDroppedSampleCount() {
        return this._droppedSamples;
    }

    /**
     * @returns {import('../../shared/contracts/RoundHeatmapContract.js').RoundHeatmapCell[]}
     */
    toCells() {
        if (this._cells.size === 0) return [];
        return normalizeHeatmapCells(Array.from(this._cells.values()), this.maxCells);
    }
}
