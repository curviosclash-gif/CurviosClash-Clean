import { writeFile } from 'node:fs/promises';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'storm_dam_siege';
const MAP_SCALE = 3;

async function startDamMatch(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
        && window.GAME_INSTANCE?.entityManager?.players?.length > 0
    ), MAP_KEY, { timeout: 120_000 });
}

test('the giant rear-wall dam breaches and launches its flood wave into the arena', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startDamMatch(page);
    await expect.poll(() => page.evaluate(() => {
        const arena = window.GAME_INSTANCE?.arena;
        return !arena?._glbLoadError && arena?._glbScene?.children?.length === 3;
    }), { timeout: 150_000 }).toBe(true);

    const result = await page.evaluate(({ mapScale }) => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const entityManager = game.entityManager;
        const destructibles = entityManager._mapDestructibleSystem;
        const water = entityManager._waterZoneSystem;
        const intact = arena._glbScene.getObjectByName('glb-slot-storm-dam-intact');
        const collapse = arena._glbScene.getObjectByName('glb-slot-storm-dam-collapse');

        const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        intact.updateWorldMatrix(true, true);
        intact.traverse((child) => {
            if (!/^dam_wall_arch_\d+$/.test(String(child.name)) || !child.geometry) return;
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
            const local = child.geometry.boundingBox;
            const matrix = child.matrixWorld.elements;
            for (const x of [local.min.x, local.max.x]) {
                for (const y of [local.min.y, local.max.y]) {
                    for (const z of [local.min.z, local.max.z]) {
                        const worldX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
                        const worldY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
                        bounds.minX = Math.min(bounds.minX, worldX);
                        bounds.maxX = Math.max(bounds.maxX, worldX);
                        bounds.minY = Math.min(bounds.minY, worldY);
                        bounds.maxY = Math.max(bounds.maxY, worldY);
                    }
                }
            }
        });

        const segment = destructibles.getDefinition().segments.find((entry) => entry.id === 'dam_wall');
        const hit = destructibles.applyMeshHit('dam_wall_arch_08', segment.hp, {
            hitPoint: {
                x: segment.anchor[0] * mapScale,
                y: segment.anchor[1] * mapScale,
                z: segment.anchor[2] * mapScale,
            },
            hitDirection: { x: 0, y: 0, z: -1 },
            cause: 'MG_BULLET',
        });
        water.update(0);
        const waveStartZ = water._visual.waveGroup.position.z;
        water.update(water.getZone().waveSeconds / 2);

        const runtime = game.renderer;
        const camera = runtime.cameras[0];
        camera.position.set(0, 72, -210);
        camera.lookAt(0, 175, 255);
        camera.updateMatrixWorld(true);
        runtime.render();

        return {
            maxY: arena.bounds.maxY,
            warningCount: arena._glbLoadWarnings.length,
            trackCount: arena._glbAnimation.trackCount,
            wallWidth: bounds.maxX - bounds.minX,
            wallHeight: bounds.maxY - bounds.minY,
            destroyed: hit?.destroyed === true,
            intactVisible: intact.visible,
            collapseVisible: collapse.visible,
            phase: water.getState().phase,
            waveOrigin: water.getZone().waveOrigin,
            waveStartZ,
            waveHalfZ: water._visual.waveGroup.position.z,
            waveParts: water._visual.waveGroup.children.length,
            picture: runtime.renderer.domElement.toDataURL('image/png'),
        };
    }, { mapScale: MAP_SCALE });

    expect(result.warningCount).toBe(0);
    expect(result.trackCount).toBe(2);
    expect(result.maxY).toBe(450);
    expect(result.wallWidth).toBeGreaterThanOrEqual(535);
    expect(result.wallHeight).toBeGreaterThanOrEqual(405);
    expect(result.destroyed).toBe(true);
    expect(result.intactVisible).toBe(false);
    expect(result.collapseVisible).toBe(true);
    expect(result.phase).toBe('wave');
    expect(result.waveOrigin).toBe('maxZ');
    expect(result.waveStartZ).toBeCloseTo(270, 4);
    expect(result.waveHalfZ).toBeCloseTo(0, 4);
    expect(result.waveParts).toBe(5);

    const screenshot = testInfo.outputPath('storm-dam-breach-wave.png');
    await writeFile(screenshot, Buffer.from(result.picture.split(',')[1], 'base64'));
    await testInfo.attach('storm-dam-breach-wave', { path: screenshot, contentType: 'image/png' });
    expect(errors).toEqual([]);
});
