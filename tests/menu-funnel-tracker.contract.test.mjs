import assert from 'node:assert/strict';
import test from 'node:test';

import { createMenuFunnelTracker } from '../src/core/runtime/MenuFunnelTracker.js';
import { MenuTelemetryStore } from '../src/ui/menu/MenuTelemetryStore.js';
import { normalizeTelemetrySnapshot } from '../src/core/settings/SettingsTelemetryFacade.js';

function createTracker() {
    let clock = 1000;
    const recorded = [];
    const tracker = createMenuFunnelTracker({
        now: () => clock,
        record: (eventType, payload) => recorded.push({ eventType, payload }),
    });
    return { tracker, recorded, advance: (ms) => { clock += ms; } };
}

test('the path from the start screen to the match start is reported once with clicks and time', () => {
    const { tracker, recorded, advance } = createTracker();
    tracker.onPanelChanged('submenu-custom', 'nav');
    advance(1500);
    tracker.onPanelChanged('submenu-game', 'mode_path_selected');
    tracker.onSettingsOpened();
    tracker.onPanelChanged('submenu-custom', 'back_button');
    tracker.onPanelChanged('submenu-game', 'mode_path_selected');
    advance(2500);
    tracker.onMatchStartAttempt();
    tracker.onMatchStartAttempt();
    assert.equal(recorded.length, 1, 'a second start attempt in the same path is not counted again');
    assert.equal(recorded[0].eventType, 'match_started');
    assert.equal(recorded[0].payload.clicks, 5);
    assert.equal(recorded[0].payload.durationMs, 4000);
    assert.deepEqual(recorded[0].payload.path, [
        'hub_opened', 'freeplay_opened', 'settings_opened', 'back_pressed', 'freeplay_opened', 'match_started',
    ]);
});

test('continue is one click, and the next menu step after a match opens a new path', () => {
    const { tracker, recorded } = createTracker();
    tracker.onContinuePressed();
    tracker.onMatchStartAttempt();
    tracker.onPanelChanged('submenu-game', 'match_return');
    tracker.onMatchStartAttempt();
    assert.deepEqual(recorded.map((entry) => entry.payload.clicks), [1, 1]);
    assert.deepEqual(recorded[1].payload.path, ['freeplay_opened', 'match_started']);
});

test('panels without a funnel meaning do not count', () => {
    const { tracker } = createTracker();
    tracker.onPanelChanged('submenu-expert', 'nav');
    tracker.onPanelChanged('', 'nav');
    assert.equal(tracker.snapshot().clicks, 0);
});

test('the developer snapshot shows click buckets and averages of the recorded paths', () => {
    const records = new Map();
    const storagePlatform = {
        readJson: (key, _legacyKeys, fallback) => (records.has(key) ? structuredClone(records.get(key)) : fallback),
        writeJson: (key, value) => { records.set(key, structuredClone(value)); return { ok: true, reason: 'ok', quotaExceeded: false }; },
        remove: (key) => { records.delete(key); return { ok: true, reason: 'ok', quotaExceeded: false }; },
    };
    const store = new MenuTelemetryStore({ storagePlatform });
    store.recordEvent('match_started', { clicks: 2, durationMs: 3000, path: ['continue_pressed', 'match_started'] });
    store.recordEvent('match_started', { clicks: 6, durationMs: 9000, path: [] });
    const { funnel } = normalizeTelemetrySnapshot(store.getSnapshot());
    assert.equal(funnel.matchPathSamples, 2);
    assert.equal(funnel.averageClicksToMatch, 4);
    assert.equal(funnel.averageDurationToMatchMs, 6000);
    assert.deepEqual(funnel.clicksToMatchCounts, { '1-2': 1, '5-6': 1 });
});
