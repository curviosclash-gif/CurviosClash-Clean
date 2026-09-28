// Belegt den wiederholbaren Telemetrie-Bericht (npm run telemetry:report):
// er trennt echtes Spiel von Testlaeufen und findet den richtigen Speicher.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildTelemetryReport,
    resolveTelemetryStoreDir,
} from '../scripts/telemetry-report-lib.mjs';

const ROWS = [
    { at: '2026-09-29T10:00:00.000Z', mode: 'hunt', mapKey: 'pillar_hall', winnerType: 'human', duration: 300, spawnDeaths: 20, stuckEvents: 10, control: { source: 'human' }, performance: { sampleCount: 100, frameAvgMs: 20 } },
    { at: '2026-09-29T10:10:00.000Z', mode: 'hunt', mapKey: 'pillar_hall', winnerType: 'bot', duration: 300, spawnDeaths: 40, stuckEvents: 30, control: { source: 'automation', automationSignal: 'cdp' } },
    { at: '2026-09-29T10:20:00.000Z', mode: 'classic', mapKey: 'standard', winnerType: 'bot', duration: 60, control: { source: 'idle' } },
    { at: '2026-07-23T10:00:00.000Z', mode: 'arcade', mapKey: 'standard', winnerType: 'human', duration: 30 },
];

test('the report separates real play from machine rounds', () => {
    const report = buildTelemetryReport(ROWS, { source: 'Port 38765' });
    assert.equal(report.data.total.rounds, 4);
    assert.deepEqual(report.data.controlSourceCounts, { human: 1, idle: 1, automation: 1, unknown: 1 });
    assert.equal(report.data.realPlay.rounds, 1, 'nur die Runde mit echter Eingabe');
    assert.equal(report.data.realPlay.maps[0].mapKey, 'pillar_hall');
    assert.equal(report.data.realPlay.maps[0].spawnDeathsPerMinute, 4);
    assert.equal(report.data.realPlay.maps[0].fps, 50);
    assert.match(report.markdown, /Nur echtes Spiel/);
    assert.match(report.markdown, /Port 38765/);
    assert.match(report.markdown, /pillar_hall/);
});

test('an empty history yields a readable report instead of NaN', () => {
    const report = buildTelemetryReport([], { source: 'Port 38765' });
    assert.equal(report.data.total.rounds, 0);
    assert.doesNotMatch(report.markdown, /NaN|undefined/);
});

test('the store folder follows the port the desktop app serves on', () => {
    const dir = resolveTelemetryStoreDir({ appData: 'C:/Users/x/AppData/Roaming', port: 38765 });
    assert.equal(
        dir.split(String.fromCharCode(92)).join('/'),
        'C:/Users/x/AppData/Roaming/curviosclash-app/session-main/IndexedDB/http_127.0.0.1_38765.indexeddb.leveldb'
    );
});

test('the reader answers the address internally and keeps the store name', async () => {
    const { readFile } = await import('node:fs/promises');
    const reader = await readFile(new URL('../scripts/telemetry-report-reader.cjs', import.meta.url), 'utf8');
    const cli = await readFile(new URL('../scripts/telemetry-report.mjs', import.meta.url), 'utf8');
    // Das laufende Spiel belegt den Port; ein eigener Server scheitert dann.
    assert.match(reader, /protocol\.handle\('http'/);
    assert.doesNotMatch(reader, /\.listen\(/);
    // Die Herkunft steckt auch in der Datenbank: eine umbenannte Kopie liest sich leer.
    assert.match(cli, /path\.basename\(sourceDir\)/);
    // Die Kopie enthaelt Spieldaten und wird nach dem Lesen entfernt.
    assert.match(cli, /finally \{[\s\S]*?rmSync\(profileDir/);
});
