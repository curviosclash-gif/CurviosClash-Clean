export const MAP_SANDSTORM_PHASES = Object.freeze({
    CALM: 'CALM',
    WARNING: 'WARNING',
    ACTIVE: 'ACTIVE',
});

export const MAP_SANDSTORM_DIRECTIONS = Object.freeze([
    Object.freeze([0, -1]),
    Object.freeze([1, 0]),
    Object.freeze([0, 1]),
    Object.freeze([-1, 0]),
]);

const PHASE_SET = new Set(Object.values(MAP_SANDSTORM_PHASES));
const MAX_SHELTER_VOLUMES = 24;
const MAP_SANDSTORM_CONTRACT_VERSION = 'map-sandstorm.v1';
const NORMALIZED_CONFIGS = new WeakSet();

function clamp(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizeRange(value, fallback, min, max) {
    const source = Array.isArray(value) ? value : fallback;
    const low = clamp(source[0], fallback[0], min, max);
    const high = clamp(source[1], fallback[1], low, max);
    return Object.freeze([low, high]);
}

function normalizeVector3(value, fallback) {
    const source = Array.isArray(value) ? value : fallback;
    return Object.freeze([
        clamp(source[0], fallback[0], -1000, 1000),
        clamp(source[1], fallback[1], -1000, 1000),
        clamp(source[2], fallback[2], -1000, 1000),
    ]);
}

function normalizeShelterVolume(value, index) {
    const source = value && typeof value === 'object' ? value : {};
    const min = normalizeVector3(source.min, [0, 0, 0]);
    const max = normalizeVector3(source.max, [0, 0, 0]);
    return Object.freeze({
        id: String(source.id || `sandstorm_shelter_${index}`).trim().slice(0, 80),
        min: Object.freeze([
            Math.min(min[0], max[0]),
            Math.min(min[1], max[1]),
            Math.min(min[2], max[2]),
        ]),
        max: Object.freeze([
            Math.max(min[0], max[0]),
            Math.max(min[1], max[1]),
            Math.max(min[2], max[2]),
        ]),
    });
}

export function normalizeMapSandstorm(value = null) {
    if (!value || typeof value !== 'object' || value.enabled === false) return null;
    if (NORMALIZED_CONFIGS.has(value)) return value;
    const outdoorFar = clamp(value.outdoorFar, 40, 12, 200);
    const shelterFar = clamp(value.shelterFar, 85, outdoorFar, 300);
    const warningSeconds = clamp(value.warningSeconds, 20, 1, 60);
    const activeSeconds = clamp(value.activeSeconds, 60, 5, 180);
    const ingressSeconds = clamp(value.ingressSeconds, 4, 0, activeSeconds * 0.5);
    const egressSeconds = clamp(
        value.egressSeconds,
        4,
        0,
        Math.max(0, activeSeconds - ingressSeconds)
    );
    const shelterVolumes = (Array.isArray(value.shelterVolumes) ? value.shelterVolumes : [])
        .slice(0, MAX_SHELTER_VOLUMES)
        .map(normalizeShelterVolume)
        .filter((entry) => entry.id);
    const normalized = Object.freeze({
        contractVersion: MAP_SANDSTORM_CONTRACT_VERSION,
        enabled: true,
        initialDelaySeconds: normalizeRange(value.initialDelaySeconds, [45, 90], 0, 600),
        repeatDelaySeconds: normalizeRange(value.repeatDelaySeconds, [90, 150], 0, 600),
        warningSeconds,
        activeSeconds,
        ingressSeconds,
        egressSeconds,
        outdoorNear: clamp(value.outdoorNear, 8, 0, outdoorFar),
        outdoorFar,
        shelterNear: clamp(value.shelterNear, 18, 0, shelterFar),
        shelterFar,
        proximityCueRange: clamp(value.proximityCueRange, 18, 0, outdoorFar),
        shelterVolumes: Object.freeze(shelterVolumes),
    });
    NORMALIZED_CONFIGS.add(normalized);
    return normalized;
}

export function createMapSandstormState(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const phase = PHASE_SET.has(source.phase) ? source.phase : MAP_SANDSTORM_PHASES.CALM;
    const remainingSeconds = clamp(source.remainingSeconds, 0, 0, 600);
    const directionIndex = Math.min(
        MAP_SANDSTORM_DIRECTIONS.length - 1,
        Math.max(0, Math.trunc(Number(source.directionIndex) || 0))
    );
    return {
        enabled: source.enabled === true,
        phase,
        remainingSeconds,
        eventIndex: Math.max(0, Math.trunc(Number(source.eventIndex) || 0)),
        directionIndex,
        intensity: phase === MAP_SANDSTORM_PHASES.ACTIVE
            ? clamp(source.intensity, 0, 0, 1)
            : 0,
    };
}

export function resolveMapSandstormIntensity(config, remainingSeconds) {
    const normalized = normalizeMapSandstorm(config);
    if (!normalized) return 0;
    const remaining = clamp(remainingSeconds, 0, 0, normalized.activeSeconds);
    const elapsed = normalized.activeSeconds - remaining;
    const ingress = normalized.ingressSeconds > 0
        ? Math.min(1, elapsed / normalized.ingressSeconds)
        : 1;
    const egress = normalized.egressSeconds > 0
        ? Math.min(1, remaining / normalized.egressSeconds)
        : 1;
    return Math.max(0, Math.min(1, ingress, egress));
}

export function isPositionInSandstormShelter(position, config, scale = 1) {
    if (!position) return false;
    const normalized = normalizeMapSandstorm(config);
    if (!normalized) return false;
    const factor = Math.max(0.001, Number(scale) || 1);
    const x = Number(position.x) || 0;
    const y = Number(position.y) || 0;
    const z = Number(position.z) || 0;
    for (let index = 0; index < normalized.shelterVolumes.length; index += 1) {
        const volume = normalized.shelterVolumes[index];
        if (
            x >= volume.min[0] * factor && x <= volume.max[0] * factor
            && y >= volume.min[1] * factor && y <= volume.max[1] * factor
            && z >= volume.min[2] * factor && z <= volume.max[2] * factor
        ) return true;
    }
    return false;
}

export function isWithinSandstormRange(observerPosition, targetPosition, range) {
    if (!observerPosition || !targetPosition) return false;
    const limit = Math.max(0, Number(range) || 0);
    const dx = (Number(targetPosition.x) || 0) - (Number(observerPosition.x) || 0);
    const dy = (Number(targetPosition.y) || 0) - (Number(observerPosition.y) || 0);
    const dz = (Number(targetPosition.z) || 0) - (Number(observerPosition.z) || 0);
    return dx * dx + dy * dy + dz * dz <= limit * limit;
}

export const MAP_SANDSTORM_LIMITS = Object.freeze({ maxShelterVolumes: MAX_SHELTER_VOLUMES });
