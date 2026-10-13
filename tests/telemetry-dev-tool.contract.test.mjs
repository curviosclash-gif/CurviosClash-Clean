import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    RELEASE_TELEMETRY_MARKERS,
    TELEMETRY_CSV_DERIVED_FIELDS,
    TELEMETRY_CSV_FIELDS,
    TELEMETRY_EXPORT_SCHEMA_VERSION,
    collectTelemetryFilterOptions,
    createTelemetryExportFileName,
    normalizeTelemetryToolFilters,
    summarizeTelemetryRound,
    telemetryRowsToCsv,
} from '../src/shared/contracts/TelemetryExportContract.js';
import { normalizeTelemetryPreferences } from '../src/shared/contracts/TelemetryPreferencesContract.js';
import { createTelemetryDevApi, registerTelemetryDevSource } from '../src/core/telemetry/TelemetryDevApi.js';
import { GameDebugApi } from '../src/core/GameDebugApi.js';
import { installDesktopTuningRuntimeBridge } from '../src/dev/tuning/TuningRuntimeIpcBridge.js';
import { createSettingsTelemetryFacade } from '../src/core/settings/SettingsTelemetryFacade.js';
import { runTelemetryOperation } from '../scripts/playtest/playtest-telemetry.mjs';
import { checkReleaseTelemetryBoundary } from '../scripts/check-release-telemetry-boundary.mjs';

const require = createRequire(import.meta.url);
const { registerTuningIpc } = require('../electron/tuning-ipc.cjs');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'curvios-telemetry-tool-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function round(index, overrides = {}) {
    return {
        at: `2026-10-${String(10 + (index % 3)).padStart(2, '0')}T12:00:0${index % 10}.000Z`,
        mapKey: index % 2 ? 'maze' : 'standard',
        mode: 'HUNT',
        buildId: index < 3 ? 'b1' : 'b2',
        duration: 60 + index,
        winnerType: 'human',
        kills: index,
        spawnDeaths: 0,
        control: { source: index === 0 ? 'automation' : 'human' },
        performance: { frameP95Ms: 16.5 },
        heatmap: [{ x: 1, z: 2, count: 3 }],
        ...overrides,
    };
}

const ROUNDS = Array.from({ length: 15 }, (_, index) => round(index));

function createFakeSettingsManager() {
    const calls = [];
    return {
        calls,
        async getTelemetryExportSnapshot(filters = {}) {
            calls.push(filters);
            const rows = ROUNDS.filter((row) => (!filters.controlSource || row.control.source === filters.controlSource)
                && (!filters.mapKey || row.mapKey === filters.mapKey));
            return {
                schemaVersion: TELEMETRY_EXPORT_SCHEMA_VERSION,
                historyEntries: rows,
                historySummary: { rounds: rows.length, topMaps: [{ key: 'maze', count: 7 }], mapHeatmaps: [{ key: 'maze', heatmap: [{ count: 1 }] }] },
                gameplay: { startAttempts: 4 },
            };
        },
        async clearTelemetry() { calls.push('clear'); return { ok: true }; },
    };
}

test('telemetry tool: the export contract keeps the CSV layout and the default filter', () => {
    const csv = telemetryRowsToCsv([round(1, { reason: 'he said "go"' })]).split('\n');
    assert.equal(csv[0], [...TELEMETRY_CSV_FIELDS, ...TELEMETRY_CSV_DERIVED_FIELDS.map(([name]) => name)].join(','));
    assert.match(csv[1], /"he said ""go"""/);
    assert.match(csv[1], /"human"/, 'derived control source column');
    assert.equal(telemetryRowsToCsv(null), csv[0]);

    assert.deepEqual(normalizeTelemetryToolFilters(undefined), { buildId: '', mapKey: '', mode: '', controlSource: 'human', sinceDays: 0 });
    assert.equal(normalizeTelemetryToolFilters({ controlSource: 'all' }).controlSource, '');
    assert.equal(normalizeTelemetryToolFilters({ controlSource: 'idle', sinceDays: 7.9 }).sinceDays, 7);
    assert.equal(normalizeTelemetryToolFilters({ controlSource: 'nonsense', sinceDays: -3 }).controlSource, 'human');
    assert.equal(normalizeTelemetryToolFilters([]).controlSource, 'human');
    assert.deepEqual(collectTelemetryFilterOptions(ROUNDS), { buildIds: ['b1', 'b2'], mapKeys: ['maze', 'standard'], modes: ['HUNT'] });
    assert.deepEqual(collectTelemetryFilterOptions('x'), { buildIds: [], mapKeys: [], modes: [] });
    assert.deepEqual(summarizeTelemetryRound({}), { at: '', mapKey: '', mode: '', winnerType: '', duration: 0, kills: 0, spawnDeaths: 0, controlSource: 'unknown', buildId: '' });
    assert.equal(createTelemetryExportFileName('csv', new Date('2026-10-12T15:04:05Z')), 'curviosclash-telemetry-2026-10-12-15-04-05.csv');
    assert.match(createTelemetryExportFileName('xml'), /\.json$/);
    assert.ok(RELEASE_TELEMETRY_MARKERS.includes('cuviosclash-telemetry'));
});

test('telemetry tool: collection is always on, an old opt-out is ignored', async () => {
    assert.equal(normalizeTelemetryPreferences({ collectionEnabled: false }).collectionEnabled, true);
    const recorded = [];
    const facade = createSettingsTelemetryFacade({
        menuTelemetryStore: { recordEvent: () => ({}), getSnapshot: () => ({}) },
        telemetryHistoryStore: { recordRound: async (payload) => { recorded.push(payload); return true; } },
        telemetryPreferencesStore: { isCollectionEnabled: () => normalizeTelemetryPreferences({ collectionEnabled: false }).collectionEnabled },
    });
    facade.recordMenuTelemetry(null, 'round_end', { mapKey: 'maze' });
    assert.equal(recorded.length, 1);
});

test('telemetry tool: overview, export and clear go through the game telemetry', async () => {
    const settingsManager = createFakeSettingsManager();
    const api = createTelemetryDevApi({ getSettingsManager: () => settingsManager, now: () => new Date('2026-10-12T10:00:00Z') });
    const overview = await api.overview({ mapKey: 'maze' });
    assert.equal(overview.totalRounds, 15);
    assert.equal(overview.filters.controlSource, 'human');
    assert.deepEqual(overview.filterOptions.mapKeys, ['maze', 'standard']);
    assert.equal('mapHeatmaps' in overview.summary, false, 'heatmaps stay out of the tool payload');
    assert.deepEqual(overview.summary.heatmapMaps, ['maze']);
    assert.equal(overview.recentRounds.length, 7);
    assert.equal(overview.recentRounds[0].kills, 13, 'newest round first');
    assert.deepEqual(settingsManager.calls[1], {}, 'filter options come from all rounds');

    const csv = await api.exportData({ controlSource: 'all' }, 'csv');
    assert.equal(csv.fileName, 'curviosclash-telemetry-2026-10-12-10-00-00.csv');
    assert.equal(csv.rounds, 15);
    assert.equal(csv.text.split('\n').length, 16);
    const json = await api.exportData({}, 'json');
    assert.equal(JSON.parse(json.text).schemaVersion, TELEMETRY_EXPORT_SCHEMA_VERSION);
    assert.equal(json.rounds, 14);

    assert.deepEqual(await api.clear(), { ok: true });
    assert.equal(settingsManager.calls.at(-1), 'clear');
    await assert.rejects(createTelemetryDevApi({ getSettingsManager: () => null }).overview(), (error) => error.reason === 'no_telemetry');
    await assert.rejects(createTelemetryDevApi({ getSettingsManager: () => ({ getTelemetryExportSnapshot: async () => ({}) }) }).clear(), (error) => error.reason === 'no_clear');
    const empty = await createTelemetryDevApi({ getSettingsManager: () => ({ getTelemetryExportSnapshot: async () => null }) }).overview();
    assert.deepEqual([empty.totalRounds, empty.recentRounds, empty.summary.heatmapMaps], [0, [], []]);
});

test('telemetry tool: the debug API and the F7 bridge reach the running game', async () => {
    const settingsManager = createFakeSettingsManager();
    const debugApi = new GameDebugApi({ getSettingsManager: () => settingsManager });
    assert.equal((await debugApi.getTelemetry().overview()).totalRounds, 15);

    let requestHandler = null;
    const responses = [];
    const dispose = installDesktopTuningRuntimeBridge({
        __CURVIOS_APP__: true,
        curviosApp: { isApp: true, contracts: { tuningRuntime: {
            subscribeRequests(handler) { requestHandler = handler; return () => { requestHandler = null; }; },
            sendResponse(response) { responses.push(response); },
        } } },
    });
    requestHandler({ requestId: 't1', action: 'tuning:telemetry', payload: { op: 'overview', filters: {} } });
    requestHandler({ requestId: 't2', action: 'tuning:telemetry', payload: { op: 'nope' } });
    requestHandler({ requestId: 't3', action: 'tuning:get-registry' });
    assert.equal(responses.at(-1).requestId, 't3', 'synchronous actions still answer at once');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const byId = Object.fromEntries(responses.map((response) => [response.requestId, response]));
    assert.equal(byId.t1.ok, true);
    assert.equal(byId.t1.value.totalRounds, 15);
    assert.equal(byId.t2.reason, 'unknown_telemetry_op');

    registerTelemetryDevSource(() => null);
    requestHandler({ requestId: 't4', action: 'tuning:telemetry', payload: { op: 'overview' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(responses.at(-1).reason, 'no_telemetry');
    dispose();
});

function createIpcHarness(answer) {
    const handlers = new Map();
    const listeners = new Map();
    const requests = [];
    const tuningWindow = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    const eventFor = (windowRef) => ({ sender: windowRef.webContents, senderFrame: windowRef.webContents.mainFrame });
    const gameWindow = {
        isDestroyed: () => false,
        webContents: {
            mainFrame: {},
            send(_channel, request) {
                requests.push(request.payload);
                queueMicrotask(() => listeners.get('tuning-runtime:response')(eventFor(gameWindow), {
                    requestId: request.requestId, ok: true, value: answer(request.payload),
                }));
            },
        },
    };
    return {
        requests,
        options: {
            ipcMain: {
                handle: (channel, handler) => handlers.set(channel, handler),
                removeHandler: (channel) => handlers.delete(channel),
                on: (channel, listener) => listeners.set(channel, listener),
                removeListener: (channel) => listeners.delete(channel),
            },
            resolveGameWindow: () => gameWindow,
            resolveTuningWindow: () => tuningWindow,
        },
        invoke: (payload) => handlers.get('tuning:telemetry')(eventFor(tuningWindow), payload),
    };
}

test('telemetry tool: the F7 export writes the game text where the developer chooses', async () => {
    const target = path.join(scratch, 'export.csv');
    const harness = createIpcHarness((payload) => (payload.op === 'export'
        ? { fileName: 'x.csv', rounds: 2, text: 'a,b\n1,2' }
        : { totalRounds: 2 }));
    let dialogOptions = null;
    let cancel = false;
    const dispose = registerTuningIpc({
        ...harness.options,
        dialog: { showSaveDialog: async (_parent, options) => { dialogOptions = options; return cancel ? { canceled: true } : { canceled: false, filePath: target }; } },
    });
    const exported = await harness.invoke({ op: 'export', format: 'csv', filters: { mapKey: 'maze' } });
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.value, { filePath: target, rounds: 2, format: 'csv' });
    assert.equal(readFileSync(target, 'utf8'), 'a,b\n1,2');
    assert.equal(dialogOptions.defaultPath, 'x.csv');
    assert.deepEqual(harness.requests[0], { op: 'export', filters: { mapKey: 'maze' }, format: 'csv' });

    cancel = true;
    assert.equal((await harness.invoke({ op: 'export' })).reason, 'dialog_cancelled');
    assert.equal((await harness.invoke({ op: 'overview' })).value.totalRounds, 2);
    assert.equal((await harness.invoke({ op: 'drop-table' })).reason, 'unknown_telemetry_op');
    dispose();
});

test('telemetry tool: the MCP reads the open session and writes exports next to the run', async () => {
    const settingsManager = createFakeSettingsManager();
    registerTelemetryDevSource(() => settingsManager);
    const debug = new GameDebugApi({ getSettingsManager: () => settingsManager });
    const session = {
        page: {
            evaluate: async (fn, arg) => {
                globalThis.GAME_DEBUG = debug;
                try { return await fn(arg); } finally { delete globalThis.GAME_DEBUG; }
            },
        },
    };
    const overview = await runTelemetryOperation({ args: { filters: { controlSource: 'all' } }, getSession: () => session });
    assert.equal(overview.action, 'overview');
    assert.equal(overview.summary.rounds, 15);
    const exported = await runTelemetryOperation({ args: { telemetryAction: 'export', format: 'csv' }, getSession: () => session, runDir: scratch });
    assert.equal(exported.rounds, 14);
    assert.ok(readFileSync(exported.file, 'utf8').startsWith('at,buildId'));
    await assert.rejects(runTelemetryOperation({ args: { telemetryAction: 'clear' }, getSession: () => session }), /unknown telemetryAction/);
    await assert.rejects(runTelemetryOperation({ args: {}, getSession: () => ({ page: { evaluate: async (fn, arg) => fn(arg) } }) }), /build:app:test/);
});

test('telemetry tool: the release guard finds telemetry in a build folder', () => {
    const clean = path.join(scratch, 'clean');
    const dirty = path.join(scratch, 'dirty', 'assets');
    mkdirSync(clean, { recursive: true });
    mkdirSync(dirty, { recursive: true });
    writeFileSync(path.join(clean, 'index.html'), '<main></main>');
    writeFileSync(path.join(clean, 'game.js'), 'console.log(1)');
    writeFileSync(path.join(clean, 'notes.txt'), 'cuviosclash-telemetry');
    writeFileSync(path.join(dirty, 'game.js'), 'indexedDB.open("cuviosclash-telemetry")');
    assert.deepEqual(checkReleaseTelemetryBoundary(clean), { ok: true, checkedFiles: 2, findings: [] });
    const result = checkReleaseTelemetryBoundary(path.join(scratch, 'dirty'));
    assert.equal(result.ok, false);
    assert.deepEqual(result.findings, [{ file: 'assets/game.js', marker: 'cuviosclash-telemetry' }]);
    assert.throws(() => checkReleaseTelemetryBoundary(path.join(scratch, 'missing')), /does not exist/);
});
