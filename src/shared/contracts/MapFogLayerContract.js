/**
 * Timing contract for maps whose fog travels vertically during a match.
 *
 * A map lists stages. Each stage states where the fog's two edges stand at one moment of match
 * time: a ceiling, above which the fog thins out, and a floor, below which it thins out. The
 * renderer interpolates between the stages and uploads the result to the fog shader; nothing else
 * in the map changes.
 *
 * The two edges are what make the layer able to turn itself inside out. With the floor inactive
 * (`floorFalloff` 0) the fog fills everything up to the ceiling - the ground is blind and the air
 * above is clear. With the ceiling inactive instead, the same fog sits above the floor and the
 * ground clears. A map that raises one while lowering the other moves the fight from one storey to
 * another without touching a single rule.
 *
 * Like MapExpansionContract and MapAnimationClockContract, the state is derived from the elapsed
 * match time rather than accumulated per frame. A client that receives the host's map time, a
 * replay that interpolates it and a round restart that resets it to zero therefore all see the
 * same fog, without a message of their own.
 *
 * Heights are authored map units, the same ones obstacles and spawns use; the renderer scales them
 * with the world scale, exactly as it scales the map's static fog height.
 */

export const MAP_FOG_LAYER_CONTRACT_VERSION = 'map-fog-layer.v1';

export const MAP_FOG_LAYER_RANGES = Object.freeze({
    stageCount: Object.freeze({ min: 2, max: 8 }),
    atSeconds: Object.freeze({ min: 0, max: 3600 }),
    height: Object.freeze({ min: -1000, max: 4000 }),
    // Mirrors MapLightingContract's fog falloff ceiling: above 0.5 the fog would be gone within
    // two metres of its edge, which reads as a hard plane rather than as weather.
    falloff: Object.freeze({ min: 0, max: 0.5 }),
});

function clamp(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizeStage(source) {
    const entry = source && typeof source === 'object' ? source : {};
    const { atSeconds, height, falloff } = MAP_FOG_LAYER_RANGES;
    return Object.freeze({
        atSeconds: clamp(entry.atSeconds, 0, atSeconds.min, atSeconds.max),
        ceiling: clamp(entry.ceiling, height.max, height.min, height.max),
        ceilingFalloff: clamp(entry.ceilingFalloff, 0, falloff.min, falloff.max),
        floor: clamp(entry.floor, height.min, height.min, height.max),
        floorFalloff: clamp(entry.floorFalloff, 0, falloff.min, falloff.max),
    });
}

/**
 * @param {unknown} source
 * @returns {{ stages: ReadonlyArray<Readonly<{atSeconds: number, ceiling: number, ceilingFalloff: number, floor: number, floorFalloff: number}>> } | null}
 */
export function normalizeMapFogLayer(source) {
    const stages = Array.isArray(/** @type {any} */ (source)?.stages)
        ? /** @type {any} */ (source).stages
        : null;
    // A single stage is a fog that never moves, which the map's lighting profile already states.
    // Returning null there keeps one way to express one thing.
    if (!stages || stages.length < MAP_FOG_LAYER_RANGES.stageCount.min) return null;

    const normalized = stages
        .slice(0, MAP_FOG_LAYER_RANGES.stageCount.max)
        .map(normalizeStage)
        .sort((left, right) => left.atSeconds - right.atSeconds);
    return Object.freeze({ stages: Object.freeze(normalized) });
}

export function createMapFogLayerState() {
    return { ceiling: 0, ceilingFalloff: 0, floor: 0, floorFalloff: 0 };
}

function mix(from, to, t) {
    return from + (to - from) * t;
}

/**
 * The fog edges at one moment of match time. Returns null for a map without a layer, so a caller
 * can tell "no travelling fog" from "a layer that happens to sit at zero" and leave the map's
 * static fog profile alone.
 *
 * @param {ReturnType<typeof normalizeMapFogLayer>} layer
 * @param {number} elapsedSeconds
 * @param {ReturnType<typeof createMapFogLayerState>} [target] reused across frames
 */
export function resolveMapFogLayerState(layer, elapsedSeconds, target = createMapFogLayerState()) {
    const stages = layer?.stages;
    if (!Array.isArray(stages) || stages.length === 0) return null;

    const parsed = Number(elapsedSeconds);
    const time = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    let index = 0;
    while (index + 1 < stages.length && time >= stages[index + 1].atSeconds) index += 1;
    const stage = stages[index];
    const next = stages[index + 1];

    // Before the first stage, after the last one, and between two stages authored at the same
    // second: hold the stage itself rather than extrapolating past what the map stated.
    const span = next ? next.atSeconds - stage.atSeconds : 0;
    const t = span > 0 ? Math.min(1, Math.max(0, (time - stage.atSeconds) / span)) : 0;

    target.ceiling = next ? mix(stage.ceiling, next.ceiling, t) : stage.ceiling;
    target.ceilingFalloff = next ? mix(stage.ceilingFalloff, next.ceilingFalloff, t) : stage.ceilingFalloff;
    target.floor = next ? mix(stage.floor, next.floor, t) : stage.floor;
    target.floorFalloff = next ? mix(stage.floorFalloff, next.floorFalloff, t) : stage.floorFalloff;
    return target;
}
