import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu, returnToMenu } from './helpers.js';
import { writeFile } from 'node:fs/promises';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';

for (const mapKey of ['notre_dame', 'notre_dame_arena']) {
    const intactSky = NOTRE_DAME_MAPS[mapKey].lighting.skyDome;
    test(`${mapKey} evolves from its dusk lighting through fire to ruins and resets @render`, async ({ page }, testInfo) => {
        test.setTimeout(240000);
        await waitForLoadedGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await page.selectOption('#map-select', mapKey);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.numBots = 0;
            game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
        });
        await page.click('#btn-start');
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE?.arena?._glbScene?.children?.length), { timeout: 150000 }).toBe(45);
        const proof = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const system = game.entityManager._mapDestructibleSystem;
            const solid = (x,y,z) => arena.checkCollisionFast({x:x*3,y:y*3,z:z*3}, .1);
            const samples = [];
            system.startRound();
            for (const at of [0, 118, 120, 121, 123, 126, 150, 350, 610]) {
                arena.setGlbAnimationElapsedSeconds(at);
                system.updateFeedback();
                arena.setGlbAnimationElapsedSeconds(at);
                const camera = game.renderer.cameras[0];
                camera.position.set(-350, 220, 160);
                camera.lookAt(-230, 180, 0);
                camera.updateMatrixWorld(true);
                game.renderer.renderer.render(game.renderer.scene, camera);
                samples.push({ at, image: game.renderer.renderer.domElement.toDataURL('image/png'),
                    progress: arena.mapFireProgress, events: system.state.events.map((entry) => entry.segmentId),
                    sky: structuredClone(game.renderer.getMapLighting().skyDome),
                    roofSolid: solid(-34.65, 60, 12),
                    finishBlockers: (() => {
                        const finish = arena.currentMapDefinition.parcours?.finish;
                        if (!finish) return [];
                        const [x, y, z] = finish.pos.map((value) => value * 3);
                        // The largest shipped aircraft has a 1.6-unit hitbox; check the actual
                        // traversal centre with that hull radius, not an arbitrary wider disc.
                        const hit = arena.getCollisionInfo({ x, y, z }, 1.6);
                        return hit ? [hit.obstacle?.sourceName || hit.obstacle?.sourceId || hit.kind || 'unknown'] : [];
                    })(),
                    constructionFrames: arena.obstacles.filter((o) => String(o.sourceId || '').startsWith('nd-site-')).length,
                    warnings: arena._glbLoadWarnings, error: String(arena._glbLoadError || ''),
                    checkpointBlocked: (arena.currentMapDefinition.parcours?.checkpoints || []).filter((cp) => solid(...cp.pos)).map((cp) => cp.id),
                });
            }
            arena.setGlbAnimationElapsedSeconds(0);
            system.startRound();
            arena.setGlbAnimationElapsedSeconds(0);
            return { samples, reset: { progress: arena.mapFireProgress, events: system.state.events.length,
                roofSolid: solid(-34.65,60,12), sky: structuredClone(game.renderer.getMapLighting().skyDome) } };
        });
        for (const sample of proof.samples) {
            await writeFile(testInfo.outputPath(`phase-${sample.at}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
            delete sample.image;
        }
        await writeFile(testInfo.outputPath('evolution.json'), JSON.stringify(proof, null, 2));
        expect(proof.samples[0].sky.zenithColor).toBe(intactSky.zenithColor);
        expect(proof.samples[0].roofSolid).toBe(true);
        expect(proof.samples[0].constructionFrames).toBe(0);
        const lateFire = proof.samples.find((sample) => sample.at === 350);
        expect(lateFire.events).toEqual(['roof','nave','transept']);
        expect(lateFire.roofSolid).toBe(false);
        expect(lateFire.constructionFrames).toBe(0);
        expect(lateFire.sky.zenithColor).toBe(0x050912);
        expect(proof.samples.find((sample) => sample.at === 610).events).toHaveLength(6);
        expect(proof.reset).toEqual({ progress: 0, events: 0, roofSolid: true, sky: proof.samples[0].sky });
        for (const sample of proof.samples) {
            expect(sample.error).toBe('');
            expect(sample.warnings).toEqual([]);
            expect(sample.checkpointBlocked).toEqual([]);
            expect(sample.finishBlockers, `FINISH should stay clear at ${sample.at}s`).toEqual([]);
        }
        // A fresh match must release the previous map's persistent fire resources.
        for (const nextMap of ['standard', mapKey, 'standard', mapKey]) {
            await returnToMenu(page);
            await openCustomSubmenu(page);
            await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
            await page.waitForSelector('#submenu-game:not(.hidden)');
            await page.selectOption('#map-select', nextMap);
            await page.click('#btn-start');
            await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE?.arena?.currentMapKey), { timeout: 150000 }).toBe(nextMap);
            if (nextMap !== 'standard') {
                await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE?.arena?._glbScene?.children?.length), { timeout: 150000 }).toBe(45);
            }
            const resources = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                let groups = 0;
                game.renderer.scene.traverse((node) => { if (node.name === 'map-fire-fx') groups++; });
                return { groups, events: game.entityManager._mapDestructibleSystem.state.events.length,
                    progress: game.arena.mapFireProgress, sky: game.renderer.getMapLighting().skyDome.zenithColor };
            });
            expect(resources.groups).toBe(nextMap === 'standard' ? 0 : 1);
            expect(resources.events).toBe(0);
            if (nextMap === 'standard') expect(resources.progress).toBeNull();
            else { expect(resources.progress).toBe(0); expect(resources.sky).toBe(intactSky.zenithColor); }
        }
    });
}
