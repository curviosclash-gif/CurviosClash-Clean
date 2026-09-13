const MAX_MAP_HAZARDS = 8;

function clamp(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizeVector(source) {
    const value = Array.isArray(source) ? source : [0, 0, 0];
    return Object.freeze([
        clamp(value[0], 0, -1000, 1000),
        clamp(value[1], 0, -1000, 1000),
        clamp(value[2], 0, -1000, 1000),
    ]);
}

function normalizeColor(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? Math.min(0xffffff, Math.max(0, Math.round(numeric)))
        : fallback;
}

function normalizeHazard(source, index) {
    const entry = source && typeof source === 'object' ? source : {};
    const cycleSeconds = clamp(entry.cycleSeconds, 12, 5, 60);
    const telegraphSeconds = clamp(entry.telegraphSeconds, 2.5, 1, cycleSeconds - 0.5);
    const activeSeconds = clamp(
        entry.activeSeconds,
        0.8,
        0.15,
        Math.max(0.15, cycleSeconds - telegraphSeconds)
    );
    return Object.freeze({
        id: String(entry.id || `map_hazard_${index}`).trim().slice(0, 80),
        position: normalizeVector(entry.position),
        radius: clamp(entry.radius, 7, 1, 40),
        cycleSeconds,
        telegraphSeconds,
        activeSeconds,
        phaseOffsetSeconds: clamp(entry.phaseOffsetSeconds, 0, 0, cycleSeconds),
        damage: clamp(entry.damage, 24, 1, 100),
        warningColor: normalizeColor(entry.warningColor, 0xffb347),
        activeColor: normalizeColor(entry.activeColor, 0xff3d16),
    });
}

export function normalizeMapHazards(source) {
    const entries = Array.isArray(source) ? source : [];
    const hazards = entries
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, MAX_MAP_HAZARDS)
        .map(normalizeHazard)
        .filter((entry) => entry.id);
    return Object.freeze(hazards);
}

export function resolveMapHazardCycleTime(hazard, elapsedSeconds) {
    const cycle = Math.max(0.001, Number(hazard?.cycleSeconds) || 1);
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    return (elapsed + (Number(hazard?.phaseOffsetSeconds) || 0)) % cycle;
}

export function isMapHazardActive(hazard, elapsedSeconds) {
    const cycleTime = resolveMapHazardCycleTime(hazard, elapsedSeconds);
    const start = Number(hazard?.telegraphSeconds) || 0;
    return cycleTime >= start && cycleTime < start + (Number(hazard?.activeSeconds) || 0);
}

export function resolveMapHazardCycleIndex(hazard, elapsedSeconds) {
    const cycle = Math.max(0.001, Number(hazard?.cycleSeconds) || 1);
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    return Math.floor((elapsed + (Number(hazard?.phaseOffsetSeconds) || 0)) / cycle);
}

export const MAP_HAZARD_LIMITS = Object.freeze({ maxHazards: MAX_MAP_HAZARDS });
