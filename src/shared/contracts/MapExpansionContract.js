/**
 * Timing contract for maps that grow during a match.
 *
 * A map lists expansion stages. The first stage is the size a round starts at; every later
 * stage is a larger size that opens at a fixed match time, after an announcement and a short
 * opening. The map preset authors the stages, the arena applies the current size to its
 * collision bounds and the HUD counts down to the next opening - all of them read this one
 * normalized shape, so a stage cannot open at one time in the preset and another on screen.
 *
 * The state is derived from the elapsed match time instead of being accumulated per frame,
 * like MapAnimationClockContract and MapHazardContract. A client that receives the host's map
 * time, a replay that interpolates it and a round restart that resets it to zero therefore
 * all land on the same stage without a message of their own.
 *
 * A stage never makes the arena smaller. Growing outwards cannot trap a player inside a wall;
 * shrinking would need a push-out rule this contract does not define.
 */

export const MAP_EXPANSION_CONTRACT_VERSION = 'map-expansion.v1';

export const MAP_EXPANSION_RANGES = Object.freeze({
    stageCount: Object.freeze({ min: 2, max: 8 }),
    atSeconds: Object.freeze({ min: 0, max: 3600 }),
    telegraphSeconds: Object.freeze({ min: 0, max: 30 }),
    openSeconds: Object.freeze({ min: 0, max: 10 }),
    size: Object.freeze({ min: 4, max: 4000 }),
});

export const MAP_EXPANSION_PHASES = Object.freeze({
    /** A later stage exists but is not announced yet. */
    IDLE: 'IDLE',
    /** The next stage is announced; its walls still stand. */
    TELEGRAPH: 'TELEGRAPH',
    /** The walls of the next stage are opening; the old bounds still collide. */
    OPENING: 'OPENING',
    /** The last stage is open. */
    COMPLETE: 'COMPLETE',
});

const DEFAULTS = Object.freeze({
    telegraphSeconds: 8,
    openSeconds: 2,
});

const ID_MAX_LENGTH = 80;
const LABEL_MAX_LENGTH = 40;

/**
 * @typedef {object} MapExpansionStage
 * @property {string} id
 * @property {string} label Short name for announcements; empty when the map states none.
 * @property {number} atSeconds Match time at which the stage is fully open and its size applies.
 * @property {number} telegraphSeconds How long the opening is announced before it starts.
 * @property {number} openSeconds How long the walls take to open, ending at atSeconds.
 * @property {readonly number[]} size Width, height and depth in authored units, like map.size.
 */

/**
 * @typedef {object} MapExpansion
 * @property {readonly Readonly<MapExpansionStage>[]} stages Sorted by atSeconds, first at 0.
 */

/**
 * @typedef {object} MapExpansionState
 * @property {number} stageIndex Last stage that is fully open.
 * @property {number} nextStageIndex Stage that opens next, -1 once the last one is open.
 * @property {string} phase One of MAP_EXPANSION_PHASES.
 * @property {number} phaseProgress 0 to 1 within TELEGRAPH or OPENING; 0 in IDLE, 1 in COMPLETE.
 * @property {number} secondsUntilOpen Time until the next stage applies, 0 once complete.
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
 * @param {{ min: number, max: number }} range
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, range, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, parsed));
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {number} maxLength
 * @returns {string}
 */
function readText(value, fallback, maxLength) {
    const text = typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
    return text || fallback;
}

/**
 * @param {unknown} value
 * @returns {number[] | null}
 */
function readSize(value) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const size = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
        const parsed = Number(value[axis]);
        if (value[axis] === null || !Number.isFinite(parsed)) return null;
        size[axis] = Math.min(MAP_EXPANSION_RANGES.size.max, Math.max(MAP_EXPANSION_RANGES.size.min, parsed));
    }
    return size;
}

/**
 * @param {unknown} source
 * @param {number} index
 * @returns {MapExpansionStage | null}
 */
function readStageCandidate(source, index) {
    if (!isRecord(source)) return null;
    const size = readSize(source.size);
    if (!size) return null;
    return {
        id: readText(source.id, `expansion_stage_${index}`, ID_MAX_LENGTH),
        label: readText(source.label, '', LABEL_MAX_LENGTH),
        atSeconds: clampNumber(source.atSeconds, MAP_EXPANSION_RANGES.atSeconds, 0),
        telegraphSeconds: clampNumber(
            source.telegraphSeconds,
            MAP_EXPANSION_RANGES.telegraphSeconds,
            DEFAULTS.telegraphSeconds,
        ),
        openSeconds: clampNumber(source.openSeconds, MAP_EXPANSION_RANGES.openSeconds, DEFAULTS.openSeconds),
        size,
    };
}

/**
 * Accepts anything a preset may hold and returns a usable expansion, or null when the map
 * does not grow. Stages are sorted by time; a stage sharing its time with an earlier one or
 * lacking a size is dropped, a smaller size is raised to the previous one, and the
 * announcement of a stage is shortened so it never starts before the previous stage opened.
 * That keeps exactly one upcoming stage at any match time.
 * @param {unknown} source
 * @returns {Readonly<MapExpansion> | null}
 */
export function normalizeMapExpansion(source) {
    const entries = isRecord(source) && Array.isArray(source.stages) ? source.stages : [];
    /** @type {MapExpansionStage[]} */
    const candidates = [];
    for (let index = 0; index < entries.length; index += 1) {
        const candidate = readStageCandidate(entries[index], index);
        if (candidate) candidates.push(candidate);
    }
    candidates.sort((a, b) => a.atSeconds - b.atSeconds);

    /** @type {Readonly<MapExpansionStage>[]} */
    const stages = [];
    for (const candidate of candidates) {
        if (stages.length >= MAP_EXPANSION_RANGES.stageCount.max) break;
        const previous = stages[stages.length - 1];
        if (!previous) {
            // The first stage is the starting size; there is nothing to announce or open.
            stages.push(Object.freeze({
                ...candidate,
                atSeconds: 0,
                telegraphSeconds: 0,
                openSeconds: 0,
                size: Object.freeze(candidate.size),
            }));
            continue;
        }
        if (candidate.atSeconds <= previous.atSeconds) continue;
        const window = candidate.atSeconds - previous.atSeconds;
        const openSeconds = Math.min(candidate.openSeconds, window);
        stages.push(Object.freeze({
            ...candidate,
            openSeconds,
            telegraphSeconds: Math.min(candidate.telegraphSeconds, window - openSeconds),
            size: Object.freeze(candidate.size.map((value, axis) => Math.max(previous.size[axis], value))),
        }));
    }

    if (stages.length < MAP_EXPANSION_RANGES.stageCount.min) return null;
    return Object.freeze({ stages: Object.freeze(stages) });
}

/**
 * @returns {MapExpansionState}
 */
export function createMapExpansionState() {
    return {
        stageIndex: 0,
        nextStageIndex: -1,
        phase: MAP_EXPANSION_PHASES.COMPLETE,
        phaseProgress: 1,
        secondsUntilOpen: 0,
    };
}

/**
 * Where a normalized expansion stands at a given match time. Writes into target so the
 * per-frame caller does not allocate; returns target.
 * @param {Readonly<MapExpansion> | null | undefined} expansion
 * @param {number} elapsedSeconds
 * @param {MapExpansionState} [target]
 * @returns {MapExpansionState}
 */
export function resolveMapExpansionState(expansion, elapsedSeconds, target = createMapExpansionState()) {
    const stages = expansion?.stages ?? [];
    const parsed = Number(elapsedSeconds);
    const time = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    let stageIndex = 0;
    while (stageIndex + 1 < stages.length && time >= stages[stageIndex + 1].atSeconds) stageIndex += 1;
    target.stageIndex = stageIndex;

    const next = stages[stageIndex + 1];
    if (!next) {
        target.nextStageIndex = -1;
        target.phase = MAP_EXPANSION_PHASES.COMPLETE;
        target.phaseProgress = 1;
        target.secondsUntilOpen = 0;
        return target;
    }

    target.nextStageIndex = stageIndex + 1;
    target.secondsUntilOpen = next.atSeconds - time;
    const openingStart = next.atSeconds - next.openSeconds;
    const telegraphStart = openingStart - next.telegraphSeconds;
    if (next.openSeconds > 0 && time >= openingStart) {
        target.phase = MAP_EXPANSION_PHASES.OPENING;
        target.phaseProgress = (time - openingStart) / next.openSeconds;
    } else if (next.telegraphSeconds > 0 && time >= telegraphStart) {
        target.phase = MAP_EXPANSION_PHASES.TELEGRAPH;
        target.phaseProgress = (time - telegraphStart) / next.telegraphSeconds;
    } else {
        target.phase = MAP_EXPANSION_PHASES.IDLE;
        target.phaseProgress = 0;
    }
    return target;
}
