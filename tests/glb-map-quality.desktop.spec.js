import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { writeFile } from 'node:fs/promises';

for (const key of ['rift_bazaar', 'aether_relay', 'verdant_aperture', 'glb_gallery']) {
    test(`${key} loads complete geometry and releases it on map replacement`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        await waitForLoadedGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await page.selectOption('#map-select', key);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.numBots = 0;
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count'] });
        });
        const start = Date.now();
        await page.click('#btn-start');
        await page.waitForFunction((id) => {
            const arena = window.GAME_INSTANCE?.arena;
            return arena?.currentMapKey === id && arena?._glbScene
                && arena._glbScene.children.length === arena.currentMapDefinition.glbModels.length;
        }, key, { timeout: 120_000 });
        const loadMs = Date.now() - start;
        const metrics = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const renderer = game.renderer;
            const camera = renderer.cameras[0];
            const spawn = arena.getAuthoredPlayerSpawn();
            if (spawn) camera.position.set(spawn.x, spawn.y, spawn.z);
            camera.lookAt(0, camera.position.y, 0);
            camera.updateMatrixWorld(true);
            const samples = [];
            for (let i = 0; i < 40; i++) {
                const start = performance.now();
                renderer.render();
                // Include GPU completion, not just CPU draw submission.
                renderer.renderer.getContext().finish();
                if (i >= 10) samples.push(performance.now() - start);
            }
            samples.sort((a, b) => a - b);
            const blocked = (p) => arena.checkCollisionFast(p, 1.1);
            const anchors = [spawn, ...arena.getAuthoredBotSpawns(), ...arena.getAuthoredItemAnchors()].filter(Boolean);
            const result = {
                warnings: arena._glbLoadWarnings,
                p95Ms: samples[28],
                calls: renderer.renderer.info.render.calls,
                triangles: renderer.renderer.info.render.triangles,
                ...renderer.renderer.info.memory,
                blockedAnchors: anchors.filter(blocked),
                screenshot: renderer.renderer.domElement.toDataURL('image/png'),
            };
            if (arena.currentMapKey === 'verdant_aperture') {
                const rewards = arena.getAuthoredItemAnchors().filter((item) =>
                    ['verdant_rocket_west', 'verdant_rocket_east', 'verdant_rare_heart'].includes(item.id));
                result.blockedRewardPhases = [];
                for (let seconds = 0; seconds < 24; seconds += 0.125) {
                    arena.setGlbAnimationElapsedSeconds(seconds);
                    arena.update(0);
                    for (const reward of rewards) {
                        if (blocked(reward)) result.blockedRewardPhases.push({ id: reward.id, seconds });
                    }
                }
            }
            const oldScene = arena._glbScene;
            let disposed = 0;
            oldScene.traverse((node) => node.geometry?.addEventListener('dispose', () => { disposed++; }));
            await game.runtimeFacade.restartRound();
            result.reused = oldScene === arena._glbScene;
            await game.runtimeFacade.returnToMenu();
            game.settings.mapKey = 'standard';
            await game.runtimeFacade.startMatch();
            result.disposed = disposed;
            result.released = arena._glbScene === null && arena._glbAnimation.trackCount === 0;
            return result;
        });
        const screenshotPath = testInfo.outputPath('spawn-view.png');
        await writeFile(screenshotPath, Buffer.from(metrics.screenshot.split(',')[1], 'base64'));
        await testInfo.attach('spawn-view', { path: screenshotPath, contentType: 'image/png' });
        delete metrics.screenshot;
        console.log(JSON.stringify({ key, loadMs, ...metrics }));
        await testInfo.attach('metrics', { body: JSON.stringify({ key, loadMs, ...metrics }), contentType: 'application/json' });
        expect(metrics.warnings).toEqual([]);
        expect(metrics.reused).toBe(true);
        expect(metrics.disposed).toBeGreaterThan(0);
        expect(metrics.released).toBe(true);
        if (key === 'rift_bazaar' || key === 'aether_relay') expect(metrics.blockedAnchors).toEqual([]);
        if (key === 'verdant_aperture') expect(metrics.blockedRewardPhases).toEqual([]);
    });
}
