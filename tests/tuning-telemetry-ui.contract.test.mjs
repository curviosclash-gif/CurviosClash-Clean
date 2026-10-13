import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Just enough DOM for the panel: elements, children, text, attributes, style and listeners.
class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = {};
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.open = false;
    }
    append(...nodes) {
        for (const node of nodes) this.children.push(typeof node === 'string' ? Object.assign(new FakeElement('#text'), { textContent: node }) : node);
    }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    dispatch(type) { return this.listeners.get(type)?.({ target: this }); }
    *walk() { yield this; for (const child of this.children) yield* child.walk(); }
    findAll(predicate) { return [...this.walk()].filter(predicate); }
    get text() { return [...this.walk()].map((node) => node.textContent).join(' '); }
}

globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
const { createTuningTelemetryUi } = await import('../electron/tuning-console/tuning-telemetry-ui.js');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createApi() {
    const calls = [];
    return {
        calls,
        telemetry: async (op, payload) => {
            calls.push([op, payload]);
            if (op === 'overview') {
                return {
                    ok: true,
                    value: {
                        totalRounds: 9,
                        filterOptions: { buildIds: ['b1'], mapKeys: ['maze'], modes: ['HUNT'] },
                        summary: { rounds: 4, averageDuration: 61.5, humanWinRate: 0.5, killsPerRound: 1.25, topMaps: [{ key: 'maze', count: 4 }], topModes: [], topBuilds: [] },
                        recentRounds: [{ at: '2026-10-12T12:00:00Z', mapKey: 'maze', mode: 'HUNT', duration: 60, winnerType: 'human', controlSource: 'human' }],
                    },
                };
            }
            if (op === 'export') return { ok: true, value: { filePath: 'C:/x.csv', rounds: 4, format: payload.format } };
            if (op === 'clear') return { ok: true, value: { ok: true } };
            return { ok: false, reason: 'unknown' };
        },
    };
}

const byText = (root, text) => root.findAll((node) => node.tagName === 'BUTTON' && node.textContent === text)[0];

test('telemetry panel: loads on open, filters re-query and exports report the file', async () => {
    const api = createApi();
    const statuses = [];
    const container = new FakeElement('section');
    createTuningTelemetryUi({ tuningApi: api, container, setStatus: (message) => statuses.push(message) });
    const details = container.children[0];
    details.open = true;
    details.dispatch('toggle');
    await flush();
    assert.match(container.text, /4 von 9 Runden/);
    assert.match(container.text, /61\.5 s/);
    assert.match(container.text, /maze/);
    assert.equal(api.calls[0][1].filters.controlSource, 'human', 'only rounds a person flew by default');

    const selects = container.findAll((node) => node.tagName === 'SELECT');
    const control = selects[3];
    control.value = 'all';
    control.dispatch('change');
    await flush();
    assert.equal(api.calls.at(-1)[1].filters.controlSource, 'all');

    byText(container, 'Export CSV').dispatch('click');
    await flush();
    assert.deepEqual(api.calls.at(-1)[0], 'export');
    assert.match(statuses.at(-1), /4 Runden exportiert: C:\/x\.csv/);
});

test('telemetry panel: deleting needs a second click on the same button', async () => {
    const api = createApi();
    const container = new FakeElement('section');
    createTuningTelemetryUi({ tuningApi: api, container, setStatus: () => {} });
    const reset = byText(container, 'Daten löschen');
    reset.dispatch('click');
    await flush();
    assert.equal(api.calls.some(([op]) => op === 'clear'), false, 'first click only arms');
    assert.equal(reset.attributes.get('data-confirm-armed'), 'true');
    reset.dispatch('click');
    await flush();
    assert.equal(api.calls.filter(([op]) => op === 'clear').length, 1);
    const source = readFileSync(new URL('../electron/tuning-console/tuning-telemetry-ui.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(confirm|alert|prompt)\(/);
});
