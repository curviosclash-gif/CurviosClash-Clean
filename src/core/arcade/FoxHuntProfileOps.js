import { HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY, isWritableHuntParcoursMedalRecord, recordHuntParcoursResult } from '../../shared/contracts/HuntParcoursMedalRecordContract.js';
import { resolveHuntParcoursMedal } from '../../shared/contracts/HuntParcoursContract.js';
import { createArcadeRankContext } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { getArcadeRunVehicleBonuses, loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { settleArcadeRunRanking } from '../../state/arcade/ArcadeRunRanking.js';

/** Snapshot each bound human's store and plane once; later profile changes cannot redirect rewards. */
export function bindFoxHuntProfiles(ops) {
    const r = ops.runtime;
    ops.targets = new Map(); ops.rewardTotals = new Map();
    for (const player of ops.manager.humanPlayers || []) {
        const index = player.index;
        const target = index === 0 ? { store: r._recordStore, vehicleId: r.rewardBinding?.vehicleId } : r._getPlayerRewardTarget(index);
        if (target) {
            const profile = structuredClone(loadVehicleProfiles(target.store)[target.vehicleId]);
            ops.targets.set(index, { ...target, profile, stoneSteps: getArcadeRunVehicleBonuses(profile, target.store)?.build?.stoneSteps });
        }
        ops.rewardTotals.set(index, index === 0 ? r._rewardTotals : { xpEarned: 0, vehicleXpEarned: 0, summary: null });
    }
}

export function settleFoxHuntPartners(ops) {
    const r = ops.runtime;
    return (ops.manager.humanPlayers || []).map(player => {
        const index = player.index, score = ops.totalPoints.get(index) || 0;
        const target = ops.targets.get(index), failures = index === 0 ? r._saveFailures : [];
        let ranking = index === 0 ? r.ranking : null;
        if (index !== 0 && target) {
            const key = HUNT_PARCOURS_MEDAL_RECORD_STORAGE_KEY;
            const read = r._records.read(target.store, key);
            if (read.status === 'missing' || (read.status === 'found' && isWritableHuntParcoursMedalRecord(read.value))) {
                r._records.queue(target.store, key, recordHuntParcoursResult(read.value, { variantId: 'fox_hunt', score, succeeded: ops.leaders().includes(index) }), failures);
            } else failures.push(key);
            if (r.rankContext) {
                const context = createArcadeRankContext({ runId: `${r.rankContext.runId}:p${index}`, runType: 'hunt_parcours',
                    vehicleId: target.vehicleId, profile: target.profile, stoneSteps: target.stoneSteps,
                    tierId: r.rankContext.tierId, runSettings: ops.manager.runtimeConfig?.arcade });
                ranking = settleArcadeRunRanking({ rankContext: { ...context, scoreModel: 'hunt-score.v1',
                    huntParcoursVariantId: 'fox_hunt', huntParcoursHumanCount: ops.manager.humanPlayers.length }, _rankingStore: target.store },
                { score, succeeded: ops.leaders().includes(index), completedMaps: 3, completedSectors: 3, aborted: false });
            }
        }
        const totals = ops.rewardTotals.get(index);
        const summary = { playerIndex: index, label: ops.label(index), score, medal: resolveHuntParcoursMedal('fox_hunt', score, { succeeded: ops.leaders().includes(index) }),
            succeeded: ops.leaders().includes(index), ranking, saveFailures: failures, xpEarned: totals?.xpEarned || 0,
            vehicleXpEarned: totals?.vehicleXpEarned || 0, pendingRewardCount: r._rewards.pending.filter(reward => reward.owner === totals).length };
        if (totals && index !== 0) totals.summary = summary;
        return summary;
    });
}
