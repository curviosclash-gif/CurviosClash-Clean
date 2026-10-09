function sumRoundCount(rounds, readCount) {
    return rounds.reduce((total, round) => total + Math.max(0, Number(readCount(round)) || 0), 0);
}

export function buildBotValidationCombatMetrics(rounds = []) {
    const mgShotRequests = sumRoundCount(rounds, (round) => round?.itemUseModeCounts?.mg);
    const mgShots = sumRoundCount(rounds, (round) => round?.actionResultCodeCounts?.['mg.shoot.success']);
    const mgCooldownBlocks = sumRoundCount(rounds, (round) => round?.actionResultCodeCounts?.['mg.shoot.cooldown']);
    const mgOverheatBlocks = sumRoundCount(rounds, (round) => round?.actionResultCodeCounts?.['mg.shoot.overheated']);
    const mgHits = sumRoundCount(rounds, (round) => round?.mgHits);
    return {
        mgShotRequests,
        mgShots,
        mgCooldownBlocks,
        mgOverheatBlocks,
        mgOtherBlocks: Math.max(0, mgShotRequests - mgShots - mgCooldownBlocks - mgOverheatBlocks),
        mgHits,
        mgHitRate: mgShots > 0 ? mgHits / mgShots : 0,
    };
}
