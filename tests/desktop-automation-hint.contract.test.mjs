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
const { appendAutomationHint, resolveAutomationHint } = require('../electron/automation-hint.cjs');

test('a remote debugging switch marks the session as automated', () => {
    assert.equal(resolveAutomationHint(['electron.exe', '--remote-debugging-port=9222'], {}), 'cdp');
    assert.equal(resolveAutomationHint(['electron.exe', '--remote-debugging-pipe'], {}), 'cdp');
    assert.equal(resolveAutomationHint(['electron.exe', '--inspect=5858'], {}), 'cdp');
    assert.equal(resolveAutomationHint(['electron.exe'], {}), '');
    // Ein Werkzeug ohne Debug-Port kann sich ausdruecklich melden.
    assert.equal(resolveAutomationHint(['electron.exe'], { CURVIOS_AUTOMATION: 'Autopilot!' }), 'autopilot');
});

test('the hint travels with the window address and never breaks the start', () => {
    assert.equal(appendAutomationHint('http://127.0.0.1:38765/', 'cdp'), 'http://127.0.0.1:38765/?automation=cdp');
    assert.equal(appendAutomationHint('http://127.0.0.1:38765/', ''), 'http://127.0.0.1:38765/');
    assert.equal(appendAutomationHint('not-a-url', 'cdp'), 'not-a-url');
});

test('the packaged app ships the hint module and the main window uses it', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../electron/package.json', import.meta.url), 'utf8'));
    assert.ok(packageJson.build.files.includes('automation-hint.cjs'), 'Hinweis-Modul liegt im Paket');
    const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.match(main, /await mainWindow\.loadURL\(appendAutomationHint\(appServer\.url,/);
    // Der Spiel-Export schneidet genau an dieser Zeile; ein Kommentar davor
    // laesst transformElectronMain scheitern (tests/game-distribution).
    const { transformElectronMain } = await import('../scripts/export-game-repo.mjs');
    assert.match(transformElectronMain(main), /await mainWindow\.loadURL\(appendAutomationHint/);
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
        runtimeWindow: { navigator: {}, location: { search: '?automation=cdp' } },
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
