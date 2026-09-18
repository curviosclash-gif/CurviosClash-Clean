import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

import {
    EDITOR_API_ROUTES,
    EDITOR_DATA_PATHS,
    EDITOR_DISK_ACTIONS,
    EDITOR_DISK_ACTION_BY_ROUTE,
    EDITOR_DISK_IPC_CHANNEL,
    EDITOR_VIEW_PATHS,
} from '../src/shared/contracts/EditorPathContract.js';

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('all disk work travels over a single named channel', () => {
    const preload = readSource('../electron/editor-preload.cjs');
    const main = readSource('../electron/main.cjs');

    assert.ok(preload.includes(`'${EDITOR_DISK_IPC_CHANNEL}'`));
    assert.ok(main.includes(`ipcMain.handle('${EDITOR_DISK_IPC_CHANNEL}'`));

    // Ein Kanal, nicht fuenf: sonst waechst die IPC-Oberflaeche mit jeder
    // weiteren Dateiaktion.
    const editorChannels = [...main.matchAll(/ipcMain\.handle\('(editor-[^']+)'/g)];
    assert.equal(editorChannels.length, 1);
});

test('the main process accepts exactly the actions the contract names', () => {
    const main = readSource('../electron/main.cjs');
    const handlerBlock = main.slice(main.indexOf('EDITOR_DISK_HANDLERS'), main.indexOf('ipcMain.handle(\'editor-disk:request\''));
    const handled = [...handlerBlock.matchAll(/'([a-z-]+)':\s*\(/g)].map((match) => match[1]);

    assert.deepEqual(handled.sort(), Object.values(EDITOR_DISK_ACTIONS).sort());
});

test('the preload exposes one method per contract action and nothing else', () => {
    const preload = readSource('../electron/editor-preload.cjs');
    const requested = [...preload.matchAll(/request\('([a-z-]+)'/g)].map((match) => match[1]);

    assert.deepEqual(requested.sort(), Object.values(EDITOR_DISK_ACTIONS).sort());
});

test('every development HTTP route maps to a desktop action', () => {
    const authoringRoutes = [
        EDITOR_API_ROUTES.SAVE_MAP_DISK,
        EDITOR_API_ROUTES.LIST_MAPS_DISK,
        EDITOR_API_ROUTES.OPEN_MAPS_FOLDER,
        EDITOR_API_ROUTES.SAVE_VEHICLE_DISK,
        EDITOR_API_ROUTES.LIST_VEHICLES_DISK,
        EDITOR_API_ROUTES.GET_VEHICLE_DISK,
        EDITOR_API_ROUTES.RENAME_VEHICLE_DISK,
        EDITOR_API_ROUTES.DELETE_VEHICLE_DISK,
    ];
    for (const route of authoringRoutes) {
        assert.ok(EDITOR_DISK_ACTION_BY_ROUTE[route], route);
    }
    // Videoexport laeuft nicht ueber den Autoren-Kanal.
    assert.equal(EDITOR_DISK_ACTION_BY_ROUTE[EDITOR_API_ROUTES.SAVE_VIDEO_DISK], undefined);
});

test('the desktop map store writes below the user data folder, never into the project', () => {
    const main = readSource('../electron/main.cjs');
    assert.match(
        main,
        new RegExp(`getMapsDirectory: \\(\\) => path\\.join\\(app\\.getPath\\('userData'\\), '${EDITOR_DATA_PATHS.USER_MAPS_DIR}'\\)`)
    );
    assert.equal(main.includes(EDITOR_DATA_PATHS.MAPS_DIR), false);
});

test('an unknown action is refused instead of reaching the file system', () => {
    const main = readSource('../electron/main.cjs');
    assert.ok(main.includes("if (!handler) return { ok: false, error: 'unknown_action' };"));
});

test('the editor disk channel checks its sender like every other capability', () => {
    const main = readSource('../electron/main.cjs');
    assert.ok(main.includes(`ipcMain.handle('${EDITOR_DISK_IPC_CHANNEL}', withTrustedEditorWindowSender`));
    assert.ok(main.includes('isTrustedWindowSender(event, candidate)'));
    assert.ok(main.includes("editorWindow.on('closed', () => editorWindows.delete(editorWindow))"));
});

test('an editor window may not carry its bridge to a foreign page', () => {
    const main = readSource('../electron/main.cjs');

    // Erste Schranke: das Fenster darf gar nicht erst woanders hin navigieren.
    const windowBlock = main.slice(
        main.indexOf("mainWindow.webContents.on('did-create-window'"),
        main.indexOf('await mainWindow.loadURL')
    );
    assert.match(
        windowBlock,
        /editorWindow\.webContents\.on\('will-navigate',[\s\S]*?isTrustedEditorUrl\(url, appServer\.url\)[\s\S]*?event\.preventDefault\(\)/
    );

    // Zweite Schranke: der Kanal prueft zusaetzlich, wo der Absender steht.
    const guardBlock = main.slice(
        main.indexOf('function withTrustedEditorWindowSender'),
        main.indexOf('function withTrustedHangarWindowSender')
    );
    assert.match(guardBlock, /event\?\.senderFrame\?\.url/);
    assert.match(guardBlock, /!isTrustedEditorUrl\(senderFrameUrl, editorTrustBaseUrl\)/);
    assert.ok(main.includes('setEditorWindowTrustBase(appServer.url);'));
});

test('the editor url check refuses foreign origins, paths and protocols', () => {
    const { isTrustedEditorUrl: isTrusted } = require('../electron/window-security-options.cjs');
    const appServerUrl = 'http://127.0.0.1:5414/';

    const editorPath = EDITOR_VIEW_PATHS.MAP_EDITOR;

    assert.equal(isTrusted(`http://127.0.0.1:5414${editorPath}`, appServerUrl), true);
    assert.equal(isTrusted(`http://127.0.0.1:5414${editorPath}?returnFromPlaytest=1`, appServerUrl), true);
    for (const url of [
        `https://example.com${editorPath}`,
        `http://127.0.0.1:5415${editorPath}`,
        'http://127.0.0.1:5414/index.html',
        'http://127.0.0.1:5414/editor/map-editor.html',
        `file:///C:${editorPath}`,
        'about:blank',
        'javascript:alert(1)',
        '',
    ]) {
        assert.equal(isTrusted(url, appServerUrl), false, url);
    }
});

test('the new electron files ship in the packaged app', () => {
    const packageJson = JSON.parse(readSource('../electron/package.json'));
    for (const fileName of ['editor-preload.cjs', 'editor-vehicle-store.cjs', 'editor-map-store.cjs', 'editor-download-target.cjs']) {
        assert.ok(packageJson.build.files.includes(fileName), fileName);
    }
});
