import {
    ROUND_HEATMAP_MAX_MERGED_CELLS,
    mergeHeatmapCells,
    normalizeHeatmapCells,
} from '../../shared/contracts/RoundHeatmapContract.js';
import {
    LEGACY_STORAGE_KEYS,
    STORAGE_KEYS,
} from '../../shared/storage/StorageKeys.js';
import { PersistentStore } from '../../shared/storage/PersistentStore.js';
import { resolveStorePlatformOptions, loadVersionedRecord } from '../../shared/storage/PersistentStoreLoadUtils.js';
import { TelemetryPreferencesStore } from '../../shared/telemetry/TelemetryPreferencesStore.js';
import {
    createDefaultArcadeSummary,
    createDefaultFunnelSummary,
    normalizeArcadeSummary,
    normalizeFunnelSummary,
    recordArcadeTelemetry,
    recordFunnelTelemetry,
} from './MenuTelemetryAggregateOps.js';

const MENU_TELEMETRY_STORAGE_KEY = STORAGE_KEYS.menuTelemetry;
const MENU_TELEMETRY_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.menuTelemetry;
const MENU_TELEMETRY_STORAGE_SCHEMA_VERSION = 'menu-telemetry.v1';
const MAX_EVENTS = 30;
const MAX_RECENT_ROUNDS = 12;

function sanitizeEventType(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || 'unknown';
}

function sanitizeBucketKey(value, fallback = 'unknown') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

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
        const itemType = sanitizeBucketKey(String(key || '').toUpperCase(), '');
        if (!itemType) return;
        normalized[itemType] = toNonNegativeInt(value, 0);
    });
    return normalized;
}

function mergeItemUseTypeCounts(target, source) {
    if (!target || typeof target !== 'object') return;
    if (!source || typeof source !== 'object') return;
    Object.entries(source).forEach(([itemType, count]) => {
        const key = sanitizeBucketKey(String(itemType || '').toUpperCase(), '');
        if (!key) return;
        target[key] = (target[key] || 0) + toNonNegativeInt(count, 0);
    });
}

function createDefaultBucket() {
    return {
        rounds: 0,
        matches: 0,
        humanWins: 0,
        botWins: 0,
        totalDuration: 0,
        totalSelfCollisions: 0,
        totalItemUses: 0,
        totalStuckEvents: 0,
        totalSpawnDeaths: 0,
        totalKills: 0,
        totalMgHits: 0,
        totalRocketHits: 0,
        totalShieldAbsorb: 0,
        totalHpDamage: 0,
        totalItemUseModeCounts: normalizeItemUseModeCounts(),
        totalItemUseTypeCounts: {},
        parcoursCompletions: 0,
        totalParcoursCompletionTimeMs: 0,
        // Nur Map-Buckets fuellen die Heatmap: dieselbe Weltkoordinate bedeutet
        // ueber zwei verschiedene Maps hinweg nichts, ueber zwei Runden derselben
        // Map dagegen alles.
        heatmap: [],
        lastSeenAt: '',
    };
}

function normalizeBucketCollection(source) {
    const normalized = {};
    if (!source || typeof source !== 'object') return normalized;
    Object.entries(source).forEach(([key, value]) => {
        const bucketKey = sanitizeBucketKey(key);
        const bucket = value && typeof value === 'object' ? value : {};
        normalized[bucketKey] = {
            rounds: toNonNegativeInt(bucket.rounds, 0),
            matches: toNonNegativeInt(bucket.matches, 0),
            humanWins: toNonNegativeInt(bucket.humanWins, 0),
            botWins: toNonNegativeInt(bucket.botWins, 0),
            totalDuration: toNonNegativeNumber(bucket.totalDuration, 0),
            totalSelfCollisions: toNonNegativeInt(bucket.totalSelfCollisions, 0),
            totalItemUses: toNonNegativeInt(bucket.totalItemUses, 0),
            totalStuckEvents: toNonNegativeInt(bucket.totalStuckEvents, 0),
            totalSpawnDeaths: toNonNegativeInt(bucket.totalSpawnDeaths, 0),
            totalKills: toNonNegativeInt(bucket.totalKills, 0),
            totalMgHits: toNonNegativeInt(bucket.totalMgHits, 0),
            totalRocketHits: toNonNegativeInt(bucket.totalRocketHits, 0),
            totalShieldAbsorb: toNonNegativeNumber(bucket.totalShieldAbsorb, 0),
            totalHpDamage: toNonNegativeNumber(bucket.totalHpDamage, 0),
            totalItemUseModeCounts: normalizeItemUseModeCounts(bucket.totalItemUseModeCounts),
            totalItemUseTypeCounts: normalizeItemUseTypeCounts(bucket.totalItemUseTypeCounts),
            parcoursCompletions: toNonNegativeInt(bucket.parcoursCompletions, 0),
            totalParcoursCompletionTimeMs: toNonNegativeNumber(bucket.totalParcoursCompletionTimeMs, 0),
            heatmap: normalizeHeatmapCells(bucket.heatmap, ROUND_HEATMAP_MAX_MERGED_CELLS),
            lastSeenAt: typeof bucket.lastSeenAt === 'string' ? bucket.lastSeenAt : '',
        };
    });
    return normalized;
}

function createDefaultBalanceSummary() {
    return {
        rounds: 0,
        matches: 0,
        humanWins: 0,
        botWins: 0,
        totalDuration: 0,
        totalSelfCollisions: 0,
        totalItemUses: 0,
        totalStuckEvents: 0,
        totalBounceWallEvents: 0,
        totalBotSurvivalSeconds: 0,
        totalBotLives: 0,
        totalSpawnDeaths: 0,
        totalKills: 0,
        totalMgHits: 0,
        totalRocketHits: 0,
        totalShieldAbsorb: 0,
        totalHpDamage: 0,
        totalItemUseModeCounts: normalizeItemUseModeCounts(),
        totalItemUseTypeCounts: {},
        parcoursCompletions: 0,
        totalParcoursCompletionTimeMs: 0,
        maps: {},
        modes: {},
    };
}

function normalizeBalanceSummary(source) {
    const summary = source && typeof source === 'object' ? source : {};
    return {
        rounds: toNonNegativeInt(summary.rounds, 0),
        matches: toNonNegativeInt(summary.matches, 0),
        humanWins: toNonNegativeInt(summary.humanWins, 0),
        botWins: toNonNegativeInt(summary.botWins, 0),
        totalDuration: toNonNegativeNumber(summary.totalDuration, 0),
        totalSelfCollisions: toNonNegativeInt(summary.totalSelfCollisions, 0),
        totalItemUses: toNonNegativeInt(summary.totalItemUses, 0),
        totalStuckEvents: toNonNegativeInt(summary.totalStuckEvents, 0),
        totalBounceWallEvents: toNonNegativeInt(summary.totalBounceWallEvents, 0),
        totalBotSurvivalSeconds: toNonNegativeNumber(summary.totalBotSurvivalSeconds, 0),
        totalBotLives: toNonNegativeInt(summary.totalBotLives, 0),
        totalSpawnDeaths: toNonNegativeInt(summary.totalSpawnDeaths, 0),
        totalKills: toNonNegativeInt(summary.totalKills, 0),
        totalMgHits: toNonNegativeInt(summary.totalMgHits, 0),
        totalRocketHits: toNonNegativeInt(summary.totalRocketHits, 0),
        totalShieldAbsorb: toNonNegativeNumber(summary.totalShieldAbsorb, 0),
        totalHpDamage: toNonNegativeNumber(summary.totalHpDamage, 0),
        totalItemUseModeCounts: normalizeItemUseModeCounts(summary.totalItemUseModeCounts),
        totalItemUseTypeCounts: normalizeItemUseTypeCounts(summary.totalItemUseTypeCounts),
        parcoursCompletions: toNonNegativeInt(summary.parcoursCompletions, 0),
        totalParcoursCompletionTimeMs: toNonNegativeNumber(summary.totalParcoursCompletionTimeMs, 0),
        maps: normalizeBucketCollection(summary.maps),
        modes: normalizeBucketCollection(summary.modes),
    };
}

function normalizeRecentRoundEntry(entry) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const winnerType = sanitizeBucketKey(source.winnerType, 'draw');
    return {
        at: typeof source.at === 'string' ? source.at : '',
        mapKey: sanitizeBucketKey(source.mapKey, 'unknown'),
        mode: sanitizeBucketKey(source.mode, 'classic'),
        state: sanitizeBucketKey(source.state, 'ROUND_END'),
        reason: sanitizeBucketKey(source.reason, 'ELIMINATION'),
        winnerType: winnerType === 'human' || winnerType === 'bot' ? winnerType : 'draw',
        winnerLabel: sanitizeBucketKey(source.winnerLabel, 'Unbekannt'),
        duration: toNonNegativeNumber(source.duration, 0),
        selfCollisions: toNonNegativeInt(source.selfCollisions, 0),
        itemUses: toNonNegativeInt(source.itemUses, 0),
        itemUseByMode: normalizeItemUseModeCounts(source.itemUseByMode || source.itemUse?.byMode),
        itemUseByType: normalizeItemUseTypeCounts(source.itemUseByType || source.itemUse?.byType),
        mgHits: toNonNegativeInt(source.mgHits, 0),
        rocketHits: toNonNegativeInt(source.rocketHits, 0),
        shieldAbsorb: toNonNegativeNumber(source.shieldAbsorb, 0),
        hpDamage: toNonNegativeNumber(source.hpDamage, 0),
        stuckEvents: toNonNegativeInt(source.stuckEvents, 0),
        spawnDeaths: toNonNegativeInt(source.spawnDeaths, 0),
        kills: toNonNegativeInt(source.kills, 0),
        parcoursCompleted: source.parcoursCompleted === true,
        parcoursRouteId: sanitizeBucketKey(source.parcoursRouteId, ''),
        parcoursCompletionTimeMs: toNonNegativeNumber(source.parcoursCompletionTimeMs, 0),
        parcoursCheckpointCount: toNonNegativeInt(source.parcoursCheckpointCount, 0),
        telemetrySchemaVersion: sanitizeBucketKey(source.telemetrySchemaVersion, 'round-telemetry.v1'),
        // Beide Formen lesen: frisch aus der Runtime kommt der Kontext verschachtelt,
        // beim erneuten Normalisieren eines gespeicherten Eintrags liegt er flach.
        // Nur die verschachtelte Form zu kennen hiess, den Build beim Speichern zu verlieren.
        appVersion: sanitizeBucketKey(source.context?.appVersion ?? source.appVersion, 'dev'),
        buildId: sanitizeBucketKey(source.context?.buildId ?? source.buildId, 'dev'),
        mapRevision: sanitizeBucketKey(source.context?.mapRevision ?? source.mapRevision, 'unknown'),
        performance: source.performance && typeof source.performance === 'object'
            ? { ...source.performance }
            : null,
        arcade: source.arcade && typeof source.arcade === 'object'
            ? { ...source.arcade }
            : null,
    };
}

function toEventPayloadCopy(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const copy = { ...payload };
    // Die Heatmap ist im Map-Bucket aufgehoben. Im Rohereignis-Ring waere sie nur
    // Ballast fuer den Persistenzspeicher.
    delete copy.heatmap;
    return copy;
}

function createDefaultState() {
    return {
        abortCount: 0,
        backtrackCount: 0,
        quickStartCount: 0,
        startAttempts: 0,
        events: [],
        balanceSummary: createDefaultBalanceSummary(),
        funnelSummary: createDefaultFunnelSummary(),
        arcadeSummary: createDefaultArcadeSummary(),
        recentRounds: [],
    };
}

function normalizeTelemetryState(source) {
    const normalizedSource = source && typeof source === 'object' ? source : {};
    return {
        ...createDefaultState(),
        abortCount: toNonNegativeInt(normalizedSource.abortCount, 0),
        backtrackCount: toNonNegativeInt(normalizedSource.backtrackCount, 0),
        quickStartCount: toNonNegativeInt(normalizedSource.quickStartCount, 0),
        startAttempts: toNonNegativeInt(normalizedSource.startAttempts, 0),
        events: Array.isArray(normalizedSource.events) ? normalizedSource.events.slice(-MAX_EVENTS) : [],
        balanceSummary: normalizeBalanceSummary(normalizedSource.balanceSummary),
        funnelSummary: normalizeFunnelSummary(normalizedSource.funnelSummary),
        arcadeSummary: normalizeArcadeSummary(normalizedSource.arcadeSummary),
        recentRounds: Array.isArray(normalizedSource.recentRounds)
            ? normalizedSource.recentRounds.map((entry) => normalizeRecentRoundEntry(entry))
            : [],
    };
}

export class MenuTelemetryStore extends PersistentStore {
    constructor(options = {}) {
        super({
            ...options,
            ...resolveStorePlatformOptions(options, MENU_TELEMETRY_STORAGE_KEY, MENU_TELEMETRY_STORAGE_LEGACY_KEYS),
        });
        this.preferencesStore = options.preferencesStore || new TelemetryPreferencesStore(options);
    }

    _loadState() {
        return loadVersionedRecord(
            () => this.readJsonRecord(null),
            {
                artifactType: 'menu-telemetry',
                schemaVersion: MENU_TELEMETRY_STORAGE_SCHEMA_VERSION,
                createDefault: createDefaultState,
                transform: (parsed, versionState) => {
                    const rawState = versionState.hasVersionField
                        ? parsed?.state
                        : (
                            parsed?.state
                            && typeof parsed.state === 'object'
                            && !Array.isArray(parsed.state)
                                ? parsed.state
                                : parsed
                        );
                    return normalizeTelemetryState(rawState);
                },
                createCanonicalRecord: (normalized) => ({
                    schemaVersion: MENU_TELEMETRY_STORAGE_SCHEMA_VERSION,
                    state: normalized,
                }),
                onCanonicalize: (normalized) => this._saveState(normalized),
            }
        );
    }

    _saveState(state) {
        return this.writeJsonRecord({
            schemaVersion: MENU_TELEMETRY_STORAGE_SCHEMA_VERSION,
            state: normalizeTelemetryState(state),
        }).ok;
    }

    _resolveBucket(collection, key) {
        const bucketKey = sanitizeBucketKey(key);
        const existing = collection[bucketKey];
        if (existing && typeof existing === 'object') {
            collection[bucketKey] = {
                ...createDefaultBucket(),
                ...existing,
            };
            collection[bucketKey].totalItemUseModeCounts = normalizeItemUseModeCounts(collection[bucketKey].totalItemUseModeCounts);
            collection[bucketKey].totalItemUseTypeCounts = normalizeItemUseTypeCounts(collection[bucketKey].totalItemUseTypeCounts);
            collection[bucketKey].heatmap = normalizeHeatmapCells(
                collection[bucketKey].heatmap,
                ROUND_HEATMAP_MAX_MERGED_CELLS
            );
            return collection[bucketKey];
        }
        collection[bucketKey] = createDefaultBucket();
        return collection[bucketKey];
    }

    _recordRoundBalance(state, payload = null, recordedAt = '') {
        const summary = normalizeBalanceSummary(state.balanceSummary);
        const source = payload && typeof payload === 'object' ? payload : {};
        const winnerType = sanitizeBucketKey(source.winnerType, 'draw');
        const mapKey = sanitizeBucketKey(source.mapKey, 'unknown');
        const mode = sanitizeBucketKey(source.mode, 'classic');
        const duration = toNonNegativeNumber(source.duration, 0);
        const selfCollisions = toNonNegativeInt(source.selfCollisions, 0);
        const itemUses = toNonNegativeInt(source.itemUses, 0);
        const itemUseByMode = normalizeItemUseModeCounts(source.itemUse?.byMode || source.itemUseByMode);
        const itemUseByType = normalizeItemUseTypeCounts(source.itemUse?.byType || source.itemUseByType);
        const mgHits = toNonNegativeInt(source.mgHits, 0);
        const rocketHits = toNonNegativeInt(source.rocketHits, 0);
        const shieldAbsorb = toNonNegativeNumber(source.shieldAbsorb, 0);
        const hpDamage = toNonNegativeNumber(source.hpDamage, 0);
        const stuckEvents = toNonNegativeInt(source.stuckEvents, 0);
        const bounceWallEvents = toNonNegativeInt(source.bounceWallEvents, 0);
        const botCount = toNonNegativeInt(source.botCount, 0);
        const botSurvivalAverage = toNonNegativeNumber(source.botSurvivalAverage, 0);
        const spawnDeaths = toNonNegativeInt(source.spawnDeaths, 0);
        const reason = sanitizeBucketKey(source.reason, 'ELIMINATION');
        const kills = toNonNegativeInt(source.kills, 0);
        const parcoursCompleted = source.parcoursCompleted === true;
        const parcoursRouteId = sanitizeBucketKey(source.parcoursRouteId, '');
        const parcoursCompletionTimeMs = toNonNegativeNumber(source.parcoursCompletionTimeMs, 0);

        summary.rounds += 1;
        summary.totalDuration += duration;
        summary.totalSelfCollisions += selfCollisions;
        summary.totalItemUses += itemUses;
        summary.totalItemUseModeCounts.use += itemUseByMode.use;
        summary.totalItemUseModeCounts.shoot += itemUseByMode.shoot;
        summary.totalItemUseModeCounts.mg += itemUseByMode.mg;
        summary.totalItemUseModeCounts.other += itemUseByMode.other;
        mergeItemUseTypeCounts(summary.totalItemUseTypeCounts, itemUseByType);
        summary.totalMgHits += mgHits;
        summary.totalRocketHits += rocketHits;
        summary.totalShieldAbsorb += shieldAbsorb;
        summary.totalHpDamage += hpDamage;
        summary.totalStuckEvents += stuckEvents;
        summary.totalBounceWallEvents += bounceWallEvents;
        summary.totalBotLives += botCount;
        summary.totalBotSurvivalSeconds += botSurvivalAverage * botCount;
        summary.totalSpawnDeaths += spawnDeaths;
        summary.totalKills += kills;
        if (parcoursCompleted) {
            summary.parcoursCompletions += 1;
            summary.totalParcoursCompletionTimeMs += parcoursCompletionTimeMs;
        }
        if (winnerType === 'human') summary.humanWins += 1;
        if (winnerType === 'bot') summary.botWins += 1;

        const mapBucket = this._resolveBucket(summary.maps, mapKey);
        mapBucket.rounds += 1;
        mapBucket.totalDuration += duration;
        mapBucket.totalSelfCollisions += selfCollisions;
        mapBucket.totalItemUses += itemUses;
        mapBucket.totalItemUseModeCounts.use += itemUseByMode.use;
        mapBucket.totalItemUseModeCounts.shoot += itemUseByMode.shoot;
        mapBucket.totalItemUseModeCounts.mg += itemUseByMode.mg;
        mapBucket.totalItemUseModeCounts.other += itemUseByMode.other;
        mergeItemUseTypeCounts(mapBucket.totalItemUseTypeCounts, itemUseByType);
        mapBucket.totalMgHits += mgHits;
        mapBucket.totalRocketHits += rocketHits;
        mapBucket.totalShieldAbsorb += shieldAbsorb;
        mapBucket.totalHpDamage += hpDamage;
        mapBucket.totalStuckEvents += stuckEvents;
        mapBucket.totalSpawnDeaths += spawnDeaths;
        mapBucket.totalKills += kills;
        if (parcoursCompleted) {
            mapBucket.parcoursCompletions += 1;
            mapBucket.totalParcoursCompletionTimeMs += parcoursCompletionTimeMs;
        }
        if (winnerType === 'human') mapBucket.humanWins += 1;
        if (winnerType === 'bot') mapBucket.botWins += 1;
        mapBucket.heatmap = mergeHeatmapCells(
            mapBucket.heatmap,
            source.heatmap,
            ROUND_HEATMAP_MAX_MERGED_CELLS
        );
        mapBucket.lastSeenAt = recordedAt;

        const modeBucket = this._resolveBucket(summary.modes, mode);
        modeBucket.rounds += 1;
        modeBucket.totalDuration += duration;
        modeBucket.totalSelfCollisions += selfCollisions;
        modeBucket.totalItemUses += itemUses;
        modeBucket.totalItemUseModeCounts.use += itemUseByMode.use;
        modeBucket.totalItemUseModeCounts.shoot += itemUseByMode.shoot;
        modeBucket.totalItemUseModeCounts.mg += itemUseByMode.mg;
        modeBucket.totalItemUseModeCounts.other += itemUseByMode.other;
        mergeItemUseTypeCounts(modeBucket.totalItemUseTypeCounts, itemUseByType);
        modeBucket.totalMgHits += mgHits;
        modeBucket.totalRocketHits += rocketHits;
        modeBucket.totalShieldAbsorb += shieldAbsorb;
        modeBucket.totalHpDamage += hpDamage;
        modeBucket.totalStuckEvents += stuckEvents;
        modeBucket.totalSpawnDeaths += spawnDeaths;
        modeBucket.totalKills += kills;
        if (parcoursCompleted) {
            modeBucket.parcoursCompletions += 1;
            modeBucket.totalParcoursCompletionTimeMs += parcoursCompletionTimeMs;
        }
        if (winnerType === 'human') modeBucket.humanWins += 1;
        if (winnerType === 'bot') modeBucket.botWins += 1;
        modeBucket.lastSeenAt = recordedAt;

        state.balanceSummary = summary;
        state.recentRounds.push(normalizeRecentRoundEntry({
            at: recordedAt,
            mapKey,
            mode,
            state: sanitizeBucketKey(source.state, 'ROUND_END'),
            reason,
            winnerType,
            winnerLabel: sanitizeBucketKey(source.winnerLabel, winnerType === 'bot' ? 'Bot' : 'Spieler'),
            duration,
            selfCollisions,
            itemUses,
            itemUseByMode,
            itemUseByType,
            mgHits,
            rocketHits,
            shieldAbsorb,
            hpDamage,
            stuckEvents,
            spawnDeaths,
            kills,
            parcoursCompleted,
            parcoursRouteId,
            parcoursCompletionTimeMs,
            parcoursCheckpointCount: toNonNegativeInt(source.parcoursCheckpointCount, 0),
            // Ohne diese drei Durchreichungen steht in der Liste der letzten Runden
            // immer "dev" und "unknown": der Normalisierer liest sie aus, bekam sie
            // hier aber nie gestellt. Damit war nicht erkennbar, welcher Build eine
            // Runde erzeugt hat.
            context: source.context,
            performance: source.performance,
            arcade: source.arcade,
            telemetrySchemaVersion: source.telemetrySchemaVersion,
        }));
        if (state.recentRounds.length > MAX_RECENT_ROUNDS) {
            state.recentRounds = state.recentRounds.slice(state.recentRounds.length - MAX_RECENT_ROUNDS);
        }
    }

    _recordMatchBalance(state, payload = null, recordedAt = '') {
        const summary = normalizeBalanceSummary(state.balanceSummary);
        const source = payload && typeof payload === 'object' ? payload : {};
        const mapKey = sanitizeBucketKey(source.mapKey, 'unknown');
        const mode = sanitizeBucketKey(source.mode, 'classic');

        summary.matches += 1;
        this._resolveBucket(summary.maps, mapKey).matches += 1;
        this._resolveBucket(summary.modes, mode).matches += 1;
        summary.maps[mapKey].lastSeenAt = recordedAt;
        summary.modes[mode].lastSeenAt = recordedAt;
        state.balanceSummary = summary;
    }

    recordEvent(eventType, payload = null) {
        if (this.preferencesStore?.isCollectionEnabled?.() === false) return this._loadState();
        const state = this._loadState();
        const normalizedEventType = sanitizeEventType(eventType);
        const recordedAt = new Date().toISOString();
        if (normalizedEventType === 'abort') state.abortCount += 1;
        if (normalizedEventType === 'backtrack') state.backtrackCount += 1;
        if (normalizedEventType === 'quickstart') state.quickStartCount += 1;
        if (normalizedEventType === 'start_attempt') state.startAttempts += 1;
        if (normalizedEventType === 'round_end') this._recordRoundBalance(state, payload, recordedAt);
        if (normalizedEventType === 'match_end') this._recordMatchBalance(state, payload, recordedAt);
        recordFunnelTelemetry(state, normalizedEventType, payload);
        recordArcadeTelemetry(state, normalizedEventType, payload);

        state.events.push({
            type: normalizedEventType,
            at: recordedAt,
            payload: toEventPayloadCopy(payload),
        });
        if (state.events.length > MAX_EVENTS) {
            state.events = state.events.slice(state.events.length - MAX_EVENTS);
        }
        this._saveState(state);
        return state;
    }

    getSnapshot() {
        return this._loadState();
    }

    clear() {
        const clearedState = createDefaultState();
        this._saveState(clearedState);
        return clearedState;
    }
}
