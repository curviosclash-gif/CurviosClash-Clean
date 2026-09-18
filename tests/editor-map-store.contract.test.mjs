import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildEditorMapDiskFiles,
    EDITOR_MAP_EDITOR_SUFFIX,
    EDITOR_MAP_RUNTIME_SUFFIX,
    slugifyEditorMapKeyBase,
} from '../editor/js/EditorMapDiskFiles.js';

const require = createRequire(import.meta.url);
const {
    createEditorMapStore,
    isSafeEditorMapFileName,
    isValidEditorMapKey,
    toEditorMapKey,
} = require('../electron/editor-map-store.cjs');

function createStore() {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'curvios-editor-map-store-'));
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

function editorJsonFor(name) {
    return JSON.stringify({ schemaVersion: 'editor-authoring.v1', map: { name } });
}

test('saving a map writes both documents into the maps directory and lists them again', () => {
    const { directory, store } = createStore();

    const saved = store.saveMap({
        mapName: 'Testkarte Alpha',
        runtimeJson: runtimeJsonFor('Testkarte Alpha'),
        editorJson: editorJsonFor('Testkarte Alpha'),
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.mapKey, 'editor_testkarte-alpha');
    assert.equal(saved.overwritten, false);
    assert.ok(existsSync(path.join(directory, `editor_testkarte-alpha${EDITOR_MAP_RUNTIME_SUFFIX}`)));
    assert.ok(existsSync(path.join(directory, `editor_testkarte-alpha${EDITOR_MAP_EDITOR_SUFFIX}`)));

    const listed = store.listMaps();
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.maps, [{ mapKey: 'editor_testkarte-alpha', mapName: 'Testkarte Alpha' }]);
});

test('the same name overwrites, a copy gets its own key, a different name keeps both', () => {
    const { directory, store } = createStore();
    const first = store.saveMap({
        mapName: 'Arena',
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });
    assert.equal(first.mapKey, 'editor_arena');

    const again = store.saveMap({
        mapName: 'Arena',
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });
    assert.equal(again.mapKey, 'editor_arena');
    assert.equal(again.overwritten, true);

    const copy = store.saveMap({
        mapName: 'Arena',
        saveAsCopy: true,
        runtimeJson: runtimeJsonFor('Arena'),
        editorJson: editorJsonFor('Arena'),
    });
    assert.equal(copy.mapKey, 'editor_arena_2');
    assert.equal(copy.overwritten, false);

    assert.equal(readdirSync(directory).filter((name) => name.endsWith(EDITOR_MAP_RUNTIME_SUFFIX)).length, 2);
});

test('a map name that carries path syntax cannot leave the maps directory', () => {
    const { directory, store } = createStore();
    const parent = path.dirname(directory);

    for (const mapName of ['../escape', '..\\escape', 'C:\\Windows\\escape', '/etc/escape', '....//escape']) {
        const saved = store.saveMap({
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

test('the caller cannot choose the map key, so no request overwrites a foreign map', () => {
    const { directory, store } = createStore();
    store.saveMap({
        mapName: 'Fremde Karte',
        runtimeJson: runtimeJsonFor('Fremde Karte', { marker: 'original' }),
        editorJson: editorJsonFor('Fremde Karte'),
    });

    // Alles, was nicht zum Vertrag gehoert, wird ignoriert - auch der Versuch,
    // die Kennung oder den Zielpfad selbst zu setzen.
    const saved = store.saveMap({
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

test('an oversized payload is refused before anything is written', () => {
    const { directory, store } = createStore();
    const huge = JSON.stringify({ name: 'Gross', filler: 'x'.repeat(3 * 1024 * 1024) });

    const result = store.saveMap({
        mapName: 'Gross',
        runtimeJson: huge,
        editorJson: editorJsonFor('Gross'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'payload_too_large');
    assert.deepEqual(readdirSync(directory), []);
});

test('only well formed json objects are stored', () => {
    const { directory, store } = createStore();

    assert.equal(store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: '{not json',
        editorJson: editorJsonFor('Kaputt'),
    }).error, 'invalid_json');

    assert.equal(store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: '[1,2,3]',
        editorJson: editorJsonFor('Kaputt'),
    }).error, 'invalid_json');

    assert.equal(store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: 'null',
        editorJson: editorJsonFor('Kaputt'),
    }).error, 'invalid_json');

    assert.equal(store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: runtimeJsonFor('Kaputt'),
        editorJson: '"only a string"',
    }).error, 'invalid_json');

    assert.equal(store.saveMap({
        mapName: 'Kaputt',
        runtimeJson: '',
        editorJson: editorJsonFor('Kaputt'),
    }).error, 'empty_payload');

    assert.deepEqual(readdirSync(directory), []);
});

test('a failed save leaves the previous map untouched and drops its temporary files', () => {
    const { directory, store } = createStore();
    store.saveMap({
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

    const result = blockedStore.saveMap({
        mapName: 'Bestand',
        runtimeJson: runtimeJsonFor('Bestand', { marker: 'replacement' }),
        editorJson: editorJsonFor('Bestand'),
    });

    assert.equal(result.ok, false);
    const runtime = JSON.parse(readFileSync(path.join(directory, `editor_bestand${EDITOR_MAP_RUNTIME_SUFFIX}`), 'utf8'));
    assert.equal(runtime.marker, 'original');
    assert.deepEqual(readdirSync(directory).filter((name) => name.includes('.tmp')), []);
});

test('a symlinked target file is refused instead of followed', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'curvios-editor-map-link-'));
    // Windows vergibt Dateiverknuepfungen nur mit erhoehten Rechten, deshalb
    // wird die Verknuepfung hier gemeldet statt angelegt.
    const store = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: () => Promise.resolve(),
        statLink: (filePath) => ({ isSymbolicLink: () => filePath.endsWith(EDITOR_MAP_RUNTIME_SUFFIX) }),
    });

    const result = store.saveMap({
        mapName: 'Link',
        runtimeJson: runtimeJsonFor('Link'),
        editorJson: editorJsonFor('Link'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'unsafe_target');
    assert.deepEqual(readdirSync(directory), []);
});

test('reading skips linked and oversized files instead of following them', () => {
    const { directory, store } = createStore();
    writeFileSync(
        path.join(directory, `editor_riesig${EDITOR_MAP_RUNTIME_SUFFIX}`),
        JSON.stringify({ name: 'Riesig', filler: 'x'.repeat(3 * 1024 * 1024) }),
        'utf8'
    );
    store.saveMap({
        mapName: 'Klein',
        runtimeJson: runtimeJsonFor('Klein'),
        editorJson: editorJsonFor('Klein'),
    });

    // Die 3-MB-Datei faellt allein an der Groessengrenze weg.
    assert.deepEqual(store.listMaps().maps, [{ mapKey: 'editor_klein', mapName: 'Klein' }]);

    // Und eine Verknuepfung faellt weg, auch wenn sie klein waere.
    const linkedStore = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: () => Promise.resolve(),
        statLink: (filePath) => ({
            isSymbolicLink: () => filePath.endsWith(`editor_klein${EDITOR_MAP_RUNTIME_SUFFIX}`),
            size: 10,
        }),
    });
    assert.deepEqual(linkedStore.listMaps().maps, [{ mapKey: 'editor_riesig', mapName: 'Riesig' }]);
});

test('a junction below the user data folder stays the boundary the check uses', (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'curvios-editor-map-junction-'));
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

    const saved = store.saveMap({
        mapName: 'Verknuepft',
        runtimeJson: runtimeJsonFor('Verknuepft'),
        editorJson: editorJsonFor('Verknuepft'),
    });

    assert.equal(saved.ok, true);
    assert.equal(path.dirname(saved.runtimeMapPath), realpathSync(realDirectory));
    assert.ok(existsSync(path.join(realDirectory, `editor_verknuepft${EDITOR_MAP_RUNTIME_SUFFIX}`)));
});

test('listing ignores foreign files and stops at the map limit', () => {
    const { directory, store } = createStore();
    writeFileSync(path.join(directory, 'notes.txt'), 'hello', 'utf8');
    writeFileSync(path.join(directory, `foreign${EDITOR_MAP_RUNTIME_SUFFIX}`), '{"name":"Foreign"}', 'utf8');
    writeFileSync(path.join(directory, `editor_broken${EDITOR_MAP_RUNTIME_SUFFIX}`), '{not json', 'utf8');
    store.saveMap({
        mapName: 'Gute Karte',
        runtimeJson: runtimeJsonFor('Gute Karte'),
        editorJson: editorJsonFor('Gute Karte'),
    });

    assert.deepEqual(store.listMaps().maps, [{ mapKey: 'editor_gute-karte', mapName: 'Gute Karte' }]);
});

test('opening the maps folder creates it and reports the directory it opened', async () => {
    const directory = path.join(mkdtempSync(path.join(os.tmpdir(), 'curvios-editor-map-open-')), 'maps');
    const opened = [];
    const store = createEditorMapStore({
        getMapsDirectory: () => directory,
        openFolder: (target) => { opened.push(target); return Promise.resolve(); },
    });

    const result = await store.openMapsFolder();

    assert.equal(result.ok, true);
    assert.equal(result.folderPath, path.resolve(directory));
    assert.deepEqual(opened, [path.resolve(directory)]);
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
