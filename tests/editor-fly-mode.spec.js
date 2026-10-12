import { test, expect } from './helpers.desktop.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';
import { resolveAppUrl } from './helpers.js';

async function openEditorWithSelectedBlock(page) {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
    await page.goto(resolveAppUrl(page, EDITOR_VIEW_PATHS.MAP_EDITOR));
    try {
        await page.waitForFunction(() => !!window.CURVIOS_EDITOR?.mapManager || !!window.CURVIOS_EDITOR_INIT_ERROR);
    } catch (error) {
        throw new Error(`Editor did not boot; page errors: ${pageErrors.join(' | ') || 'none'}`, { cause: error });
    }
    const initError = await page.evaluate(() => window.CURVIOS_EDITOR_INIT_ERROR || null);
    expect(initError, `editor init failed; page errors: ${pageErrors.join(' | ')}`).toBeNull();
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

// Waits for rendered editor frames instead of wall time.
const waitForFrames = (page, count) => page.evaluate((frames) => new Promise((resolve) => {
    let seen = 0;
    const tick = () => {
        seen += 1;
        if (seen >= frames) resolve();
        else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}), count);

const isBuildFlightActive = (page) => page.evaluate(() => window.CURVIOS_EDITOR.ui.isShipFlightActive());

const readLook = (page) => page.evaluate(() => {
    const core = window.CURVIOS_EDITOR.core;
    return {
        active: window.CURVIOS_EDITOR.ui.isGameViewActive(),
        toneMapping: core.renderer.toneMapping,
        fogFar: core.scene.fog.far,
        cameraDistance: core.camera.position.length(),
        sky: !!core.scene.getObjectByName('scene-atmosphere-sky'),
        editorLightsVisible: core.editorLights.every((light) => light.visible),
        hardOpacity: window.CURVIOS_EDITOR.mapManager.mats.hard.opacity,
        drawCalls: core.renderer.info.render.calls,
    };
});

test('Spielansicht: Licht, Himmel und Nebel wie im Spiel, danach wieder die Bauansicht', async ({ page }, testInfo) => {
    await openEditorWithSelectedBlock(page);
    const shaderErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error' && /shader|program|webgl/i.test(message.text())) shaderErrors.push(message.text());
    });
    const before = await readLook(page);
    expect(before.active).toBe(false);

    await page.locator('#btnGameView').click();
    await expect.poll(async () => (await readLook(page)).active).toBe(true);
    await waitForFrames(page, 10);
    const gameView = await readLook(page);
    expect(gameView.sky).toBe(true);
    expect(gameView.toneMapping).not.toBe(before.toneMapping);
    expect(gameView.editorLightsVisible).toBe(false);
    expect(gameView.hardOpacity).toBe(1);
    // The overview camera stands outside the match view distance; the arena must stay visible.
    expect(gameView.fogFar).toBeGreaterThan(gameView.cameraDistance);
    expect(gameView.drawCalls).toBeGreaterThan(0);
    await testInfo.attach('editor-game-view.png', { body: await page.screenshot(), contentType: 'image/png' });

    await page.locator('#btnGameView').click();
    await expect.poll(async () => (await readLook(page)).active).toBe(false);
    await waitForFrames(page, 5);
    const restored = await readLook(page);
    expect({ ...restored, drawCalls: 0, cameraDistance: 0 }).toEqual({ ...before, drawCalls: 0, cameraDistance: 0 });
    expect(shaderErrors).toEqual([]);
});

test('Kartenwelt: das Welt-Modell einer Karte erscheint in Spielgroesse statt als Ersatzkasten', async ({ page }) => {
    await openEditorWithSelectedBlock(page);
    // Riesen-Kinderzimmer: 120 map units wide, the editor converts maps of this size with 35.
    await page.evaluate(() => {
        window.CURVIOS_EDITOR.mapManager.importFromJSON(JSON.stringify({
            arenaSize: { width: 4200, height: 1400, depth: 4200 },
            glbModels: [{
                id: 'toybox-titan-world#world',
                url: 'assets/maps/toybox_titan/glb/toybox_titan.glb',
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: 35,
            }],
        }), {
            onArenaSize: (size) => {
                window.CURVIOS_EDITOR.ui.setArenaSizeInputs(size);
                window.CURVIOS_EDITOR.ui.syncArenaValues();
            },
        });
    });
    await expect.poll(() => page.evaluate(() => (
        window.CURVIOS_EDITOR.assetLoader.getLoadStatus('toybox-titan-world')?.state
    )), { timeout: 30_000 }).toBe('loaded');

    const world = await page.evaluate(() => {
        const editor = window.CURVIOS_EDITOR;
        const object = editor.core.objectsContainer.children.find((child) => child.userData.type === 'glb');
        // The loaded model is normalized to size 1, so its scale is its largest extent.
        return {
            placeholder: object.userData.isEditorPlaceholder === true,
            sourceSize: object.userData.glbSourceMaxDimension,
            extent: object.scale.x,
        };
    });
    expect(world.placeholder).toBe(false);
    expect(world.extent).toBeCloseTo(35 * world.sourceSize, 3);
    expect(world.extent).toBeGreaterThan(3000);
    expect(world.extent).toBeLessThan(6000);
});

test('Bauflug: G in einem Eingabefeld startet keinen Flug, ausserhalb schon', async ({ page }) => {
    await openEditorWithSelectedBlock(page);
    await page.locator('[data-editor-tab="map"]').click();
    await page.locator('#numGrid').focus();
    await page.keyboard.press('KeyG');
    await waitForFrames(page, 5);
    expect(await isBuildFlightActive(page)).toBe(false);

    // Counter-check: the same key outside a field does start the build flight.
    await page.locator('#numGrid').blur();
    await page.keyboard.press('KeyG');
    try {
        await expect.poll(() => isBuildFlightActive(page)).toBe(true);
    } finally {
        await page.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight?.stop());
    }
});
