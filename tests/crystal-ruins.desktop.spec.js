import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'crystal_ruins';
const MAP_SCALE = 3;

async function startCrystalRuins(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction((mapKey) => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?.currentMapKey === mapKey
            && arena?._glbScene?.children?.length === arena?.currentMapDefinition?.glbModels?.length;
    }, MAP_KEY, { timeout: 120_000 });
}

test('Crystal Ruins loads its curated ruin library and keeps tunnel crossings clear', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startCrystalRuins(page);

    const state = await page.evaluate(({ scale }) => {
        const arena = window.GAME_INSTANCE.arena;
        const point = ([x, y, z]) => ({ x: x * scale, y: y * scale, z: z * scale });
        const crossingLines = [
            Array.from({ length: 17 }, (_, index) => [0, 10, -46 + index * 0.75]),
            Array.from({ length: 17 }, (_, index) => [0, 10, 34 + index * 0.75]),
            Array.from({ length: 17 }, (_, index) => [34 + index * 0.75, 10, 0]),
            Array.from({ length: 17 }, (_, index) => [-46 + index * 0.75, 10, 0]),
        ];
        return {
            sceneChildren: arena._glbScene.children.length,
            modelCount: arena.currentMapDefinition.glbModels.length,
            colliderMode: arena._glbFootprint?.colliderMode,
            glbColliders: arena.obstacles.filter((obstacle) => obstacle?.meshCollider).length,
            dynamicGlbColliders: arena._glbDynamicObstacles.length,
            warnings: arena._glbLoadWarnings,
            loadError: arena._glbLoadError,
            blockedTunnelSamples: crossingLines.flat().filter((sample) => (
                arena.checkCollisionFast(point(sample), 0.8)
            )),
        };
    }, { scale: MAP_SCALE });

    expect(state.modelCount).toBeGreaterThanOrEqual(24);
    expect(state.sceneChildren).toBe(state.modelCount);
    expect(state.colliderMode).toBe('scene');
    expect(state.glbColliders).toBeGreaterThan(0);
    expect(state.glbColliders).toBeLessThanOrEqual(48);
    expect(state.dynamicGlbColliders).toBe(0);
    expect(state.warnings).toEqual([]);
    expect(state.loadError).toBeNull();
    expect(state.blockedTunnelSamples).toEqual([]);

    const views = [
        { id: 'overview', from: [64, 48, 64], to: [0, 16, 0] },
        { id: 'north-tunnel', from: [0, 13, -67], to: [0, 8, -38] },
        { id: 'northwest-ensemble', from: [-64, 12, -8], to: [-50, 6, -25] },
        { id: 'southeast-ensemble', from: [64, 12, 8], to: [50, 6, 25] },
    ];
    for (const view of views) {
        const picture = await page.evaluate(({ from, to, scale }) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const camera = runtime.cameras[0];
            camera.position.set(...from.map((value) => value * scale));
            camera.lookAt(...to.map((value) => value * scale));
            camera.updateMatrixWorld(true);
            runtime.render();
            return runtime.renderer.domElement.toDataURL('image/png');
        }, { ...view, scale: MAP_SCALE });
        const file = testInfo.outputPath(`${view.id}.png`);
        await writeFile(file, Buffer.from(picture.split(',')[1], 'base64'));
        await testInfo.attach(view.id, { path: file, contentType: 'image/png' });
    }
});
