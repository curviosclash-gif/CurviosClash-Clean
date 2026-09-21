const CLONED_ARRAY_FIELDS = Object.freeze([
    'botSurvivalSeconds',
    'botDeathSurvivalSeconds',
]);

const CLONED_OBJECT_FIELDS = Object.freeze([
    'botDeathCauseCounts',
    'itemUseModeCounts',
    'itemUseTypeCounts',
    'itemSpawnTypeCounts',
    'itemPickupTypeCounts',
    'itemPickupRejectedTypeCounts',
    'itemHitTypeCounts',
    'itemDamageByType',
    'actionResultCodeCounts',
    'failedItemActionModeCounts',
    'failedItemActionCodeCounts',
    'turretEventCounts',
]);

export function createItemUseModeCounts() {
    return {
        use: 0,
        shoot: 0,
        mg: 0,
        other: 0,
    };
}

export function createRoundSummary() {
    return {
        roundId: 0,
        duration: 0,
        winnerIndex: -1,
        winnerIsBot: false,
        reason: '',
        botCount: 0,
        humanCount: 0,
        botSurvivalAverage: 0,
        botSurvivalSeconds: [],
        botDeathSurvivalSeconds: [],
        botDeathCauseCounts: {},
        selfCollisions: 0,
        stuckEvents: 0,
        bounceWallEvents: 0,
        bounceTrailEvents: 0,
        itemUseEvents: 0,
        mgFireSeconds: 0,
        itemUseModeCounts: createItemUseModeCounts(),
        itemUseTypeCounts: {},
        itemSpawnTypeCounts: {},
        itemPickupTypeCounts: {},
        itemPickupRejectedTypeCounts: {},
        itemHitTypeCounts: {},
        itemDamageByType: {},
        actionResultCodeCounts: {},
        failedItemActions: 0,
        failedItemActionModeCounts: createItemUseModeCounts(),
        failedItemActionCodeCounts: {},
        mgHits: 0,
        rocketHits: 0,
        shieldAbsorb: 0,
        hpDamage: 0,
        turretEventCounts: {},
        stuckPerMinute: 0,
        parcoursCompleted: false,
        parcoursRouteId: '',
        parcoursCompletionTimeMs: 0,
        parcoursCheckpointCount: 0,
    };
}

export function createAggregateSummary() {
    return {
        rounds: 0,
        totalDuration: 0,
        totalBotLives: 0,
        totalBotSurvival: 0,
        totalBotDeathCauseCounts: {},
        totalSelfCollisions: 0,
        totalStuckEvents: 0,
        totalBounceWallEvents: 0,
        totalBounceTrailEvents: 0,
        totalItemUseEvents: 0,
        totalMgFireSeconds: 0,
        totalItemUseModeCounts: createItemUseModeCounts(),
        totalItemUseTypeCounts: {},
        totalItemSpawnTypeCounts: {},
        totalItemPickupTypeCounts: {},
        totalItemPickupRejectedTypeCounts: {},
        totalItemHitTypeCounts: {},
        totalItemDamageByType: {},
        totalActionResultCodeCounts: {},
        totalFailedItemActions: 0,
        totalFailedItemActionModeCounts: createItemUseModeCounts(),
        totalFailedItemActionCodeCounts: {},
        totalMgHits: 0,
        totalRocketHits: 0,
        totalShieldAbsorb: 0,
        totalHpDamage: 0,
        totalTurretEventCounts: {},
        botWins: 0,
        parcoursCompletions: 0,
        totalParcoursCompletionTimeMs: 0,
    };
}

export function cloneRoundMetricsSummary(round) {
    const clone = { ...round };
    for (const field of CLONED_ARRAY_FIELDS) {
        clone[field] = [...(round[field] || [])];
    }
    for (const field of CLONED_OBJECT_FIELDS) {
        clone[field] = { ...(round[field] || {}) };
    }
    return clone;
}
