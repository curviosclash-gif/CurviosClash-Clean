/**
 * Map units: vehicles that belong to a map and move on their own (E46). The tank is the first
 * kind; bomber, drone swarm and creature join later as further kinds of the same block.
 *
 * A map carries them in an optional `mapUnits` block. A unit drives an authored path - there is no
 * height map in the game, so every waypoint carries its own height (A8) - and is shot at like a
 * turret on wheels. The block is a positive list: unknown kinds and broken paths are dropped with
 * a warning, so a map from a newer build still loads in an older one.
 */

export const MAP_UNIT_CONTRACT_VERSION = 'map-unit.v1';

export const MAP_UNIT_LIMITS = Object.freeze({
    maxUnits: 16,
    minPathPoints: 2,
    maxPathPoints: 64,
});

const VALID_KINDS = new Set(['tank']);
const VALID_MODES = new Set(['HUNT', 'ARCADE']);
const VALID_ROCKETS = new Set(['ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA']);

/** Balance start values from ideen.md (tank row). */
const TANK_DEFAULTS = Object.freeze({
    speed: 12,
    maxHp: 150,
    hitboxRadius: 3.5,
    respawnSeconds: 30,
    mg: Object.freeze({ damage: 3, cooldown: 0.3, range: 60 }),
    rocket: Object.freeze({ rocketType: 'ROCKET_MEDIUM', cooldown: 5, range: 90 }),
    loot: Object.freeze({ ROCKET_MEDIUM: 0.6, ROCKET_HEAVY: 0.3, ROCKET_MEGA: 0.1 }),
});

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

/**
 * @param {unknown} point
 * @returns {readonly number[] | null}
 */
function normalizePoint(point) {
    const source = Array.isArray(point)
        ? point
        : (point && typeof point === 'object' ? [/** @type {any} */ (point).x, /** @type {any} */ (point).y, /** @type {any} */ (point).z] : null);
    if (!source) return null;
    const coords = [0, 1, 2].map((axis) => Number(source[axis]));
    return coords.every(Number.isFinite) ? Object.freeze(coords) : null;
}

/**
 * @param {unknown} raw
 * @param {typeof clampNumber} spatial
 * @returns {Readonly<{ damage: number, cooldown: number, range: number }> | null}
 */
function normalizeMg(raw, spatial) {
    if (raw === false || raw === null) return null;
    const source = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
    return Object.freeze({
        damage: clampNumber(source.damage, TANK_DEFAULTS.mg.damage, 1, 40),
        cooldown: clampNumber(source.cooldown, TANK_DEFAULTS.mg.cooldown, 0.1, 10),
        range: spatial(source.range, TANK_DEFAULTS.mg.range, 8, 180),
    });
}

/**
 * @param {unknown} raw
 * @param {typeof clampNumber} spatial
 * @returns {Readonly<{ rocketType: string, cooldown: number, range: number }> | null}
 */
function normalizeRocket(raw, spatial) {
    if (raw === false || raw === null) return null;
    const source = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
    const rocketType = String(source.rocketType || '').toUpperCase();
    return Object.freeze({
        rocketType: VALID_ROCKETS.has(rocketType) ? rocketType : TANK_DEFAULTS.rocket.rocketType,
        cooldown: clampNumber(source.cooldown, TANK_DEFAULTS.rocket.cooldown, 0.5, 30),
        range: spatial(source.range, TANK_DEFAULTS.rocket.range, 8, 180),
    });
}

/**
 * Loot chances per rocket type. Unknown types and non-positive chances fall away; an empty or
 * missing table falls back to the default so a tank always drops something (E19).
 * @param {unknown} raw
 * @returns {Readonly<Record<string, number>>}
 */
function normalizeLoot(raw) {
    /** @type {Record<string, number>} */
    const loot = {};
    if (raw && typeof raw === 'object') {
        for (const [type, chance] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
            const value = Number(chance);
            if (VALID_ROCKETS.has(type) && Number.isFinite(value) && value > 0) loot[type] = Math.min(1, value);
        }
    }
    return Object.freeze(Object.keys(loot).length > 0 ? loot : { ...TANK_DEFAULTS.loot });
}

/**
 * Spatial values of a map already divided by its map scale must not meet the authoring limits a
 * second time - a slow tank on a map with scale 3 would otherwise come back three times as fast.
 * The same reason the static turrets pass preserveSpatialRange.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function keepSpatial(value, fallback) {
    return clampNumber(value, fallback, 0.0001, 1000000);
}

/**
 * @param {unknown} entry
 * @param {number} index
 * @param {string[] | undefined} warnings
 * @param {{ preserveSpatial?: boolean }} [options]
 */
export function normalizeMapUnit(entry, index = 0, warnings = undefined, options = {}) {
    /** @type {typeof clampNumber} */
    const spatial = options?.preserveSpatial === true ? keepSpatial : clampNumber;
    const source = entry && typeof entry === 'object' ? /** @type {any} */ (entry) : null;
    const id = String(source?.id || `unit_${index + 1}`).trim() || `unit_${index + 1}`;
    const kind = String(source?.kind || 'tank').toLowerCase();
    if (!VALID_KINDS.has(kind)) {
        warnings?.push(`Map unit "${id}" has the unknown kind "${kind}" and was dropped.`);
        return null;
    }
    const rawPath = Array.isArray(source?.path) ? source.path.slice(0, MAP_UNIT_LIMITS.maxPathPoints) : [];
    const path = rawPath.map(normalizePoint);
    if (path.length < MAP_UNIT_LIMITS.minPathPoints || path.some((/** @type {readonly number[] | null} */ point) => point === null)) {
        warnings?.push(`Map unit "${id}" needs at least ${MAP_UNIT_LIMITS.minPathPoints} valid path points and was dropped.`);
        return null;
    }
    const weapons = source?.weapons && typeof source.weapons === 'object' ? source.weapons : {};
    const modes = Array.isArray(source?.allowedModes)
        ? [...new Set(source.allowedModes.map((/** @type {unknown} */ mode) => String(mode).toUpperCase()).filter((/** @type {string} */ mode) => VALID_MODES.has(mode)))]
        : ['HUNT', 'ARCADE'];
    return Object.freeze({
        id,
        kind,
        path: Object.freeze(/** @type {readonly number[][]} */ (path)),
        // true drives the path as a closed circuit, false turns around at both ends.
        loop: source?.loop !== false,
        speed: spatial(source?.speed, TANK_DEFAULTS.speed, 1, 60),
        maxHp: clampNumber(source?.maxHp, TANK_DEFAULTS.maxHp, 1, 2000),
        hitboxRadius: spatial(source?.hitboxRadius, TANK_DEFAULTS.hitboxRadius, 0.5, 12),
        respawnSeconds: clampNumber(source?.respawnSeconds, TANK_DEFAULTS.respawnSeconds, 0, 3600),
        weapons: Object.freeze({ mg: normalizeMg(weapons.mg, spatial), rocket: normalizeRocket(weapons.rocket, spatial) }),
        loot: normalizeLoot(source?.loot),
        allowedModes: Object.freeze(modes.length > 0 ? modes : ['HUNT', 'ARCADE']),
        // A tank is a neutral hazard: it fires at bots too, unless the map says otherwise.
        targetPlayers: source?.targetPlayers === 'humans' ? 'humans' : 'all',
    });
}

/**
 * Normalizes a whole `mapUnits` block. Duplicate ids keep the first unit.
 * @param {unknown} rawUnits
 * @param {{ warnings?: string[], preserveSpatial?: boolean }} [options]
 */
export function normalizeMapUnits(rawUnits, options = {}) {
    const entries = Array.isArray(rawUnits) ? rawUnits.slice(0, MAP_UNIT_LIMITS.maxUnits) : [];
    const warnings = Array.isArray(options?.warnings) ? options.warnings : undefined;
    if (Array.isArray(rawUnits) && rawUnits.length > MAP_UNIT_LIMITS.maxUnits) {
        warnings?.push(`Only the first ${MAP_UNIT_LIMITS.maxUnits} map units are kept.`);
    }
    const ids = new Set();
    /** @type {ReturnType<typeof normalizeMapUnit>[]} */
    const units = [];
    entries.forEach((entry, index) => {
        const unit = normalizeMapUnit(entry, index, warnings, { preserveSpatial: options?.preserveSpatial === true });
        if (!unit) return;
        if (ids.has(unit.id)) {
            warnings?.push(`Map unit id "${unit.id}" is used twice; the second unit was dropped.`);
            return;
        }
        ids.add(unit.id);
        units.push(unit);
    });
    return Object.freeze(units);
}

/**
 * The runtime reads the units of the loaded map definition. A map in map units (scaled anchors)
 * passes preserveSpatial, because the schema already checked and divided its values.
 * @param {unknown} mapDefinition
 * @param {{ preserveSpatial?: boolean }} [options]
 */
export function resolveMapUnitDefinitions(mapDefinition, options = {}) {
    const source = mapDefinition && typeof mapDefinition === 'object' ? /** @type {any} */ (mapDefinition).mapUnits : null;
    return normalizeMapUnits(source, { preserveSpatial: options?.preserveSpatial === true });
}
