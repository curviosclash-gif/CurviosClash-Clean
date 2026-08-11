/**
 * Timing contract for animated GLB setpieces placed on a map.
 *
 * A map defines one beat length; every animated setpiece states how far it runs ahead of
 * that beat and how fast it plays. Authoring (map presets), the runtime that drives the
 * animation mixers and the asset tests all read the same normalized shape, so a setpiece
 * cannot be timed one way in the preset and another way on screen.
 *
 * The phase is computed from the elapsed simulation time rather than accumulated per
 * frame. That keeps two clients on the same pose: they derive the same phase from the same
 * tick count instead of summing frame deltas that differ between machines.
 */

export const MAP_ANIMATION_CLOCK_CONTRACT_VERSION = 'map-animation-clock.v1';

export const MAP_ANIMATION_CLOCK_RANGES = Object.freeze({
    beatSeconds: Object.freeze({ min: 0.25, max: 120 }),
    phaseOffsetBeats: Object.freeze({ min: -64, max: 64 }),
    playbackRate: Object.freeze({ min: 0.05, max: 8 }),
});

const DEFAULTS = Object.freeze({
    beatSeconds: 4,
    phaseOffsetBeats: 0,
    playbackRate: 1,
    clipName: '',
});

// Half a frame at 30 fps, the export rate of the authored setpieces. A loop that misses
// its beat by less than one exported frame cannot be authored more precisely.
const DEFAULT_BEAT_TOLERANCE_SECONDS = 1 / 60;

/**
 * @typedef {object} MapAnimationClock
 * @property {number} beatSeconds Length of one beat in seconds.
 * @property {number} phaseOffsetBeats How many beats this setpiece runs ahead.
 * @property {number} playbackRate Multiplier on the elapsed time.
 * @property {string} clipName Clip to play; empty selects the first clip in the file.
 */

/**
 * @param {unknown} value
 * @param {{ min: number, max: number }} range
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, range, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, parsed));
}

/**
 * @returns {MapAnimationClock}
 */
export function createDefaultMapAnimationClock() {
    return { ...DEFAULTS };
}

/**
 * Accepts anything a preset or a stored map may hold and returns a complete clock.
 * The fallback carries the map level clock so a setpiece only has to state what differs.
 * @param {unknown} source
 * @param {unknown} [fallback]
 * @returns {MapAnimationClock}
 */
export function normalizeMapAnimationClock(source, fallback = null) {
    const base = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
        ? { ...DEFAULTS, ...normalizeClockShape(/** @type {Record<string, unknown>} */(fallback), DEFAULTS) }
        : { ...DEFAULTS };
    const input = source && typeof source === 'object' && !Array.isArray(source)
        ? /** @type {Record<string, unknown>} */ (source)
        : {};
    return normalizeClockShape(input, base);
}

/**
 * @param {Record<string, unknown>} input
 * @param {MapAnimationClock} base
 * @returns {MapAnimationClock}
 */
function normalizeClockShape(input, base) {
    return {
        beatSeconds: clampNumber(input.beatSeconds, MAP_ANIMATION_CLOCK_RANGES.beatSeconds, base.beatSeconds),
        phaseOffsetBeats: clampNumber(
            input.phaseOffsetBeats,
            MAP_ANIMATION_CLOCK_RANGES.phaseOffsetBeats,
            base.phaseOffsetBeats,
        ),
        playbackRate: clampNumber(input.playbackRate, MAP_ANIMATION_CLOCK_RANGES.playbackRate, base.playbackRate),
        clipName: typeof input.clipName === 'string' && input.clipName.trim()
            ? input.clipName.trim()
            : base.clipName,
    };
}

/**
 * Position inside the clip for a given elapsed simulation time, always within
 * [0, clipDurationSeconds). Returns 0 for a clip without a usable duration, which keeps a
 * malformed asset on its first frame instead of throwing during a match.
 * @param {number} elapsedSeconds
 * @param {unknown} clock
 * @param {number} clipDurationSeconds
 * @returns {number}
 */
export function resolveMapAnimationClipPhase(elapsedSeconds, clock, clipDurationSeconds) {
    const duration = Number(clipDurationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return 0;

    const normalized = normalizeMapAnimationClock(clock);
    const elapsed = Number.isFinite(Number(elapsedSeconds)) ? Number(elapsedSeconds) : 0;
    const offsetSeconds = normalized.phaseOffsetBeats * normalized.beatSeconds;
    const phase = (elapsed * normalized.playbackRate) + offsetSeconds;
    const wrapped = phase % duration;
    return wrapped < 0 ? wrapped + duration : wrapped;
}

/**
 * True when a clip length is a whole multiple of the beat, so the setpiece stays in sync
 * with the rest of the map instead of drifting against it. Asset tests use this to keep
 * authored loop lengths honest.
 * @param {number} clipDurationSeconds
 * @param {unknown} clock
 * @param {number} [toleranceSeconds]
 * @returns {boolean}
 */
export function isBeatAlignedClipDuration(
    clipDurationSeconds,
    clock,
    toleranceSeconds = DEFAULT_BEAT_TOLERANCE_SECONDS,
) {
    const duration = Number(clipDurationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return false;

    const { beatSeconds } = normalizeMapAnimationClock(clock);
    const tolerance = Math.max(0, Number(toleranceSeconds) || 0);
    const beats = duration / beatSeconds;
    const distanceToWholeBeat = Math.abs(beats - Math.round(beats)) * beatSeconds;
    return Math.round(beats) >= 1 && distanceToWholeBeat <= tolerance;
}
