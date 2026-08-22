function nonNegativeInt(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function nonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function key(value, fallback = 'unknown') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function countMap(source = null) {
    const normalized = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return normalized;
    Object.entries(source).forEach(([entryKey, value]) => {
        const normalizedKey = key(entryKey, '');
        if (normalizedKey) normalized[normalizedKey] = nonNegativeInt(value);
    });
    return normalized;
}

function increment(target, entryKey) {
    const normalizedKey = key(entryKey);
    target[normalizedKey] = (target[normalizedKey] || 0) + 1;
}

export function createDefaultFunnelSummary() {
    return { eventCounts: {}, abortReasonCounts: {}, quickStartVariantCounts: {}, sessionTypeCounts: {} };
}

export function normalizeFunnelSummary(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        eventCounts: countMap(value.eventCounts),
        abortReasonCounts: countMap(value.abortReasonCounts),
        quickStartVariantCounts: countMap(value.quickStartVariantCounts),
        sessionTypeCounts: countMap(value.sessionTypeCounts),
    };
}

export function recordFunnelTelemetry(state, eventType, payload = null) {
    const summary = normalizeFunnelSummary(state.funnelSummary);
    const source = payload && typeof payload === 'object' ? payload : {};
    increment(summary.eventCounts, eventType);
    if (eventType === 'abort') increment(summary.abortReasonCounts, source.reason || source.trigger || 'unknown');
    if (eventType === 'quickstart') increment(summary.quickStartVariantCounts, source.variant || 'unknown');
    if (source.sessionType) increment(summary.sessionTypeCounts, source.sessionType);
    state.funnelSummary = summary;
}

export function createDefaultArcadeSummary() {
    return {
        sectors: 0, runs: 0, abortedRuns: 0, dailyRuns: 0, totalScore: 0,
        totalPeakCombo: 0, totalPeakMultiplier: 0, totalCompletedSectors: 0,
        missionsCompleted: 0, missionsTotal: 0, totalXpEarned: 0,
        rewardChoiceCounts: {}, modifierCounts: {}, terminalReasonCounts: {},
    };
}

export function normalizeArcadeSummary(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        sectors: nonNegativeInt(value.sectors),
        runs: nonNegativeInt(value.runs),
        abortedRuns: nonNegativeInt(value.abortedRuns),
        dailyRuns: nonNegativeInt(value.dailyRuns),
        totalScore: nonNegativeNumber(value.totalScore),
        totalPeakCombo: nonNegativeNumber(value.totalPeakCombo),
        totalPeakMultiplier: nonNegativeNumber(value.totalPeakMultiplier),
        totalCompletedSectors: nonNegativeInt(value.totalCompletedSectors),
        missionsCompleted: nonNegativeInt(value.missionsCompleted),
        missionsTotal: nonNegativeInt(value.missionsTotal),
        totalXpEarned: nonNegativeNumber(value.totalXpEarned),
        rewardChoiceCounts: countMap(value.rewardChoiceCounts),
        modifierCounts: countMap(value.modifierCounts),
        terminalReasonCounts: countMap(value.terminalReasonCounts),
    };
}

export function recordArcadeTelemetry(state, eventType, payload = null) {
    const source = payload?.arcade;
    if (!source || typeof source !== 'object' || source.enabled !== true) return;
    const summary = normalizeArcadeSummary(state.arcadeSummary);
    if (eventType === 'round_end' && source.lastSector) {
        summary.sectors += 1;
        summary.missionsCompleted += nonNegativeInt(source.lastSector.missionsCompleted);
        summary.missionsTotal += nonNegativeInt(source.lastSector.missionsTotal);
        summary.totalXpEarned += nonNegativeNumber(source.lastSector.xpEarned);
        increment(summary.modifierCounts, source.lastSector.modifierId || 'none');
    }
    if (eventType === 'match_end' && source.run) {
        summary.runs += 1;
        if (source.run.aborted === true) summary.abortedRuns += 1;
        if (source.run.isDailyChallenge === true) summary.dailyRuns += 1;
        summary.totalScore += nonNegativeNumber(source.run.score);
        summary.totalPeakCombo += nonNegativeNumber(source.run.peakCombo);
        summary.totalPeakMultiplier += nonNegativeNumber(source.run.peakMultiplier);
        summary.totalCompletedSectors += nonNegativeInt(source.run.completedSectors);
        increment(summary.terminalReasonCounts, source.run.terminalReason || payload?.reason || 'unknown');
        if (Array.isArray(source.run.rewardIds)) {
            source.run.rewardIds.forEach((rewardId) => increment(summary.rewardChoiceCounts, rewardId));
        }
    }
    state.arcadeSummary = summary;
}
