// ============================================
// TelemetryHistoryPruning.js - which recorded rounds leave the history first
// ============================================
//
// Die Historie ist gedeckelt. Frueher fiel beim Ueberlauf einfach die aelteste
// Runde weg - eine Testserie von 61 automatischen Runden schob so genauso viele
// echte Runden hinaus. Runden aus Automatisierung und unbedienten Fenstern
// bekommen deshalb ein eigenes, kleines Budget und gehen beim Gesamtdeckel
// vor jeder echten Runde. Altdaten ohne Steuerungsblock zaehlen als echt.

import { ROUND_CONTROL_SOURCES, resolveRoundControlSource } from '../../shared/contracts/RoundControlContract.js';

export const TELEMETRY_HISTORY_MAX_ENTRIES = 500;
export const TELEMETRY_HISTORY_MAX_MACHINE_ENTRIES = 100;
export const TELEMETRY_HISTORY_PRUNE_BATCH = 50;

function isMachineRound(row) {
    const source = resolveRoundControlSource(row);
    return source === ROUND_CONTROL_SOURCES.AUTOMATION || source === ROUND_CONTROL_SOURCES.IDLE;
}

/**
 * @param {Array<{id: number, control?: any}>} rows gespeicherte Runden
 * @param {{maxEntries?: number, maxMachineEntries?: number, pruneBatch?: number}} [limits]
 * @returns {number[]} Schluessel der zu loeschenden Runden, aelteste zuerst
 */
export function selectTelemetryPruneIds(rows, limits = {}) {
    const maxEntries = limits.maxEntries ?? TELEMETRY_HISTORY_MAX_ENTRIES;
    const maxMachineEntries = limits.maxMachineEntries ?? TELEMETRY_HISTORY_MAX_MACHINE_ENTRIES;
    const pruneBatch = limits.pruneBatch ?? TELEMETRY_HISTORY_PRUNE_BATCH;
    const ordered = (Array.isArray(rows) ? rows : [])
        .filter((row) => Number.isFinite(row?.id))
        .sort((left, right) => left.id - right.id);
    const dropped = new Set();

    const machineRows = ordered.filter(isMachineRound);
    machineRows.slice(0, Math.max(0, machineRows.length - maxMachineEntries)).forEach((row) => dropped.add(row.id));

    const remaining = ordered.filter((row) => !dropped.has(row.id));
    if (remaining.length > maxEntries) {
        const excess = remaining.length - maxEntries + pruneBatch;
        const machineFirst = [...remaining.filter(isMachineRound), ...remaining.filter((row) => !isMachineRound(row))];
        machineFirst.slice(0, excess).forEach((row) => dropped.add(row.id));
    }
    return ordered.filter((row) => dropped.has(row.id)).map((row) => row.id);
}
