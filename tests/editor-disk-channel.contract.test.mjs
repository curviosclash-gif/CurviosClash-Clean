import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    EDITOR_API_ROUTES,
    EDITOR_DISK_ACTIONS,
    EDITOR_DISK_ACTION_BY_ROUTE,
    EDITOR_DISK_IPC_CHANNEL,
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
    const vehicleRoutes = [
        EDITOR_API_ROUTES.SAVE_VEHICLE_DISK,
        EDITOR_API_ROUTES.LIST_VEHICLES_DISK,
        EDITOR_API_ROUTES.GET_VEHICLE_DISK,
        EDITOR_API_ROUTES.RENAME_VEHICLE_DISK,
        EDITOR_API_ROUTES.DELETE_VEHICLE_DISK,
    ];
    for (const route of vehicleRoutes) {
        assert.ok(EDITOR_DISK_ACTION_BY_ROUTE[route], route);
    }
    // Kartenrouten sind bewusst noch nicht angeschlossen.
    assert.equal(EDITOR_DISK_ACTION_BY_ROUTE[EDITOR_API_ROUTES.SAVE_MAP_DISK], undefined);
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

test('the new electron files ship in the packaged app', () => {
    const packageJson = JSON.parse(readSource('../electron/package.json'));
    for (const fileName of ['editor-preload.cjs', 'editor-vehicle-store.cjs', 'editor-download-target.cjs']) {
        assert.ok(packageJson.build.files.includes(fileName), fileName);
    }
});
