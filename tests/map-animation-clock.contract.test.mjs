import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAP_ANIMATION_CLOCK_CONTRACT_VERSION,
    MAP_ANIMATION_CLOCK_RANGES,
    createDefaultMapAnimationClock,
    isBeatAlignedClipDuration,
    isMapAnimationClockOneShot,
    normalizeMapAnimationClock,
    resolveMapAnimationClipPhase,
} from '../src/shared/contracts/MapAnimationClockContract.js';

test('default clock plays the first clip on the map beat', () => {
    assert.equal(MAP_ANIMATION_CLOCK_CONTRACT_VERSION, 'map-animation-clock.v1');
    assert.deepEqual(createDefaultMapAnimationClock(), {
        beatSeconds: 4,
        phaseOffsetBeats: 0,
        playbackRate: 1,
        clipName: '',
        mode: 'loop',
    });
});

test('normalization turns any input into a complete clock', () => {
    const expected = createDefaultMapAnimationClock();
    for (const input of [undefined, null, [], 'abc', 42, { beatSeconds: 'x' }]) {
        assert.deepEqual(normalizeMapAnimationClock(input), expected, `input ${JSON.stringify(input)}`);
    }
});

test('a setpiece only states what differs from the map clock', () => {
    const mapClock = { beatSeconds: 8, playbackRate: 0.5 };

    assert.deepEqual(normalizeMapAnimationClock({ phaseOffsetBeats: 1.5 }, mapClock), {
        beatSeconds: 8,
        phaseOffsetBeats: 1.5,
        playbackRate: 0.5,
        clipName: '',
        mode: 'loop',
    });
    // A fallback that is not an object falls back to the defaults, not to nothing.
    assert.deepEqual(normalizeMapAnimationClock({}, []), createDefaultMapAnimationClock());
});

test('values outside the authored ranges are clamped, not rejected', () => {
    const low = normalizeMapAnimationClock({
        beatSeconds: 0,
        phaseOffsetBeats: -1000,
        playbackRate: 0,
    });
    assert.equal(low.beatSeconds, MAP_ANIMATION_CLOCK_RANGES.beatSeconds.min);
    assert.equal(low.phaseOffsetBeats, MAP_ANIMATION_CLOCK_RANGES.phaseOffsetBeats.min);
    assert.equal(low.playbackRate, MAP_ANIMATION_CLOCK_RANGES.playbackRate.min);

    const high = normalizeMapAnimationClock({
        beatSeconds: 10_000,
        phaseOffsetBeats: 1000,
        playbackRate: 1000,
    });
    assert.equal(high.beatSeconds, MAP_ANIMATION_CLOCK_RANGES.beatSeconds.max);
    assert.equal(high.phaseOffsetBeats, MAP_ANIMATION_CLOCK_RANGES.phaseOffsetBeats.max);
    assert.equal(high.playbackRate, MAP_ANIMATION_CLOCK_RANGES.playbackRate.max);
});

test('clip names are trimmed and blank names keep the fallback', () => {
    assert.equal(normalizeMapAnimationClock({ clipName: '  GateBreath  ' }).clipName, 'GateBreath');
    assert.equal(normalizeMapAnimationClock({ clipName: '   ' }, { clipName: 'Loop' }).clipName, 'Loop');
    assert.equal(normalizeMapAnimationClock({ clipName: 7 }).clipName, '');
});

test('phase wraps inside the clip and never leaves its bounds', () => {
    const clock = { beatSeconds: 4, phaseOffsetBeats: 0, playbackRate: 1 };

    assert.equal(resolveMapAnimationClipPhase(0, clock, 8), 0);
    assert.equal(resolveMapAnimationClipPhase(3, clock, 8), 3);
    assert.equal(resolveMapAnimationClipPhase(8, clock, 8), 0);
    assert.equal(resolveMapAnimationClipPhase(19, clock, 8), 3);
});

test('phase offset shifts a setpiece against the map beat', () => {
    const behind = { beatSeconds: 4, phaseOffsetBeats: -0.5 };
    const ahead = { beatSeconds: 4, phaseOffsetBeats: 0.5 };

    // Half a beat is two seconds; the negative offset wraps to the end of the clip.
    assert.equal(resolveMapAnimationClipPhase(0, ahead, 8), 2);
    assert.equal(resolveMapAnimationClipPhase(0, behind, 8), 6);
});

test('playback rate scales elapsed time', () => {
    assert.equal(resolveMapAnimationClipPhase(4, { playbackRate: 2 }, 16), 8);
    assert.equal(resolveMapAnimationClipPhase(4, { playbackRate: 0.5 }, 16), 2);
});

test('a clip without a usable duration stays on its first frame', () => {
    for (const duration of [0, -4, Number.NaN, undefined, 'x']) {
        assert.equal(resolveMapAnimationClipPhase(7, {}, /** @type {any} */(duration)), 0);
    }
    assert.equal(resolveMapAnimationClipPhase(Number.NaN, {}, 8), 0);
});

test('the same elapsed time always yields the same phase', () => {
    const clock = { beatSeconds: 4, phaseOffsetBeats: 0.25, playbackRate: 1.5 };
    const step = 1 / 60;

    // One long step, many short steps and a step sequence with a gap must agree, because
    // the phase is computed from elapsed time rather than accumulated per frame.
    const elapsed = 137 * step;
    assert.equal(
        resolveMapAnimationClipPhase(elapsed, clock, 12),
        resolveMapAnimationClipPhase(137 * step, clock, 12),
    );
    assert.ok(resolveMapAnimationClipPhase(elapsed, clock, 12) < 12);
});

test('a clock is either a loop or a single play, and only those two', () => {
    assert.equal(normalizeMapAnimationClock({ mode: 'once' }).mode, 'once');
    assert.equal(isMapAnimationClockOneShot({ mode: 'once' }), true);
    assert.equal(isMapAnimationClockOneShot({ mode: 'loop' }), false);
    assert.equal(isMapAnimationClockOneShot(null), false);

    // Anything that is not one of the two known modes keeps the fallback.
    for (const mode of ['ONCE', 'single', 7, null, undefined, {}]) {
        assert.equal(normalizeMapAnimationClock({ mode }).mode, 'loop', `mode ${JSON.stringify(mode)}`);
        assert.equal(normalizeMapAnimationClock({ mode }, { mode: 'once' }).mode, 'once');
    }
    // A setpiece inherits the mode from the map clock like every other field.
    assert.equal(normalizeMapAnimationClock({}, { mode: 'once' }).mode, 'once');
    assert.equal(normalizeMapAnimationClock({ mode: 'loop' }, { mode: 'once' }).mode, 'loop');
});

test('a one-shot clip waits for its start, plays once and holds the last frame', () => {
    const clock = { mode: 'once', beatSeconds: 4, playbackRate: 1 };

    // Before the break the tower stands: the clip is pinned to its first frame.
    assert.equal(resolveMapAnimationClipPhase(0, clock, 8, 10), 0);
    assert.equal(resolveMapAnimationClipPhase(9.5, clock, 8, 10), 0);
    // During the fall the phase is the time since the break.
    assert.equal(resolveMapAnimationClipPhase(10, clock, 8, 10), 0);
    assert.equal(resolveMapAnimationClipPhase(14, clock, 8, 10), 4);
    assert.equal(resolveMapAnimationClipPhase(17.5, clock, 8, 10), 7.5);
    // Afterwards it stays down instead of wrapping back to standing.
    assert.equal(resolveMapAnimationClipPhase(18, clock, 8, 10), 8);
    assert.equal(resolveMapAnimationClipPhase(600, clock, 8, 10), 8);

    // Playback rate still applies, and a missing start means "from the round start".
    assert.equal(resolveMapAnimationClipPhase(3, { mode: 'once', playbackRate: 2 }, 16), 6);
    assert.equal(resolveMapAnimationClipPhase(5, clock, 0, 1), 0);
    assert.equal(resolveMapAnimationClipPhase(12, clock, 8, /** @type {any} */('spaet')), 8);
});

test('a one-shot clip starts at its first frame even with a phase offset on the map', () => {
    // The offset spreads looping setpieces across the map beat. A break scene that inherited it
    // from the map clock would begin its collapse part way through.
    const offset = { mode: 'once', beatSeconds: 4, phaseOffsetBeats: 0.5 };
    assert.equal(resolveMapAnimationClipPhase(1, offset, 16, 1), 0);
    assert.equal(resolveMapAnimationClipPhase(2, offset, 16, 1), 1);

    const inherited = normalizeMapAnimationClock(
        { mode: 'once' },
        { beatSeconds: 4, phaseOffsetBeats: 2 },
    );
    assert.equal(inherited.phaseOffsetBeats, 2, 'the offset is still carried, just not used');
    assert.equal(resolveMapAnimationClipPhase(10, inherited, 16, 10), 0);
    assert.equal(resolveMapAnimationClipPhase(13, inherited, 16, 10), 3);
});

test('a looping clip ignores the start time entirely', () => {
    const clock = { beatSeconds: 4, playbackRate: 1 };

    for (const start of [0, 10, -5, Number.NaN]) {
        assert.equal(resolveMapAnimationClipPhase(11, clock, 8, start), 3, `start ${start}`);
    }
});

test('beat alignment accepts whole multiples and rejects drifting loops', () => {
    const clock = { beatSeconds: 4 };

    assert.equal(isBeatAlignedClipDuration(4, clock), true);
    assert.equal(isBeatAlignedClipDuration(16, clock), true);
    // Within one exported frame at 30 fps the loop is as precise as it can be authored.
    assert.equal(isBeatAlignedClipDuration(8 + (1 / 90), clock), true);
    assert.equal(isBeatAlignedClipDuration(8.5, clock), false);
    // Shorter than a single beat: nothing to stay in sync with.
    assert.equal(isBeatAlignedClipDuration(1, clock), false);
    assert.equal(isBeatAlignedClipDuration(0, clock), false);
    assert.equal(isBeatAlignedClipDuration(Number.NaN, clock), false);
    assert.equal(isBeatAlignedClipDuration(8.5, clock, 1), true);
});

test('a one-shot clip is exempt from beat alignment', () => {
    const clock = { beatSeconds: 4, mode: 'once' };

    // A collapse runs from an event, never against the beat, so any length is authored fine.
    assert.equal(isBeatAlignedClipDuration(8.5, clock), true);
    assert.equal(isBeatAlignedClipDuration(1, clock), true);
    assert.equal(isBeatAlignedClipDuration(4, clock), true);
    // A file without a usable length is still a broken asset, one-shot or not.
    assert.equal(isBeatAlignedClipDuration(0, clock), false);
    assert.equal(isBeatAlignedClipDuration(Number.NaN, clock), false);
});
