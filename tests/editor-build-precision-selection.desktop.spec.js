import { test, expect } from './helpers.desktop.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

test('Bauflug: präzise Position, sichtbare Auswahl, Abbruch und Undo', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const popup = page.waitForEvent('popup');
    await page.evaluate((url) => window.open(url, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
    const editorPage = await popup;
    const errors = []; editorPage.on('pageerror', (error) => errors.push(error.message));
    try {
        await editorPage.waitForFunction(() => window.CURVIOS_EDITOR?.ui?.buildFlight);
        const original = await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            mapManager.clearAllObjects();
            mapManager.createMesh('spawn', 'player', 0, 500, 0, 0, {});
            const object = mapManager.createMesh('hard', '', 0, 400, 0, 0, { sizeX: 200, sizeY: 200, sizeZ: 200 });
            ui.selectObject(object); ui.activateBuildCatalogEntry('build-hard');
            return { id: object.userData.id, position: object.position.toArray(), count: mapManager.getObjectCount() };
        });
        await editorPage.locator('#btnShipFlight').click();
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.press('KeyB');
        await editorPage.getByRole('button', { name: 'Auswahl bewegen', exact: true }).click();
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.press('KeyB');
        const x = editorPage.getByRole('spinbutton', { name: 'Bauposition X', exact: true });
        await x.fill('12.3'); await x.press('Enter');
        await expect(x).toHaveValue('12.3');
        expect(await editorPage.evaluate((id) => window.CURVIOS_EDITOR.mapManager.getObjectById(id).position.x, original.id)).toBe(0);
        await editorPage.getByRole('checkbox', { name: 'Bauposition am Raster ausrichten' }).check();
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.pose.position.x)).toBe(12.3);
        await x.fill('74'); await x.press('Enter');
        await expect(x).toHaveValue('50');
        await editorPage.getByRole('checkbox', { name: 'Bauposition am Raster ausrichten' }).uncheck();
        await editorPage.getByRole('combobox', { name: 'Bau-Schrittweite' }).selectOption('0.1');
        await editorPage.screenshot({ path: testInfo.outputPath('precision-menu.png') });
        await editorPage.getByRole('button', { name: 'Schließen', exact: true }).click();
        await editorPage.keyboard.press('ArrowRight'); await editorPage.keyboard.press('PageUp');
        const preview = await editorPage.evaluate(() => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            return { position: f.position.toArray(), pose: f.pose.position.toArray(), generation: f.generation };
        });
        expect(preview.pose).toEqual([50.1, 400.1, 0]);
        await editorPage.keyboard.press('Enter');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => window.CURVIOS_EDITOR.mapManager.getObjectById(id).position.toArray(), original.id)).toEqual(preview.pose);
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(original.count);
        await editorPage.keyboard.press('Control+z');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => window.CURVIOS_EDITOR.mapManager.getObjectById(id).position.toArray(), original.id)).toEqual(original.position);
        await editorPage.keyboard.press('Control+y');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.moveSelection());
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.press('ArrowLeft'); await editorPage.keyboard.press('Escape');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => window.CURVIOS_EDITOR.mapManager.getObjectById(id).position.toArray(), original.id)).toEqual(preview.pose);
        // Freeze the normal scheduler for deterministic crosshair captures; use the actual runtime camera and real pointer event.
        await editorPage.evaluate(() => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            f.core.externalRenderHook = () => true;
            f.preview.root.visible = false;
            const camera = f.runtime.renderer.cameras[0];
            camera.position.set(50.1 / f.units, 400.1 / f.units, 500 / f.units);
            camera.lookAt(50.1 / f.units, 400.1 / f.units, 0); camera.updateMatrixWorld();
            f.target = f.pickCrosshair(); f.ui.setTarget(f.target);
            f.selectionVisuals.show(f.selectionVisuals.hover, f.target, f.units);
            f.runtime.renderer.render();
        });
        await expect(editorPage.locator('.editor-build-flight-target')).toContainText(original.id);
        await editorPage.locator('#editor-build-runtime').click({ button: 'right' });
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.selectedObject.userData.id)).toBe(original.id);
        await editorPage.screenshot({ path: testInfo.outputPath('visible-selection.png') });
        await editorPage.evaluate(() => {
            const { ui } = window.CURVIOS_EDITOR; ui.selectedObject.userData.editorLocked = true;
            ui.buildFlight.target = ui.buildFlight.pickCrosshair(); ui.buildFlight.ui.setTarget(ui.buildFlight.target);
        });
        await expect(editorPage.locator('.editor-build-flight-target')).toContainText('Gesperrt');
        await editorPage.evaluate(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; f.stop(); });
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.tearingDown);
        expect(errors).toEqual([]);
    } finally { await editorPage.close(); }
});
