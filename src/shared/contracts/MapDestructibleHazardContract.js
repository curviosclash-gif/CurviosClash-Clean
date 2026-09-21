/**
 * What a break scene can do to a player, in the two shapes a collapse actually has.
 *
 * A **blast** is one moment: after an authored delay the break deals radial damage once, at one
 * radius, and is over. That is a tower hitting the ground, and it is how every map that had a
 * collapse before this file existed describes its danger.
 *
 * A **fireball** is a volume that lives. It grows, it rises, it shrinks, and while it does so it
 * burns whoever is inside it. That is a reactor breach, and a single delayed sphere cannot describe
 * it: the thing that burns is the fireball the clip draws, and it may only be dangerous exactly as
 * long and exactly as far as it is drawn. So it is not a second, invisible sphere that happens to
 * look similar. It is a table of samples - seconds, centre height, radius - and the Blender
 * generator keys the drawn fireball off the very same table
 * (scripts/generate_reactor_site_assets.py, FIREBALL_CURVE). Both sides interpolate linearly
 * between the rows, which is exactly how glTF plays its own samplers, so the sphere the runtime
 * measures against and the sphere on screen are the same sphere.
 * tests/reactor-site-blender-assets.contract.test.mjs reads the exported clip back and holds it
 * against this table through the map's own placement; if either side is edited alone, that goes red.
 *
 * Units. The table is in metres, because the asset is modelled in metres. `unitScale` says how many
 * authored map units one of those metres is (0.6 on the reactor site, as everything else there is
 * placed), and `origin` is where the fireball's axis stands, in authored map units, like a segment
 * anchor. The runtime multiplies both by the map's anchor scale to reach world units - the same
 * single step MapDestructibleSystem already takes for its anchors. A blast radius is not scaled,
 * because it never was: it is authored in world units, and changing that would retune three maps.
 *
 * Outside the table there is no fireball at all: before the first row it has not happened, at and
 * after the last row the smoke has closed over it. That is what keeps the smoke harmless - it is
 * drawn for another forty-five seconds after the table ends, and none of it can hurt anyone.
 */

export const MAP_DESTRUCTIBLE_HAZARD_CONTRACT_VERSION = 'map-destructible-hazard.v1';

export const MAP_DESTRUCTIBLE_BLAST_LIMITS = Object.freeze({
    radius: Object.freeze({ min: 1, max: 300 }),
    damage: Object.freeze({ min: 1, max: 100000 }),
    delaySeconds: Object.freeze({ min: 0, max: 30 }),
});

/**
 * @typedef {object} MapDestructibleBlast
 * @property {number} radius World units a nearby player still takes damage within.
 * @property {number} damage Damage at the blast center; falls off linearly to the radius edge.
 * @property {number} delaySeconds Map-clock delay after the break before the blast applies.
 */

export const MAP_DESTRUCTIBLE_FIREBALL_LIMITS = Object.freeze({
    /** Enough rows to describe a growth and a decay without becoming an animation of its own. */
    maxSamples: 64,
    minSamples: 2,
    origin: Object.freeze({ min: -4000, max: 4000 }),
    unitScale: Object.freeze({ min: 0.001, max: 1000, fallback: 1 }),
    damage: Object.freeze({ min: 1, max: 100000 }),
    atSeconds: Object.freeze({ min: 0, max: 60 }),
    heightMetres: Object.freeze({ min: -1000, max: 4000 }),
    radiusMetres: Object.freeze({ min: 0, max: 2000 }),
});

/**
 * @typedef {object} MapDestructibleFireballSample
 * @property {number} atSeconds Seconds since the break; rows are strictly increasing.
 * @property {number} heightMetres Centre of the fireball above the scene's own origin, in metres.
 * @property {number} radiusMetres Radius in metres; zero means there is nothing there.
 */

/**
 * @typedef {object} MapDestructibleFireball
 * @property {number} damage Damage at the centre; falls off linearly to the edge, like a blast.
 * @property {readonly number[]} origin Where the axis stands, in authored map units.
 * @property {number} unitScale Authored map units per curve metre.
 * @property {readonly Readonly<MapDestructibleFireballSample>[]} samples
 * @property {number} durationSeconds Second the last row sits at; the fireball is gone from there.
 */

/**
 * @typedef {object} MapDestructibleFireballSphere
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} radius World radius; zero outside the authored window.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {{ min: number, max: number }} limit
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, limit, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(limit.max, Math.max(limit.min, parsed));
}

/**
 * A scene's one-shot radial damage against nearby players, or null when it deals none. Every number
 * is clamped into its own range, so an authored map cannot round-trip into a blast larger, harder
 * or more delayed than the game is tuned for.
 * @param {unknown} source
 * @returns {Readonly<MapDestructibleBlast> | null}
 */
export function normalizeMapDestructibleBlast(source) {
    if (!isRecord(source)) return null;
    const limits = MAP_DESTRUCTIBLE_BLAST_LIMITS;
    return Object.freeze({
        radius: clampNumber(source.radius, limits.radius, limits.radius.min),
        damage: clampNumber(source.damage, limits.damage, limits.damage.min),
        delaySeconds: clampNumber(source.delaySeconds, limits.delaySeconds, 0),
    });
}

/**
 * The three authored coordinates of the axis, in map units. A shorter or unreadable list falls
 * back to the map's own origin rather than to a guess - a fireball at a wrong place would be worse
 * than one on the centre line.
 * @param {unknown} value
 * @returns {readonly number[]}
 */
function readOrigin(value) {
    const source = Array.isArray(value) ? value : [];
    const limit = MAP_DESTRUCTIBLE_FIREBALL_LIMITS.origin;
    return Object.freeze([
        clampNumber(source[0], limit, 0),
        clampNumber(source[1], limit, 0),
        clampNumber(source[2], limit, 0),
    ]);
}

/**
 * The authored rows, cleaned up: every row clamped into range, rows that do not move the clock
 * forward dropped. Out-of-order rows are dropped rather than sorted - a table that does not read
 * forward is an authoring mistake, and silently reordering it would hide which row was wrong.
 * @param {unknown} value
 * @returns {Readonly<MapDestructibleFireballSample>[]}
 */
function readSamples(value) {
    const entries = Array.isArray(value) ? value : [];
    const limits = MAP_DESTRUCTIBLE_FIREBALL_LIMITS;
    /** @type {Readonly<MapDestructibleFireballSample>[]} */
    const samples = [];
    let previousSeconds = -Infinity;
    for (const entry of entries) {
        if (samples.length >= limits.maxSamples) break;
        const row = Array.isArray(entry)
            ? { atSeconds: entry[0], heightMetres: entry[1], radiusMetres: entry[2] }
            : entry;
        if (!isRecord(row)) continue;
        const atSeconds = clampNumber(row.atSeconds, limits.atSeconds, NaN);
        if (!Number.isFinite(atSeconds) || atSeconds <= previousSeconds) continue;
        previousSeconds = atSeconds;
        samples.push(Object.freeze({
            atSeconds,
            heightMetres: clampNumber(row.heightMetres, limits.heightMetres, 0),
            radiusMetres: clampNumber(row.radiusMetres, limits.radiusMetres, 0),
        }));
    }
    return samples;
}

/**
 * Accepts a break scene's `fireball` block and returns a usable hazard, or null when the scene has
 * none. A table of fewer than two rows cannot be interpolated and a table that never reaches a
 * positive radius can never hit anything, so both are read as "this scene draws smoke only".
 * @param {unknown} source
 * @returns {Readonly<MapDestructibleFireball> | null}
 */
export function normalizeMapDestructibleFireball(source) {
    if (!isRecord(source)) return null;
    const limits = MAP_DESTRUCTIBLE_FIREBALL_LIMITS;
    const samples = readSamples(source.samples);
    if (samples.length < limits.minSamples) return null;
    if (!samples.some((sample) => sample.radiusMetres > 0)) return null;
    return Object.freeze({
        damage: clampNumber(source.damage, limits.damage, limits.damage.min),
        origin: readOrigin(source.origin),
        unitScale: clampNumber(source.unitScale, limits.unitScale, limits.unitScale.fallback),
        samples: Object.freeze(samples),
        durationSeconds: samples[samples.length - 1].atSeconds,
    });
}

/**
 * The fireball at one second of its own clock, in metres, linearly between the two rows around it.
 * Outside the authored window the radius is zero: the height still reads, so a caller that wants
 * to draw something knows where the fireball went, but nothing with a zero radius can be hit.
 * @param {Readonly<MapDestructibleFireball> | null | undefined} fireball
 * @param {number} seconds
 * @returns {{ heightMetres: number, radiusMetres: number }}
 */
export function sampleMapDestructibleFireball(fireball, seconds) {
    const samples = fireball?.samples;
    if (!samples?.length) return { heightMetres: 0, radiusMetres: 0 };
    const at = Number(seconds);
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!Number.isFinite(at) || at < first.atSeconds) {
        return { heightMetres: first.heightMetres, radiusMetres: 0 };
    }
    if (at >= last.atSeconds) return { heightMetres: last.heightMetres, radiusMetres: 0 };
    for (let index = 1; index < samples.length; index += 1) {
        const high = samples[index];
        if (at > high.atSeconds) continue;
        const low = samples[index - 1];
        const span = high.atSeconds - low.atSeconds;
        const ratio = span <= 0 ? 0 : (at - low.atSeconds) / span;
        return {
            heightMetres: low.heightMetres + (high.heightMetres - low.heightMetres) * ratio,
            radiusMetres: low.radiusMetres + (high.radiusMetres - low.radiusMetres) * ratio,
        };
    }
    return { heightMetres: last.heightMetres, radiusMetres: 0 };
}

/**
 * The same fireball as a sphere in world units - the one place the two scales a map applies are
 * put together, so the runtime and the asset test cannot disagree about them.
 *
 * `worldScale` is the map's anchor scale: authored units are that much larger in the world. The
 * axis is an authored position and is scaled once; the curve is in metres and is scaled twice,
 * first by `unitScale` into authored units and then by the map.
 * @param {Readonly<MapDestructibleFireball> | null | undefined} fireball
 * @param {number} seconds
 * @param {number} [worldScale]
 * @returns {MapDestructibleFireballSphere}
 */
export function resolveMapDestructibleFireballSphere(fireball, seconds, worldScale = 1) {
    const scale = Number.isFinite(Number(worldScale)) && Number(worldScale) > 0 ? Number(worldScale) : 1;
    const origin = fireball?.origin || [0, 0, 0];
    const metre = (Number(fireball?.unitScale) || 0) * scale;
    const { heightMetres, radiusMetres } = sampleMapDestructibleFireball(fireball, seconds);
    return {
        x: (Number(origin[0]) || 0) * scale,
        y: (Number(origin[1]) || 0) * scale + heightMetres * metre,
        z: (Number(origin[2]) || 0) * scale,
        radius: radiusMetres * metre,
    };
}
