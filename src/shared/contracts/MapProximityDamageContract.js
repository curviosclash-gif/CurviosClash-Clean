const MAX_SOURCES = 8;
const ALLOWED_MODES = new Set(['HUNT', 'ARCADE', 'CLASSIC', 'WEAPON_RACE', 'ARENA_WAVES', 'ESCORT']);

function bounded(value, fallback, min, max) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

export function normalizeMapProximityDamageSources(source) {
    const entries = Array.isArray(source) ? source : [];
    return Object.freeze(entries.slice(0, MAX_SOURCES).map((entry, index) => {
        const position = Array.isArray(entry?.position) ? entry.position : [0, 0, 0];
        const radius = bounded(entry?.radius, 12, 0.1, 200);
        const nearDamagePerSecond = bounded(entry?.nearDamagePerSecond, 2, 0, 100);
        const farDamagePerSecond = bounded(entry?.farDamagePerSecond, 0.5, 0, nearDamagePerSecond);
        const modes = Object.freeze((Array.isArray(entry?.modes) ? entry.modes : [])
            .map((mode) => String(mode).trim().toUpperCase())
            .filter((mode, modeIndex, values) => ALLOWED_MODES.has(mode) && values.indexOf(mode) === modeIndex));
        return Object.freeze({
            id: String(entry?.id || `proximity_damage_${index}`).trim().slice(0, 80),
            position: Object.freeze([
                bounded(position[0], 0, -1000, 1000),
                bounded(position[1], 0, -1000, 1000),
                bounded(position[2], 0, -1000, 1000),
            ]),
            radius,
            nearDamagePerSecond,
            farDamagePerSecond,
            modes,
        });
    }).filter((entry) => entry.id));
}

/** Damage ramps from the source maximum at its center to the minimum at its radius. */
export function resolveMapProximityDamage(source, position) {
    if (!source || !position) return 0;
    const dx = (Number(position[0] ?? position.x) || 0) - source.position[0];
    const dy = (Number(position[1] ?? position.y) || 0) - source.position[1];
    const dz = (Number(position[2] ?? position.z) || 0) - source.position[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= source.radius) return 0;
    const progress = distance / source.radius;
    return source.nearDamagePerSecond
        + (source.farDamagePerSecond - source.nearDamagePerSecond) * progress;
}
