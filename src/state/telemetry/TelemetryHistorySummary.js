// ============================================
// TelemetryHistorySummary.js - aggregates recorded rounds into comparable KPIs
// ============================================
//
// Die Zusammenfassung beantwortet die Frage "wie unterscheiden sich diese
// Runden von jenen". Deshalb sind fast alle Werte pro Runde normiert: nur so
// laesst sich ein Build mit 40 Runden gegen einen mit 8 Runden vergleichen.

import {
    ROUND_HEATMAP_MAX_MERGED_CELLS,
    mergeHeatmapCells,
} from '../../shared/contracts/RoundHeatmapContract.js';
import {
    mergeItemUseTypeCounts,
    normalizeItemUseModeCounts,
    normalizeItemUseTypeCounts,
    sanitizeString,
    toNonNegativeInt,
    toNonNegativeNumber,
} from './TelemetryHistoryEntry.js';

// Nur Map-Buckets fuehren Heatmaps zusammen: dieselbe Weltkoordinate bedeutet ueber
// zwei verschiedene Maps hinweg nichts, ueber zwei Runden derselben Map dagegen alles.
function collectMapHeatmaps(rows) {
    const byMap = new Map();
    for (const row of rows) {
        const cells = Array.isArray(row?.heatmap) ? row.heatmap : null;
        if (!cells || cells.length === 0) continue;
        const key = sanitizeString(row?.mapKey, 'unknown');
        byMap.set(key, mergeHeatmapCells(byMap.get(key) || [], cells, ROUND_HEATMAP_MAX_MERGED_CELLS));
    }
    return [...byMap.entries()]
        .map(([key, heatmap]) => ({
            key,
            heatmap,
            totalSamples: heatmap.reduce((sum, cell) => sum + cell.count, 0),
        }))
        .sort((left, right) => right.totalSamples - left.totalSamples || left.key.localeCompare(right.key));
}

function topEntries(counts, limit) {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }));
}

export function createEmptyTelemetryHistorySummary() {
    return {
        rounds: 0,
        humanWins: 0,
        botWins: 0,
        humanWinRate: 0,
        botWinRate: 0,
        averageDuration: 0,
        selfCollisionsPerRound: 0,
        itemUsesPerRound: 0,
        itemUseModePerRound: normalizeItemUseModeCounts(),
        itemUseTypeTotals: {},
        mgHitsPerRound: 0,
        rocketHitsPerRound: 0,
        shieldAbsorbPerRound: 0,
        hpDamagePerRound: 0,
        stuckEventsPerRound: 0,
        killsPerRound: 0,
        spawnDeathsPerRound: 0,
        parcoursCompletions: 0,
        parcoursCompletionRate: 0,
        averageParcoursCompletionTimeMs: 0,
        topMaps: [],
        topModes: [],
        topBuilds: [],
        mapHeatmaps: [],
        performanceRounds: 0,
        averageFrameP95Ms: 0,
        averageFrameP99Ms: 0,
        frameSpikesPerRound: 0,
        arcadeSectors: 0,
        arcadeMissionCompletionRate: 0,
    };
}

/**
 * @param {Array<Record<string, any>>} rows
 * @returns {ReturnType<typeof createEmptyTelemetryHistorySummary>}
 */
export function computeTelemetryHistorySummary(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return createEmptyTelemetryHistorySummary();

    let totalDuration = 0;
    let humanWins = 0;
    let botWins = 0;
    let totalSelfCollisions = 0;
    let totalItemUses = 0;
    const totalItemUseByMode = normalizeItemUseModeCounts();
    const totalItemUseByType = {};
    let totalMgHits = 0;
    let totalRocketHits = 0;
    let totalShieldAbsorb = 0;
    let totalHpDamage = 0;
    let totalStuckEvents = 0;
    let totalKills = 0;
    let totalSpawnDeaths = 0;
    let parcoursCompletions = 0;
    let totalParcoursCompletionTimeMs = 0;
    const mapCounts = {};
    const modeCounts = {};
    const buildCounts = {};
    let performanceRounds = 0;
    let totalFrameP95Ms = 0;
    let totalFrameP99Ms = 0;
    let totalFrameSpikes = 0;
    let arcadeSectors = 0;
    let arcadeMissionsCompleted = 0;
    let arcadeMissionsTotal = 0;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        totalDuration += toNonNegativeNumber(r.duration);
        totalSelfCollisions += toNonNegativeInt(r.selfCollisions);
        totalItemUses += toNonNegativeInt(r.itemUses);
        const itemUseByMode = normalizeItemUseModeCounts(r.itemUseByMode);
        totalItemUseByMode.use += itemUseByMode.use;
        totalItemUseByMode.shoot += itemUseByMode.shoot;
        totalItemUseByMode.mg += itemUseByMode.mg;
        totalItemUseByMode.other += itemUseByMode.other;
        mergeItemUseTypeCounts(totalItemUseByType, normalizeItemUseTypeCounts(r.itemUseByType));
        totalMgHits += toNonNegativeInt(r.mgHits, 0);
        totalRocketHits += toNonNegativeInt(r.rocketHits, 0);
        totalShieldAbsorb += toNonNegativeNumber(r.shieldAbsorb, 0);
        totalHpDamage += toNonNegativeNumber(r.hpDamage, 0);
        totalStuckEvents += toNonNegativeInt(r.stuckEvents);
        totalKills += toNonNegativeInt(r.kills);
        totalSpawnDeaths += toNonNegativeInt(r.spawnDeaths);
        if (toNonNegativeInt(r.performance?.sampleCount, 0) > 0) {
            performanceRounds += 1;
            totalFrameP95Ms += toNonNegativeNumber(r.performance?.frameP95Ms, 0);
            totalFrameP99Ms += toNonNegativeNumber(r.performance?.frameP99Ms, 0);
            totalFrameSpikes += toNonNegativeInt(r.performance?.spikeCount, 0);
        }
        if (r.arcade?.enabled === true && r.arcade?.lastSector) {
            arcadeSectors += 1;
            arcadeMissionsCompleted += toNonNegativeInt(r.arcade.lastSector.missionsCompleted, 0);
            arcadeMissionsTotal += toNonNegativeInt(r.arcade.lastSector.missionsTotal, 0);
        }
        if (r.parcoursCompleted === true) {
            parcoursCompletions += 1;
            totalParcoursCompletionTimeMs += toNonNegativeNumber(r.parcoursCompletionTimeMs);
        }
        if (r.winnerType === 'human') humanWins += 1;
        if (r.winnerType === 'bot') botWins += 1;

        const mk = sanitizeString(r.mapKey, 'unknown');
        mapCounts[mk] = (mapCounts[mk] || 0) + 1;

        const md = sanitizeString(r.mode, 'classic');
        modeCounts[md] = (modeCounts[md] || 0) + 1;

        const buildId = sanitizeString(r.buildId, 'dev');
        buildCounts[buildId] = (buildCounts[buildId] || 0) + 1;
    }

    const rounds = rows.length;
    return {
        rounds,
        humanWins,
        botWins,
        humanWinRate: rounds > 0 ? humanWins / rounds : 0,
        botWinRate: rounds > 0 ? botWins / rounds : 0,
        averageDuration: rounds > 0 ? totalDuration / rounds : 0,
        selfCollisionsPerRound: rounds > 0 ? totalSelfCollisions / rounds : 0,
        itemUsesPerRound: rounds > 0 ? totalItemUses / rounds : 0,
        itemUseModePerRound: {
            use: rounds > 0 ? totalItemUseByMode.use / rounds : 0,
            shoot: rounds > 0 ? totalItemUseByMode.shoot / rounds : 0,
            mg: rounds > 0 ? totalItemUseByMode.mg / rounds : 0,
            other: rounds > 0 ? totalItemUseByMode.other / rounds : 0,
        },
        itemUseTypeTotals: { ...totalItemUseByType },
        mgHitsPerRound: rounds > 0 ? totalMgHits / rounds : 0,
        rocketHitsPerRound: rounds > 0 ? totalRocketHits / rounds : 0,
        shieldAbsorbPerRound: rounds > 0 ? totalShieldAbsorb / rounds : 0,
        hpDamagePerRound: rounds > 0 ? totalHpDamage / rounds : 0,
        stuckEventsPerRound: rounds > 0 ? totalStuckEvents / rounds : 0,
        killsPerRound: rounds > 0 ? totalKills / rounds : 0,
        spawnDeathsPerRound: rounds > 0 ? totalSpawnDeaths / rounds : 0,
        parcoursCompletions,
        parcoursCompletionRate: rounds > 0 ? parcoursCompletions / rounds : 0,
        averageParcoursCompletionTimeMs: parcoursCompletions > 0
            ? totalParcoursCompletionTimeMs / parcoursCompletions
            : 0,
        topMaps: topEntries(mapCounts, 3),
        topModes: topEntries(modeCounts, 3),
        topBuilds: topEntries(buildCounts, 5),
        mapHeatmaps: collectMapHeatmaps(rows),
        performanceRounds,
        averageFrameP95Ms: performanceRounds > 0 ? totalFrameP95Ms / performanceRounds : 0,
        averageFrameP99Ms: performanceRounds > 0 ? totalFrameP99Ms / performanceRounds : 0,
        frameSpikesPerRound: performanceRounds > 0 ? totalFrameSpikes / performanceRounds : 0,
        arcadeSectors,
        arcadeMissionCompletionRate: arcadeMissionsTotal > 0
            ? arcadeMissionsCompleted / arcadeMissionsTotal
            : 0,
    };
}
