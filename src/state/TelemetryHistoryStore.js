// ============================================
// TelemetryHistoryStore.js - IndexedDB-based persistent telemetry
// for cross-session comparison (max 500 entries, auto-pruning)
// ============================================

const DB_NAME = 'cuviosclash-telemetry';
const DB_VERSION = 1;
const STORE_NAME = 'rounds';
const MAX_ENTRIES = 500;
const PRUNE_BATCH = 50;
const DB_RETRY_ATTEMPTS = 2;

function openDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB not available'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('at', 'at', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
        request.onblocked = () => reject(new Error('indexeddb-open-blocked'));
    });
}

function toNonNegativeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function sanitizeString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
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
        const itemType = sanitizeString(String(key || '').toUpperCase(), '');
        if (!itemType) return;
        normalized[itemType] = toNonNegativeInt(value, 0);
    });
    return normalized;
}

function mergeItemUseTypeCounts(target, source) {
    if (!target || typeof target !== 'object') return;
    if (!source || typeof source !== 'object') return;
    Object.entries(source).forEach(([itemType, count]) => {
        const key = sanitizeString(String(itemType || '').toUpperCase(), '');
        if (!key) return;
        target[key] = (target[key] || 0) + toNonNegativeInt(count, 0);
    });
}

function normalizeStringArray(source, maxEntries = 8) {
    if (!Array.isArray(source)) return [];
    return source
        .map((entry) => sanitizeString(entry, ''))
        .filter(Boolean)
        .slice(0, maxEntries);
}

function normalizePerformance(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        sampleCount: toNonNegativeInt(value.sampleCount, 0),
        frameAvgMs: toNonNegativeNumber(value.frameAvgMs ?? value.frameMs?.avg, 0),
        frameP95Ms: toNonNegativeNumber(value.frameP95Ms ?? value.frameMs?.p95, 0),
        frameP99Ms: toNonNegativeNumber(value.frameP99Ms ?? value.frameMs?.p99, 0),
        frameMaxMs: toNonNegativeNumber(value.frameMaxMs ?? value.frameMs?.max, 0),
        spikeCount: toNonNegativeInt(value.spikeCount ?? value.spikes?.recent, 0),
        subsystems: value.subsystems && typeof value.subsystems === 'object'
            ? Object.fromEntries(Object.entries(value.subsystems).slice(0, 16).map(([key, metric]) => [
                sanitizeString(key, 'unknown'),
                toNonNegativeNumber(metric?.avg ?? metric, 0),
            ]))
            : {},
    };
}

function normalizeArcadeTelemetry(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const lastSector = value.lastSector && typeof value.lastSector === 'object' ? value.lastSector : null;
    const run = value.run && typeof value.run === 'object' ? value.run : null;
    return {
        enabled: value.enabled === true,
        runId: sanitizeString(value.runId, ''),
        phase: sanitizeString(value.phase, ''),
        currentMapKey: sanitizeString(value.currentMapKey, ''),
        activeVehicleId: sanitizeString(value.activeVehicleId, ''),
        lastSector: lastSector ? {
            sectorIndex: toNonNegativeInt(lastSector.sectorIndex, 0),
            modifierId: sanitizeString(lastSector.modifierId, ''),
            awardedPoints: toNonNegativeNumber(lastSector.awardedPoints, 0),
            comboAtSectorEnd: toNonNegativeInt(lastSector.comboAtSectorEnd, 0),
            missionsCompleted: toNonNegativeInt(lastSector.missionsCompleted, 0),
            missionsTotal: toNonNegativeInt(lastSector.missionsTotal, 0),
            xpEarned: toNonNegativeNumber(lastSector.xpEarned, 0),
        } : null,
        run: run ? {
            score: toNonNegativeNumber(run.score, 0),
            peakMultiplier: toNonNegativeNumber(run.peakMultiplier, 1),
            peakCombo: toNonNegativeInt(run.peakCombo, 0),
            completedSectors: toNonNegativeInt(run.completedSectors, 0),
            isDailyChallenge: run.isDailyChallenge === true,
            aborted: run.aborted === true,
            terminalReason: sanitizeString(run.terminalReason, ''),
            rewardIds: normalizeStringArray(run.rewardIds, 32),
        } : null,
    };
}

function normalizeEntry(source) {
    const s = source && typeof source === 'object' ? source : {};
    const context = s.context && typeof s.context === 'object' ? s.context : {};
    return {
        telemetrySchemaVersion: sanitizeString(s.telemetrySchemaVersion, 'round-telemetry.v1'),
        at: sanitizeString(s.at, new Date().toISOString()),
        mapKey: sanitizeString(s.mapKey, 'unknown'),
        mode: sanitizeString(s.mode, 'classic'),
        state: sanitizeString(s.state, 'ROUND_END'),
        reason: sanitizeString(s.reason, 'ELIMINATION'),
        winnerType: sanitizeString(s.winnerType, 'draw'),
        winnerLabel: sanitizeString(s.winnerLabel, 'Unbekannt'),
        duration: toNonNegativeNumber(s.duration),
        selfCollisions: toNonNegativeInt(s.selfCollisions),
        itemUses: toNonNegativeInt(s.itemUses),
        itemUseByMode: normalizeItemUseModeCounts(s.itemUseByMode || s.itemUse?.byMode),
        itemUseByType: normalizeItemUseTypeCounts(s.itemUseByType || s.itemUse?.byType),
        mgHits: toNonNegativeInt(s.mgHits, 0),
        rocketHits: toNonNegativeInt(s.rocketHits, 0),
        shieldAbsorb: toNonNegativeNumber(s.shieldAbsorb, 0),
        hpDamage: toNonNegativeNumber(s.hpDamage, 0),
        stuckEvents: toNonNegativeInt(s.stuckEvents),
        parcoursCompleted: s.parcoursCompleted === true,
        parcoursRouteId: sanitizeString(s.parcoursRouteId, ''),
        parcoursCompletionTimeMs: toNonNegativeNumber(s.parcoursCompletionTimeMs),
        appVersion: sanitizeString(context.appVersion ?? s.appVersion, 'dev'),
        buildId: sanitizeString(context.buildId ?? s.buildId, 'dev'),
        mapRevision: sanitizeString(context.mapRevision ?? s.mapRevision, 'unknown'),
        sessionType: sanitizeString(context.sessionType ?? s.sessionType, 'single'),
        modePath: sanitizeString(context.modePath ?? s.modePath, ''),
        platform: sanitizeString(context.platform ?? s.platform, 'unknown'),
        graphicsQuality: sanitizeString(context.graphicsQuality ?? s.graphicsQuality, 'unknown'),
        playerCount: toNonNegativeInt(context.playerCount ?? s.playerCount, 0),
        humanCount: toNonNegativeInt(context.humanCount ?? s.humanCount, 0),
        botCount: toNonNegativeInt(context.botCount ?? s.botCount, 0),
        botDifficulty: sanitizeString(context.botDifficulty ?? s.botDifficulty, 'unknown'),
        botPolicy: sanitizeString(context.botPolicy ?? s.botPolicy, 'unknown'),
        vehicles: normalizeStringArray(context.vehicles ?? s.vehicles),
        performance: normalizePerformance(s.performance),
        arcade: normalizeArcadeTelemetry(s.arcade),
    };
}

function matchesFilters(entry, filters = null) {
    const value = filters && typeof filters === 'object' ? filters : {};
    const equalsIfSet = (actual, expected) => {
        const normalized = sanitizeString(expected, '');
        return !normalized || normalized === 'all' || actual === normalized;
    };
    if (!equalsIfSet(entry.buildId, value.buildId)) return false;
    if (!equalsIfSet(entry.mapKey, value.mapKey)) return false;
    if (!equalsIfSet(entry.mode, value.mode)) return false;
    const sinceDays = toNonNegativeInt(value.sinceDays, 0);
    if (sinceDays > 0) {
        const timestamp = Date.parse(entry.at);
        const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
    }
    return true;
}

function isRetryableDbError(error) {
    const name = String(error?.name || '').trim();
    if (!name) return false;
    return (
        name === 'AbortError'
        || name === 'InvalidStateError'
        || name === 'TransactionInactiveError'
        || name === 'UnknownError'
        || name === 'NotReadableError'
        || name === 'QuotaExceededError'
    );
}

export class TelemetryHistoryStore {
    constructor() {
        this._dbPromise = null;
        this._db = null;
    }

    async _getDb() {
        if (this._db) {
            return this._db;
        }
        if (!this._dbPromise) {
            this._dbPromise = openDb()
                .then((db) => {
                    this._db = db;
                    return db;
                })
                .catch(() => {
                    this._dbPromise = null;
                    this._db = null;
                    return null;
                });
        }
        const db = await this._dbPromise;
        if (!db) {
            this._dbPromise = null;
        }
        return db;
    }

    _invalidateDb() {
        if (this._db && typeof this._db.close === 'function') {
            try {
                this._db.close();
            } catch {
                // Ignore close errors.
            }
        }
        this._db = null;
        this._dbPromise = null;
    }

    async _runWithDbRetry(operation, fallbackValue) {
        for (let attempt = 0; attempt <= DB_RETRY_ATTEMPTS; attempt += 1) {
            const db = await this._getDb();
            if (!db) return fallbackValue;

            try {
                return await operation(db);
            } catch (error) {
                const shouldRetry = attempt < DB_RETRY_ATTEMPTS && isRetryableDbError(error);
                this._invalidateDb();
                if (!shouldRetry) {
                    return fallbackValue;
                }
            }
        }
        return fallbackValue;
    }

    async recordRound(payload) {
        const entry = normalizeEntry(payload);
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.add(entry);
                tx.oncomplete = () => {
                    this._pruneIfNeeded(db).then(() => resolve(true)).catch(reject);
                };
                tx.onerror = () => reject(tx.error || new Error('record-round-failed'));
                tx.onabort = () => reject(tx.error || new Error('record-round-aborted'));
            } catch (error) {
                reject(error);
            }
        }), false);
    }

    async _pruneIfNeeded(db) {
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const countReq = store.count();
                countReq.onsuccess = () => {
                    const total = countReq.result;
                    if (total <= MAX_ENTRIES) {
                        resolve();
                        return;
                    }
                    const deleteCount = total - MAX_ENTRIES + PRUNE_BATCH;
                    const cursor = store.openCursor();
                    let deleted = 0;
                    cursor.onsuccess = (event) => {
                        const c = /** @type {IDBRequest<IDBCursorWithValue | null>} */ (event.target).result;
                        if (c && deleted < deleteCount) {
                            c.delete();
                            deleted += 1;
                            c.continue();
                            return;
                        }
                        resolve();
                    };
                    cursor.onerror = () => reject(cursor.error || new Error('prune-cursor-failed'));
                };
                countReq.onerror = () => reject(countReq.error || new Error('prune-count-failed'));
                tx.onerror = () => reject(tx.error || new Error('prune-tx-failed'));
                tx.onabort = () => reject(tx.error || new Error('prune-tx-aborted'));
            } catch (error) {
                reject(error);
            }
        });
    }

    async getCount() {
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('count-failed'));
                tx.onerror = () => reject(tx.error || new Error('count-tx-failed'));
                tx.onabort = () => reject(tx.error || new Error('count-tx-aborted'));
            } catch (error) {
                reject(error);
            }
        }), 0);
    }

    async getEntries(filters = null) {
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => {
                    const rows = (req.result || []).map(normalizeEntry).filter((entry) => matchesFilters(entry, filters));
                    resolve(rows);
                };
                req.onerror = () => reject(req.error || new Error('summary-failed'));
                tx.onerror = () => reject(tx.error || new Error('summary-tx-failed'));
                tx.onabort = () => reject(tx.error || new Error('summary-tx-aborted'));
            } catch (error) {
                reject(error);
            }
        }), []);
    }

    async getSummary(filters = null) {
        return this._computeSummary(await this.getEntries(filters));
    }

    summarizeEntries(rows = []) {
        return this._computeSummary(Array.isArray(rows) ? rows : []);
    }

    _computeSummary(rows) {
        if (!rows.length) return this._emptySummary();

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
            parcoursCompletions,
            parcoursCompletionRate: rounds > 0 ? parcoursCompletions / rounds : 0,
            averageParcoursCompletionTimeMs: parcoursCompletions > 0
                ? totalParcoursCompletionTimeMs / parcoursCompletions
                : 0,
            topMaps: this._topEntries(mapCounts, 3),
            topModes: this._topEntries(modeCounts, 3),
            topBuilds: this._topEntries(buildCounts, 5),
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

    _topEntries(counts, limit) {
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([key, count]) => ({ key, count }));
    }

    _emptySummary() {
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
            parcoursCompletions: 0,
            parcoursCompletionRate: 0,
            averageParcoursCompletionTimeMs: 0,
            topMaps: [],
            topModes: [],
            topBuilds: [],
            performanceRounds: 0,
            averageFrameP95Ms: 0,
            averageFrameP99Ms: 0,
            frameSpikesPerRound: 0,
            arcadeSectors: 0,
            arcadeMissionCompletionRate: 0,
        };
    }

    async clear() {
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error || new Error('clear-failed'));
                tx.onabort = () => reject(tx.error || new Error('clear-aborted'));
            } catch (error) {
                reject(error);
            }
        }), false);
    }
}
