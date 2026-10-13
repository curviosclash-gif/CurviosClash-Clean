// Round telemetry for developer tools (F7 console, playtest MCP): overview with filters,
// export as JSON or CSV, and clearing. Reads through the settings manager's telemetry facade,
// so the tools see exactly what the game recorded. Nothing here records telemetry.

import {
    TELEMETRY_EXPORT_SCHEMA_VERSION,
    collectTelemetryFilterOptions,
    createTelemetryExportFileName,
    normalizeTelemetryToolFilters,
    summarizeTelemetryRound,
    telemetryRowsToCsv,
} from '../../shared/contracts/TelemetryExportContract.js';

const RECENT_ROUND_LIMIT = 12;

function requireSettingsManager(getSettingsManager) {
    const settingsManager = getSettingsManager?.() || null;
    if (typeof settingsManager?.getTelemetryExportSnapshot !== 'function') {
        throw Object.assign(new Error('Telemetrie ist im laufenden Spiel nicht erreichbar.'), { reason: 'no_telemetry' });
    }
    return settingsManager;
}

/** Heatmaps are large and only the menu draws them; the tools get counts. */
function withoutHeatmaps(summary) {
    const { mapHeatmaps, ...rest } = summary && typeof summary === 'object' ? summary : {};
    return { ...rest, heatmapMaps: Array.isArray(mapHeatmaps) ? mapHeatmaps.map((entry) => entry.key) : [] };
}

/** @type {(() => any) | null} */
let registeredSettingsManager = null;

/** The running game registers its settings manager; the latest game wins. */
export function registerTelemetryDevSource(getSettingsManager) {
    registeredSettingsManager = typeof getSettingsManager === 'function' ? getSettingsManager : null;
}

/**
 * @param {{ getSettingsManager?: () => any, now?: () => Date }} [options]
 */
export function createTelemetryDevApi({ getSettingsManager = () => registeredSettingsManager?.(), now = () => new Date() } = {}) {
    async function overview(rawFilters = {}) {
        const settingsManager = requireSettingsManager(getSettingsManager);
        const filters = normalizeTelemetryToolFilters(rawFilters);
        const [filtered, all] = await Promise.all([
            settingsManager.getTelemetryExportSnapshot(filters),
            settingsManager.getTelemetryExportSnapshot({}),
        ]);
        const entries = Array.isArray(filtered?.historyEntries) ? filtered.historyEntries : [];
        const allEntries = Array.isArray(all?.historyEntries) ? all.historyEntries : [];
        return {
            filters,
            totalRounds: allEntries.length,
            filterOptions: collectTelemetryFilterOptions(allEntries),
            summary: withoutHeatmaps(filtered?.historySummary),
            recentRounds: entries.slice(-RECENT_ROUND_LIMIT).reverse().map(summarizeTelemetryRound),
            gameplay: filtered?.gameplay || null,
        };
    }

    async function exportData(rawFilters = {}, format = 'json') {
        const settingsManager = requireSettingsManager(getSettingsManager);
        const filters = normalizeTelemetryToolFilters(rawFilters);
        const snapshot = await settingsManager.getTelemetryExportSnapshot(filters);
        const csv = format === 'csv';
        return {
            schemaVersion: TELEMETRY_EXPORT_SCHEMA_VERSION,
            format: csv ? 'csv' : 'json',
            fileName: createTelemetryExportFileName(csv ? 'csv' : 'json', now()),
            rounds: Array.isArray(snapshot?.historyEntries) ? snapshot.historyEntries.length : 0,
            text: csv ? telemetryRowsToCsv(snapshot?.historyEntries) : `${JSON.stringify(snapshot, null, 2)}\n`,
        };
    }

    async function clear() {
        const settingsManager = requireSettingsManager(getSettingsManager);
        if (typeof settingsManager.clearTelemetry !== 'function') {
            throw Object.assign(new Error('Telemetrie kann hier nicht gelöscht werden.'), { reason: 'no_clear' });
        }
        return settingsManager.clearTelemetry();
    }

    return Object.freeze({ overview, exportData, clear });
}
