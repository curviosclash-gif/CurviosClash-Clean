import { test, expect } from '@playwright/test';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

test('Fly Mode behaelt das Transformationswerkzeug fuer ausgewaehlte Objekte', async ({ page }) => {
    await page.goto(EDITOR_VIEW_PATHS.MAP_EDITOR);
    await page.waitForFunction(() => !!window.CURVIOS_EDITOR?.mapManager);

    const firstId = await page.evaluate(() => {
        const editor = window.CURVIOS_EDITOR;
        const object = editor.mapManager.createMesh('hard', null, 0, 100, 0, 100, {
            sizeX: 100,
            sizeY: 100,
            sizeZ: 100,
        });
        editor.ui.selectObject(object);
        return object.userData.id;
    });

    await page.locator('[data-editor-tab="map"]').click();
    await page.locator('#chkFly').check();
    await expect.poll(() => page.evaluate(() => ({
        flyMode: window.CURVIOS_EDITOR.ui.flyModeEnabled,
        attachedId: window.CURVIOS_EDITOR.core.transformControl.object?.userData?.id,
    }))).toEqual({ flyMode: true, attachedId: firstId });

    const secondId = await page.evaluate(() => {
        const editor = window.CURVIOS_EDITOR;
        const object = editor.mapManager.createMesh('hard', null, 300, 100, 0, 100, {
            sizeX: 100,
            sizeY: 100,
            sizeZ: 100,
        });
        editor.ui.selectObject(object);
        return object.userData.id;
    });

    await expect.poll(() => page.evaluate(() => (
        window.CURVIOS_EDITOR.core.transformControl.object?.userData?.id
    ))).toBe(secondId);
});
