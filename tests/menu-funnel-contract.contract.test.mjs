import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MENU_FUNNEL_ABORT_REASONS,
    MENU_FUNNEL_CLICK_BUCKETS,
    MENU_FUNNEL_CONTRACT_VERSION,
    MENU_FUNNEL_EVENTS,
    MENU_FUNNEL_PATH_MAX_LENGTH,
    createMenuFunnelPath,
    getMenuFunnelClickBucket,
    normalizeMenuFunnelEvent,
} from '../src/shared/contracts/MenuFunnelContract.js';
import {
    createDefaultFunnelSummary,
    normalizeFunnelSummary,
    recordFunnelTelemetry,
} from '../src/ui/menu/MenuTelemetryAggregateOps.js';

function clock(start = 1000) {
    let value = start;
    const now = () => value;
    now.advance = (ms) => { value += ms; };
    return now;
}

test('contract exposes the version and the full event vocabulary of the new menu', () => {
    assert.equal(MENU_FUNNEL_CONTRACT_VERSION, 1);
    assert.deepEqual([...MENU_FUNNEL_EVENTS], [
        'continue_pressed', 'first_flight_pressed', 'session_selected', 'hub_opened',
        'freeplay_opened', 'stage_selected', 'stage_started', 'freeplay_started',
        'lobby_create', 'lobby_join', 'settings_opened', 'back_pressed',
        'match_started', 'menu_aborted',
    ]);
    ['back_to_start', 'quit', 'lobby_left', 'start_failed'].forEach((reason) => {
        assert.ok(MENU_FUNNEL_ABORT_REASONS.includes(reason), reason);
    });
    assert.ok(Object.isFrozen(MENU_FUNNEL_EVENTS));
    assert.ok(Object.isFrozen(MENU_FUNNEL_ABORT_REASONS));
});

test('normalizeMenuFunnelEvent accepts strings and objects and drops unknown events', () => {
    assert.deepEqual(normalizeMenuFunnelEvent('continue_pressed'), { type: 'continue_pressed' });
    assert.deepEqual(normalizeMenuFunnelEvent({ type: ' hub_opened ', extra: 1 }), { type: 'hub_opened' });
    assert.deepEqual(
        normalizeMenuFunnelEvent({ type: 'menu_aborted', reason: 'quit' }),
        { type: 'menu_aborted', reason: 'quit' },
    );
    assert.deepEqual(
        normalizeMenuFunnelEvent({ type: 'menu_aborted', reason: 'something_new' }),
        { type: 'menu_aborted', reason: 'unknown' },
    );
    assert.deepEqual(normalizeMenuFunnelEvent({ type: 'menu_aborted' }), { type: 'menu_aborted', reason: 'unknown' });
    // The reason is only meaningful for aborts.
    assert.deepEqual(normalizeMenuFunnelEvent({ type: 'back_pressed', reason: 'quit' }), { type: 'back_pressed' });
    [null, undefined, 42, '', 'nonsense', {}, { type: 7 }, [], { type: '__proto__' }].forEach((raw) => {
        assert.equal(normalizeMenuFunnelEvent(raw), null, JSON.stringify(raw));
    });
});

test('path counts interactions with injected time until match_started', () => {
    const now = clock(5000);
    const path = createMenuFunnelPath({ now });
    now.advance(300);
    assert.equal(path.record('continue_pressed'), null);
    now.advance(700);
    assert.equal(path.record({ type: 'session_selected' }), null);
    assert.equal(path.record('totally_unknown'), null, 'unknown events are ignored');
    now.advance(500);
    assert.deepEqual(path.snapshot(), {
        clicks: 2,
        durationMs: 1500,
        path: ['continue_pressed', 'session_selected'],
    });
    now.advance(1000);
    const result = path.record('match_started');
    assert.deepEqual(result, {
        clicks: 2,
        durationMs: 2500,
        path: ['continue_pressed', 'session_selected', 'match_started'],
    });
    // After the match start the path is closed until reset.
    assert.equal(path.record('hub_opened'), null);
    assert.equal(path.snapshot().clicks, 2);
    now.advance(10);
    path.reset();
    assert.deepEqual(path.snapshot(), { clicks: 0, durationMs: 0, path: [] });
});

test('path length is bounded while clicks keep counting', () => {
    const path = createMenuFunnelPath({ now: () => 0 });
    const total = MENU_FUNNEL_PATH_MAX_LENGTH + 20;
    for (let i = 0; i < total; i += 1) path.record('back_pressed');
    const snapshot = path.snapshot();
    assert.equal(snapshot.path.length, MENU_FUNNEL_PATH_MAX_LENGTH);
    assert.equal(snapshot.clicks, total);
    const result = path.record('match_started');
    assert.ok(result.path.length <= MENU_FUNNEL_PATH_MAX_LENGTH);
    assert.equal(result.path[result.path.length - 1], 'match_started', 'terminal event is always kept');
});

test('path ends on menu_aborted and tolerates a missing or broken clock', () => {
    const path = createMenuFunnelPath({ now: () => 10 });
    path.record('continue_pressed');
    const aborted = path.record({ type: 'menu_aborted', reason: 'back_to_start' });
    assert.equal(aborted.clicks, 1);
    assert.equal(aborted.path.at(-1), 'menu_aborted');
    const noClock = createMenuFunnelPath();
    noClock.record('hub_opened');
    assert.deepEqual(noClock.snapshot(), { clicks: 1, durationMs: 0, path: ['hub_opened'] });
    const brokenClock = createMenuFunnelPath({ now: () => Number.NaN });
    brokenClock.record('hub_opened');
    assert.equal(brokenClock.snapshot().durationMs, 0);
});

test('click buckets are monotonic and cover every count', () => {
    assert.equal(getMenuFunnelClickBucket(0), MENU_FUNNEL_CLICK_BUCKETS[0].id);
    assert.equal(getMenuFunnelClickBucket(2), '1-2');
    assert.equal(getMenuFunnelClickBucket(3), '3-4');
    assert.equal(getMenuFunnelClickBucket(7), '7-9');
    assert.equal(getMenuFunnelClickBucket(10), '10+');
    assert.equal(getMenuFunnelClickBucket(100000), '10+');
    assert.equal(getMenuFunnelClickBucket(Number.NaN), MENU_FUNNEL_CLICK_BUCKETS[0].id);
});

test('legacy funnel data without the new fields still normalizes', () => {
    const legacy = {
        eventCounts: { start_attempt: 5, abort: 2 },
        abortReasonCounts: { escape: 1 },
        quickStartVariantCounts: { fast: 3 },
        sessionTypeCounts: { local: 4 },
    };
    const normalized = normalizeFunnelSummary(legacy);
    assert.equal(normalized.eventCounts.start_attempt, 5);
    assert.equal(normalized.abortReasonCounts.escape, 1);
    assert.equal(normalized.quickStartVariantCounts.fast, 3);
    assert.equal(normalized.sessionTypeCounts.local, 4);
    assert.deepEqual(normalized.clicksToMatchCounts, {});
    assert.equal(normalized.matchPathSamples, 0);
    assert.equal(normalized.clicksToMatchSum, 0);
    assert.equal(normalized.durationToMatchMsSum, 0);
    assert.deepEqual(normalizeFunnelSummary(null), createDefaultFunnelSummary());
});

test('new funnel fields survive normalization and recording', () => {
    const state = {};
    recordFunnelTelemetry(state, 'continue_pressed');
    recordFunnelTelemetry(state, 'match_started', { clicks: 2, durationMs: 4000, sessionType: 'single' });
    recordFunnelTelemetry(state, 'match_started', { clicks: 12, durationMs: 9000 });
    recordFunnelTelemetry(state, 'menu_aborted', { reason: 'lobby_left' });
    recordFunnelTelemetry(state, 'match_started', {});
    const summary = normalizeFunnelSummary(state.funnelSummary);
    assert.equal(summary.eventCounts.continue_pressed, 1);
    assert.equal(summary.eventCounts.match_started, 3);
    assert.equal(summary.abortReasonCounts.lobby_left, 1);
    assert.equal(summary.sessionTypeCounts.single, 1);
    assert.deepEqual(summary.clicksToMatchCounts, { '1-2': 1, '10+': 1 });
    assert.equal(summary.matchPathSamples, 2);
    assert.equal(summary.clicksToMatchSum, 14);
    assert.equal(summary.durationToMatchMsSum, 13000);
    assert.deepEqual(normalizeFunnelSummary(JSON.parse(JSON.stringify(summary))), summary);
});

test('old abort event keeps its reason counting', () => {
    const state = {};
    recordFunnelTelemetry(state, 'abort', { reason: 'escape' });
    assert.equal(state.funnelSummary.abortReasonCounts.escape, 1);
});
