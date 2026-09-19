import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';

const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

async function startMap(page, key, bots = 0) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', key);
    await page.waitForFunction((value) => window.GAME_INSTANCE?.settings?.mapKey === value, key);
    await page.evaluate((count) => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = count;
        document.getElementById('bot-count').value = String(count);
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count'] });
    }, bots);
    await page.click('#btn-start');
    await page.waitForFunction((value) => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?.currentMapKey === value && arena?._glbScene?.children?.length === 30 && !arena._glbLoadError;
    }, key, { timeout: 150_000 });
}

for (const key of ['burg_falkenwacht', 'burg_falkenwacht_arena']) {
    test(`${key} loads, animates, flies with safe spawns and releases resources on restart`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        const errors = collectErrors(page);
        await startMap(page, key, key.endsWith('_arena') ? 7 : 0);
        const initial = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            return {
                warnings: arena._glbLoadWarnings,
                tracks: arena._glbAnimation.trackCount,
                parcours: !!arena.currentMapDefinition.parcours?.enabled,
                bots: game.entityManager.players.filter((p) => p.isBot).length,
                spawnsClear: [arena.getAuthoredPlayerSpawn(), ...arena.getAuthoredBotSpawns()]
                    .every((p) => !arena.checkCollisionFast(p, 1.1)),
            };
        });
        expect(initial.warnings).toEqual([]);
        expect(initial.tracks).toBe(3);
        expect(initial.parcours).toBe(!key.endsWith('_arena'));
        expect(initial.spawnsClear).toBe(true);
        if (key.endsWith('_arena')) expect(initial.bots).toBeGreaterThan(0);

        const elapsed = await page.evaluate(() => window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds);
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds),
            { timeout: 15000 }).toBeGreaterThan(elapsed);

        const poses = await page.evaluate((scale) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const p = game.entityManager.players[0].position.clone();
            const blocked = (x,y,z) => arena.checkCollisionFast(p.set(x*scale,y*scale,z*scale), 1.1);
            return [0,7,10,14,18,24].map((seconds) => {
                arena.setGlbAnimationElapsedSeconds(seconds);
                arena.update(0);
                return { seconds, bridge: blocked(0,26,seconds === 10 ? 132 : 118),
                    gate: blocked(0,30,0), bypass: blocked(-65,58,118), wall: blocked(145,30,0) };
            });
        }, MAP_SCALE);
        expect(poses.map((p) => p.gate)).toEqual([false,true,true,false,true,false]);
        expect(poses.map((p) => p.bridge)).toEqual([false,false,true,true,true,false]);
        expect(poses.every((p) => !p.bypass && p.wall)).toBe(true);

        // Capture actual desktop renderer views, not offline beauty renders.
        const views = [
            { id: 'south', from: [0,37,164], to: [0,38,118] },
            { id: 'courtyard', from: [-28,42,43], to: [0,42,0] },
            { id: 'palas', from: [75,34,-56], to: [112,34,-56] },
            { id: 'keep', from: [-114,95,-78], to: [-64,95,-78] },
        ];
        for (const view of views) {
            const picture = await page.evaluate((v) => {
                const game = window.GAME_INSTANCE;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                camera.position.set(...v.from.map((n) => n*v.scale));
                camera.lookAt(...v.to.map((n) => n*v.scale));
                camera.updateMatrixWorld(true);
                runtime.render();
                return runtime.renderer.domElement.toDataURL('image/png');
            }, { ...view, scale: MAP_SCALE });
            const file = testInfo.outputPath(`${view.id}.png`);
            await writeFile(file, Buffer.from(picture.split(',')[1], 'base64'));
            await testInfo.attach(view.id, { path: file, contentType: 'image/png' });
        }

        const benchmark = await page.evaluate(async (scale) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const runtime = game.renderer;
            const camera = runtime.cameras[0];
            const castleKey = arena.currentMapKey;
            function measure() {
                const samples = [];
                // Identical camera, resolution, settings and warm-up for both maps.
                camera.position.set(0,45*scale,65*scale);
                camera.lookAt(0,42*scale,0);
                camera.updateMatrixWorld(true);
                for (let i=0; i<10; i++) runtime.render();
                for (let i=0; i<30; i++) {
                    const t = performance.now();
                    runtime.render();
                    samples.push(performance.now()-t);
                }
                samples.sort((a,b) => a-b);
                return { p95: samples[28], calls: runtime.renderer.info.render.calls,
                    triangles: runtime.renderer.info.render.triangles, geometries: runtime.renderer.info.memory.geometries };
            }
            const castle = measure();
            // Instrument the old resources, then exercise the production round restart.
            const oldScene = arena._glbScene;
            const oldDriver = arena._glbAnimation;
            const lifecycle = { disposed: 0, driver: oldDriver };
            window.falkenwachtLifecycleProbe = lifecycle;
            oldScene.traverse((node) => node.geometry?.addEventListener('dispose', () => { lifecycle.disposed++; }));
            await game.runtimeFacade.restartRound();
            return { castle, disposed: lifecycle.disposed, sameScene: oldScene === arena._glbScene,
                oldTrackCount: oldDriver.trackCount, castleKey, afterRestart: runtime.renderer.info.memory.geometries };
        }, MAP_SCALE);
        // Ordinary round restarts reuse the arena; map replacement releases it.
        expect(benchmark.disposed).toBe(0);
        expect(benchmark.sameScene).toBe(true);
        expect(benchmark.oldTrackCount).toBe(3);
        expect(benchmark.afterRestart).toBeLessThanOrEqual(benchmark.castle.geometries);
        expect(benchmark.castle.calls).toBeLessThanOrEqual(260);
        expect(benchmark.castle.p95).toBeLessThan(100);
        await page.waitForFunction(() => window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 30,
            null, { timeout: 150_000 });
        expect(await page.evaluate(() => window.GAME_INSTANCE.arena._glbAnimation.trackCount)).toBe(3);

        // Switching via the runtime session boundary also verifies collection replacement.
        await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            await game.runtimeFacade.returnToMenu();
            game.settings.mapKey = 'notre_dame_arena';
            game.settings.numBots = 0;
            await game.runtimeFacade.startMatch();
        });
        await page.waitForFunction(() => window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 15,
            null, { timeout: 150_000 });
        const baseline = await page.evaluate((scale) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const camera = runtime.cameras[0];
            camera.position.set(0,45*scale,65*scale);
            camera.lookAt(0,42*scale,0);
            camera.updateMatrixWorld(true);
            for (let i=0; i<10; i++) runtime.render();
            const samples = [];
            for (let i=0; i<30; i++) {
                const t = performance.now();
                runtime.render();
                samples.push(performance.now()-t);
            }
            samples.sort((a,b) => a-b);
            return { p95: samples[28], calls: runtime.renderer.info.render.calls,
                triangles: runtime.renderer.info.render.triangles };
        }, MAP_SCALE);
        await testInfo.attach('render-comparison', { body: JSON.stringify({ castle: benchmark.castle, notreDame: baseline }),
            contentType: 'application/json' });
        console.log(JSON.stringify({ key, castle: benchmark.castle, notreDame: baseline }));
        expect(benchmark.castle.p95).toBeLessThan(Math.max(25, baseline.p95*2));
        expect(await page.evaluate(() => window.falkenwachtLifecycleProbe.disposed)).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
}
