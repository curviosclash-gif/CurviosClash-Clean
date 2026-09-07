import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { test, expect } from './helpers.desktop.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('editor window saves drafts with confirmed downloads and transforms groups', async ({ page, electronApp }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'curvios-editor-draft-'));
    await electronApp.evaluate(({ app }, downloads) => app.setPath('downloads', downloads), directory);
    const popupPromise = page.waitForEvent('popup');
    await page.evaluate((editorPath) => window.open(editorPath, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
    const editorPage = await popupPromise;
    try {
        await editorPage.waitForFunction(() => window.CURVIOS_EDITOR?.ui && window.__CURVIOS_EDITOR_DISK__);
        await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            ui.executeHistoryMutation('Create draft', () => {
                mapManager.createMesh('hard', null, -100, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100, groupId: 'test' });
                mapManager.createMesh('item', 'item_rocket', 100, 100, 0, 0, { groupId: 'test' });
            });
        }, EDITOR_VIEW_PATHS.MAP_EDITOR);
        await editorPage.locator('#btnSaveToGame').click();
        await expect(editorPage.locator('#btnExportConfirm')).toBeDisabled();
        await editorPage.locator('#exportTarget').selectOption('project');
        await editorPage.locator('#exportMapName').fill('Unfinished draft');
        await expect(editorPage.locator('#btnExportConfirm')).toBeEnabled();
        await editorPage.locator('#btnExportConfirm').click();
        await expect(editorPage.locator('#exportResultSummary')).toContainText('gespeichert');
        await expect(editorPage.locator('#dirtyStateBadge')).toHaveText('Gespeichert');
        const document = JSON.parse(await readFile(path.join(directory, 'unfinished-draft.curvios-map.json'), 'utf8'));
        expect(document.authoring.playerSpawnPlaced).toBe(false);
        await editorPage.locator('#btnExportClose').click();
        await editorPage.evaluate((saved) => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            const parsed = ui.resolveEditorImportText(JSON.stringify(saved));
            mapManager.importFromJSON(parsed.jsonText);
            ui.applyEditorImportState(parsed);
            ui.toggleMarkedObject(mapManager.core.objectsContainer.children.find((object) => object.userData.type === 'hard'));
        }, document);
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.core.objectsContainer.children.filter((object) => object.userData.type === 'spawn').length)).toBe(0);
        await editorPage.locator('#btnTransformMarked').click();
        await editorPage.locator('[data-transform-fields] [name=scale]').fill('2');
        await editorPage.locator('#btnEditorModalConfirm').click();
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.core.objectsContainer.children.map((object) => object.position.x))).toEqual([-200, 200]);
        await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.undo());
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.core.objectsContainer.children.map((object) => object.position.x))).toEqual([-100, 100]);

        // Delayed completion must acknowledge exactly the exported revision.
        await electronApp.evaluate(({ BrowserWindow }, editorPath) => {
            const window = BrowserWindow.getAllWindows().find((entry) => new URL(entry.webContents.getURL()).pathname === editorPath);
            const session = window.webContents.session;
            session.once('will-download', (_event, item, webContents) => {
                const originalSend = webContents.send.bind(webContents);
                webContents.send = (channel, ...args) => {
                    if (channel === 'editor-download:completed') {
                        setTimeout(() => originalSend(channel, ...args), 1200);
                        webContents.send = originalSend;
                    } else originalSend(channel, ...args);
                };
            });
        }, EDITOR_VIEW_PATHS.MAP_EDITOR);
        await editorPage.locator('#btnSaveToGame').click();
        await editorPage.locator('#exportTarget').selectOption('project');
        await editorPage.locator('#btnExportConfirm').click();
        await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            ui.executeHistoryMutation('Edit during download', () => {
                const block = mapManager.core.objectsContainer.children.find((object) => object.userData.type === 'hard');
                block.position.x += 40;
                mapManager.notifyObjectMutated(block);
            });
        });
        await expect(editorPage.locator('#exportResultView')).toBeVisible();
        await expect(editorPage.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        expect(await editorPage.evaluate(() => !!localStorage.getItem('curviosclash.editor.autosave.v1'))).toBe(true);
        await editorPage.locator('#btnExportClose').click();

        await electronApp.evaluate(({ BrowserWindow }, editorPath) => {
            const window = BrowserWindow.getAllWindows().find((entry) => new URL(entry.webContents.getURL()).pathname === editorPath);
            window.webContents.session.once('will-download', (_event, item) => item.cancel());
        }, EDITOR_VIEW_PATHS.MAP_EDITOR);
        await editorPage.locator('#btnSaveToGame').click();
        await editorPage.locator('#exportTarget').selectOption('project');
        await editorPage.locator('#btnExportConfirm').click();
        await expect(editorPage.locator('#exportConflictNotice')).toContainText('abgebrochen');
        await expect(editorPage.locator('#dirtyStateBadge')).toHaveText('Ungespeichert');
        expect(await editorPage.evaluate(() => !!localStorage.getItem('curviosclash.editor.autosave.v1'))).toBe(true);
    } finally {
        if (!editorPage.isClosed()) {
            await editorPage.evaluate(() => window.CURVIOS_EDITOR?.ui?.markSaved());
            await editorPage.close();
        }
    }
});
