// ============================================
// TelemetryHistoryEntry.js - shape and filters for one recorded round
// ============================================
//
// Der Eintrag ist die kleinste Einheit der Rundenhistorie. Er wird beim
// Schreiben und beim Lesen durch dieselbe Normalisierung geschickt, damit
// aeltere Eintraege nach einer Schemaerweiterung nicht als kaputt gelten,
// sondern die neuen Felder mit Null auffuellen.

import { normalizeHeatmapCells } from '../../shared/contracts/RoundHeatmapContract.js';

export function toNonNegativeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function toMeasuredSeconds(value) {
    if (value == null) return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function toNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function sanitizeString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function normalizeItemUseModeCounts(source = null) {
    const modeSource = source && typeof source === 'object' ? source : {};
    return {
        use: toNonNegativeInt(modeSource.use, 0),
        shoot: toNonNegativeInt(modeSource.shoot, 0),
        mg: toNonNegativeInt(modeSource.mg, 0),
        other: toNonNegativeInt(modeSource.other, 0),
    };
}

export function normalizeItemUseTypeCounts(source = null) {
    const typeSource = source && typeof source === 'object' ? source : {};
    const normalized = {};
    Object.entries(typeSource).forEach(([key, value]) => {
        const itemType = sanitizeString(String(key || '').toUpperCase(), '');
        if (!itemType) return;
        normalized[itemType] = toNonNegativeInt(value, 0);
    });
    return normalized;
}

export function mergeItemUseTypeCounts(target, source) {
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

/**
 * Nimmt bewusst beliebige Rohdaten an: die Quelle ist entweder die Runtime oder ein
 * alter IndexedDB-Eintrag, dessen Form aelter sein kann als das heutige Schema.
 * Genau deshalb ist der Parameter `any` und nicht `unknown` - jeder Feldzugriff hier
 * ist gewollt ungeprueft und wird stattdessen zur Laufzeit normalisiert.
 *
 * @param {any} source Rohes Rundenereignis, direkt aus der Runtime oder aus IndexedDB.
 * @returns {Record<string, any>} Vollstaendig aufgefuellter Historieneintrag.
 */
export function normalizeTelemetryHistoryEntry(source) {
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
        mgFireSeconds: toMeasuredSeconds(s.mgFireSeconds),
        itemUseByMode: normalizeItemUseModeCounts(s.itemUseByMode || s.itemUse?.byMode),
        itemUseByType: normalizeItemUseTypeCounts(s.itemUseByType || s.itemUse?.byType),
        mgHits: toNonNegativeInt(s.mgHits, 0),
        rocketHits: toNonNegativeInt(s.rocketHits, 0),
        shieldAbsorb: toNonNegativeNumber(s.shieldAbsorb, 0),
        hpDamage: toNonNegativeNumber(s.hpDamage, 0),
        stuckEvents: toNonNegativeInt(s.stuckEvents),
        // Kills und Spawn-Tode entstehen am Rundenende aus dem Scoreboard und sind
        // die einzigen Werte, die Waffenbalance direkt messen. Ohne sie bleibt nur
        // die Winrate, und die verraet nicht, womit gewonnen wurde.
        kills: toNonNegativeInt(s.kills),
        spawnDeaths: toNonNegativeInt(s.spawnDeaths),
        parcoursCompleted: s.parcoursCompleted === true,
        parcoursRouteId: sanitizeString(s.parcoursRouteId, ''),
        parcoursCompletionTimeMs: toNonNegativeNumber(s.parcoursCompletionTimeMs),
        parcoursCheckpointCount: toNonNegativeInt(s.parcoursCheckpointCount),
        // Die Heatmap lag bisher nur im Menuespeicher, also ungefiltert ueber alle
        // Builds hinweg. Damit liess sich nie belegen, dass ein Geometriefix eine
        // Haeufungsstelle wirklich beseitigt hat - hier ist sie pro Runde datiert
        // und traegt denselben Build wie der Rest des Eintrags.
        heatmap: normalizeHeatmapCells(s.heatmap),
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

/**
 * @param {Record<string, any>} entry
 * @param {{buildId?: string, mapKey?: string, mode?: string, sinceDays?: number} | null} [filters]
 * @returns {boolean}
 */
export function matchesTelemetryHistoryFilters(entry, filters = null) {
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
