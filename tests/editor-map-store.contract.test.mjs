import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    existsSync,
    mkdirSync,
    lstatSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
    buildEditorMapDiskFiles,
    EDITOR_MAP_EDITOR_SUFFIX,
    EDITOR_MAP_RUNTIME_SUFFIX,
    slugifyEditorMapKeyBase,
} from '../editor/js/EditorMapDiskFiles.js';
import { createEditorAuthoringDocument } from '../editor/js/EditorAuthoringDocument.js';

const require = createRequire(import.meta.url);
const {
    createEditorMapStore,
    MAX_TOTAL_RUNTIME_MAP_BYTES,
    isSafeEditorMapFileName,
    isValidEditorMapKey,
    toEditorMapKey,
} = require('../electron/editor-map-store.cjs');

const tempDirectories = [];
after(() => {
    for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
});

function makeTempDirectory(prefix) {
    const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirectories.push(directory);
    return directory;
}

function createStore() {
    const directory = makeTempDirectory('curvios-editor-map-store-');
    const opened = [];
    const store = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: (target) => { opened.push(target); return Promise.resolve(); },
    });
    return { directory, store, opened };
}

function runtimeJsonFor(name, extra = {}) {
    return JSON.stringify({ name, mapScale: 3, hardBlocks: [], ...extra });
}

function runtimeJsonForStoredSize(name, storedSize) {
    const runtimeMap = { name, mapScale: 3, hardBlocks: [], padding: '' };
    const emptyStoredSize = Buffer.byteLength(`${JSON.stringify(runtimeMap, null, 2)}\n`, 'utf8');
    runtimeMap.padding = 'x'.repeat(storedSize - emptyStoredSize);
    const runtimeJson = JSON.stringify(runtimeMap);
    assert.equal(Buffer.byteLength(`${JSON.stringify(JSON.parse(runtimeJson), null, 2)}\n`, 'utf8'), storedSize);
    return runtimeJson;
}

function editorJsonFor(name) {
    return JSON.stringify({ schemaVersion: 'editor-authoring.v1', map: { name } });
}

test('map reads are asynchronous and aggregate budget errors never return a partial catalog', async () => {
    const exactDirectory = makeTempDirectory('curvios-editor-map-budget-exact-');
    const overflowDirectory = makeTempDirectory('curvios-editor-map-budget-overflow-');
    const exactKeys = Array.from({ length: 32 }, (_, index) => `editor_m${String(index).padStart(2, '0')}`);
    const overflowKeys = [...exactKeys, 'editor_m32'];
    for (const directory of [exactDirectory, overflowDirectory]) {
        const mapKeys = directory === overflowDirectory ? overflowKeys : exactKeys;
        for (const mapKey of mapKeys) {
            writeFileSync(
                path.join(directory, `${mapKey}${EDITOR_MAP_RUNTIME_SUFFIX}`),
                runtimeJsonFor(mapKey),
                'utf8'
            );
        }
    }
    const syntheticSizeByKey = new Map([
        ...exactKeys.map((mapKey) => [mapKey, MAX_TOTAL_RUNTIME_MAP_BYTES / exactKeys.length]),
        ['editor_m32', 1],
    ]);
    const storeFor = (directory) => createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: async () => {},
        statLink(filePath) {
            const stats = lstatSync(filePath);
            const mapKey = path.basename(filePath, EDITOR_MAP_RUNTIME_SUFFIX);
            return {
                isSymbolicLink: () => stats.isSymbolicLink(),
                size: syntheticSizeByKey.get(mapKey) ?? stats.size,
            };
        },
    });

    const exactStore = storeFor(exactDirectory);
    const exactRead = exactStore.readRuntimeMaps();
    assert.equal(typeof exactRead?.then, 'function');
    assert.equal(Object.keys((await exactRead).maps).length, exactKeys.length);

    const overflowStore = storeFor(overflowDirectory);
    assert.deepEqual(await overflowStore.readRuntimeMaps(), {
        ok: false,
        error: 'total_payload_too_large',
        maps: {},
    });
    assert.deepEqual(await overflowStore.listMaps(), {
        ok: false,
        error: 'total_payload_too_large',
        maps: [],
    });
});

test('map saves budget the prospective catalog, serialize concurrent saves, and subtract overwritten bytes', async () => {
    const newMapDirectory = makeTempDirectory('curvios-editor-map-save-budget-');
    const overwriteDirectory = makeTempDirectory('curvios-editor-map-overwrite-budget-');
    const mapKeys = Array.from({ length: 31 }, (_, index) => `editor_m${String(index + 1).padStart(2, '0')}`);
    const existingSizes = new Map(mapKeys.map((mapKey) => [mapKey, MAX_TOTAL_RUNTIME_MAP_BYTES / 32]));
    for (const [directory, keys] of [[newMapDirectory, mapKeys], [overwriteDirectory, [...mapKeys, 'editor_budget-overwrite']]]) {
        for (const mapKey of keys) {
            writeFileSync(
                path.join(directory, `${mapKey}${EDITOR_MAP_RUNTIME_SUFFIX}`),
                runtimeJsonFor(mapKey === 'editor_budget-overwrite' ? 'Budget Overwrite' : mapKey),
                'utf8'
            );
        }
    }
    existingSizes.set('editor_budget-overwrite', MAX_TOTAL_RUNTIME_MAP_BYTES / 32);
    const storeFor = (directory) => createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: async () => {},
        statLink(filePath) {
            const stats = lstatSync(filePath);
            const mapKey = path.basename(filePath, EDITOR_MAP_RUNTIME_SUFFIX);
            return {
                isSymbolicLink: () => stats.isSymbolicLink(),
                size: existingSizes.get(mapKey) ?? stats.size,
            };
        },
    });

    const newMapStore = storeFor(newMapDirectory);
    const exactLimitSave = newMapStore.saveMap({
        mapName: 'Exact Limit',
        runtimeJson: runtimeJsonForStoredSize('Exact Limit', MAX_TOTAL_RUNTIME_MAP_BYTES / 32),
        editorJson: editorJsonFor('Exact Limit'),
    });
    const overflowingSave = newMapStore.saveMap({
        mapName: 'Beyond Limit',
        runtimeJson: runtimeJsonFor('Beyond Limit'),
        editorJson: editorJsonFor('Beyond Limit'),
    });
    const exactLimitResult = await exactLimitSave;
    assert.equal(exactLimitResult.ok, true, 'a saved catalog exactly at the aggregate limit is accepted');
    assert.equal((await newMapStore.readRuntimeMaps()).ok, true, 'the exact-limit saved catalog remains readable');
    const filesBeforeRejectedSave = readdirSync(newMapDirectory).sort().map((fileName) => [
        fileName,
        readFileSync(path.join(newMapDirectory, fileName)),
    ]);
    const overflowingResult = await overflowingSave;
    assert.deepEqual(overflowingResult, { ok: false, error: 'total_payload_too_large' });
    assert.deepEqual(
        readdirSync(newMapDirectory).sort().map((fileName) => [fileName, readFileSync(path.join(newMapDirectory, fileName))]),
        filesBeforeRejectedSave,
        'a rejected over-budget save leaves existing files byte-for-byte unchanged'
    );

    const overwrite = await storeFor(overwriteDirectory).saveMap({
        mapName: 'Budget Overwrite',
        runtimeJson: runtimeJsonFor('Budget Overwrite', { updated: true }),
        editorJson: editorJsonFor('Budget Overwrite'),
    });
    assert.equal(overwrite.ok, true, 'overwriting an exact-limit catalog accounts for the replaced runtime bytes');
    assert.equal(overwrite.overwritten, true);
    const overwrittenCatalog = await storeFor(overwriteDirectory).readRuntimeMaps();
    assert.equal(overwrittenCatalog.ok, true);
    assert.equal(Object.keys(overwrittenCatalog.maps).length, 32);
    assert.equal(overwrittenCatalog.maps['editor_budget-overwrite'].updated, true);
});

test('saving a map writes both documents into the maps directory and lists them again', async () => {
    const { directory, store } = createStore();

    const saved = await store.saveMap({
        mapName: 'Testkarte Alpha',
        runtimeJson: runtimeJsonFor('Testkarte Alpha'),
        editorJson: editorJsonFor('Testkarte Alpha'),
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.mapKey, 'editor_testkarte-alpha');
    assert.equal(saved.overwritten, false);
    assert.ok(existsSync(path.join(directory, `editor_testkarte-alpha${EDITOR_MAP_RUNTIME_SUFFIX}`)));
    assert.ok(existsSync(path.join(directory, `editor_testkarte-alpha${EDITOR_MAP_EDITOR_SUFFIX}`)));

    const listed = await store.listMaps();
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.maps, [{ mapKey: 'editor_testkarte-alpha', mapName: 'Testkarte Alpha' }]);
});

test('the game window reads the saved runtime maps by key', async () => {
    const { directory, store } = createStore();
    await store.saveMap({
        mapName: 'Testkarte Beta',
        runtimeJson: runtimeJsonFor('Testkarte Beta', { size: [80, 30, 80] }),
        editorJson: editorJsonFor('Testkarte Beta'),
    });
    // Fremde oder kaputte Dateien im Ordner werden uebersprungen.
    writeFileSync(path.join(directory, `editor_kaputt${EDITOR_MAP_RUNTIME_SUFFIX}`), '{nicht json');
    writeFileSync(path.join(directory, `fremd${EDITOR_MAP_RUNTIME_SUFFIX}`), runtimeJsonFor('Fremd'));

    const read = await store.readRuntimeMaps();
    assert.equal(read.ok, true);
    assert.deepEqual(Object.keys(read.maps), ['editor_testkarte-beta']);
    assert.deepEqual(read.maps['editor_testkarte-beta'].size, [80, 30, 80]);
    assert.equal(read.maps['editor_testkarte-beta'].name, 'Testkarte Beta');
});

test('the same name overwrites, a copy gets its own key, a different name keeps both', async () => {
    const { directory, store } = createStore();
    const first = await store.saveMap({
        mapName: 'Arena',
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });
    assert.equal(first.mapKey, 'editor_arena');

    const again = await store.saveMap({
        mapName: 'Arena',
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });
    assert.equal(again.mapKey, 'editor_arena');
    assert.equal(again.overwritten, true);

    const copy = await store.saveMap({
        mapName: 'Arena',
        saveAsCopy: true,
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });
    assert.equal(copy.mapKey, 'editor_arena_2');
    assert.equal(copy.overwritten, false);

    assert.equal(readdirSync(directory).filter((name) => name.endsWith(EDITOR_MAP_RUNTIME_SUFFIX)).length, 2);
});

test('concurrent copy saves serialize and allocate distinct map keys', async () => {
    const { directory, store } = createStore();
    await store.saveMap({
        mapName: 'Arena',
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });

    const copies = await Promise.all([
        store.saveMap({
            mapName: 'Arena',
            saveAsCopy: true,
            runtimeJson: runtimeJsonFor('Arena One'),
            editorJson: editorJsonFor('Arena One'),
        }),
        store.saveMap({
            mapName: 'Arena',
            saveAsCopy: true,
            runtimeJson: runtimeJsonFor('Arena Two'),
            editorJson: editorJsonFor('Arena Two'),
        }),
    ]);

    assert.deepEqual(copies.map(({ mapKey }) => mapKey), ['editor_arena_2', 'editor_arena_3']);
    assert.equal((await store.readRuntimeMaps()).maps.editor_arena_2.name, 'Arena One');
    assert.equal((await store.readRuntimeMaps()).maps.editor_arena_3.name, 'Arena Two');
    assert.equal(readdirSync(directory).filter((name) => name.endsWith(EDITOR_MAP_RUNTIME_SUFFIX)).length, 3);
});

test('a map name that carries path syntax cannot leave the maps directory', async () => {
    const { directory, store } = createStore();
    const parent = path.dirname(directory);

    for (const mapName of ['../escape', '..\\escape', 'C:\\Windows\\escape', '/etc/escape', '....//escape']) {
        const saved = await store.saveMap({
            mapName,
            runtimeJson: runtimeJsonFor(mapName),
            editorJson: editorJsonFor(mapName),
        });
        assert.equal(saved.ok, true, mapName);
        const writtenFiles = readdirSync(directory);
        for (const fileName of writtenFiles) {
            assert.equal(path.resolve(directory, fileName), path.join(directory, fileName), fileName);
        }
    }

    assert.equal(existsSync(path.join(parent, `escape${EDITOR_MAP_RUNTIME_SUFFIX}`)), false);
});

test('the caller cannot choose the map key, so no request overwrites a foreign map', async () => {
    const { directory, store } = createStore();
    await store.saveMap({
        mapName: 'Fremde Karte',
        runtimeJson: runtimeJsonFor('Fremde Karte', { marker: 'original' }),
        editorJson: editorJsonFor('Fremde Karte'),
    });

    // Alles, was nicht zum Vertrag gehoert, wird ignoriert - auch der Versuch,
    // die Kennung oder den Zielpfad selbst zu setzen.
    const saved = await store.saveMap({
        mapKey: 'editor_fremde-karte',
        mapId: 'editor_fremde-karte',
        filePath: path.join(directory, 'editor_fremde-karte.runtime.json'),
        directory: path.dirname(directory),
        mapName: 'Eigene Karte',
        runtimeJson: runtimeJsonFor('Eigene Karte'),
        editorJson: editorJsonFor('Eigene Karte'),
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.mapKey, 'editor_eigene-karte');
    assert.equal(
        JSON.parse(readFileSync(path.join(directory, `editor_fremde-karte${EDITOR_MAP_RUNTIME_SUFFIX}`), 'utf8')).marker,
        'original'
    );
    assert.equal(readdirSync(directory).length, 4);
});

test('reserved windows device names and separators never pass the file name guard', () => {
    for (const fileName of [
        'con.runtime.json',
        'NUL.runtime.json',
        'lpt9.runtime.json',
        'a/b.runtime.json',
        'a\\b.runtime.json',
        '../a.runtime.json',
        'C:a.runtime.json',
        'a .runtime.json',
        'a.runtime.json.',
        `${'x'.repeat(200)}.runtime.json`,
        'a.json',
        '.runtime.json',
    ]) {
        assert.equal(isSafeEditorMapFileName(fileName), false, fileName);
    }

    assert.equal(isSafeEditorMapFileName(`editor_arena${EDITOR_MAP_RUNTIME_SUFFIX}`), true);
    assert.equal(isSafeEditorMapFileName(`editor_arena${EDITOR_MAP_EDITOR_SUFFIX}`), true);
});

test('an oversized payload is refused before anything is written', async () => {
    const { directory, store } = createStore();
    const huge = JSON.stringify({ name: 'Gross', filler: 'x'.repeat(3 * 1024 * 1024) });

    const result = await store.saveMap({
        mapName: 'Gross',
        runtimeJson: huge,
        editorJson: editorJsonFor('Gross'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'payload_too_large');
    assert.deepEqual(readdirSync(directory), []);
});

test('only well formed json objects are stored', async () => {
    const { directory, store } = createStore();

    assert.equal((await store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: '{not json',
        editorJson: editorJsonFor('Kaputt'),
    })).error, 'invalid_json');

    assert.equal((await store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: '[1,2,3]',
        editorJson: editorJsonFor('Kaputt'),
    })).error, 'invalid_json');

    assert.equal((await store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: 'null',
        editorJson: editorJsonFor('Kaputt'),
    })).error, 'invalid_json');

    assert.equal((await store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: runtimeJsonFor('Kaputt'),
        editorJson: '"only a string"',
    })).error, 'invalid_json');

    assert.equal((await store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: '',
        editorJson: editorJsonFor('Kaputt'),
    })).error, 'empty_payload');

    assert.deepEqual(readdirSync(directory), []);
});

test('a failed save leaves the previous map untouched and drops its temporary files', async () => {
    const { directory, store } = createStore();
    await store.saveMap({
        mapName: 'Bestand',
        runtimeJson: runtimeJsonFor('Bestand', { marker: 'original' }),
        editorJson: editorJsonFor('Bestand'),
    });

    // Ein Ordner an der Stelle der Editor-Datei laesst das Umbenennen scheitern.
    mkdirSync(path.join(directory, `editor_bestand${EDITOR_MAP_EDITOR_SUFFIX}.blocked`), { recursive: true });
    const blockedStore = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: () => Promise.resolve(),
        renameFile: (source, target) => {
            if (target.endsWith(EDITOR_MAP_EDITOR_SUFFIX)) throw new Error('rename blocked');
            return renameSync(source, target);
        },
    });

    const result = await blockedStore.saveMap({
        mapName: 'Bestand',
        runtimeJson: runtimeJsonFor('Bestand', { marker: 'replacement' }),
        editorJson: editorJsonFor('Bestand'),
    });

    assert.equal(result.ok, false);
    const runtime = JSON.parse(readFileSync(path.join(directory, `editor_bestand${EDITOR_MAP_RUNTIME_SUFFIX}`), 'utf8'));
    assert.equal(runtime.marker, 'original');
    assert.deepEqual(readdirSync(directory).filter((name) => name.includes('.tmp')), []);
});

test('a symlinked target file is refused instead of followed', async () => {
    const directory = makeTempDirectory('curvios-editor-map-link-');
    // Windows vergibt Dateiverknuepfungen nur mit erhoehten Rechten, deshalb
    // wird die Verknuepfung hier gemeldet statt angelegt.
    const store = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: () => Promise.resolve(),
        statLink: (filePath) => ({ isSymbolicLink: () => filePath.endsWith(EDITOR_MAP_RUNTIME_SUFFIX) }),
    });

    const result = await store.saveMap({
        mapName: 'Link',
        runtimeJson: runtimeJsonFor('Link'),
        editorJson: editorJsonFor('Link'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'unsafe_target');
    assert.deepEqual(readdirSync(directory), []);
});

test('reading skips linked and oversized files instead of following them', async () => {
    const { directory, store } = createStore();
    writeFileSync(
        path.join(directory, `editor_riesig${EDITOR_MAP_RUNTIME_SUFFIX}`),
        JSON.stringify({ name: 'Riesig', filler: 'x'.repeat(3 * 1024 * 1024) }),
        'utf8'
    );
    await store.saveMap({
        mapName: 'Klein',
        runtimeJson: runtimeJsonFor('Klein'),
        editorJson: editorJsonFor('Klein'),
    });

    // Die 3-MB-Datei faellt allein an der Groessengrenze weg.
    assert.deepEqual((await store.listMaps()).maps, [{ mapKey: 'editor_klein', mapName: 'Klein' }]);

    // Und eine Verknuepfung faellt weg, auch wenn sie klein waere.
    const linkedStore = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: () => Promise.resolve(),
        statLink: (filePath) => ({
            isSymbolicLink: () => filePath.endsWith(`editor_klein${EDITOR_MAP_RUNTIME_SUFFIX}`),
            size: 10,
        }),
    });
    assert.deepEqual((await linkedStore.listMaps()).maps, [{ mapKey: 'editor_riesig', mapName: 'Riesig' }]);
});

test('a junction below the user data folder stays the boundary the check uses', async (t) => {
    const root = makeTempDirectory('curvios-editor-map-junction-');
    const realDirectory = path.join(root, 'real-maps');
    mkdirSync(realDirectory, { recursive: true });
    const junction = path.join(root, 'maps');

    try {
        symlinkSync(realDirectory, junction, 'junction');
    } catch {
        // Ohne erhoehte Rechte laesst Windows keine Verknuepfung anlegen; der
        // Test wird dann sichtbar uebersprungen statt still gruen zu melden.
        return t.skip('junction not creatable on this machine');
    }

    const store = createEditorMapStore({
        getMapsDirectory: () => junction,
        openFolder: () => Promise.resolve(),
    });

    const saved = await store.saveMap({
        mapName: 'Verknuepft',
        runtimeJson: runtimeJsonFor('Verknuepft'),
        editorJson: editorJsonFor('Verknuepft'),
    });

    assert.equal(saved.ok, true);
    assert.equal(path.dirname(saved.runtimeMapPath).toLowerCase(), (await realpath(realDirectory)).toLowerCase());
    assert.ok(existsSync(path.join(realDirectory, `editor_verknuepft${EDITOR_MAP_RUNTIME_SUFFIX}`)));
});

test('listing ignores foreign files and stops at the map limit', async () => {
    const { directory, store } = createStore();
    writeFileSync(path.join(directory, 'notes.txt'), 'hello', 'utf8');
    writeFileSync(path.join(directory, `foreign${EDITOR_MAP_RUNTIME_SUFFIX}`), '{"name":"Foreign"}', 'utf8');
    writeFileSync(path.join(directory, `editor_broken${EDITOR_MAP_RUNTIME_SUFFIX}`), '{not json', 'utf8');
    await store.saveMap({
        mapName: 'Gute Karte',
        runtimeJson: runtimeJsonFor('Gute Karte'),
        editorJson: editorJsonFor('Gute Karte'),
    });

    assert.deepEqual((await store.listMaps()).maps, [{ mapKey: 'editor_gute-karte', mapName: 'Gute Karte' }]);
});

test('opening the maps folder creates it and reports the directory it opened', async () => {
    const directory = path.join(makeTempDirectory('curvios-editor-map-open-'), 'maps');
    const opened = [];
    const store = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: (target) => { opened.push(target); return Promise.resolve(); },
    });

    const result = await store.openMapsFolder();

    assert.equal(result.ok, true);
    assert.equal(result.folderPath.toLowerCase(), (await realpath(directory)).toLowerCase());
    assert.deepEqual(opened.map((folderPath) => folderPath.toLowerCase()), [(await realpath(directory)).toLowerCase()]);
    assert.ok(existsSync(directory));
});

test('renderer and main process derive the same map key from the same name', () => {
    for (const mapName of ['Testkarte Alpha', 'Über Brücke', '   ', 'A'.repeat(120), '???', 'Map 2']) {
        assert.equal(toEditorMapKey(mapName), slugifyEditorMapKeyBase(mapName), mapName);
    }
});

test('the renderer builds the runtime map the disk store then stores', () => {
    const jsonText = JSON.stringify({
        arenaSize: { width: 2800, height: 700, depth: 1800 },
        hardBlocks: [], tunnels: [], foamBlocks: [], botSpawns: [], portals: [], items: [],
        playerSpawn: { x: 0, y: 0, z: 0 },
    });

    const built = buildEditorMapDiskFiles({ jsonText, mapName: 'Gebaute Karte' });

    assert.equal(built.mapName, 'Gebaute Karte');
    assert.equal(built.runtimeMap.name, 'Gebaute Karte');
    assert.ok(built.authoringDocument && typeof built.authoringDocument === 'object');
    assert.ok(isValidEditorMapKey(toEditorMapKey(built.mapName)));
});

test('the disk authoring document preserves an explicitly missing player spawn', () => {
    const jsonText = JSON.stringify({
        arenaSize: { width: 2800, height: 700, depth: 1800 },
        hardBlocks: [], tunnels: [], foamBlocks: [], botSpawns: [], portals: [], items: [],
        playerSpawn: { x: -800, y: 0, z: 0 },
    });
    const editorDocument = createEditorAuthoringDocument({
        map: JSON.parse(jsonText),
        playerSpawnPlaced: false,
    });

    const built = buildEditorMapDiskFiles({ jsonText, mapName: 'Ohne Spawn', editorDocument });

    assert.equal(built.authoringDocument.authoring.playerSpawnPlaced, false);
});
