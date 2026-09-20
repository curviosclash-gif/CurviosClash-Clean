// Placement helpers for the glowing mushroom family in assets/models/glowing_mushroom.
//
// The models are built by scripts/generate_glowing_mushroom_assets.py and described by the
// manifest beside them. Maps place them through the helpers here rather than writing URLs, so
// the file layout lives in one place and a renamed variant breaks one file instead of five.
//
// Everything placed here is decoration: `collision: false` marks it so, and the models already
// carry the `_nocol` marker the loader keys on. Mushrooms are organic shapes, the colliders
// derived from them would not be, and nobody expects to die on a mushroom.

const ASSET_BASE = 'assets/models/glowing_mushroom';

/**
 * Which hue each variant carries. Read off the generator manifest; kept here so a map can ask
 * for a colour without loading the manifest at runtime.
 *
 * Every silhouette covers all three hues, so no map has to accept a shape it does not want in
 * order to get the colour it does.
 */
export const MUSHROOM_VARIANTS = Object.freeze({
    cap: Object.freeze({ 1: 'teal', 2: 'violet', 3: 'amber' }),
    trumpet: Object.freeze({ 1: 'violet', 2: 'amber', 3: 'teal' }),
    coral: Object.freeze({ 1: 'amber', 2: 'teal', 3: 'violet' }),
    shelf: Object.freeze({ 1: 'teal', 2: 'violet', 3: 'amber' }),
});

export const MUSHROOM_FORMS = Object.freeze(Object.keys(MUSHROOM_VARIANTS));
export const MUSHROOM_HUES = Object.freeze(['teal', 'violet', 'amber']);

/**
 * The yaw that turns a bracket mushroom away from each of a room's four walls.
 *
 * Named rather than written out at each call site: `Math.PI` at a wall reads as a number, and a
 * number is exactly as easy to get backwards as it looks. Verified by
 * tests/glowing-mushroom-assets.contract.test.mjs, which measures the growth direction.
 */
export const MUSHROOM_FACING = Object.freeze({
    fromMinZ: Math.PI,
    fromMaxZ: 0,
    fromMinX: -Math.PI / 2,
    fromMaxX: Math.PI / 2,
});

// Decoration this small stops being readable long before it stops being drawn. The default keeps
// a patch from costing draw calls across a whole map; a caller that places a landmark-sized
// cluster raises it.
const DEFAULT_RENDER_DISTANCE = 220;

/**
 * One placed mushroom.
 *
 * @param {string} id Unique within the map.
 * @param {string} form One of MUSHROOM_FORMS.
 * @param {number} variant 1..3.
 * @param {readonly number[]} position Map units, y is the ground the mushroom stands on.
 * @param {number} targetSize Largest dimension after the map scale, see fitScale in GLBMapLoader.
 * @param {{ rotationY?: number, maxRenderDistance?: number, tiltX?: number, tiltZ?: number }} [options]
 */
export function mushroom(id, form, variant, position, targetSize, options = {}) {
    if (!MUSHROOM_VARIANTS[form]) throw new Error(`unknown mushroom form: ${form}`);
    if (!MUSHROOM_VARIANTS[form][variant]) throw new Error(`unknown ${form} variant: ${variant}`);
    const padded = String(variant).padStart(2, '0');
    return Object.freeze({
        id,
        url: `${ASSET_BASE}/${form}_v${padded}.glb`,
        position: Object.freeze([...position]),
        rotation: Object.freeze([options.tiltX || 0, options.rotationY || 0, options.tiltZ || 0]),
        targetSize,
        maxRenderDistance: options.maxRenderDistance || DEFAULT_RENDER_DISTANCE,
        collision: false,
    });
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * A deterministic pseudo-random sequence.
 *
 * Not Math.random: two clients showing a different forest is a bug even when the forest is
 * decoration, and a map that rearranges itself between two runs cannot be tested by comparing
 * screenshots. The multiplier is the usual 32-bit LCG one; the values only have to be evenly
 * spread, not cryptographically anything.
 */
function sequence(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * Selects the variants a patch may draw from.
 *
 * @param {readonly string[]} forms
 * @param {readonly string[] | undefined} hues Restricts to these colours when given.
 */
function variantPool(forms, hues) {
    const pool = [];
    for (const form of forms) {
        for (const [variant, hue] of Object.entries(MUSHROOM_VARIANTS[form])) {
            if (hues && !hues.includes(hue)) continue;
            pool.push({ form, variant: Number(variant) });
        }
    }
    if (pool.length === 0) throw new Error('no mushroom variant matches the requested forms and hues');
    return pool;
}

/**
 * A scattered group of mushrooms around one point.
 *
 * Positions follow the golden angle rather than an even ring: an even ring reads as a fairy
 * circle, which is a decision a map should have to make on purpose. The radius grows with the
 * square root of the index so the patch stays evenly dense instead of crowding its centre.
 *
 * @param {{
 *   id: string,
 *   centre: readonly number[],
 *   radius: number,
 *   count: number,
 *   size: readonly number[],
 *   forms?: readonly string[],
 *   hues?: readonly string[],
 *   seed?: number,
 *   maxRenderDistance?: number,
 * }} spec
 * @returns {readonly object[]}
 */
export function mushroomPatch(spec) {
    const forms = spec.forms || MUSHROOM_FORMS;
    const pool = variantPool(forms, spec.hues);
    const [minSize, maxSize] = spec.size;
    const next = sequence(spec.seed || 1);
    const [cx, cy, cz] = spec.centre;
    const models = [];
    for (let index = 0; index < spec.count; index += 1) {
        const angle = index * GOLDEN_ANGLE;
        const distance = spec.radius * Math.sqrt((index + 0.5) / spec.count);
        const pick = pool[Math.floor(next() * pool.length) % pool.length];
        models.push(mushroom(
            `${spec.id}-${String(index + 1).padStart(2, '0')}`,
            pick.form,
            pick.variant,
            [cx + Math.cos(angle) * distance, cy, cz + Math.sin(angle) * distance],
            minSize + (maxSize - minSize) * next(),
            {
                rotationY: next() * Math.PI * 2,
                maxRenderDistance: spec.maxRenderDistance,
            },
        ));
    }
    return Object.freeze(models);
}

/**
 * A row of bracket mushrooms climbing a wall.
 *
 * Bracket mushrooms grow into their own **-Z** half space: the half disc is authored in
 * Blender's +Y, and the glTF export turns Blender's +Y into -Z. `facing` is the yaw that turns
 * that half space into the room, so MUSHROOM_FACING has the four values a rectangular room
 * needs. A row placed with the wrong facing vanishes into the wall it decorates.
 *
 * GLBMapLoader also centres a model horizontally, so a bracket placed exactly on a wall reaches
 * half its depth into it. Offset the row into the room by roughly a fifth of its target size.
 *
 * @param {{
 *   id: string,
 *   start: readonly number[],
 *   end: readonly number[],
 *   count: number,
 *   size: readonly number[],
 *   facing: number,
 *   hues?: readonly string[],
 *   seed?: number,
 *   maxRenderDistance?: number,
 * }} spec
 * @returns {readonly object[]}
 */
export function mushroomWallRow(spec) {
    const pool = variantPool(['shelf'], spec.hues);
    const [minSize, maxSize] = spec.size;
    const next = sequence(spec.seed || 1);
    const models = [];
    for (let index = 0; index < spec.count; index += 1) {
        const t = spec.count === 1 ? 0.5 : index / (spec.count - 1);
        const position = spec.start.map((value, axis) => value + (spec.end[axis] - value) * t);
        const pick = pool[Math.floor(next() * pool.length) % pool.length];
        models.push(mushroom(
            `${spec.id}-${String(index + 1).padStart(2, '0')}`,
            pick.form,
            pick.variant,
            position,
            minSize + (maxSize - minSize) * next(),
            {
                rotationY: spec.facing + (next() - 0.5) * 0.5,
                maxRenderDistance: spec.maxRenderDistance,
            },
        ));
    }
    return Object.freeze(models);
}
