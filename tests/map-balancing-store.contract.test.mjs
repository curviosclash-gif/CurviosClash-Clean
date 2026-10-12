import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMapBalancingStore, resolveMapBalancingStoreRoot } = require('../electron/map-balancing-store.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'curvios-map-balancing-'));
mkdirSync(path.join(scratch, 'data', 'balancing'), { recursive: true });
copyFileSync(path.join(ROOT, 'data', 'balancing', 'modes.json'), path.join(scratch, 'data', 'balancing', 'modes.json'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

let clock = Date.UTC(2026, 9, 12, 12, 0, 0);
const store = createMapBalancingStore({ root: ROOT, dataRoot: scratch, writable: true, now: () => (clock += 1000) });
const mazeFile = path.join(scratch, 'data', 'balancing', 'maps', 'maze.json');

test('store: only an unpacked repository may write', () => {
    assert.deepEqual(
        [resolveMapBalancingStoreRoot({ isPackaged: true }).writable, resolveMapBalancingStoreRoot({ isPackaged: true }).reason],
        [false, 'packaged']
    );
    const repo = resolveMapBalancingStoreRoot({ projectRoot: ROOT });
    assert.equal(repo.writable, true);
    assert.equal(repo.root, ROOT);
    assert.equal(resolveMapBalancingStoreRoot({ projectRoot: scratch }).reason, 'no_repository');
    assert.equal(resolveMapBalancingStoreRoot({ env: { CURVIOS_MAP_BALANCING_ROOT: ROOT } }).writable, true);
});

test('store: a read-only store refuses every operation with its reason', async () => {
    const readOnly = createMapBalancingStore({ root: '', writable: false, reason: 'packaged', message: 'nur in Dev' });
    await assert.rejects(readOnly.describe({ mapKey: 'maze' }), (error) => error.reason === 'packaged');
    await assert.rejects(readOnly.setValue('maze', 'speed', 22), /nur in Dev/);
    await assert.rejects(readOnly.listMaps(), (error) => error.reason === 'packaged');
});

test('store: lists the shipped maps without editor maps', async () => {
    const maps = await store.listMaps();
    assert.ok(maps.length > 40);
    assert.ok(maps.some((entry) => entry.mapKey === 'maze' && entry.name && entry.hasMapFile === false));
    assert.equal(maps.some((entry) => entry.mapKey.startsWith('editor_')), false);
});

test('store: set writes a validated sparse file, a second save keeps a backup, reset removes it again', async () => {
    const first = await store.setValue('maze', 'speed', 24);
    assert.equal(first.backupPath, '');
    assert.deepEqual(JSON.parse(readFileSync(mazeFile, 'utf8')), { version: 1, mapKey: 'maze', values: { speed: 24 } });
    let description = await store.describe({ mapKey: 'maze', modePath: 'fight' });
    const speed = description.fields.find((row) => row.key === 'speed');
    assert.deepEqual([speed.value, speed.origin, speed.inherited], [24, 'map', 20]);
    assert.equal(description.path, mazeFile);

    const second = await store.setValue('maze', 'portalsEnabled', false);
    assert.ok(existsSync(second.backupPath));
    assert.deepEqual(JSON.parse(readFileSync(second.backupPath, 'utf8')).values, { speed: 24 });
    assert.deepEqual((await store.readMapLayer('maze')).values, { speed: 24, portalsEnabled: false });

    await store.resetValue('maze', 'speed');
    description = await store.describe({ mapKey: 'maze', modePath: 'fight' });
    assert.equal(description.fields.find((row) => row.key === 'speed').origin, 'mode');
    const removed = await store.resetValue('maze', 'portalsEnabled');
    assert.equal(removed.removed, true);
    assert.equal(existsSync(mazeFile), false);
    assert.equal(readdirSync(path.join(scratch, 'tmp', 'balancing-backups')).length, 3);
});

test('store: invalid values, unknown maps and path tricks never reach the disk', async () => {
    await assert.rejects(store.setValue('maze', 'speed', 99), /speed/);
    await assert.rejects(store.saveMapLayer('maze', { values: { speed: 22, nope: 1 } }), (error) => error.reason === 'invalid_layer');
    await assert.rejects(store.setValue('no_such_map', 'speed', 22), (error) => error.reason === 'unknown_map');
    await assert.rejects(store.setValue('../evil', 'speed', 22), (error) => error.reason === 'invalid_map_key');
    assert.equal(existsSync(mazeFile), false);
});
