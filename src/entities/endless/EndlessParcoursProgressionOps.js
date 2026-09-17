import { ENDLESS_PARCOURS_END_REASONS } from '../../shared/contracts/EndlessParcoursContract.js';
import { resolveEndlessCosmeticUnlocks } from '../../shared/contracts/EndlessParcoursRecordsContract.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from '../../shared/contracts/EndlessParcoursWaveContract.js';
import {
    addXp,
    getMasteryPerks,
    getOrCreateProfile,
    getSlotStatBonuses,
    loadVehicleProfiles,
    XP_REWARD_TABLE,
} from '../../state/arcade/ArcadeVehicleProfile.js';
import {
    loadEndlessParcoursRecords,
    normalizeEndlessParcoursRecords,
} from '../../state/arcade/EndlessParcoursRecords.js';
import {
    queueEndlessSettlement,
    retryEndlessSettlements,
} from '../../state/arcade/EndlessParcoursSettlementStore.js';
import { buildEndlessSummary } from './EndlessParcoursProjection.js';

/**
 * Grundtempo ohne die Fahrzeug-Aufwertung. Player.setControlOptions rechnet den
 * Aufwertungsfaktor als baseSpeed/_arcadeBaseSpeed selbst wieder ein. Waere hier
 * das schon aufgewertete baseSpeed gemerkt, zaehlte die Aufwertung ab dem
 * zweiten Baustein doppelt.
 *
 * @param {any} player
 * @param {number} fallback
 * @returns {number}
 */
export function resolveEndlessStartSpeed(player, fallback = 1) {
    const arcadeBase = Number(player?._arcadeBaseSpeed);
    if (Number.isFinite(arcadeBase) && arcadeBase > 0) return arcadeBase;
    return Math.max(0.001, Number(player?.baseSpeed) || Number(fallback) || 1);
}

export function setEndlessRecordStore(runtime, store) {
    runtime._recordStore = store || null;
    runtime._lastPersistenceResult = retryEndlessSettlements(runtime._recordStore);
    runtime._records = loadEndlessParcoursRecords(runtime._recordStore);
    runtime._refreshRecordMarkers();
    return normalizeEndlessParcoursRecords(runtime._records);
}

export function setEndlessRunProfile(runtime, {
    recordStore = runtime._recordStore,
    vehicleId = 'ship1',
    strategy = null,
} = {}) {
    if (runtime.startProfile) return { vehicleId: runtime.startVehicleId, bonuses: { ...runtime.startBonuses } };
    runtime._recordStore = recordStore || runtime._recordStore;
    const profiles = loadVehicleProfiles(runtime._recordStore);
    const profile = getOrCreateProfile(profiles, vehicleId);
    runtime.startVehicleId = String(vehicleId || 'ship1');
    runtime.startProfile = Object.freeze(JSON.parse(JSON.stringify(profile)));
    runtime.startBonuses = Object.freeze({ ...getSlotStatBonuses(profile.upgrades, profile.hangarBonuses) });
    runtime._xpBonusPct = getMasteryPerks(profile.level).xpBonusPct;
    try { strategy?.applyVehicleUpgrades?.(runtime.startBonuses); } catch { /* no-op */ }
    const human = runtime.entityManager?.humanPlayers?.[0] || null;
    try { strategy?.resetPlayerHealth?.(human); } catch { /* no-op */ }
    try { strategy?.applySpawnStatBonuses?.(human); } catch { /* no-op */ }
    runtime._startSpeed = resolveEndlessStartSpeed(human, runtime._startSpeed);
    return { vehicleId: runtime.startVehicleId, bonuses: { ...runtime.startBonuses } };
}

export function collectEndlessRunXp(runtime, kind, count = 1) {
    const baseByKind = {
        checkpoint: XP_REWARD_TABLE.parcoursCheckpoint,
        kill: XP_REWARD_TABLE.killBase,
        intercept: XP_REWARD_TABLE.interceptBase,
        mission: XP_REWARD_TABLE.missionComplete,
    };
    const base = Math.max(0, Number(baseByKind[String(kind || '')]) || 0)
        * Math.max(0, Math.floor(Number(count) || 0));
    if (base <= 0) return 0;
    const earned = Math.max(1, Math.round(base * (1 + (Number(runtime._xpBonusPct) || 0) / 100)));
    runtime.runXp += earned;
    return earned;
}

export function retryEndlessSettlement(runtime) {
    if (!runtime._recordStore) return { ok: false, pending: true, reason: 'storage_unavailable' };
    runtime._lastPersistenceResult = runtime._settlement
        ? queueEndlessSettlement(runtime._recordStore, runtime._settlement)
        : retryEndlessSettlements(runtime._recordStore);
    runtime._records = loadEndlessParcoursRecords(runtime._recordStore);
    if (runtime._summary) runtime._summary.persistence = { ...runtime._lastPersistenceResult };
    return { ...runtime._lastPersistenceResult };
}

export function finalizeEndlessRun(runtime, reason, options = {}) {
    if (runtime._finalized) {
        if (runtime._lastPersistenceResult?.pending === true) retryEndlessSettlement(runtime);
        return runtime._summary;
    }
    runtime._finalized = true;
    runtime._pendingFinalReason = '';
    runtime._summary = buildEndlessSummary(runtime, reason);
    const shouldPersist = options.persist !== false && reason !== ENDLESS_PARCOURS_END_REASONS.ABORT;
    if (shouldPersist) {
        const priorMilestones = new Set(runtime._records.milestones || []);
        const projected = addXp(
            runtime.startProfile || getOrCreateProfile({}, runtime.startVehicleId || 'ship1'),
            runtime.runXp
        );
        runtime.runUnlocks = [
            ...projected.unlocksGained,
            ...projected.partFamiliesGained,
            ...projected.tiersGained,
            ...projected.masteryMilestonesGained,
            ...resolveEndlessCosmeticUnlocks(runtime._summary),
        ];
        runtime._summary.xp = runtime.runXp;
        runtime._summary.unlocks = runtime.runUnlocks.slice();
        runtime._settlement = Object.freeze({
            runId: runtime.runId,
            vehicleId: runtime.startVehicleId || 'ship1',
            xp: runtime.runXp,
            ruleVersion: ENDLESS_PARCOURS_RULE_VERSION,
            endedAtIso: runtime.wallClockIso(),
            summary: Object.freeze({ ...runtime._summary }),
            unlocks: Object.freeze(runtime.runUnlocks.slice()),
        });
        runtime._lastPersistenceResult = queueEndlessSettlement(runtime._recordStore, runtime._settlement);
        runtime._records = loadEndlessParcoursRecords(runtime._recordStore);
        runtime._newMilestones = (runtime._records.milestones || []).filter((id) => !priorMilestones.has(id));
        const ruleBest = runtime._records.bestByRuleVersion?.[ENDLESS_PARCOURS_RULE_VERSION];
        runtime._isNewRecord = ruleBest?.runId === runtime.runId;
        runtime._summary.isNewRecord = runtime._isNewRecord;
        runtime._summary.newMilestones = runtime._newMilestones;
        runtime._summary.persistence = { ...runtime._lastPersistenceResult };
    }
    if (options.requestRoundEnd !== false) {
        runtime.entityManager?.requestRoundEnd?.({
            winner: null,
            allowNoWinner: true,
            reason,
            parcours: { endless: true, endlessSummary: { ...runtime._summary } },
        });
    }
    return runtime._summary;
}
