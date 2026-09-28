// Belegt, dass ein ferngesteuertes Desktop-Fenster sich selbst meldet. Ueber
// die Debug-Schnittstelle geschickte Tasten sind im Fenster nicht von echten
// zu unterscheiden - erkennbar ist die Fernsteuerung nur am Start.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ROUND_CONTROL_SOURCES } from '../src/shared/contracts/RoundControlContract.js';
import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';

const require = createRequire(import.meta.url);
const { installAutomationHintReporter, resolveAutomationHint } = require('../electron/automation-hint.cjs');

function createWebContentsStub() {
    const listeners = new Map();
    return {
        scripts: [],
        on(event, listener) { listeners.set(event, listener); },
        emit(event) { listeners.get(event)?.(); },
        executeJavaScript(script) { this.scripts.push(script); return Promise.resolve(); },
    };
}

test('a remote debugging switch marks the session as automated', () => {
    assert.equal(resolveAutomationHint(['electron.exe', '--remote-debugging-port=9222'], {}), 'cdp');
    assert.equal(resolveAutomationHint(['electron.exe', '--remote-debugging-pipe'], {}), 'cdp');
    assert.equal(resolveAutomationHint(['electron.exe', '--inspect=5858'], {}), 'cdp');
    assert.equal(resolveAutomationHint(['electron.exe'], {}), '');
    // Ein Werkzeug ohne Debug-Port kann sich ausdruecklich melden.
    assert.equal(resolveAutomationHint(['electron.exe'], { CURVIOS_AUTOMATION: 'Autopilot!' }), 'autopilot');
});

test('the hint is set in the window after every load and leaves the address alone', () => {
    const webContents = createWebContentsStub();
    assert.equal(installAutomationHintReporter(webContents, 'cdp'), true);
    webContents.emit('did-finish-load');
    // Nach einem Neuladen ist die Variable weg und muss erneut gesetzt werden.
    webContents.emit('did-finish-load');
    assert.deepEqual(webContents.scripts, [
        'window.__CURVIOS_AUTOMATION__ = "cdp";',
        'window.__CURVIOS_AUTOMATION__ = "cdp";',
    ]);

    const untouched = createWebContentsStub();
    assert.equal(installAutomationHintReporter(untouched, ''), false);
    untouched.emit('did-finish-load');
    assert.deepEqual(untouched.scripts, []);
});

test('the packaged app ships the hint module and the main window uses it', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../electron/package.json', import.meta.url), 'utf8'));
    assert.ok(packageJson.build.files.includes('automation-hint.cjs'), 'Hinweis-Modul liegt im Paket');
    const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.match(main, /installAutomationHintReporter\(mainWindow\.webContents, resolveAutomationHint\(/);
    // Die Adresse bleibt unveraendert: sonst verwerfen die Desktop-Tests ihren
    // vorgebooteten Zustand und laden ein zweites Mal (T20w kippte daran).
    assert.match(main, /await mainWindow\.loadURL\(appServer\.url\);/);
    const { transformElectronMain } = await import('../scripts/export-game-repo.mjs');
    assert.match(transformElectronMain(main), /installAutomationHintReporter\(mainWindow\.webContents/);
});

test('a round in a remote-controlled window is recorded as automation', () => {
    const players = [{ index: 0, isBot: false }, { index: 1, isBot: true }];
    const game = {
        arena: { currentMapKey: 'standard', getTelemetryMapRevision: () => 'map-r4' },
        buildInfoController: { appVersion: '2.1.0', buildId: 'desktop-88' },
        activeGameMode: 'CLASSIC',
        settings: { localSettings: { modePath: 'normal' } },
        runtimeConfig: { session: { sessionType: 'single' }, player: { vehicles: {} }, bot: {} },
        renderer: { getQualityState: () => ({ effectiveQuality: 'HIGH' }) },
        runtimePerfProfiler: { getTelemetryIntervalSnapshot: () => null },
        input: { getInputActivitySnapshot: () => ({ samples: 2400, activeSamples: 1900 }) },
        runtimeWindow: { navigator: {}, __CURVIOS_AUTOMATION__: 'cdp' },
        entityManager: {
            players,
            getHumanPlayers: () => players.filter((player) => !player.isBot),
            getHuntScoreboard: () => [],
        },
    };
    const payload = new MatchFlowTelemetryController({ game }).buildRoundEndTelemetryPayload({
        outcome: { state: 'ROUND_END', reason: 'ELIMINATION' },
        recording: { roundMetrics: { winnerIndex: 1, winnerIsBot: true, duration: 40 } },
    });
    assert.equal(payload.control.source, ROUND_CONTROL_SOURCES.AUTOMATION);
    assert.equal(payload.control.automationSignal, 'cdp');
});
