import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { RuntimePerfProfiler } from '../src/core/perf/RuntimePerfProfiler.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { TelemetryHistoryStore } from '../src/state/TelemetryHistoryStore.js';
import { TelemetryPreferencesStore } from '../src/shared/telemetry/TelemetryPreferencesStore.js';
import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';
import { MenuTelemetryStore } from '../src/ui/menu/MenuTelemetryStore.js';

function createMemoryStoragePlatform() {
    const records = new Map();
    return {
        readJson(key, _legacyKeys, fallback) {
            return records.has(key) ? structuredClone(records.get(key)) : fallback;
        },
        writeJson(key, value) {
            records.set(key, structuredClone(value));
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        remove(key) {
            records.delete(key);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
    };
}

test('telemetry opt-out stops new gameplay events and remains persisted', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const preferences = new TelemetryPreferencesStore({ storagePlatform });
    const telemetry = new MenuTelemetryStore({ storagePlatform, preferencesStore: preferences });

    preferences.setCollectionEnabled(false);
    telemetry.recordEvent('start_attempt', { sessionType: 'single' });
    assert.equal(telemetry.getSnapshot().startAttempts, 0);
    assert.equal(new TelemetryPreferencesStore({ storagePlatform }).isCollectionEnabled(), false);

    preferences.setCollectionEnabled(true);
    telemetry.recordEvent('start_attempt', { sessionType: 'single' });
    telemetry.recordEvent('abort', { trigger: 'escape' });
    assert.equal(telemetry.getSnapshot().startAttempts, 1);
    assert.equal(telemetry.getSnapshot().funnelSummary.abortReasonCounts.escape, 1);
});

test('telemetry reset clears sidecars and the live settings projection', async () => {
    const storagePlatform = createMemoryStoragePlatform();
    let historyClears = 0;
    const manager = new SettingsManager({
        storagePlatform,
        telemetryHistoryStore: {
            recordRound: async () => true,
            getEntries: async () => [],
            summarizeEntries: () => ({}),
            clear: async () => { historyClears += 1; return true; },
        },
    });
    const settings = manager.createDefaultSettings();
    manager.recordMenuTelemetry(settings, 'start_attempt');
    assert.equal(settings.localSettings.telemetryState.startAttempts, 1);

    const result = await manager.clearTelemetry(settings);
    assert.equal(result.ok, true);
    assert.equal(historyClears, 1);
    assert.equal(settings.localSettings.telemetryState.startAttempts, 0);
    assert.equal(manager.getAuthoringTelemetrySnapshot().recentSessions.length, 0);
});

test('menu telemetry aggregates arcade sector and run KPIs', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const telemetry = new MenuTelemetryStore({
        storagePlatform,
        preferencesStore: { isCollectionEnabled: () => true },
    });
    const arcade = {
        enabled: true,
        lastSector: { missionsCompleted: 2, missionsTotal: 3, xpEarned: 150, modifierId: 'kinetic' },
        run: {
            score: 4200,
            peakCombo: 7,
            peakMultiplier: 3,
            completedSectors: 2,
            isDailyChallenge: true,
            terminalReason: 'ELIMINATION',
            rewardIds: ['shield'],
        },
    };
    telemetry.recordEvent('round_end', { mapKey: 'standard', mode: 'arcade', arcade });
    telemetry.recordEvent('match_end', { mapKey: 'standard', mode: 'arcade', arcade });

    const summary = telemetry.getSnapshot().arcadeSummary;
    assert.equal(summary.sectors, 1);
    assert.equal(summary.runs, 1);
    assert.equal(summary.missionsCompleted, 2);
    assert.equal(summary.rewardChoiceCounts.shield, 1);
    assert.equal(summary.modifierCounts.kinetic, 1);
});

test('round performance interval reports p95, p99, spikes and subsystem averages', () => {
    const profiler = new RuntimePerfProfiler({ spikeThresholdMs: 30 });
    profiler.beginTelemetryInterval();
    for (const [frameMs, updateMs] of [[10, 2], [20, 4], [40, 6]]) {
        profiler.beginFrame(frameMs, frameMs);
        profiler.recordSubsystemDuration('update', updateMs);
        profiler.endFrame(frameMs, frameMs);
    }
    const snapshot = profiler.getTelemetryIntervalSnapshot();
    assert.equal(snapshot.sampleCount, 3);
    assert.equal(snapshot.frameMs.p95, 40);
    assert.equal(snapshot.frameMs.p99, 40);
    assert.equal(snapshot.spikes.recent, 1);
    assert.equal(snapshot.subsystems.update.avg, 4);
});

test('round payload includes versioned context and compact performance telemetry', () => {
    const players = [{ index: 0, isBot: false }, { index: 1, isBot: true }];
    const game = {
        arena: { currentMapKey: 'standard', getTelemetryMapRevision: () => 'map-r4' },
        buildInfoController: { appVersion: '2.1.0', buildId: 'desktop-88' },
        activeGameMode: 'CLASSIC',
        settings: { localSettings: { modePath: 'normal' } },
        runtimeConfig: {
            session: { sessionType: 'single', modePath: 'normal' },
            player: { vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship7' } },
            bot: { activeDifficulty: 'HARD', policyType: 'heuristic' },
        },
        renderer: { getQualityState: () => ({ effectiveQuality: 'HIGH' }) },
        runtimePerfProfiler: {
            getTelemetryIntervalSnapshot: () => ({
                sampleCount: 3,
                frameMs: { avg: 16, p95: 20, p99: 24, max: 30 },
                spikes: { recent: 1 },
                subsystems: { update: { avg: 2 } },
            }),
        },
        entityManager: {
            players,
            getHumanPlayers: () => players.filter((player) => !player.isBot),
            getHuntScoreboard: () => [],
        },
    };
    const controller = new MatchFlowTelemetryController({ game });
    const payload = controller.buildRoundEndTelemetryPayload({
        outcome: { state: 'ROUND_END', reason: 'ELIMINATION' },
        recording: { roundMetrics: { winnerIndex: 0, winnerIsBot: false, duration: 12 } },
    });

    assert.equal(payload.telemetrySchemaVersion, 'round-telemetry.v2');
    assert.equal(payload.context.buildId, 'desktop-88');
    assert.equal(payload.context.mapRevision, 'map-r4');
    assert.equal(payload.context.botCount, 1);
    assert.deepEqual(payload.context.vehicles, ['ship5', 'ship7']);
    assert.equal(payload.performance.frameP99Ms, 24);
});

test('history summary compares builds and performance across rounds', () => {
    const store = new TelemetryHistoryStore();
    const summary = store.summarizeEntries([
        { mapKey: 'standard', mode: 'classic', buildId: 'a', winnerType: 'human', performance: { sampleCount: 2, frameP95Ms: 20, frameP99Ms: 25, spikeCount: 1 } },
        { mapKey: 'standard', mode: 'classic', buildId: 'b', winnerType: 'bot', performance: { sampleCount: 2, frameP95Ms: 30, frameP99Ms: 35, spikeCount: 3 } },
    ]);
    assert.equal(summary.rounds, 2);
    assert.equal(summary.averageFrameP95Ms, 25);
    assert.equal(summary.frameSpikesPerRound, 2);
    assert.deepEqual(summary.topBuilds, [{ key: 'a', count: 1 }, { key: 'b', count: 1 }]);
});

test('arcade runtime support enriches locally recorded events after state handling', () => {
    const calls = [];
    const support = {
        arcadeRunRuntime: {
            handleRoundEndTelemetry: () => calls.push('handled'),
            getTelemetrySnapshot: () => ({ enabled: true, runId: 'run-1' }),
        },
    };
    GameRuntimeArcadeSupport.prototype.recordRoundEndTelemetry.call(
        support,
        { reason: 'ELIMINATION' },
        { recordMenuTelemetry: (type, payload) => calls.push([type, payload]) }
    );
    assert.equal(calls[0], 'handled');
    assert.equal(calls[1][0], 'round_end');
    assert.equal(calls[1][1].arcade.runId, 'run-1');
});

test('desktop debug menu exposes telemetry controls, filters, exports and reset', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const id of [
        'developer-telemetry-panel', 'telemetry-collection-toggle', 'telemetry-filter-build',
        'telemetry-filter-map', 'telemetry-filter-mode', 'telemetry-filter-period',
        'btn-telemetry-export-json', 'btn-telemetry-export-csv', 'btn-telemetry-reset',
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
});
