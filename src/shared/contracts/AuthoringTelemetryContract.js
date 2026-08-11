export const AUTHORING_TELEMETRY_SCHEMA_VERSION = 'authoring-telemetry.v1';
export const AUTHORING_TELEMETRY_STORAGE_KEY = 'cuviosclash.authoring-telemetry.v1';
export const AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS = 50;

export const AUTHORING_TELEMETRY_TOOLS = Object.freeze({
    VEHICLE_LAB: 'vehicle_lab',
    MAP_EDITOR: 'map_editor',
});

export const AUTHORING_TELEMETRY_COUNTERS = Object.freeze([
    'edit',
    'undo',
    'redo',
    'validation',
    'validation_issue',
    'save',
    'export',
    'import',
    'playtest_started',
    'playtest_returned',
    'recovery_restored',
    'part_added',
    'part_removed',
    'part_duplicated',
    'preset_loaded',
    'publish',
    'asset_loaded',
    'asset_placeholder',
]);

export const AUTHORING_TELEMETRY_OUTCOMES = Object.freeze([
    'completed',
    'validation_passed',
    'save_succeeded',
    'export_succeeded',
    'import_succeeded',
    'publish_succeeded',
    'playtest_returned',
    'recovery_restored',
]);

export const AUTHORING_TELEMETRY_ERRORS = Object.freeze([
    'init_failed',
    'autosave_failed',
    'save_failed',
    'export_failed',
    'import_failed',
    'validation_failed',
    'asset_load_failed',
    'asset_load_timeout',
    'playtest_save_failed',
    'playtest_return_failed',
]);

const TOOL_SET = new Set(Object.values(AUTHORING_TELEMETRY_TOOLS));
const COUNTER_SET = new Set(AUTHORING_TELEMETRY_COUNTERS);
const OUTCOME_SET = new Set(AUTHORING_TELEMETRY_OUTCOMES);
const ERROR_SET = new Set(AUTHORING_TELEMETRY_ERRORS);
const MAX_COUNT = 1_000_000_000;
const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

function toBoundedInt(value, max = MAX_COUNT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(max, Math.max(0, Math.floor(parsed)));
}

function normalizeTimestamp(value) {
    if (typeof value !== 'string' || value.length > 40) return '';
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeKnownCounts(source, allowedKeys) {
    const normalized = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return normalized;
    Object.entries(source).forEach(([key, value]) => {
        if (!allowedKeys.has(key)) return;
        const count = toBoundedInt(value);
        if (count > 0) normalized[key] = count;
    });
    return normalized;
}

function normalizeKnownOutcomes(source) {
    const normalized = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return normalized;
    Object.entries(source).forEach(([key, value]) => {
        if (!OUTCOME_SET.has(key)) return;
        normalized[key] = value === true;
    });
    return normalized;
}

export function normalizeAuthoringTelemetryTool(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return TOOL_SET.has(normalized) ? normalized : '';
}

export function createAuthoringTelemetryToolSummary() {
    return {
        sessions: 0,
        completedSessions: 0,
        activeDurationMs: 0,
        counters: {},
        outcomes: {},
        errors: {},
        lastSeenAt: '',
    };
}

export function normalizeAuthoringTelemetryToolSummary(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        sessions: toBoundedInt(value.sessions),
        completedSessions: toBoundedInt(value.completedSessions),
        activeDurationMs: toBoundedInt(value.activeDurationMs, MAX_DURATION_MS),
        counters: normalizeKnownCounts(value.counters, COUNTER_SET),
        outcomes: normalizeKnownCounts(value.outcomes, OUTCOME_SET),
        errors: normalizeKnownCounts(value.errors, ERROR_SET),
        lastSeenAt: normalizeTimestamp(value.lastSeenAt),
    };
}

export function normalizeAuthoringTelemetrySession(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const tool = normalizeAuthoringTelemetryTool(value.tool);
    if (!tool) return null;
    const platform = value.platform === 'desktop' ? 'desktop' : 'browser';
    return {
        tool,
        platform,
        startedAt: normalizeTimestamp(value.startedAt),
        endedAt: normalizeTimestamp(value.endedAt),
        durationActiveMs: toBoundedInt(value.durationActiveMs, MAX_DURATION_MS),
        completed: value.completed === true,
        counters: normalizeKnownCounts(value.counters, COUNTER_SET),
        outcomes: normalizeKnownOutcomes(value.outcomes),
        errors: normalizeKnownCounts(value.errors, ERROR_SET),
    };
}

export function createAuthoringTelemetryState() {
    return {
        schemaVersion: AUTHORING_TELEMETRY_SCHEMA_VERSION,
        updatedAt: '',
        tools: {
            [AUTHORING_TELEMETRY_TOOLS.VEHICLE_LAB]: createAuthoringTelemetryToolSummary(),
            [AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR]: createAuthoringTelemetryToolSummary(),
        },
        recentSessions: [],
    };
}

export function normalizeAuthoringTelemetryState(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    const sessions = Array.isArray(value.recentSessions)
        ? value.recentSessions.map(normalizeAuthoringTelemetrySession).filter(Boolean)
        : [];
    return {
        schemaVersion: AUTHORING_TELEMETRY_SCHEMA_VERSION,
        updatedAt: normalizeTimestamp(value.updatedAt),
        tools: {
            [AUTHORING_TELEMETRY_TOOLS.VEHICLE_LAB]: normalizeAuthoringTelemetryToolSummary(
                value.tools?.[AUTHORING_TELEMETRY_TOOLS.VEHICLE_LAB]
            ),
            [AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR]: normalizeAuthoringTelemetryToolSummary(
                value.tools?.[AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR]
            ),
        },
        recentSessions: sessions.slice(-AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS),
    };
}

export function normalizeAuthoringTelemetryDelta(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        durationActiveMs: toBoundedInt(value.durationActiveMs, MAX_DURATION_MS),
        counters: normalizeKnownCounts(value.counters, COUNTER_SET),
        outcomes: normalizeKnownCounts(value.outcomes, OUTCOME_SET),
        errors: normalizeKnownCounts(value.errors, ERROR_SET),
    };
}
