import {
    ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY,
    appendSettlementReceipt,
    normalizeEndlessSettlement,
    normalizeEndlessSettlementLedger,
} from '../../shared/contracts/EndlessParcoursSettlementContract.js';
import {
    ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
    normalizeEndlessParcoursRecords,
    updateEndlessParcoursRecords,
} from '../../shared/contracts/EndlessParcoursRecordsContract.js';
import {
    addXp,
    getOrCreateProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
} from './ArcadeVehicleProfile.js';

function acknowledged(result) {
    return result === undefined || result === true || result?.ok === true || result?.success === true;
}

function saveLedger(store, ledger) {
    if (!store?.saveJsonRecord) return false;
    try {
        return acknowledged(store.saveJsonRecord(
            ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY,
            normalizeEndlessSettlementLedger(ledger)
        ));
    } catch {
        return false;
    }
}

export function loadEndlessSettlementLedger(store) {
    if (!store?.loadJsonRecord) return normalizeEndlessSettlementLedger();
    try {
        return normalizeEndlessSettlementLedger(store.loadJsonRecord(ENDLESS_PARCOURS_SETTLEMENT_STORAGE_KEY, null));
    } catch {
        return normalizeEndlessSettlementLedger();
    }
}

function applyRecordsTarget(store, entry) {
    const settlement = entry.settlement;
    const current = normalizeEndlessParcoursRecords(
        store.loadJsonRecord(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY, null)
    );
    if (current.processedSettlementIds.includes(settlement.runId)) return true;
    const update = updateEndlessParcoursRecords(current, {
        ...settlement.summary,
        ruleVersion: settlement.ruleVersion,
    }, settlement.endedAtIso);
    update.records.processedSettlementIds = appendSettlementReceipt(
        update.records.processedSettlementIds,
        settlement.runId
    );
    return acknowledged(store.saveJsonRecord(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY, update.records));
}

function applyVehicleTarget(store, entry, nowMs) {
    const settlement = entry.settlement;
    const profiles = loadVehicleProfiles(store);
    const current = getOrCreateProfile(profiles, settlement.vehicleId, nowMs);
    const receipts = Array.isArray(current.endlessSettlementIds) ? current.endlessSettlementIds : [];
    if (receipts.includes(settlement.runId)) return true;
    const result = addXp(current, settlement.xp, nowMs);
    profiles[settlement.vehicleId] = {
        ...result.profile,
        endlessSettlementIds: appendSettlementReceipt(receipts, settlement.runId),
    };
    return acknowledged(saveVehicleProfiles(store, profiles));
}

export function queueEndlessSettlement(store, settlement) {
    const normalized = normalizeEndlessSettlement(settlement);
    if (!normalized.runId) return { ok: false, pending: true, reason: 'invalid_run_id' };
    const ledger = loadEndlessSettlementLedger(store);
    if (!ledger.pending.some((entry) => entry.settlement.runId === normalized.runId)) {
        ledger.pending.push({ settlement: normalized, targets: { records: false, vehicle: false } });
    }
    if (!saveLedger(store, ledger)) return { ok: false, pending: true, reason: 'ledger_write_failed' };
    return retryEndlessSettlements(store);
}

export function retryEndlessSettlements(store, nowMs = Date.now()) {
    if (!store?.loadJsonRecord || !store?.saveJsonRecord) {
        return { ok: false, pending: true, reason: 'storage_unavailable' };
    }
    const ledger = loadEndlessSettlementLedger(store);
    for (const entry of ledger.pending) {
        if (!entry.targets.records) {
            try {
                if (!applyRecordsTarget(store, entry)) return { ok: false, pending: true, reason: 'records_write_failed' };
                entry.targets.records = true;
                if (!saveLedger(store, ledger)) return { ok: false, pending: true, reason: 'ledger_status_failed' };
            } catch {
                return { ok: false, pending: true, reason: 'records_write_failed' };
            }
        }
        if (!entry.targets.vehicle) {
            try {
                if (!applyVehicleTarget(store, entry, nowMs)) return { ok: false, pending: true, reason: 'vehicle_write_failed' };
                entry.targets.vehicle = true;
                if (!saveLedger(store, ledger)) return { ok: false, pending: true, reason: 'ledger_status_failed' };
            } catch {
                return { ok: false, pending: true, reason: 'vehicle_write_failed' };
            }
        }
    }
    ledger.pending = ledger.pending.filter((entry) => !entry.targets.records || !entry.targets.vehicle);
    if (!saveLedger(store, ledger)) return { ok: false, pending: true, reason: 'ledger_cleanup_failed' };
    return { ok: true, pending: false, reason: 'saved' };
}
