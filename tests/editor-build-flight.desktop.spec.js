import { mkdir } from 'node:fs/promises';
import { test, expect } from './helpers.desktop.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

test('Bauflug: Enter, Bewegen, Undo, Weltpause und echter Solo-Test bleiben isoliert', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const popupPromise = page.waitForEvent('popup');
    await page.evaluate((url) => window.open(url, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
    const editorPage = await popupPromise;
    const errors = [];
    editorPage.on('pageerror', (error) => errors.push(error.message));
    try {
        await editorPage.waitForFunction(() => window.CURVIOS_EDITOR?.ui?.buildFlight);
        await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            mapManager.clearAllObjects();
            mapManager.createMesh('spawn', 'player', 0, 500, 0, 0, {});
            ui.activateBuildCatalogEntry('build-hard');
        });
        await editorPage.locator('#btnShipFlight').click();
        await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return f.mode === 'build' && !f.loading; });
        const initial = await editorPage.evaluate(() => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            return { count: window.CURVIOS_EDITOR.mapManager.getObjectCount(), firstPerson: f.firstPerson,
                trail: f.runtime.session, radius: f.preview.getRadius(), units: f.units };
        });
        expect(initial.firstPerson).toBe(false);
        expect(initial.trail).toBeNull();
        expect(initial.radius).toBeGreaterThan(0);
        await editorPage.locator('#editor-build-runtime').click();
        await editorPage.waitForFunction(() => document.pointerLockElement === document.getElementById('editor-build-runtime'));
        const movementStart = await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.pose.position.toArray());
        await editorPage.keyboard.down('KeyW');
        let flight;
        try {
            await editorPage.waitForFunction((start) => {
                const position = window.CURVIOS_EDITOR.ui.buildFlight.pose.position;
                return position.distanceTo({ x: start[0], y: start[1], z: start[2] }) > 1000;
            }, movementStart);
            flight = await editorPage.evaluate((start) => {
                const f = window.CURVIOS_EDITOR.ui.buildFlight;
                f.paused = true;
                const distance = f.pose.position.distanceTo({ x: start[0], y: start[1], z: start[2] });
                const geometries = f.runtime.renderer.renderer.info.memory.geometries;
                const trails = [];
                f.runtime.renderer.matchRoot.traverse((object) => { if (/trail/i.test(object.name)) trails.push(object.name); });
                window.dispatchEvent(new Event('blur'));
                const held = f.codes.size;
                const stopped = f.pose.position.clone();
                f.frame(1 / 60);
                const stayedStill = stopped.distanceTo(f.pose.position) === 0;
                const afterGeometries = f.runtime.renderer.renderer.info.memory.geometries;
                f.pose.position.fromArray(start);
                f.paused = false;
                return { distance, trails, geometries, afterGeometries, held, stopped: stayedStill };
            }, movementStart);
        } finally {
            await editorPage.keyboard.up('KeyW');
        }
        expect(flight.distance).toBeGreaterThan(1000);
        expect(flight.trails).toEqual([]);
        expect(flight.afterGeometries).toBe(flight.geometries);
        expect(flight.held).toBe(0);
        expect(flight.stopped).toBe(true);
        await editorPage.keyboard.press('Enter');
        await editorPage.waitForFunction((count) => window.CURVIOS_EDITOR.mapManager.getObjectCount() === count + 1,
            initial.count);
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.down('Enter');
        await editorPage.keyboard.down('Enter');
        await editorPage.keyboard.up('Enter');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(initial.count + 2);
        await editorPage.keyboard.press('Control+z');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.press('Control+y');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.press('KeyC');
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.firstPerson)).toBe(true);
        await editorPage.keyboard.press('KeyC');
        await editorPage.keyboard.press('KeyB');
        await expect(editorPage.getByRole('dialog', { name: 'Build-Menü' })).toBeVisible();
        const property = editorPage.locator('.editor-build-flight-properties-host input').first();
        await property.fill('45');
        await property.press('Enter');
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.mapManager.getObjectCount())).toBe(initial.count + 2);
        await editorPage.getByRole('button', { name: 'Schließen', exact: true }).click();
        // Select under the crosshair with a real right click, then use the visible move action.
        await editorPage.keyboard.press('Escape');
        await editorPage.locator('#editor-build-runtime').click({ button: 'right' });
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.selectedObject?.userData.type)).toBe('hard');
        const move = await editorPage.evaluate(() => {
            const { ui } = window.CURVIOS_EDITOR;
            const object = ui.selectedObject;
            const id = object.userData.id;
            const before = object.position.toArray();
            return { id, before };
        });
        await editorPage.keyboard.press('KeyB');
        await editorPage.getByRole('button', { name: 'Auswahl bewegen', exact: true }).click();
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        const movedPosition = await editorPage.evaluate((id) => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            ui.buildFlight.pose.position.set(350, 600, -350);
            ui.buildFlight.keyDown({ code: 'Enter', target: document.body, preventDefault() {}, stopImmediatePropagation() {} });
            return mapManager.getObjectById(id).position.toArray();
        }, move.id);
        expect(movedPosition).toEqual([350, 600, -350]);
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.keyboard.press('Control+z');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => window.CURVIOS_EDITOR.mapManager.getObjectById(id).position.toArray(), move.id)).toEqual(move.before);
        await editorPage.keyboard.press('Delete');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => !!window.CURVIOS_EDITOR.mapManager.getObjectById(id), move.id)).toBe(false);
        await editorPage.keyboard.press('Control+z');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => !!window.CURVIOS_EDITOR.mapManager.getObjectById(id), move.id)).toBe(true);
        await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.moveSelection());
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.pose.position.addScalar(100));
        await editorPage.keyboard.press('Escape');
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        expect(await editorPage.evaluate((id) => window.CURVIOS_EDITOR.mapManager.getObjectById(id).position.toArray(), move.id)).toEqual(move.before);
        await editorPage.keyboard.press('KeyP');
        const time = await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.runtime.worldTime);
        await editorPage.waitForFunction(async (before) => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            await new Promise(requestAnimationFrame);
            const first = f.runtime.worldTime;
            await new Promise(requestAnimationFrame);
            return f.paused && first === before && f.runtime.worldTime === first;
        }, time);
        const beforeTest = await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            return { json: mapManager.generateJSONExport(ui.getArenaSizeForExport()), position: ui.buildFlight.pose.position.toArray() };
        });
        await mkdir(testInfo.outputPath('evidence'), { recursive: true });
        await editorPage.screenshot({ path: testInfo.outputPath('evidence/build-third-person.png') });
        await editorPage.keyboard.press('F6');
        await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return f.mode === 'test' && !f.loading; });
        await expect(editorPage.getByRole('button', { name: 'Zum Bauflug', exact: true })).toBeVisible();
        const testFrame = await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.runtime.frameId);
        await editorPage.waitForFunction((previousFrame) => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            return f.mode === 'test' && !f.loading && f.runtime?.session?.entityManager?.players.length === 1
                && f.runtime.frameId > previousFrame;
        }, testFrame);
        const testState = await editorPage.evaluate(() => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            return { players: f.runtime.session.entityManager.players.length, camera: f.runtime.renderer.cameras[0].position.length() };
        });
        expect(testState.players).toBe(1);
        expect(testState.camera).toBeGreaterThan(1);
        await editorPage.screenshot({ path: testInfo.outputPath('evidence/ship-test.png') });
        await editorPage.keyboard.press('Escape');
        await editorPage.getByRole('button', { name: 'Zum Bauflug', exact: true }).click();
        await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return f.mode === 'build' && !f.loading; });
        const afterTest = await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            return { json: mapManager.generateJSONExport(ui.getArenaSizeForExport()), position: ui.buildFlight.pose.position.toArray(), paused: ui.buildFlight.paused };
        });
        expect(afterTest.json).toBe(beforeTest.json);
        expect(afterTest.position).toEqual(beforeTest.position);
        expect(afterTest.paused).toBe(true);
        await editorPage.keyboard.press('Escape');
        await editorPage.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }).click();
        await expect(editorPage.locator('#editor-build-runtime')).toBeHidden();
        await editorPage.evaluate(async () => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            await f.pending;
            window.CURVIOS_EDITOR.ui.enableGameView();
            f.start(); f.stop(); f.start();
        });
        await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return !f.loading && f.mode === 'build'; });
        await editorPage.keyboard.press('Escape');
        await editorPage.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }).click();
        await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.pending);
        expect(await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.isGameViewActive())).toBe(true);
        for (let index = 0; index < 3; index += 1) {
            await editorPage.locator('#btnShipFlight').click();
            await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return !f.loading && f.mode === 'build'; });
            await editorPage.keyboard.press('Escape');
            await editorPage.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }).click();
            await editorPage.evaluate(() => window.CURVIOS_EDITOR.ui.buildFlight.pending);
            expect(await editorPage.evaluate(() => ({ canvases: document.querySelectorAll('#editor-build-runtime').length,
                runtime: window.CURVIOS_EDITOR.ui.buildFlight.runtime, hook: window.CURVIOS_EDITOR.core.externalRenderHook })))
                .toEqual({ canvases: 1, runtime: null, hook: null });
        }
        expect(errors).toEqual([]);
    } finally {
        await editorPage.evaluate(() => { window.CURVIOS_EDITOR?.ui?.buildFlight.stop(); window.CURVIOS_EDITOR?.ui?.markSaved?.(); });
        await editorPage.close();
    }
});

for (const scenario of [
    { name: 'animated-glb', document: { glbModel: 'assets/maps/storm_lighthouse_siege/glb/30_lighthouse_lift.glb', glbColliderMode: 'dynamic' } },
    { name: 'water-fog', document: { waterZone: { bounds: { min: [-1400, 0, -1200], max: [1400, 950, 1200] },
        reservoirBounds: { min: [-1400, 0, -1200], max: [1400, 350, 500] }, startLevel: 200, targetLevel: 350 },
        lighting: { fog: { color: 0x225577, skyBlend: 0, near: 15, far: 90, height: 15 } } } },
]) {
    test(`Spielweltvergleich: ${scenario.name}`, async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const popupPromise = page.waitForEvent('popup');
        await page.evaluate((url) => window.open(url, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
        const editorPage = await popupPromise;
        const errors = [];
        editorPage.on('pageerror', (error) => errors.push(error.message));
        try {
            await editorPage.waitForFunction(() => window.CURVIOS_EDITOR?.ui?.buildFlight);
            await editorPage.evaluate((document) => {
                const { ui, mapManager } = window.CURVIOS_EDITOR;
                mapManager.importFromJSON(JSON.stringify({ schemaVersion: 4,
                    arenaSize: { width: 2800, height: 950, depth: 2400 },
                    playerSpawn: { x: 0, y: 500, z: 700 }, portalMode: 'authored', itemSpawnMode: 'authored',
                    ...document }));
                ui.currentTool = 'select';
                ui.core.orbit.target.set(0, 500, 700);
            }, scenario.document);
            await editorPage.locator('#btnShipFlight').click();
            await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return !f.loading || f.mode === 'edit'; });
            expect(await editorPage.evaluate(() => {
                const f = window.CURVIOS_EDITOR.ui.buildFlight; return { mode: f.mode, error: f.lastError };
            })).toEqual({ mode: 'build', error: null });
            const build = await editorPage.evaluate(() => {
                const f = window.CURVIOS_EDITOR.ui.buildFlight;
                f.paused = true;
                return { appearance: f.runtime.renderer.getSceneAppearance(), models: f.runtime.arena.getMapAssetLoadState().modelCount,
                    size: [f.runtime.arena.width, f.runtime.arena.height, f.runtime.arena.depth],
                    animationTracks: f.runtime.arena._glbAnimation.trackCount,
                    water: !!f.runtime.water?.getZone(),
                    camera: { position: f.runtime.renderer.cameras[0].position.toArray(), quaternion: f.runtime.renderer.cameras[0].quaternion.toArray() } };
            });
            if (scenario.name === 'animated-glb') {
                expect(build.models).toBe(1);
                expect(build.animationTracks).toBeGreaterThan(0);
            } else expect(build.water).toBe(true);
            await mkdir(testInfo.outputPath('evidence'), { recursive: true });
            await editorPage.screenshot({ path: testInfo.outputPath(`evidence/${scenario.name}-build.png`) });
            await editorPage.keyboard.press('F6');
            await editorPage.waitForFunction(() => { const f = window.CURVIOS_EDITOR.ui.buildFlight; return f.mode === 'test' && !f.loading; });
            const match = await editorPage.evaluate((camera) => {
                const f = window.CURVIOS_EDITOR.ui.buildFlight;
                f.loading = true;
                f.runtime.renderer.cameras[0].position.fromArray(camera.position);
                f.runtime.renderer.cameras[0].quaternion.fromArray(camera.quaternion);
                f.runtime.renderer.render();
                return { appearance: f.runtime.renderer.getSceneAppearance(), models: f.runtime.arena.getMapAssetLoadState().modelCount,
                    size: [f.runtime.arena.width, f.runtime.arena.height, f.runtime.arena.depth],
                    water: !!f.runtime.session.entityManager._waterZoneSystem.getZone() };
            }, build.camera);
            expect(match.models).toBe(build.models);
            expect(match.size).toEqual(build.size);
            expect(match.appearance).toEqual(build.appearance);
            expect(match.water).toBe(build.water);
            await editorPage.screenshot({ path: testInfo.outputPath(`evidence/${scenario.name}-match.png`) });
            expect(errors).toEqual([]);
        } finally {
            await editorPage.evaluate(() => { window.CURVIOS_EDITOR?.ui?.buildFlight.stop(); window.CURVIOS_EDITOR?.ui?.markSaved?.(); });
            await editorPage.close();
        }
    });
}
