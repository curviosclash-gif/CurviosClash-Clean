import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Just enough DOM for the section: elements, children, text, listeners and class lookups.
class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.listeners = new Map();
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
    }
    append(...nodes) {
        for (const node of nodes) this.children.push(typeof node === 'string' ? Object.assign(new FakeElement('#text'), { textContent: node }) : node);
    }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    dispatch(type) { return this.listeners.get(type)?.({ target: this }); }
    *walk() { yield this; for (const child of this.children) yield* child.walk(); }
    querySelector(selector) { return this.findAll((node) => node.className.split(' ').includes(selector.slice(1)))[0] || null; }
    findAll(predicate) { return [...this.walk()].filter(predicate); }
    get text() { return [...this.walk()].map((node) => node.textContent).join(' '); }
}

globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
const { createStudioBalancingSection } = await import('../electron/settings-studio/ui/settings-studio-balancing.js');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createApi() {
    const calls = [];
    const files = { maze: { speed: 24 } };
    const describe = ({ mapKey, layer }) => {
        const values = layer ? layer.values : (files[mapKey] || {});
        return {
            mapKey, modePath: 'fight', hasMapFile: !!files[mapKey], path: `data/balancing/maps/${mapKey}.json`,
            fields: [{ key: 'speed', group: 'map', type: 'number', label: 'Tempo', help: '', min: 8, max: 40, step: 0.5, integer: false,
                value: values.speed ?? 20, origin: 'speed' in values ? 'map' : 'mode', mapValue: values.speed ?? null, inherited: 20 }],
        };
    };
    const api = {
        calls,
        mapBalancing: async (op, payload) => {
            calls.push(op);
            const status = { writable: true, message: '' };
            if (op === 'list-maps') return { ok: true, status, maps: [{ mapKey: 'maze', name: 'Labyrinth', hasMapFile: true }, { mapKey: 'standard', name: 'Standard', hasMapFile: false }] };
            if (op === 'describe') return { ok: true, status, description: describe(payload) };
            if (op === 'validate') return { ok: true, status, validation: { ok: payload.layer.values.speed <= 40, errors: payload.layer.values.speed <= 40 ? [] : ['speed: 50 outside 8..40'] } };
            if (op === 'save') {
                files[payload.mapKey] = { ...payload.layer.values };
                return { ok: true, status, saved: { path: 'x.json', backupPath: '', removed: false, layer: payload.layer } };
            }
            return { ok: false, reason: 'unknown_op', status };
        },
    };
    return { api, files };
}

const mapButton = (container, mapKey) => container.findAll((node) => node.tagName === 'BUTTON' && node.text.includes(mapKey))[0];
const numberInput = (container) => container.findAll((node) => node.className === 'map-balancing__number')[0];
const button = (container, label) => container.findAll((node) => node.tagName === 'BUTTON' && node.textContent === label)[0];

test('B3 UI: drafts survive a map switch without any confirmation dialog', async () => {
    const { api, files } = createApi();
    let dirtyReports = 0;
    const section = createStudioBalancingSection({ api, onDirtyChange: () => { dirtyReports += 1; } });
    const container = new FakeElement('div');
    await section.mount(container);
    assert.match(container.text, /Labyrinth/);

    mapButton(container, 'maze').dispatch('click');
    await flush();
    assert.equal(numberInput(container).value, '24');
    numberInput(container).value = '26';
    numberInput(container).dispatch('change');
    await flush();
    assert.equal(section.isDirty(), true);
    assert.match(container.text, /ungespeichert/);

    mapButton(container, 'standard').dispatch('click');
    await flush();
    assert.equal(numberInput(container).value, '20');
    assert.equal(section.isDirty(), true, 'the maze draft is kept');
    assert.match(container.text, /✎/);

    mapButton(container, 'maze').dispatch('click');
    await flush();
    assert.equal(numberInput(container).value, '26', 'back on maze the draft is still there');

    button(container, 'Für Karte speichern').dispatch('click');
    await flush();
    await flush();
    assert.deepEqual(files.maze, { speed: 26 });
    assert.equal(section.isDirty(), false);
    assert.ok(dirtyReports > 0);
    assert.ok(api.calls.includes('validate'), 'save validates first');
});

test('B3 UI: invalid drafts are shown and never saved; read-only stores explain why', async () => {
    const { api, files } = createApi();
    const section = createStudioBalancingSection({ api });
    const container = new FakeElement('div');
    await section.mount(container);
    mapButton(container, 'maze').dispatch('click');
    await flush();
    numberInput(container).value = '50';
    numberInput(container).dispatch('change');
    await flush();
    button(container, 'Für Karte speichern').dispatch('click');
    await flush();
    assert.match(container.text, /outside 8..40/);
    assert.deepEqual(files.maze, { speed: 24 });

    const readOnly = createStudioBalancingSection({
        api: { mapBalancing: async () => ({ ok: false, reason: 'packaged', status: { writable: false, message: 'nur in der Entwicklungsumgebung' } }) },
    });
    const readOnlyContainer = new FakeElement('div');
    await readOnly.mount(readOnlyContainer);
    assert.match(readOnlyContainer.text, /nur in der Entwicklungsumgebung/);
});

test('B3 UI: no Windows dialogs in the balancing tools', () => {
    for (const file of ['../electron/settings-studio/ui/settings-studio-balancing.js', '../electron/tuning-console/tuning-balancing-ui.js']) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\b(confirm|alert|prompt)\(/, file);
    }
});
