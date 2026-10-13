import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

// Evaluates the real capability function from main.cjs against a stated app and process.
function loadCapability({ isPackaged, argv = [], env = {}, singleInstance = true }) {
    const match = mainSource.match(/\nfunction resolveTuningConsoleCapabilityState\(\) \{[\s\S]*?\n\}\n/);
    assert.ok(match, 'capability function found in main.cjs');
    const factory = new Function(
        'app', 'process', 'hasSingleInstanceLock', 'TUNING_CONSOLE_CAPABILITY_CONTRACT_VERSION', 'TUNING_CONSOLE_CAPABILITY_ID',
        `${match[0]}\nreturn resolveTuningConsoleCapabilityState;`
    );
    return factory({ isPackaged }, { argv, env }, singleInstance, 'v1', 'developer-tuning-console')();
}

test('F7 console: only from source or with the developer start parameter', () => {
    const packaged = loadCapability({ isPackaged: true, argv: ['CurviosClash.exe'] });
    assert.equal(packaged.available, false);
    assert.equal(packaged.reason, 'developer_tools_disabled');
    assert.match(packaged.message, /Entwicklungsumgebung/);
    assert.equal(loadCapability({ isPackaged: true, argv: ['CurviosClash.exe', '--dev-tools'] }).available, true);
    assert.equal(loadCapability({ isPackaged: true, env: { CURVIOS_DEV_TOOLS: '1' } }).available, true);
    assert.equal(loadCapability({ isPackaged: true, env: { CURVIOS_DEV_TOOLS: 'yes' } }).available, false);
    assert.equal(loadCapability({ isPackaged: false }).available, true, 'game from source');
    const secondInstance = loadCapability({ isPackaged: false, singleInstance: false });
    assert.deepEqual([secondInstance.available, secondInstance.reason], [false, 'desktop_surface_unavailable']);
});

class FakeButton {
    constructor(textContent) {
        this.textContent = textContent;
        this.listeners = new Map();
        this.attributes = new Map();
        this.disabled = false;
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    dispatch(type) { return this.listeners.get(type)?.({ target: this }); }
}

test('F7 console: "Alle zurücksetzen" needs a second click', async () => {
    globalThis.document = { createElement: () => ({ appendChild() {}, set innerHTML(_value) {} }) };
    const { createTuningPresetUi } = await import('../electron/tuning-console/tuning-preset-ui.js');
    let resets = 0;
    const resetAllButton = new FakeButton('Alle zurücksetzen');
    createTuningPresetUi({
        tuningApi: { resetAll: async () => { resets += 1; return { ok: true }; } },
        presetManager: { listPresets: () => [], getPreset: () => null },
        elements: { resetAllButton },
        setStatus: () => {},
    });
    resetAllButton.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resets, 0, 'the first click only arms');
    assert.equal(resetAllButton.textContent, 'Wirklich alle zurücksetzen?');
    resetAllButton.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resets, 1);
    assert.equal(resetAllButton.textContent, 'Alle zurücksetzen');
    delete globalThis.document;
});

test('F7 console: German labels and no Windows dialogs', () => {
    const html = readFileSync(new URL('../electron/tuning-console/tuning.html', import.meta.url), 'utf8');
    for (const label of ['Speichern', 'Laden', 'Exportieren', 'Importieren', 'Alle zurücksetzen']) assert.match(html, new RegExp(`>${label}<`));
    assert.doesNotMatch(html, />(Save|Load|Reset All)</);
    for (const file of ['tuning-preset-ui.js', 'tuning-app.js', 'tuning-balancing-ui.js', 'tuning-telemetry-ui.js']) {
        const source = readFileSync(new URL(`../electron/tuning-console/${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\b(confirm|alert|prompt)\(/, file);
    }
});
