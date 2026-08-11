import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS,
    AUTHORING_TELEMETRY_STORAGE_KEY,
    AUTHORING_TELEMETRY_TOOLS,
    normalizeAuthoringTelemetrySession,
    normalizeAuthoringTelemetryState,
} from '../src/shared/contracts/AuthoringTelemetryContract.js';
import { AuthoringTelemetryStore } from '../src/state/AuthoringTelemetryStore.js';
import { AuthoringTelemetrySession } from '../src/state/AuthoringTelemetrySession.js';
import { SettingsManager } from '../src/core/SettingsManager.js';

function createMemoryStoragePlatform(initial = null) {
    const records = new Map();
    if (initial !== null) records.set(AUTHORING_TELEMETRY_STORAGE_KEY, initial);
    return {
        readJson(key, legacyKeys, fallback) {
            return records.has(key) ? records.get(key) : fallback;
        },
        writeJson(key, value) {
            records.set(key, structuredClone(value));
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        get(key) {
            return records.get(key);
        },
    };
}

function createEventTarget(extra = {}) {
    const listeners = new Map();
    return {
        ...extra,
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        removeEventListener(type, listener) {
            if (listeners.get(type) === listener) listeners.delete(type);
        },
        dispatch(type) {
            listeners.get(type)?.();
        },
    };
}

test('authoring telemetry contract strips content and unknown dimensions', () => {
    const normalized = normalizeAuthoringTelemetrySession({
        tool: 'vehicle_lab',
        platform: 'desktop',
        startedAt: '2026-08-11T10:00:00.000Z',
        endedAt: '2026-08-11T10:01:00.000Z',
        durationActiveMs: 60_000,
        completed: true,
        counters: { save: 1, property_name: 400 },
        outcomes: { save_succeeded: true, vehicle_name: true },
        errors: { save_failed: 2, raw_message: 1 },
        mapJson: '{"secret":true}',
        vehicleConfig: { label: 'Private name' },
        filePath: 'C:/Users/private/map.json',
    });

    assert.deepEqual(normalized.counters, { save: 1 });
    assert.deepEqual(normalized.outcomes, { save_succeeded: true });
    assert.deepEqual(normalized.errors, { save_failed: 2 });
    assert.equal('mapJson' in normalized, false);
    assert.equal('vehicleConfig' in normalized, false);
    assert.equal('filePath' in normalized, false);
});

test('authoring telemetry store aggregates bounded metrics and caps recent sessions', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const store = new AuthoringTelemetryStore({ storagePlatform });

    assert.equal(store.recordDelta(AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR, {
        durationActiveMs: 1200,
        counters: { edit: 3, unknown: 100 },
        outcomes: { export_succeeded: 1 },
        errors: { export_failed: 1, private_error: 2 },
    }), true);

    for (let index = 0; index < AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS + 5; index += 1) {
        store.recordSession({
            tool: AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR,
            platform: 'browser',
            startedAt: new Date(1_700_000_000_000 + index).toISOString(),
            endedAt: new Date(1_700_000_001_000 + index).toISOString(),
            durationActiveMs: 1000,
            completed: index % 2 === 0,
        });
    }

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.tools.map_editor.activeDurationMs, 1200);
    assert.deepEqual(snapshot.tools.map_editor.counters, { edit: 3 });
    assert.deepEqual(snapshot.tools.map_editor.errors, { export_failed: 1 });
    assert.equal(snapshot.tools.map_editor.sessions, AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS + 5);
    assert.equal(snapshot.recentSessions.length, AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS);
    assert.equal(snapshot.recentSessions[0].startedAt, new Date(1_700_000_000_005).toISOString());
});

test('authoring session records active time and flushes safe deltas on completion', () => {
    let nowMs = 1_700_000_000_000;
    const documentRef = createEventTarget({ visibilityState: 'visible' });
    const runtimeGlobal = createEventTarget({ navigator: { userAgent: 'Electron test' } });
    const storagePlatform = createMemoryStoragePlatform();
    const store = new AuthoringTelemetryStore({ storagePlatform });
    const lifecycle = [];
    const session = new AuthoringTelemetrySession({
        tool: AUTHORING_TELEMETRY_TOOLS.VEHICLE_LAB,
        store,
        runtimeGlobal,
        documentRef,
        now: () => nowMs,
        sessionId: 'vehicle-lab-test-session',
        lifecycleSink: (event) => lifecycle.push(structuredClone(event)),
    });

    session.recordCounter('part_added', 2);
    session.recordCounter('not_allowed', 100);
    nowMs += 2500;
    session.recordOutcome('save_succeeded', true, { flush: true });
    nowMs += 500;
    session.end({ completed: true });

    const snapshot = normalizeAuthoringTelemetryState(storagePlatform.get(AUTHORING_TELEMETRY_STORAGE_KEY));
    assert.equal(snapshot.tools.vehicle_lab.activeDurationMs, 3000);
    assert.equal(snapshot.tools.vehicle_lab.counters.part_added, 2);
    assert.equal(snapshot.tools.vehicle_lab.outcomes.save_succeeded, 1);
    assert.equal(snapshot.tools.vehicle_lab.outcomes.completed, 1);
    assert.equal(snapshot.tools.vehicle_lab.sessions, 1);
    assert.equal(snapshot.tools.vehicle_lab.completedSessions, 1);
    assert.equal(snapshot.recentSessions[0].platform, 'desktop');
    assert.equal(snapshot.recentSessions[0].durationActiveMs, 3000);
    assert.deepEqual(lifecycle.map((event) => event.event), ['started', 'activity', 'activity', 'ended']);
    assert.equal(lifecycle[0].sessionId, 'vehicle-lab-test-session');
    assert.equal(lifecycle[0].tool, AUTHORING_TELEMETRY_TOOLS.VEHICLE_LAB);
    assert.equal(lifecycle[1].durationActiveMs, 2500);
    assert.equal(lifecycle[2].durationActiveMs, 500);
    assert.equal(lifecycle[3].durationActiveMs, 3000);
    assert.equal('vehicleConfig' in lifecycle[3], false);
});

test('authoring session automatically sends its lifecycle to the local workflow collector', () => {
    const beacons = [];
    class MemoryBlob {
        constructor(parts, options = {}) {
            this.value = parts.join('');
            this.type = options.type;
        }
    }
    const runtimeGlobal = createEventTarget({
        Blob: MemoryBlob,
        crypto: { randomUUID: () => 'map-editor-test-session' },
        navigator: {
            userAgent: 'Electron test',
            sendBeacon(url, body) {
                beacons.push({ url, body });
                return true;
            },
        },
    });
    const session = new AuthoringTelemetrySession({
        tool: AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR,
        store: new AuthoringTelemetryStore({ storagePlatform: createMemoryStoragePlatform() }),
        runtimeGlobal,
        documentRef: createEventTarget({ visibilityState: 'visible' }),
        now: () => 1_700_000_000_000,
    });

    assert.equal(beacons.length, 1);
    assert.equal(beacons[0].url, 'http://127.0.0.1:4318/v1/authoring');
    assert.equal(beacons[0].body.type, 'text/plain;charset=UTF-8');
    assert.deepEqual(JSON.parse(beacons[0].body.value), {
        schemaVersion: 'codex-workflow.authoring.v1',
        event: 'started',
        sessionId: 'map-editor-test-session',
        tool: AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR,
        platform: 'desktop',
        startedAt: '2023-11-14T22:13:20.000Z',
    });

    session.end();
    assert.equal(JSON.parse(beacons.at(-1).body.value).event, 'ended');
});

test('automated browser runs do not pollute local authoring telemetry', () => {
    let beaconCalls = 0;
    const runtimeGlobal = createEventTarget({
        Blob,
        navigator: {
            userAgent: 'HeadlessChrome test',
            webdriver: true,
            sendBeacon() {
                beaconCalls += 1;
                return true;
            },
        },
    });
    const session = new AuthoringTelemetrySession({
        tool: AUTHORING_TELEMETRY_TOOLS.VEHICLE_LAB,
        store: new AuthoringTelemetryStore({ storagePlatform: createMemoryStoragePlatform() }),
        runtimeGlobal,
        documentRef: createEventTarget({ visibilityState: 'visible' }),
    });

    session.end();
    assert.equal(beaconCalls, 0);
});

test('settings manager exposes the shared authoring snapshot to the developer dashboard', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const store = new AuthoringTelemetryStore({ storagePlatform });
    store.recordDelta(AUTHORING_TELEMETRY_TOOLS.MAP_EDITOR, {
        counters: { validation: 2 },
        errors: { validation_failed: 1 },
    });

    const manager = new SettingsManager({ storagePlatform });
    const snapshot = manager.getAuthoringTelemetrySnapshot();

    assert.equal(snapshot.tools.map_editor.counters.validation, 2);
    assert.equal(snapshot.tools.map_editor.errors.validation_failed, 1);
});
