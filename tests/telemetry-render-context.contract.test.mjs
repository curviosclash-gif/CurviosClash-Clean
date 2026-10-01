// Belegt, dass jede Runde mitschreibt, unter welchen Bedingungen ihre Bildrate
// gemessen wurde. Ohne Aufloesung und Zahl der Bildausschnitte lagen 21 FPS im
// geteilten Bildschirm neben 52 FPS allein - und sahen nach einem Kartenproblem aus.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTelemetryReport } from '../scripts/telemetry-report-lib.mjs';
import { normalizeTelemetryHistoryEntry } from '../src/state/telemetry/TelemetryHistoryEntry.js';
import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';

function createGame({ cameras, width, height }) {
    const players = [{ index: 0, isBot: false }, { index: 1, isBot: false }];
    return {
        arena: { currentMapKey: 'pyramid', getTelemetryMapRevision: () => 'r1' },
        buildInfoController: {},
        activeGameMode: 'HUNT',
        settings: { localSettings: {} },
        runtimeConfig: { session: { sessionType: 'splitscreen' }, player: { vehicles: {} }, bot: {} },
        renderer: {
            getQualityState: () => ({ effectiveQuality: 'LOW' }),
            cameras,
            renderer: { domElement: { width, height } },
        },
        runtimePerfProfiler: {
            getTelemetryIntervalSnapshot: () => ({ sampleCount: 10, frameMs: { avg: 40 }, spikes: {}, subsystems: {} }),
        },
        runtimeWindow: { navigator: {} },
        entityManager: { players, getHumanPlayers: () => players, getHuntScoreboard: () => [] },
    };
}

test('the round payload names resolution and viewports next to the frame rate', () => {
    const game = createGame({ cameras: [{}, {}], width: 1920, height: 1080 });
    const payload = new MatchFlowTelemetryController({ game }).buildRoundEndTelemetryPayload({
        outcome: { state: 'ROUND_END', reason: 'ELIMINATION' },
        recording: { roundMetrics: { winnerIndex: 0, winnerIsBot: false, duration: 30 } },
    });
    assert.equal(payload.performance.viewportCount, 2);
    assert.equal(payload.performance.renderWidth, 1920);
    assert.equal(payload.performance.renderHeight, 1080);

    const stored = normalizeTelemetryHistoryEntry(payload);
    assert.equal(stored.performance.viewportCount, 2);
    assert.equal(stored.performance.renderWidth, 1920);
    // Aeltere Runden kennen die Felder nicht und bleiben bei 0 = unbekannt.
    assert.equal(normalizeTelemetryHistoryEntry({ performance: { sampleCount: 3 } }).performance.viewportCount, 0);
});

test('the report keeps single and split frame rates apart per map', () => {
    const rows = [
        { mode: 'hunt', mapKey: 'pyramid', duration: 60, control: { source: 'human' }, sessionType: 'single', humanCount: 1, performance: { sampleCount: 5, frameAvgMs: 20, viewportCount: 1 } },
        { mode: 'hunt', mapKey: 'pyramid', duration: 60, control: { source: 'human' }, sessionType: 'splitscreen', humanCount: 2, performance: { sampleCount: 5, frameAvgMs: 40, viewportCount: 2 } },
        // Altdaten ohne Zaehler: der Sitzungstyp verraet den geteilten Bildschirm.
        { mode: 'hunt', mapKey: 'pyramid', duration: 60, control: { source: 'human' }, sessionType: 'splitscreen', humanCount: 2, performance: { sampleCount: 5, frameAvgMs: 40 } },
    ];
    const map = buildTelemetryReport(rows).data.realPlay.maps[0];
    assert.equal(map.fpsSingle, 50);
    assert.equal(map.fpsSplit, 25);
});
