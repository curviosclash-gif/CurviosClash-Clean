// Belegt, dass eine Runde erkennbar macht, wer sie gesteuert hat: Mensch,
// unbedientes Fenster oder Automatisierung. Ohne diese Kennung zaehlt jede
// offene Sitzung als menschliche Runde.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    ROUND_CONTROL_MIN_SAMPLES,
    ROUND_CONTROL_SOURCES,
    classifyRoundControl,
    normalizeRoundControl,
    resolveRoundControlSource,
} from '../src/shared/contracts/RoundControlContract.js';
import { InputManager } from '../src/core/InputManager.js';
import { normalizeTelemetryHistoryEntry } from '../src/state/TelemetryHistoryStore.js';
import { computeTelemetryHistorySummary } from '../src/state/telemetry/TelemetryHistorySummary.js';
import { matchesTelemetryHistoryFilters } from '../src/state/telemetry/TelemetryHistoryEntry.js';
import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';
import { renderTelemetryHistorySection } from '../src/ui/menu/MenuTelemetryDashboard.js';

const ACTIVE_SAMPLES = ROUND_CONTROL_MIN_SAMPLES * 2;

test('control classification separates human, idle and automated rounds', () => {
    const human = classifyRoundControl({
        humanCount: 1, inputSamples: ACTIVE_SAMPLES, activeInputSamples: Math.floor(ACTIVE_SAMPLES * 0.4),
    });
    assert.equal(human.source, ROUND_CONTROL_SOURCES.HUMAN);
    assert.ok(human.inputShare > 0.3);

    const idle = classifyRoundControl({ humanCount: 1, inputSamples: ACTIVE_SAMPLES, activeInputSamples: 1 });
    assert.equal(idle.source, ROUND_CONTROL_SOURCES.IDLE);

    // Die Kennung schlaegt den Eingabeanteil: Werkzeug-Tastendruecke sehen aus wie echte.
    const automated = classifyRoundControl({
        automationSignal: 'test-api', humanCount: 1, inputSamples: ACTIVE_SAMPLES, activeInputSamples: ACTIVE_SAMPLES,
    });
    assert.equal(automated.source, ROUND_CONTROL_SOURCES.AUTOMATION);
    assert.equal(automated.automationSignal, 'test-api');

    // Kopfloser Lauf ohne menschlichen Platz ist Automatisierung, nicht Untaetigkeit.
    assert.equal(classifyRoundControl({ humanCount: 0, inputSamples: ACTIVE_SAMPLES }).source, ROUND_CONTROL_SOURCES.AUTOMATION);
    // Zu kurze Runde sagt nichts aus.
    assert.equal(classifyRoundControl({ humanCount: 1, inputSamples: 4, activeInputSamples: 0 }).source, ROUND_CONTROL_SOURCES.UNKNOWN);
});

test('history entries keep the control block and older rounds stay unknown', () => {
    const recorded = normalizeTelemetryHistoryEntry({
        mapKey: 'standard',
        control: { source: 'idle', inputSamples: 600, activeInputSamples: 3, automationSignal: '' },
    });
    assert.equal(recorded.control.source, ROUND_CONTROL_SOURCES.IDLE);
    assert.equal(recorded.control.inputSamples, 600);
    assert.equal(resolveRoundControlSource(recorded), ROUND_CONTROL_SOURCES.IDLE);

    const legacy = normalizeTelemetryHistoryEntry({ mapKey: 'standard' });
    assert.equal(legacy.control.source, ROUND_CONTROL_SOURCES.UNKNOWN);
    assert.equal(normalizeRoundControl(null).source, ROUND_CONTROL_SOURCES.UNKNOWN);
});

test('control source is filterable and counted in the summary', () => {
    const rows = [
        { mapKey: 'standard', winnerType: 'human', control: { source: 'human', inputSamples: 600, activeInputSamples: 200 } },
        { mapKey: 'standard', winnerType: 'bot', control: { source: 'idle', inputSamples: 600, activeInputSamples: 1 } },
        { mapKey: 'standard', winnerType: 'bot', control: { source: 'automation', automationSignal: 'webdriver' } },
        { mapKey: 'standard', winnerType: 'bot' },
    ].map(normalizeTelemetryHistoryEntry);

    const summary = computeTelemetryHistorySummary(rows);
    assert.deepEqual(summary.controlSourceCounts, { human: 1, idle: 1, automation: 1, unknown: 1 });

    assert.equal(matchesTelemetryHistoryFilters(rows[0], { controlSource: 'human' }), true);
    assert.equal(matchesTelemetryHistoryFilters(rows[1], { controlSource: 'human' }), false);
    assert.equal(matchesTelemetryHistoryFilters(rows[2], { controlSource: 'all' }), true);
});

test('input manager counts only polls that carry a real input', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, document: { addEventListener() {} } };
    try {
        const input = new InputManager();
        const createSource = (state) => ({ poll: () => state, bind() {}, unbind() {}, dispose() {} });
        const idleSource = createSource({ yawLeft: false, pitchAxis: 0 });
        const busySource = createSource({ yawLeft: false, pitchAxis: 0.9 });

        input.setPlayerSource(0, idleSource);
        input.getPlayerInput(0);
        input.getPlayerInput(0);
        assert.deepEqual(input.getInputActivitySnapshot(), { samples: 2, activeSamples: 0, players: [{ index: 0, samples: 2, activeSamples: 0 }] });

        input.setPlayerSource(0, busySource);
        input.getPlayerInput(0);
        assert.deepEqual(input.getInputActivitySnapshot(), { samples: 3, activeSamples: 1, players: [{ index: 0, samples: 3, activeSamples: 1 }] });

        input.resetInputActivity();
        assert.deepEqual(input.getInputActivitySnapshot(), { samples: 0, activeSamples: 0, players: [] });
    } finally {
        globalThis.window = previousWindow;
    }
});

function createGame({ players, inputActivity, runtimeWindow }) {
    return {
        arena: { currentMapKey: 'standard', getTelemetryMapRevision: () => 'map-r4' },
        buildInfoController: { appVersion: '2.1.0', buildId: 'desktop-88' },
        activeGameMode: 'CLASSIC',
        settings: { localSettings: { modePath: 'normal' } },
        runtimeConfig: { session: { sessionType: 'single', modePath: 'normal' }, player: { vehicles: {} }, bot: {} },
        renderer: { getQualityState: () => ({ effectiveQuality: 'HIGH' }) },
        runtimePerfProfiler: { getTelemetryIntervalSnapshot: () => null },
        input: {
            getInputActivitySnapshot: () => inputActivity,
            resetInputActivity() { this.resetCalls = (this.resetCalls || 0) + 1; },
        },
        runtimeWindow,
        entityManager: {
            players,
            getHumanPlayers: () => players.filter((player) => !player.isBot),
            getHuntScoreboard: () => [],
        },
    };
}

const roundEndPlan = {
    outcome: { state: 'ROUND_END', reason: 'ELIMINATION' },
    recording: { roundMetrics: { winnerIndex: 1, winnerIsBot: true, duration: 40 } },
};

test('round payload marks an unattended window as idle', () => {
    const players = [{ index: 0, isBot: false }, { index: 1, isBot: true }];
    const game = createGame({
        players,
        inputActivity: { samples: 2400, activeSamples: 0 },
        runtimeWindow: { navigator: {} },
    });
    const payload = new MatchFlowTelemetryController({ game }).buildRoundEndTelemetryPayload(roundEndPlan);
    assert.equal(payload.control.source, ROUND_CONTROL_SOURCES.IDLE);
    assert.equal(payload.control.inputSamples, 2400);
});

test('round payload marks a tool-driven window as automation', () => {
    const players = [{ index: 0, isBot: false }, { index: 1, isBot: true }];
    const game = createGame({
        players,
        inputActivity: { samples: 2400, activeSamples: 1800 },
        runtimeWindow: { navigator: { webdriver: true } },
    });
    const payload = new MatchFlowTelemetryController({ game }).buildRoundEndTelemetryPayload(roundEndPlan);
    assert.equal(payload.control.source, ROUND_CONTROL_SOURCES.AUTOMATION);
    assert.equal(payload.control.automationSignal, 'webdriver');
});

test('developer panel shows the control split and filters real play by default', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const select = html.match(/<select id="telemetry-filter-control">[\s\S]*?<\/select>/)?.[0] || '';
    assert.ok(select.includes('value="human" selected'), 'Steuerungsfilter steht ab Werk auf echtem Spiel');
    assert.ok(select.includes('value="automation"'));

    const previousDocument = globalThis.document;
    const createElement = () => ({
        children: [], attributes: {}, textContent: '',
        setAttribute(key, value) { this.attributes[key] = value; },
        appendChild(child) { this.children.push(child); },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
    });
    const find = (element, key, value) => {
        if (element.attributes?.[key] === value) return element;
        for (const child of element.children || []) {
            const match = find(child, key, value);
            if (match) return match;
        }
        return null;
    };
    globalThis.document = { createElement };
    try {
        const root = createElement();
        renderTelemetryHistorySection(root, {
            rounds: 4,
            controlSourceCounts: { human: 1, idle: 1, automation: 1, unknown: 1 },
        });
        const row = find(root, 'data-telemetry-row-key', 'history-control');
        assert.equal(row.children[0].textContent, 'Steuerung');
        assert.equal(row.children[1].textContent, 'Mensch 1 · untätig 1 · automatisch 1 · unbekannt 1');
    } finally {
        globalThis.document = previousDocument;
    }
});

test('recording a round resets the input activity for the next round', () => {
    const players = [{ index: 0, isBot: false }, { index: 1, isBot: true }];
    const game = createGame({
        players,
        inputActivity: { samples: 2400, activeSamples: 900 },
        runtimeWindow: { navigator: {} },
    });
    const controller = new MatchFlowTelemetryController({ game });
    controller.recordRoundEndTelemetry(roundEndPlan);
    assert.equal(game.input.resetCalls, 1);
});

// Im geteilten Bildschirm zaehlte bisher die Summe beider Plaetze. Spielte nur
// Pilot 1 und Pilot 2 sass nicht am Controller, galt die Runde als zwei Menschen.
test('a split round with one absent pilot keeps the active one and flags the idle seat', () => {
    const split = classifyRoundControl({
        humanCount: 2,
        players: [
            { index: 0, samples: ACTIVE_SAMPLES, activeSamples: Math.floor(ACTIVE_SAMPLES / 2) },
            { index: 1, samples: ACTIVE_SAMPLES, activeSamples: 0 },
        ],
    });
    assert.equal(split.source, ROUND_CONTROL_SOURCES.HUMAN);
    assert.equal(split.activeHumanCount, 1);
    assert.equal(split.idleHumanCount, 1);

    const bothIdle = classifyRoundControl({
        humanCount: 2,
        players: [
            { index: 0, samples: ACTIVE_SAMPLES, activeSamples: 0 },
            { index: 1, samples: ACTIVE_SAMPLES, activeSamples: 1 },
        ],
    });
    assert.equal(bothIdle.source, ROUND_CONTROL_SOURCES.IDLE);
    assert.equal(bothIdle.activeHumanCount, 0);

    // Ein Platz mit zu wenig Abfragen wird nicht bewertet, statt als untaetig zu gelten.
    const short = classifyRoundControl({ humanCount: 1, players: [{ index: 0, samples: 5, activeSamples: 0 }] });
    assert.equal(short.source, ROUND_CONTROL_SOURCES.UNKNOWN);
    assert.equal(normalizeRoundControl({ source: 'human' }).idleHumanCount, 0);
});

test('input manager keeps the activity apart per pilot', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, document: { addEventListener() {} } };
    try {
        const input = new InputManager();
        const createSource = (state) => ({ poll: () => state, bind() {}, unbind() {}, dispose() {} });
        input.setPlayerSource(0, createSource({ yawLeft: true }));
        input.setPlayerSource(1, createSource({ yawLeft: false }));
        input.getPlayerInput(0);
        input.getPlayerInput(1);
        input.getPlayerInput(1);
        const snapshot = input.getInputActivitySnapshot();
        assert.equal(snapshot.samples, 3);
        assert.equal(snapshot.activeSamples, 1);
        assert.deepEqual(snapshot.players, [
            { index: 0, samples: 1, activeSamples: 1 },
            { index: 1, samples: 2, activeSamples: 0 },
        ]);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('the summary counts rounds that ran with an idle human seat', () => {
    const rows = [
        { control: { source: 'human', activeHumanCount: 1, idleHumanCount: 1 } },
        { control: { source: 'human', activeHumanCount: 2, idleHumanCount: 0 } },
        { control: { source: 'idle', activeHumanCount: 0, idleHumanCount: 1 } },
    ].map(normalizeTelemetryHistoryEntry);
    assert.equal(computeTelemetryHistorySummary(rows).roundsWithIdleHumanSeat, 1);
});
