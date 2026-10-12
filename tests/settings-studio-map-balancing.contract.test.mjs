import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SECTIONS, createTranslator } from '../electron/settings-studio/ui/settings-studio-i18n.js';

const require = createRequire(import.meta.url);
const { registerSettingsStudioIpc } = require('../electron/settings-studio/ipc/settings-studio-ipc.cjs');
const { createMapBalancingStore } = require('../electron/map-balancing-store.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNEL = 'settings-studio:map-balancing';
const scratch = mkdtempSync(path.join(os.tmpdir(), 'curvios-studio-balancing-'));
mkdirSync(path.join(scratch, 'data', 'balancing'), { recursive: true });
copyFileSync(path.join(ROOT, 'data', 'balancing', 'modes.json'), path.join(scratch, 'data', 'balancing', 'modes.json'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function register(options) {
    const handlers = new Map();
    const mainFrame = {};
    const windowRef = { webContents: { mainFrame }, isDestroyed: () => false };
    const unregister = registerSettingsStudioIpc({
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) },
        app: { getPath: () => scratch, isPackaged: options.isPackaged },
        getWindow: () => windowRef,
        browserDemoProjectRootPath: scratch,
        ...(options.store ? { mapBalancingStore: options.store } : {}),
    });
    const invoke = (payload) => handlers.get(CHANNEL)({ sender: windowRef.webContents, senderFrame: mainFrame }, payload);
    return { invoke, unregister, handlers };
}

test('B3: the studio edits a map draft, validates and saves it into data/balancing', async () => {
    const store = createMapBalancingStore({ root: ROOT, dataRoot: scratch, writable: true });
    const { invoke, unregister } = register({ isPackaged: false, store });

    const maps = await invoke({ op: 'list-maps' });
    assert.equal(maps.ok, true);
    assert.equal(maps.status.writable, true);
    assert.ok(maps.maps.some((entry) => entry.mapKey === 'maze'));

    const preview = await invoke({ op: 'describe', mapKey: 'maze', modePath: 'fight', layer: { values: { speed: 23 } } });
    const speed = preview.description.fields.find((row) => row.key === 'speed');
    assert.deepEqual([speed.value, speed.origin, speed.inherited], [23, 'map', 20]);
    assert.equal(preview.description.hasMapFile, false, 'a preview never writes');

    const invalid = await invoke({ op: 'validate', mapKey: 'maze', layer: { values: { speed: 50 } } });
    assert.equal(invalid.validation.ok, false);
    assert.match(invalid.validation.errors[0], /speed/);
    const refused = await invoke({ op: 'save', mapKey: 'maze', layer: { values: { speed: 50 } } });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'invalid_layer');

    const saved = await invoke({ op: 'save', mapKey: 'maze', layer: { values: { speed: 23 } } });
    assert.equal(saved.ok, true);
    const file = path.join(scratch, 'data', 'balancing', 'maps', 'maze.json');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).values, { speed: 23 });
    assert.equal((await invoke({ op: 'describe', mapKey: 'maze', modePath: 'fight' })).description.hasMapFile, true);

    assert.equal((await invoke({ op: 'describe', mapKey: '../x' })).reason, 'invalid_map_key');
    assert.equal((await invoke({ op: 'nope' })).reason, 'unknown_op');
    assert.equal((await invoke(null)).reason, 'unknown_op');
    await invoke({ op: 'save', mapKey: 'maze', layer: { values: {} } });
    assert.equal(existsSync(file), false);
    unregister();
});

test('B3: the packaged studio refuses balancing with a plain reason', async () => {
    const { invoke, unregister, handlers } = register({ isPackaged: true });
    const result = await invoke({ op: 'list-maps' });
    assert.deepEqual([result.ok, result.reason, result.status.writable], [false, 'packaged', false]);
    assert.match(result.status.message, /Entwicklungsumgebung/);
    unregister();
    assert.equal(handlers.has(CHANNEL), false);
});

test('B3: the section is registered in the studio navigation and texts', () => {
    assert.deepEqual(SECTIONS.find((entry) => entry.key === 'mapBalancing'), { key: 'mapBalancing', labelKey: 'sectionMapBalancing', noDirty: true });
    for (const language of ['de', 'en']) {
        const t = createTranslator(language);
        assert.notEqual(t('sectionMapBalancing'), 'sectionMapBalancing', language);
        assert.notEqual(t('sectionHintMapBalancing'), 'sectionHintMapBalancing', language);
    }
    const app = readFileSync(new URL('../electron/settings-studio/ui/settings-studio-app.js', import.meta.url), 'utf8');
    assert.match(app, /mapBalancingSection\.mount\(refs\.formContent\)/);
    assert.match(app, /closest\?\.\('\.map-balancing'\)\) return;/, 'the draft form handlers ignore the balancing section');
    const preload = readFileSync(new URL('../electron/settings-studio/preload.cjs', import.meta.url), 'utf8');
    assert.match(preload, /mapBalancing: \(op, payload = \{\}\) => invoke\('settings-studio:map-balancing'/);
});
