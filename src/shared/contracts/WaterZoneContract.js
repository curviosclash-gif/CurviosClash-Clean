const DEFAULT_EFFECTS = Object.freeze({
    speedMultiplier: 0.64,
    turnMultiplier: 0.7,
    visibilityMultiplier: 0.42,
    buoyancy: 7.5,
    damagePerSecond: 0,
    createTrails: false,
    extinguishesFire: true,
    flamethrowerEnabled: false,
    projectileSpeedMultiplier: 0.58,
    groundUnitsEnabled: true,
});

export const WATER_PHASES = Object.freeze({
    DRY: 'dry',
    WAVE: 'wave',
    RISING: 'rising',
    FLOODED: 'flooded',
});

const PHASE_SET = new Set(Object.values(WATER_PHASES));

function finite(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, finite(value, min)));
}

function readVec3(value, fallback) {
    return Object.freeze([0, 1, 2].map((index) => finite(value?.[index], fallback[index])));
}

function readEffects(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.freeze({
        speedMultiplier: clamp(source.speedMultiplier, 0.1, 1),
        turnMultiplier: clamp(source.turnMultiplier, 0.1, 1),
        visibilityMultiplier: clamp(source.visibilityMultiplier, 0.05, 1),
        buoyancy: clamp(source.buoyancy, 0, 50),
        damagePerSecond: 0,
        createTrails: false,
        extinguishesFire: true,
        flamethrowerEnabled: false,
        projectileSpeedMultiplier: clamp(source.projectileSpeedMultiplier, 0.1, 1),
        groundUnitsEnabled: true,
    });
}

export function normalizeWaterZone(value) {
    if (!value || typeof value !== 'object') return null;
    const min = readVec3(value.bounds?.min, [-100, 0, -100]);
    const maxSource = readVec3(value.bounds?.max, [100, 100, 100]);
    const max = Object.freeze([
        Math.max(min[0], maxSource[0]),
        Math.max(min[1], maxSource[1]),
        Math.max(min[2], maxSource[2]),
    ]);
    const startLevel = clamp(value.startLevel, min[1], max[1]);
    const targetLevel = clamp(value.targetLevel, startLevel, max[1]);
    return Object.freeze({
        id: String(value.id || 'water_zone').trim().slice(0, 64) || 'water_zone',
        triggerSegmentId: String(value.triggerSegmentId || '').trim().slice(0, 64),
        bounds: Object.freeze({ min, max }),
        startLevel,
        targetLevel,
        waveSeconds: clamp(value.waveSeconds, 0.1, 15),
        riseSeconds: clamp(value.riseSeconds, 1, 120),
        effects: readEffects({ ...DEFAULT_EFFECTS, ...(value.effects || {}) }),
    });
}

export function createWaterZoneState(zone) {
    return {
        phase: WATER_PHASES.DRY,
        phaseElapsedSeconds: 0,
        level: finite(zone?.startLevel, 0),
        triggered: false,
    };
}

export function triggerWaterZone(state) {
    if (!state || state.phase !== WATER_PHASES.DRY) return state;
    state.phase = WATER_PHASES.WAVE;
    state.phaseElapsedSeconds = 0;
    state.triggered = true;
    return state;
}

function advanceRising(state, zone, seconds) {
    state.phaseElapsedSeconds = Math.min(zone.riseSeconds, state.phaseElapsedSeconds + seconds);
    const progress = state.phaseElapsedSeconds / zone.riseSeconds;
    state.level = zone.startLevel + ((zone.targetLevel - zone.startLevel) * progress);
    if (state.phaseElapsedSeconds >= zone.riseSeconds) {
        state.phase = WATER_PHASES.FLOODED;
        state.phaseElapsedSeconds = zone.riseSeconds;
        state.level = zone.targetLevel;
    }
}

export function stepWaterZoneState(state, zone, deltaSeconds) {
    if (!state || !zone || state.phase === WATER_PHASES.DRY || state.phase === WATER_PHASES.FLOODED) return state;
    let remaining = clamp(deltaSeconds, 0, 60);
    if (state.phase === WATER_PHASES.WAVE) {
        const needed = Math.max(0, zone.waveSeconds - state.phaseElapsedSeconds);
        const consumed = Math.min(remaining, needed);
        state.phaseElapsedSeconds += consumed;
        remaining -= consumed;
        if (state.phaseElapsedSeconds >= zone.waveSeconds) {
            state.phase = WATER_PHASES.RISING;
            state.phaseElapsedSeconds = 0;
        }
    }
    if (state.phase === WATER_PHASES.RISING && remaining > 0) advanceRising(state, zone, remaining);
    return state;
}

export function isPointUnderwater(zone, state, point) {
    if (!zone || !state || (state.phase !== WATER_PHASES.RISING && state.phase !== WATER_PHASES.FLOODED)) return false;
    const x = finite(point?.[0] ?? point?.x, Infinity);
    const y = finite(point?.[1] ?? point?.y, Infinity);
    const z = finite(point?.[2] ?? point?.z, Infinity);
    const { min, max } = zone.bounds;
    return x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2]
        && y >= min[1] && y <= Math.min(max[1], state.level);
}

export function serializeWaterZoneState(state) {
    return {
        phase: PHASE_SET.has(state?.phase) ? state.phase : WATER_PHASES.DRY,
        phaseElapsedSeconds: Math.round(Math.max(0, finite(state?.phaseElapsedSeconds, 0)) * 1000) / 1000,
        level: Math.round(finite(state?.level, 0) * 1000) / 1000,
        triggered: state?.triggered === true,
    };
}

export function applyWaterZoneNetworkState(state, zone, payload) {
    if (!state || !zone || !payload || typeof payload !== 'object') return state;
    state.phase = PHASE_SET.has(payload.phase) ? payload.phase : WATER_PHASES.DRY;
    state.phaseElapsedSeconds = clamp(payload.phaseElapsedSeconds, 0, Math.max(zone.waveSeconds, zone.riseSeconds));
    state.level = clamp(payload.level, zone.startLevel, zone.targetLevel);
    state.triggered = payload.triggered === true || state.phase !== WATER_PHASES.DRY;
    return state;
}
