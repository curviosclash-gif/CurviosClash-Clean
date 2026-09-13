import { ENDLESS_PARCOURS_RULE_VERSION } from './EndlessParcoursWaveContract.js';

export const ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY = 'curviosclash.endless-parcours-settlements.v1';
export const ENDLESS_PARCOURS_SETTLEMENT_SCHEMA_VERSION = 'endless-parcours-settlements.v1';
export const ENDLESS_PARCOURS_SETTLEMENT_RECEIPT_LIMIT = 64;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function integer(value) { return Math.max(0, Math.floor(Number(value) || 0)); }

export function normalizeEndlessSettlement(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
    return Object.freeze({
        runId: text(source.runId),
        vehicleId: text(source.vehicleId) || 'ship1',
        xp: integer(source.xp),
        ruleVersion: text(source.ruleVersion) || ENDLESS_PARCOURS_RULE_VERSION,
        endedAtIso: text(source.endedAtIso),
        summary: Object.freeze({ ...summary }),
        unlocks: Object.freeze(Array.isArray(source.unlocks) ? source.unlocks.map(text).filter(Boolean) : []),
    });
}

export function normalizeEndlessSettlementLedger(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const pending = [];
    for (const entry of Array.isArray(source.pending) ? source.pending : []) {
        const settlement = normalizeEndlessSettlement(entry?.settlement);
        if (!settlement.runId || pending.some((item) => item.settlement.runId === settlement.runId)) continue;
        pending.push({
            settlement,
            targets: {
                records: entry?.targets?.records === true,
                vehicle: entry?.targets?.vehicle === true,
            },
        });
    }
    return { schemaVersion: ENDLESS_PARCOURS_SETTLEMENT_SCHEMA_VERSION, pending };
}

export function appendSettlementReceipt(receipts, runId) {
    const id = text(runId);
    const normalized = Array.isArray(receipts) ? receipts.map(text).filter(Boolean) : [];
    if (id && !normalized.includes(id)) normalized.push(id);
    return normalized.slice(-ENDLESS_PARCOURS_SETTLEMENT_RECEIPT_LIMIT);
}
