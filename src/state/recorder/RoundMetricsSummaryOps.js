const CLONED_ARRAY_FIELDS = Object.freeze([
    'botSurvivalSeconds',
    'botDeathSurvivalSeconds',
]);

const CLONED_OBJECT_FIELDS = Object.freeze([
    'botDeathCauseCounts',
    'itemUseModeCounts',
    'itemUseTypeCounts',
    'actionResultCodeCounts',
    'failedItemActionModeCounts',
    'failedItemActionCodeCounts',
    'turretEventCounts',
]);

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
