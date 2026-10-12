// Pure render budget rules shared by tests/map-render-budget.desktop.spec.js, its contract test
// and scripts/summarize-render-budget.mjs. Budget file: scripts/architecture/map-render-budgets.json.

// The player spawn is rolled per round, so its station is recorded but never budgeted.
const UNBUDGETED_STATIONS = new Set(['spawn']);

// Two identical runs on 12.10.2026 matched exactly on 15 of 69 maps only: animated and siege
// maps are counted at whatever moment loading finished (storm_bridge_siege 84k vs 108k
// triangles, sky ladders +9 transparent meshes). Budgets therefore hold the highest value of
// several runs, and the tolerance absorbs the rest; it is meant to catch real regressions
// such as a hundred extra draw calls or a new point light, not timing noise. Transparent
// meshes are recorded but not budgeted: effects come and go (reactor_site 85/92/166 over three
// runs), and what they cost already shows in draw calls and triangles.
export const RENDER_BUDGET_TOLERANCES = Object.freeze({
    maxCalls: Object.freeze({ relative: 0.1, absolute: 15 }),
    maxTriangles: Object.freeze({ relative: 0.08, absolute: 3000 }),
    pointLights: Object.freeze({ relative: 0, absolute: 0 }),
    shadowCasters: Object.freeze({ relative: 0.1, absolute: 2 }),
});

/** The values a budget entry limits, taken from one probe result. */
export function budgetValuesFromCounts(counts) {
    const frames = counts.frames.filter((frame) => !UNBUDGETED_STATIONS.has(frame.id));
    return {
        maxCalls: Math.max(...frames.map((frame) => frame.calls)),
        maxTriangles: Math.max(...frames.map((frame) => frame.triangles)),
        pointLights: counts.lights.point,
        shadowCasters: counts.meshes.shadowCasters,
    };
}

function allowance(budget, tolerance) {
    if (!tolerance) return 0;
    return Math.max(tolerance.absolute || 0, Math.ceil(budget * (tolerance.relative || 0)));
}

/**
 * Compares one probe result with its budget entry. A value above budget plus tolerance is
 * exceeded; one below budget minus tolerance may be lowered (the budget is a ratchet).
 * @returns {{ exceeded: object[], lowerable: object[] }}
 */
export function checkRenderBudget(counts, entry, tolerances = RENDER_BUDGET_TOLERANCES) {
    const measured = budgetValuesFromCounts(counts);
    const exceeded = [];
    const lowerable = [];
    for (const [key, value] of Object.entries(measured)) {
        const budget = entry[key];
        if (!Number.isFinite(budget)) continue;
        const slack = allowance(budget, tolerances[key]);
        if (value > budget + slack) exceeded.push({ key, value, budget, allowed: budget + slack });
        else if (value < budget - slack) lowerable.push({ key, value, budget });
    }
    return { exceeded, lowerable };
}

/**
 * Builds budget entries from calibration records (one JSON line per map). Several records of
 * one map keep the highest value, so a budget never starts below a measured run.
 */
export function buildRenderBudget(records, { targetFps, measuredOn, measuredAt }) {
    const maps = {};
    for (const record of records) {
        const values = budgetValuesFromCounts(record.counts);
        const entry = maps[record.mapKey] || {};
        for (const [key, value] of Object.entries(values)) entry[key] = Math.max(entry[key] ?? 0, value);
        if (record.play) {
            entry.referenceFps = Math.round(Math.min(entry.referenceFps ?? Infinity, record.play.fps) * 10) / 10;
            entry.belowTargetFps = entry.referenceFps < targetFps;
        }
        maps[record.mapKey] = entry;
    }
    const sorted = Object.fromEntries(Object.keys(maps).sort().map((key) => [key, maps[key]]));
    return { targetFps, measuredOn, measuredAt, maps: sorted };
}
