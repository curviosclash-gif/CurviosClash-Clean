import {
    ROUND_HEATMAP_MAX_MERGED_CELLS,
    normalizeHeatmapCells,
} from '../../shared/contracts/RoundHeatmapContract.js';
import { ensureMenuContractState } from '../../composition/core-ui/CoreSettingsPorts.js';

function toNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.floor(parsed));
}

function toNonNegativeNumber(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
}

function sanitizeTelemetryKey(value, fallback = 'unknown') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeItemUseModeCounts(source = null) {
    const modeSource = source && typeof source === 'object' ? source : {};
    return {
        use: toNonNegativeInt(modeSource.use, 0),
        shoot: toNonNegativeInt(modeSource.shoot, 0),
        mg: toNonNegativeInt(modeSource.mg, 0),
        other: toNonNegativeInt(modeSource.other, 0),
    };
}

function normalizeItemUseTypeCounts(source = null) {
    const typeSource = source && typeof source === 'object' ? source : {};
    const normalized = {};
    Object.entries(typeSource).forEach(([key, value]) => {
        const itemType = sanitizeTelemetryKey(String(key || '').toUpperCase(), '');
        if (!itemType) return;
        normalized[itemType] = toNonNegativeInt(value, 0);
    });
    return normalized;
}

function normalizeTelemetryBucketSnapshot(source) {
    const bucket = source && typeof source === 'object' ? source : {};
    return {
        rounds: toNonNegativeInt(bucket.rounds, 0),
        matches: toNonNegativeInt(bucket.matches, 0),
        humanWins: toNonNegativeInt(bucket.humanWins, 0),
        botWins: toNonNegativeInt(bucket.botWins, 0),
        totalDuration: toNonNegativeNumber(bucket.totalDuration, 0),
        totalSelfCollisions: toNonNegativeInt(bucket.totalSelfCollisions, 0),
        totalItemUses: toNonNegativeInt(bucket.totalItemUses, 0),
        totalItemUseModeCounts: normalizeItemUseModeCounts(bucket.totalItemUseModeCounts),
        totalItemUseTypeCounts: normalizeItemUseTypeCounts(bucket.totalItemUseTypeCounts),
        totalMgHits: toNonNegativeInt(bucket.totalMgHits, 0),
        totalRocketHits: toNonNegativeInt(bucket.totalRocketHits, 0),
        totalShieldAbsorb: toNonNegativeNumber(bucket.totalShieldAbsorb, 0),
        totalHpDamage: toNonNegativeNumber(bucket.totalHpDamage, 0),
        totalStuckEvents: toNonNegativeInt(bucket.totalStuckEvents, 0),
        totalSpawnDeaths: toNonNegativeInt(bucket.totalSpawnDeaths, 0),
        totalKills: toNonNegativeInt(bucket.totalKills, 0),
        parcoursCompletions: toNonNegativeInt(bucket.parcoursCompletions, 0),
        totalParcoursCompletionTimeMs: toNonNegativeNumber(bucket.totalParcoursCompletionTimeMs, 0),
        heatmap: normalizeHeatmapCells(bucket.heatmap, ROUND_HEATMAP_MAX_MERGED_CELLS),
        lastSeenAt: typeof bucket.lastSeenAt === 'string' ? bucket.lastSeenAt : '',
    };
}

function deriveTelemetryTopBuckets(source, fallbackKey) {
    if (!source || typeof source !== 'object') return [];
    return Object.entries(source)
        .map(([key, value]) => {
            const bucket = normalizeTelemetryBucketSnapshot(value);
            return {
                key: sanitizeTelemetryKey(key, fallbackKey),
                rounds: bucket.rounds,
                matches: bucket.matches,
                humanWins: bucket.humanWins,
                botWins: bucket.botWins,
                humanWinRate: bucket.rounds > 0 ? bucket.humanWins / bucket.rounds : 0,
                botWinRate: bucket.rounds > 0 ? bucket.botWins / bucket.rounds : 0,
                averageRoundDuration: bucket.rounds > 0 ? bucket.totalDuration / bucket.rounds : 0,
                selfCollisionsPerRound: bucket.rounds > 0 ? bucket.totalSelfCollisions / bucket.rounds : 0,
                itemUsesPerRound: bucket.rounds > 0 ? bucket.totalItemUses / bucket.rounds : 0,
                itemUsesWithoutMgPerRound: bucket.rounds > 0
                    ? Math.max(0, bucket.totalItemUses - bucket.totalItemUseModeCounts.mg) / bucket.rounds
                    : 0,
                itemUseModePerRound: {
                    use: bucket.rounds > 0 ? bucket.totalItemUseModeCounts.use / bucket.rounds : 0,
                    shoot: bucket.rounds > 0 ? bucket.totalItemUseModeCounts.shoot / bucket.rounds : 0,
                    mg: bucket.rounds > 0 ? bucket.totalItemUseModeCounts.mg / bucket.rounds : 0,
                    other: bucket.rounds > 0 ? bucket.totalItemUseModeCounts.other / bucket.rounds : 0,
                },
                itemUseTypeTotals: { ...bucket.totalItemUseTypeCounts },
                mgHitsPerRound: bucket.rounds > 0 ? bucket.totalMgHits / bucket.rounds : 0,
                rocketHitsPerRound: bucket.rounds > 0 ? bucket.totalRocketHits / bucket.rounds : 0,
                shieldAbsorbPerRound: bucket.rounds > 0 ? bucket.totalShieldAbsorb / bucket.rounds : 0,
                hpDamagePerRound: bucket.rounds > 0 ? bucket.totalHpDamage / bucket.rounds : 0,
                stuckEventsPerRound: bucket.rounds > 0 ? bucket.totalStuckEvents / bucket.rounds : 0,
                spawnDeathsPerRound: bucket.rounds > 0 ? bucket.totalSpawnDeaths / bucket.rounds : 0,
                killsPerRound: bucket.rounds > 0 ? bucket.totalKills / bucket.rounds : 0,
                parcoursCompletionRate: bucket.rounds > 0 ? bucket.parcoursCompletions / bucket.rounds : 0,
                averageParcoursCompletionTimeMs: bucket.parcoursCompletions > 0
                    ? bucket.totalParcoursCompletionTimeMs / bucket.parcoursCompletions
                    : 0,
                heatmap: bucket.heatmap,
                lastSeenAt: bucket.lastSeenAt,
            };
        })
        .filter((entry) => entry.rounds > 0 || entry.matches > 0)
        .sort((left, right) => {
            if (right.rounds !== left.rounds) return right.rounds - left.rounds;
            if (right.matches !== left.matches) return right.matches - left.matches;
            return left.key.localeCompare(right.key);
        })
        .slice(0, 3);
}

function normalizeTelemetryRecentRounds(source) {
    if (!Array.isArray(source)) return [];
    return source
        .slice(-6)
        .map((entry) => ({
            at: typeof entry?.at === 'string' ? entry.at : '',
            mapKey: sanitizeTelemetryKey(entry?.mapKey, 'unknown'),
            mode: sanitizeTelemetryKey(entry?.mode, 'classic'),
            state: sanitizeTelemetryKey(entry?.state, 'ROUND_END'),
            reason: sanitizeTelemetryKey(entry?.reason, 'ELIMINATION'),
            winnerType: sanitizeTelemetryKey(entry?.winnerType, 'draw'),
            winnerLabel: sanitizeTelemetryKey(entry?.winnerLabel, 'Unbekannt'),
            duration: toNonNegativeNumber(entry?.duration, 0),
            selfCollisions: toNonNegativeInt(entry?.selfCollisions, 0),
            itemUses: toNonNegativeInt(entry?.itemUses, 0),
            itemUseByMode: normalizeItemUseModeCounts(entry?.itemUseByMode),
            itemUseByType: normalizeItemUseTypeCounts(entry?.itemUseByType),
            mgHits: toNonNegativeInt(entry?.mgHits, 0),
            rocketHits: toNonNegativeInt(entry?.rocketHits, 0),
            shieldAbsorb: toNonNegativeNumber(entry?.shieldAbsorb, 0),
            hpDamage: toNonNegativeNumber(entry?.hpDamage, 0),
            stuckEvents: toNonNegativeInt(entry?.stuckEvents, 0),
            spawnDeaths: toNonNegativeInt(entry?.spawnDeaths, 0),
            kills: toNonNegativeInt(entry?.kills, 0),
            parcoursCompleted: entry?.parcoursCompleted === true,
            parcoursRouteId: sanitizeTelemetryKey(entry?.parcoursRouteId, ''),
            parcoursCompletionTimeMs: toNonNegativeNumber(entry?.parcoursCompletionTimeMs, 0),
            parcoursCheckpointCount: toNonNegativeInt(entry?.parcoursCheckpointCount, 0),
            telemetrySchemaVersion: sanitizeTelemetryKey(entry?.telemetrySchemaVersion, 'round-telemetry.v1'),
            appVersion: sanitizeTelemetryKey(entry?.appVersion, 'dev'),
            buildId: sanitizeTelemetryKey(entry?.buildId, 'dev'),
            mapRevision: sanitizeTelemetryKey(entry?.mapRevision, 'unknown'),
            performance: entry?.performance && typeof entry.performance === 'object'
                ? { ...entry.performance }
                : null,
            arcade: entry?.arcade && typeof entry.arcade === 'object'
                ? { ...entry.arcade }
                : null,
        }));
}

function normalizeCountMap(source = null) {
    const normalized = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return normalized;
    Object.entries(source).forEach(([key, value]) => {
        const normalizedKey = sanitizeTelemetryKey(key, '');
        if (normalizedKey) normalized[normalizedKey] = toNonNegativeInt(value, 0);
    });
    return normalized;
}

function normalizeFunnelSnapshot(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const eventCounts = normalizeCountMap(value.eventCounts);
    const attempts = toNonNegativeInt(eventCounts.start_attempt, 0);
    const rounds = toNonNegativeInt(eventCounts.round_end, 0);
    const matches = toNonNegativeInt(eventCounts.match_end, 0);
    const aborts = toNonNegativeInt(eventCounts.abort, 0);
    return {
        eventCounts,
        abortReasonCounts: normalizeCountMap(value.abortReasonCounts),
        quickStartVariantCounts: normalizeCountMap(value.quickStartVariantCounts),
        sessionTypeCounts: normalizeCountMap(value.sessionTypeCounts),
        startToRoundRate: attempts > 0 ? Math.min(1, rounds / attempts) : 0,
        startToMatchRate: attempts > 0 ? Math.min(1, matches / attempts) : 0,
        abortRate: attempts > 0 ? Math.min(1, aborts / attempts) : 0,
    };
}

function normalizeArcadeSnapshot(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const runs = toNonNegativeInt(value.runs, 0);
    const sectors = toNonNegativeInt(value.sectors, 0);
    const missionsTotal = toNonNegativeInt(value.missionsTotal, 0);
    return {
        sectors,
        runs,
        abortedRuns: toNonNegativeInt(value.abortedRuns, 0),
        dailyRuns: toNonNegativeInt(value.dailyRuns, 0),
        averageScore: runs > 0 ? toNonNegativeNumber(value.totalScore, 0) / runs : 0,
        averagePeakCombo: runs > 0 ? toNonNegativeNumber(value.totalPeakCombo, 0) / runs : 0,
        averagePeakMultiplier: runs > 0 ? toNonNegativeNumber(value.totalPeakMultiplier, 0) / runs : 0,
        averageCompletedSectors: runs > 0 ? toNonNegativeInt(value.totalCompletedSectors, 0) / runs : 0,
        missionCompletionRate: missionsTotal > 0 ? toNonNegativeInt(value.missionsCompleted, 0) / missionsTotal : 0,
        totalXpEarned: toNonNegativeNumber(value.totalXpEarned, 0),
        rewardChoiceCounts: normalizeCountMap(value.rewardChoiceCounts),
        modifierCounts: normalizeCountMap(value.modifierCounts),
        terminalReasonCounts: normalizeCountMap(value.terminalReasonCounts),
    };
}

export function normalizeTelemetrySnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const balanceSource = source.balanceSummary && typeof source.balanceSummary === 'object'
        ? source.balanceSummary
        : {};
    const rounds = toNonNegativeInt(balanceSource.rounds, 0);
    const matches = toNonNegativeInt(balanceSource.matches, 0);
    const humanWins = toNonNegativeInt(balanceSource.humanWins, 0);
    const botWins = toNonNegativeInt(balanceSource.botWins, 0);
    const totalDuration = toNonNegativeNumber(balanceSource.totalDuration, 0);
    const totalSelfCollisions = toNonNegativeInt(balanceSource.totalSelfCollisions, 0);
    const totalItemUses = toNonNegativeInt(balanceSource.totalItemUses, 0);
    const totalItemUseModeCounts = normalizeItemUseModeCounts(balanceSource.totalItemUseModeCounts);
    const totalItemUseTypeCounts = normalizeItemUseTypeCounts(balanceSource.totalItemUseTypeCounts);
    const totalMgHits = toNonNegativeInt(balanceSource.totalMgHits, 0);
    const totalRocketHits = toNonNegativeInt(balanceSource.totalRocketHits, 0);
    const totalShieldAbsorb = toNonNegativeNumber(balanceSource.totalShieldAbsorb, 0);
    const totalHpDamage = toNonNegativeNumber(balanceSource.totalHpDamage, 0);
    const totalStuckEvents = toNonNegativeInt(balanceSource.totalStuckEvents, 0);
    const totalBounceWallEvents = toNonNegativeInt(balanceSource.totalBounceWallEvents, 0);
    const totalBotSurvivalSeconds = toNonNegativeNumber(balanceSource.totalBotSurvivalSeconds, 0);
    const totalBotLives = toNonNegativeInt(balanceSource.totalBotLives, 0);
    const totalSpawnDeaths = toNonNegativeInt(balanceSource.totalSpawnDeaths, 0);
    const totalKills = toNonNegativeInt(balanceSource.totalKills, 0);
    const parcoursCompletions = toNonNegativeInt(balanceSource.parcoursCompletions, 0);
    const totalParcoursCompletionTimeMs = toNonNegativeNumber(balanceSource.totalParcoursCompletionTimeMs, 0);
    return {
        abortCount: toNonNegativeInt(source.abortCount, 0),
        backtrackCount: toNonNegativeInt(source.backtrackCount, 0),
        quickStartCount: toNonNegativeInt(source.quickStartCount, 0),
        startAttempts: toNonNegativeInt(source.startAttempts, 0),
        lastEvents: Array.isArray(source.events) ? source.events.slice(-15) : [],
        funnel: normalizeFunnelSnapshot(source.funnelSummary),
        arcade: normalizeArcadeSnapshot(source.arcadeSummary),
        balance: {
            rounds,
            matches,
            humanWins,
            botWins,
            humanWinRate: rounds > 0 ? humanWins / rounds : 0,
            botWinRate: rounds > 0 ? botWins / rounds : 0,
            averageRoundDuration: rounds > 0 ? totalDuration / rounds : 0,
            selfCollisionsPerRound: rounds > 0 ? totalSelfCollisions / rounds : 0,
            itemUsesPerRound: rounds > 0 ? totalItemUses / rounds : 0,
            // MG-Dauerfeuer dominiert totalItemUses um Groessenordnungen. Der
            // MG-freie Wert ist der, der zur Item-Balance etwas aussagt.
            itemUsesWithoutMgPerRound: rounds > 0
                ? Math.max(0, totalItemUses - totalItemUseModeCounts.mg) / rounds
                : 0,
            itemUseModePerRound: {
                use: rounds > 0 ? totalItemUseModeCounts.use / rounds : 0,
                shoot: rounds > 0 ? totalItemUseModeCounts.shoot / rounds : 0,
                mg: rounds > 0 ? totalItemUseModeCounts.mg / rounds : 0,
                other: rounds > 0 ? totalItemUseModeCounts.other / rounds : 0,
            },
            itemUseTypeTotals: { ...totalItemUseTypeCounts },
            mgHitsPerRound: rounds > 0 ? totalMgHits / rounds : 0,
            rocketHitsPerRound: rounds > 0 ? totalRocketHits / rounds : 0,
            shieldAbsorbPerRound: rounds > 0 ? totalShieldAbsorb / rounds : 0,
            hpDamagePerRound: rounds > 0 ? totalHpDamage / rounds : 0,
            stuckEventsPerRound: rounds > 0 ? totalStuckEvents / rounds : 0,
            stuckEventsPerMinute: totalDuration > 0 ? totalStuckEvents / (totalDuration / 60) : 0,
            bounceWallPerRound: rounds > 0 ? totalBounceWallEvents / rounds : 0,
            averageBotSurvival: totalBotLives > 0 ? totalBotSurvivalSeconds / totalBotLives : 0,
            spawnDeathsPerRound: rounds > 0 ? totalSpawnDeaths / rounds : 0,
            killsPerRound: rounds > 0 ? totalKills / rounds : 0,
            parcoursCompletions,
            parcoursCompletionRate: rounds > 0 ? parcoursCompletions / rounds : 0,
            averageParcoursCompletionTimeMs: parcoursCompletions > 0
                ? totalParcoursCompletionTimeMs / parcoursCompletions
                : 0,
        },
        topMaps: deriveTelemetryTopBuckets(balanceSource.maps, 'unknown'),
        topModes: deriveTelemetryTopBuckets(balanceSource.modes, 'classic'),
        recentRounds: normalizeTelemetryRecentRounds(source.recentRounds),
    };
}

export function createSettingsTelemetryFacade(options = {}) {
    const menuTelemetryStore = options.menuTelemetryStore;
    const telemetryHistoryStore = options.telemetryHistoryStore;
    const authoringTelemetryStore = options.authoringTelemetryStore;
    const telemetryPreferencesStore = options.telemetryPreferencesStore;

    function getMenuTelemetrySnapshot(settings = null) {
        const snapshot = normalizeTelemetrySnapshot(menuTelemetryStore.getSnapshot());
        if (settings && typeof settings === 'object') {
            ensureMenuContractState(settings);
            settings.localSettings.telemetryState = {
                ...settings.localSettings.telemetryState,
                ...snapshot,
            };
        }
        return snapshot;
    }

    function recordMenuTelemetry(settings, eventType, payload = null) {
        const snapshot = normalizeTelemetrySnapshot(menuTelemetryStore.recordEvent(eventType, payload));
        if (settings && typeof settings === 'object') {
            ensureMenuContractState(settings);
            settings.localSettings.telemetryState = {
                ...settings.localSettings.telemetryState,
                ...snapshot,
            };
        }
        const normalizedType = typeof eventType === 'string' ? eventType.trim().toLowerCase() : '';
        if (
            normalizedType === 'round_end'
            && payload
            && telemetryPreferencesStore?.isCollectionEnabled?.() !== false
            && telemetryHistoryStore?.recordRound
        ) {
            telemetryHistoryStore.recordRound(payload).catch(() => {});
        }
        return snapshot;
    }

    function getTelemetryHistorySummary(filters = null) {
        if (!telemetryHistoryStore?.getSummary) return {};
        return telemetryHistoryStore.getSummary(filters);
    }

    function getTelemetryPreferences() {
        return telemetryPreferencesStore?.getSnapshot?.() || { collectionEnabled: true };
    }

    function setTelemetryCollectionEnabled(enabled) {
        return telemetryPreferencesStore?.setCollectionEnabled?.(enabled)
            || { collectionEnabled: enabled === true, saved: false };
    }

    async function getTelemetryExportSnapshot(filters = null) {
        const historyEntries = telemetryHistoryStore?.getEntries
            ? await telemetryHistoryStore.getEntries(filters)
            : [];
        const historySummary = telemetryHistoryStore?.summarizeEntries
            ? telemetryHistoryStore.summarizeEntries(historyEntries)
            : {};
        return {
            schemaVersion: 'curviosclash-telemetry-export.v1',
            exportedAt: new Date().toISOString(),
            filters: filters && typeof filters === 'object' ? { ...filters } : {},
            preferences: getTelemetryPreferences(),
            gameplay: getMenuTelemetrySnapshot(),
            historySummary,
            historyEntries,
            authoring: authoringTelemetryStore?.getSnapshot?.() || null,
        };
    }

    async function clearTelemetry(settings = null) {
        const gameplay = menuTelemetryStore?.clear?.();
        const normalizedGameplay = normalizeTelemetrySnapshot(gameplay);
        if (settings && typeof settings === 'object') {
            ensureMenuContractState(settings);
            settings.localSettings.telemetryState = normalizedGameplay;
        }
        const authoringCleared = authoringTelemetryStore?.clear?.() !== false;
        const historyCleared = telemetryHistoryStore?.clear ? await telemetryHistoryStore.clear() : true;
        return {
            ok: authoringCleared && historyCleared,
            gameplay: normalizedGameplay,
            authoringCleared,
            historyCleared,
        };
    }

    return {
        getMenuTelemetrySnapshot,
        recordMenuTelemetry,
        getTelemetryHistorySummary,
        getTelemetryPreferences,
        setTelemetryCollectionEnabled,
        getTelemetryExportSnapshot,
        clearTelemetry,
    };
}
