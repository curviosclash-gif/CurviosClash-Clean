import { test, expect } from './helpers.desktop.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { resolveAppUrl } from './helpers.js';

async function openEditorWithSelectedBlock(page) {
    await page.goto(resolveAppUrl(page, EDITOR_VIEW_PATHS.MAP_EDITOR));
    await page.waitForFunction(() => !!window.CURVIOS_EDITOR?.mapManager);
    return page.evaluate(() => {
        const editor = window.CURVIOS_EDITOR;
        const object = editor.mapManager.createMesh('hard', null, 0, 100, 0, 100, {
            sizeX: 100,
            sizeY: 100,
            sizeZ: 100,
        });
        editor.ui.selectObject(object);
        return object.userData.id;
    });
}

// Waits for rendered editor frames instead of wall time: each frame runs one flight step.
const waitForFrames = (page, count) => page.evaluate((frames) => new Promise((resolve) => {
    let seen = 0;
    const tick = () => {
        seen += 1;
        if (seen >= frames) resolve();
        else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}), count);

const readFlight = (page) => page.evaluate(() => {
    const editor = window.CURVIOS_EDITOR;
    const camera = editor.core.camera;
    return {
        active: editor.ui.isShipFlightActive(),
        hudHidden: document.getElementById('shipFlightHud').hidden,
        position: camera.position.toArray(),
        forward: camera.getWorldDirection(camera.position.clone()).toArray(),
        orbitEnabled: editor.core.orbit.enabled,
        transformMode: editor.core.transformControl.mode,
        attachedId: editor.core.transformControl.object?.userData?.id || null,
    };
});

test('Schiffsflug: G startet, das Schiff fliegt vorwaerts, Leertaste schwebt, Esc landet mit Auswahl', async ({ page }) => {
    const selectedId = await openEditorWithSelectedBlock(page);
    await page.locator('#threeCanvas').hover();

    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await readFlight(page)).active).toBe(true);
    const start = await readFlight(page);
    expect(start.hudHidden).toBe(false);
    expect(start.orbitEnabled).toBe(false);

    // The ship always flies forward, like in a match.
    await expect.poll(async () => {
        const now = await readFlight(page);
        const moved = now.position.map((value, index) => value - start.position[index]);
        return moved.reduce((sum, value, index) => sum + value * start.forward[index], 0);
    }).toBeGreaterThan(50);

    // Holding Space hovers: the ship stays where it is.
    await page.keyboard.down('Space');
    await waitForFrames(page, 3);
    const hoverStart = await readFlight(page);
    await waitForFrames(page, 20);
    const hoverEnd = await readFlight(page);
    expect(Math.hypot(...hoverEnd.position.map((value, index) => value - hoverStart.position[index]))).toBeLessThan(1);

    // S steers the ship and must not switch the gizmo to scale.
    await page.keyboard.press('KeyS');
    await page.keyboard.up('Space');
    expect((await readFlight(page)).transformMode).toBe('translate');

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await readFlight(page)).active).toBe(false);
    const landed = await readFlight(page);
    expect(landed.hudHidden).toBe(true);
    expect(landed.orbitEnabled).toBe(true);
    expect(landed.attachedId).toBe(selectedId);

    // After landing the editor shortcuts are back.
    await page.keyboard.press('KeyS');
    await expect.poll(async () => (await readFlight(page)).transformMode).toBe('scale');
});

test('Schiffsflug: G in einem Eingabefeld startet keinen Flug', async ({ page }) => {
    await openEditorWithSelectedBlock(page);
    await page.locator('[data-editor-tab="map"]').click();
    await page.locator('#numGrid').focus();
    await page.keyboard.press('KeyG');
    await waitForFrames(page, 5);
    expect((await readFlight(page)).active).toBe(false);
});
