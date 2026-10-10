import { test, expect } from './helpers.desktop.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

test('Bauflug wählt animierte GLB-Modelle und bewegte Pickups über stabile Editor-IDs', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const popup = page.waitForEvent('popup');
    await page.evaluate((url) => window.open(url, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
    const editorPage = await popup;
    try {
        await editorPage.waitForFunction(() => window.CURVIOS_EDITOR?.ui?.buildFlight);
        await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            mapManager.importFromJSON(JSON.stringify({ schemaVersion: 4,
                arenaSize: { width: 2800, height: 950, depth: 2400 },
                playerSpawn: { x: 0, y: 500, z: 700 }, portalMode: 'authored', itemSpawnMode: 'anchor-only',
                glbModels: [{ id: 'lift#glb-selection', url: 'assets/maps/storm_lighthouse_siege/glb/30_lighthouse_lift.glb',
                    position: [0, 300, 0], rotation: [0, 0, 0], targetSize: 400 }],
                items: [{ id: 'pickup-selection', type: 'SPEED_UP', x: 900, y: 500, z: 0 }] }));
            ui.currentTool = 'select';
        });
        await editorPage.locator('#btnShipFlight').click();
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        const result = await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR; const f = ui.buildFlight;
            f.core.externalRenderHook = () => true; f.preview.root.visible = false;
            f.runtime.tick(1, false); f.runtime.renderer.render();
            const root = f.selectionVisuals.models.get('glb-selection');
            const mesh = []; root.traverse((node) => { if (node.isMesh && node.visible) mesh.push(node); });
            const camera = f.runtime.renderer.cameras[0];
            const v = () => f.position.clone().set(0, 0, 0);
            let glbTarget = null;
            for (const node of mesh) {
                const index = node.geometry.index;
                const points = [0, 1, 2].map((i) => node.getVertexPosition(index ? index.getX(i) : i, v()).applyMatrix4(node.matrixWorld));
                const center = v().add(points[0]).add(points[1]).add(points[2]).multiplyScalar(1 / 3);
                const normal = v().subVectors(points[1], points[0]).cross(v().subVectors(points[2], points[0])).normalize();
                camera.position.copy(center).addScaledVector(normal, 5); camera.lookAt(center); camera.updateMatrixWorld();
                glbTarget = f.pickCrosshair();
                if (glbTarget?.object?.userData.id === 'glb-selection') break;
            }
            f.ui.setTarget(glbTarget); f.selectionVisuals.show(f.selectionVisuals.hover, glbTarget, f.units);
            f.runtime.renderer.render();
            const glbId = glbTarget?.object?.userData.id;
            const anchors = f.runtime.arena.getAuthoredItemAnchors();
            f.runtime.powerups._spawnRandom(); f.runtime.powerups.update(1);
            const pickup = f.runtime.powerups.items.find((item) => item.anchorKey === 'pickup-selection');
            if (!pickup) throw new Error(`Authored pickup not spawned: ${JSON.stringify(anchors)}`);
            camera.position.copy(pickup.mesh.position).add(v().set(0, 0, 10));
            camera.lookAt(pickup.mesh.position); camera.updateMatrixWorld();
            const itemTarget = f.pickCrosshair();
            return { glbId, pickupId: itemTarget?.object?.userData.id, bob: pickup.mesh.position.y - pickup.baseY,
                authoredY: mapManager.getObjectById('pickup-selection').position.y,
                tracks: f.runtime.arena._glbAnimation.trackCount };
        });
        expect(result.glbId).toBe('glb-selection'); expect(result.pickupId).toBe('pickup-selection');
        expect(Math.abs(result.bob)).toBeGreaterThan(0.01); expect(result.authoredY).toBe(500);
        expect(result.tracks).toBeGreaterThan(0);
        await editorPage.screenshot({ path: testInfo.outputPath('animated-glb-selection.png') });
    } finally {
        await editorPage.evaluate(() => { window.CURVIOS_EDITOR?.ui?.buildFlight.stop(); window.CURVIOS_EDITOR?.ui?.markSaved?.(); });
        await editorPage.close();
    }
});

test('Bauflug markiert und wählt ein authored Portal aus dem gemeinsamen Instanz-Batch', async ({ page }) => {
    test.setTimeout(180000);
    const popup = page.waitForEvent('popup');
    await page.evaluate((url) => window.open(url, '_blank'), EDITOR_VIEW_PATHS.MAP_EDITOR);
    const editorPage = await popup; const errors = [];
    editorPage.on('pageerror', (error) => errors.push(error.message));
    try {
        await editorPage.waitForFunction(() => window.CURVIOS_EDITOR?.ui?.buildFlight);
        await editorPage.evaluate(() => {
            const { ui, mapManager } = window.CURVIOS_EDITOR;
            mapManager.importFromJSON(JSON.stringify({ schemaVersion: 4,
                arenaSize: { width: 2800, height: 950, depth: 2400 },
                playerSpawn: { x: 0, y: 500, z: 700 }, portalMode: 'authored',
                portals: [{ id: 'portal-a', x: -700, y: 500, z: 0 }, { id: 'portal-b', x: 700, y: 500, z: 0 }] }));
            ui.selectObject(mapManager.getObjectById('portal-a')); ui.currentTool = 'select';
        });
        await editorPage.locator('#btnShipFlight').click();
        await editorPage.waitForFunction(() => !window.CURVIOS_EDITOR.ui.buildFlight.loading);
        const selected = await editorPage.evaluate(() => {
            const f = window.CURVIOS_EDITOR.ui.buildFlight;
            f.frame(1 / 60); f.core.externalRenderHook = () => true;
            const handle = f.selectionVisuals.models.get('portal-a');
            if (!handle?._components?.length) throw new Error('No portal instance mapping');
            const camera = f.runtime.renderer.cameras[0];
            const v = () => f.position.clone().set(0, 0, 0);
            let target;
            for (const component of handle._components) {
                const mesh = component.batch.mesh;
                const matrix = f.selectionVisuals.instanceMatrix.clone();
                mesh.getMatrixAt(component.instanceId, matrix); matrix.premultiply(mesh.matrixWorld);
                const geo = mesh.geometry; const index = geo.index;
                const points = [0, 1, 2].map((i) => v().fromBufferAttribute(geo.attributes.position, index ? index.getX(i) : i).applyMatrix4(matrix));
                const center = v().add(points[0]).add(points[1]).add(points[2]).multiplyScalar(1 / 3);
                const normal = v().subVectors(points[1], points[0]).cross(v().subVectors(points[2], points[0])).normalize();
                camera.position.copy(center).addScaledVector(normal, 5); camera.lookAt(center); camera.updateMatrixWorld();
                target = f.pickCrosshair();
                if (target?.object?.userData.id === 'portal-a') break;
            }
            f.selectionVisuals.show(f.selectionVisuals.hover, target, f.units);
            f.runtime.renderer.render(); f.selectCrosshair();
            return { target: target?.object?.userData.id, selected: window.CURVIOS_EDITOR.ui.selectedObject?.userData.id,
                marked: f.selectionVisuals.selected.visible, hover: f.selectionVisuals.hover.visible };
        });
        expect(selected).toEqual({ target: 'portal-a', selected: 'portal-a', marked: true, hover: true });
        expect(errors).toEqual([]);
    } finally {
        await editorPage.evaluate(() => { window.CURVIOS_EDITOR?.ui?.buildFlight.stop(); window.CURVIOS_EDITOR?.ui?.markSaved?.(); });
        await editorPage.close();
    }
});
