import { writeFile } from 'node:fs/promises';
import { captureReactorVideo } from './reactor-video-capture.mjs';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

test('reactor plays one of four torus clouds with sound, flash and the enlarged ceiling', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'reactor_site');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.gameMode = 'HUNT';
        game.settings.numBots = 0;
        document.getElementById('bot-count').value = '0';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count', 'mode'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?.currentMapKey === 'reactor_site'
            && arena._glbScene?.children?.length === arena.currentMapDefinition.glbModels.length
            && !arena._glbLoadError;
    }, null, { timeout: 180_000 });
    await waitForRenderFrames(page, 5);

    for (let variant = 0; variant < 4; variant += 1) {
        const result = await page.evaluate((selected) => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const arena = game.arena;
            const system = manager.getMapDestructibleSystem();
            system.startRound();
            arena.setGlbAnimationElapsedSeconds(0);
            const oldInt = manager.runtimeRng.int;
            const oldPlay = manager.audio.play;
            const sounds = [];
            manager.runtimeRng.int = (count) => count === 4 ? selected : oldInt(count);
            manager.audio.play = function (type, options) { sounds.push(type); return oldPlay.call(this, type, options); };
            let event;
            try {
                event = system.applyMeshHit('reactor_block', 900).event;
                if (sounds.includes('REACTOR_BREACH')) throw new Error('sound preceded pressure');
                arena.setGlbAnimationElapsedSeconds(.28);
                system.updateFeedback();
                // Sound travels at 343 m/s; give it time to reach a camera across the map.
                arena.setGlbAnimationElapsedSeconds(4);
                system.updateFeedback();
            } finally {
                manager.runtimeRng.int = oldInt;
                manager.audio.play = oldPlay;
            }
            manager.particles.rocketBlastEffect.update(.01);
            const flash = manager.particles.rocketBlastEffect.light?.intensity || 0;
            const slots = arena._glbScene.children.filter((slot) => String(slot.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
            const active = slots.filter((slot) => slot.visible);
            const audio = manager.audio;
            // World sound reaches the master through the hearing low-pass once audio is running.
            const hearing = !audio?.ctx ? 'no-audio' : (audio._sfxGain && audio._hearing ? 'wired' : 'missing');
            return { selected: event.variantIndex, active: active.map((slot) => slot.userData.glbModelId),
                sounds, flash, hearing, height: arena.currentMapDefinition.size[1] };
        }, variant);
        expect(result.selected).toBe(variant);
        expect(result.active).toEqual([variant === 0 ? 'reactor-mushroom-cloud' : `reactor-mushroom-cloud-${variant + 1}`]);
        expect(result.sounds.filter((sound) => sound === 'REACTOR_BREACH')).toHaveLength(1);
        expect(result.flash).toBeGreaterThan(0);
        expect(result.hearing).not.toBe('missing');
        if (variant === 0) testInfo.annotations.push({ type: 'hearing', description: result.hearing });
        expect(result.height).toBe(286);
        if (process.env.REACTOR_VIDEO_DIR && (!process.env.REACTOR_VIDEO_VARIANT || Number(process.env.REACTOR_VIDEO_VARIANT) === variant + 1)) {
            await captureReactorVideo(page, variant, process.env.REACTOR_VIDEO_DIR);
        }
        for (const seconds of [2, 12, 48]) {
            const shot = await page.evaluate((time) => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                arena.setGlbAnimationElapsedSeconds(time);
                arena._glbAnimation.advance(0);
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                slot.updateWorldMatrix(true, true);
                let top = -Infinity;
                slot.traverse((node) => {
                    if (!node.isMesh) return;
                    const positions = node.geometry.attributes.position;
                    const m = node.matrixWorld.elements;
                    for (let i = 0; i < positions.count; i += 1) {
                        const y = m[1] * positions.getX(i) + m[5] * positions.getY(i) + m[9] * positions.getZ(i) + m[13];
                        if (y > top) top = y;
                    }
                });
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const position = camera.position.clone();
                const quaternion = camera.quaternion.clone();
                camera.position.set(350, Math.max(160, top * 1.02), 450);
                camera.lookAt(0, top * .83, 0);
                camera.updateMatrixWorld(true);
                runtime.renderer.setRenderTarget(null);
                runtime.renderer.render(runtime.scene, camera);
                const png = runtime.renderer.domElement.toDataURL('image/png');
                runtime.renderer.render(runtime.scene, camera);
                if (png !== runtime.renderer.domElement.toDataURL('image/png')) {
                    throw new Error('The first smoke draw after a seek differs from the settled draw');
                }
                if (time === 12) {
                    const smoke = slot.getObjectByName('reactor-soft-smoke_nocol_noshadow');
                    const prepare = smoke.onBeforeRender;
                    try {
                        smoke.onBeforeRender = function (...args) { prepare.apply(this,args); this.material.uniforms.heat.value=0; };
                        runtime.renderer.render(runtime.scene,camera);
                        if (png === runtime.renderer.domElement.toDataURL('image/png')) throw new Error('Local embers are invisible during ascent');
                    } finally { smoke.onBeforeRender=prepare; }
                }
                camera.position.copy(position); camera.quaternion.copy(quaternion);
                camera.updateMatrixWorld(true);
                return { png, top };
            }, seconds);
            await writeFile(testInfo.outputPath(`variant-${variant + 1}-${seconds}s.png`), Buffer.from(shot.png.split(',')[1], 'base64'));
            if (seconds === 48) expect(shot.top).toBeCloseTo(286 * 1.15 * 3, 1);
        }
    }
    const smokeReport = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        arena.setGlbAnimationElapsedSeconds(48); arena._glbAnimation.advance(0);
        const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
        const smoke = slot.getObjectByName('reactor-soft-smoke_nocol_noshadow');
        if (!smoke) throw new Error('Missing runtime smoke layer');
        const renderer = game.renderer.renderer;
        const camera = game.renderer.cameras[0];
        const oldPosition = camera.position.clone(), oldRotation = camera.quaternion.clone();
        const oldFar = camera.far; camera.far = 5000; camera.updateProjectionMatrix();
        const materials = new Set();
        slot.traverse((node) => { if (/^Cloud(?:Dark)?$/.test(node.material?.name || '')) materials.add(node.material); });
        const images = [];
        for (const angle of [0, 90, 180, 225]) {
            const radians = angle * Math.PI / 180;
            camera.position.set(Math.cos(radians)*1400,600,Math.sin(radians)*1400);
            camera.lookAt(0,520,0); camera.updateMatrixWorld(true);
            renderer.render(game.renderer.scene,camera);
            images.push({ angle, png: renderer.domElement.toDataURL('image/png') });
        }
        // Same scene, resolution, pose and camera. Synchronous samples stop gameplay
        // updates; gl.finish includes GPU completion rather than only submission cost.
        const gl = renderer.getContext();
        const samples = { mesh: [], smoke: [] };
        const draws = {};
        for (let cycle = 0; cycle < 3; cycle++) {
            for (const mode of cycle % 2 ? ['smoke','mesh'] : ['mesh','smoke']) {
                smoke.visible = mode === 'smoke';
                for (const material of materials) material.visible = mode === 'mesh';
                for (let frame = 0; frame < 15; frame++) {
                    renderer.info.reset();
                    const start = performance.now();
                    renderer.render(game.renderer.scene,camera); gl.finish();
                    if (frame >= 3) samples[mode].push(performance.now()-start);
                }
                draws[mode] = renderer.info.render.calls;
            }
        }
        smoke.visible = true; for (const material of materials) material.visible = false;
        camera.position.copy(oldPosition); camera.quaternion.copy(oldRotation); camera.far = oldFar;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        const times = {};
        for (const mode of ['mesh','smoke']) {
            samples[mode].sort((a,b)=>a-b);
            times[mode] = { p50: samples[mode][18], p95: samples[mode][34] };
        }
        return { images, times, draws, cards: smoke.geometry.instanceCount,
            dimensions: [renderer.domElement.width,renderer.domElement.height] };
    });
    for (const { angle, png } of smokeReport.images) {
        await writeFile(testInfo.outputPath(`smoke-view-${angle}.png`),Buffer.from(png.split(',')[1],'base64'));
    }
    delete smokeReport.images;
    await writeFile(testInfo.outputPath('smoke-performance.json'),JSON.stringify(smokeReport,null,2));
    expect(smokeReport.cards).toBeGreaterThan(100);
    expect(smokeReport.cards).toBeLessThanOrEqual(512);
    expect(smokeReport.draws.smoke).toBeLessThan(smokeReport.draws.mesh);
    expect(errors).toEqual([]);
});
