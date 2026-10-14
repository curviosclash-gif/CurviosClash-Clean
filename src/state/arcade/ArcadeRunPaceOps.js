// Stores the score after each sector of the best run of each kind, so intermissions can show
// whether the current run is ahead of or behind its record. This additive field is optional for
// older persisted records and is bounded to keep the profile small.
export const ARCADE_RUN_PACE_MAX_KEYS = 12;
const MAX_SECTORS = 20;

function toPoints(value) {
    const numeric = Math.round(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function resolveArcadeRunPaceKey(state) {
    const config = state?.config || {};
    const tier = String(state?.encounterSequence?.[0]?.difficultyTierId || 'normal').trim() || 'normal';
    const sectorCount = Math.max(1, Math.floor(Number(config.sectorCount) || 1));
    const isDailyChallenge = state?.isDailyChallenge === true || config.dailyChallenge === true;
    return `${String(config.runType || 'gauntlet')}:${tier}:${sectorCount}:${isDailyChallenge ? 'daily' : 'free'}`;
}

export function collectArcadeSectorTotals(sectorHistory) {
    const totals = [];
    let sum = 0;
    for (const entry of Array.isArray(sectorHistory) ? sectorHistory.slice(0, MAX_SECTORS) : []) {
        sum += toPoints(entry?.awardedPoints);
        totals.push(sum);
    }
    return totals;
}

export function normalizeArcadeRunPace(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const entries = Object.entries(source)
        .filter(([key, value]) => key && value && typeof value === 'object' && Array.isArray(value.sectors))
        .map(([key, value]) => /** @type {[string, {score: number, sectors: number[]}]} */ ([key, {
            score: toPoints(value.score),
            sectors: value.sectors.slice(0, MAX_SECTORS).map(toPoints),
        }]))
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, ARCADE_RUN_PACE_MAX_KEYS);
    return Object.fromEntries(entries);
}

export function mergeArcadeRunPace(pace, summary) {
    const next = normalizeArcadeRunPace(pace);
    const key = String(summary?.paceKey || '');
    const sectors = Array.isArray(summary?.sectorTotals) ? summary.sectorTotals : [];
    const score = toPoints(summary?.score);
    if (!key || sectors.length === 0 || score < (next[key]?.score ?? 0)) return next;
    return normalizeArcadeRunPace({ ...next, [key]: { score, sectors } });
}

export function compareArcadeRunPace(records, state) {
    const record = normalizeArcadeRunPace(records?.pace)[resolveArcadeRunPaceKey(state)];
    const totals = collectArcadeSectorTotals(state?.sectorHistory);
    const sector = totals.length;
    const recordPoints = record?.sectors?.[sector - 1];
    if (!sector || !(recordPoints > 0)) return null;
    return { sector, recordPoints, deltaPoints: totals[sector - 1] - recordPoints };
}
