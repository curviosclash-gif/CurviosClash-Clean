import { writeFile } from 'node:fs/promises';
import { captureReactorVideo } from './reactor-video-capture.mjs';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

test('reactor plays one of four torus clouds with sound, flash and the enlarged ceiling', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    const glMessages = [];
    page.on('console', (message) => { if (/WebGL/i.test(message.text())) glMessages.push(message.text()); });
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
        if (variant === 0) {
            // The whiteout is drawn in the scene, so the real renderer must show it fading.
            const flash = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const overlay = slot.getObjectByProperty('name', 'reactor-flash-overlay_nocol_noshadow');
                const probe = document.createElement('canvas'); probe.width = 64; probe.height = 36;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const shots = {};
                const brightness = {};
                for (const reduced of [false, true]) {
                    overlay.userData.reduceMotion = reduced;
                    for (const time of [0.03, 0.4, 2]) {
                        arena.setGlbAnimationElapsedSeconds(time); arena._glbAnimation.advance(0);
                        camera.position.set(260, 70, 260); camera.lookAt(0, 60, 0); camera.updateMatrixWorld(true);
                        runtime.renderer.setRenderTarget(null);
                        runtime.renderer.render(runtime.scene, camera);
                        context.drawImage(runtime.renderer.domElement, 0, 0, 64, 36);
                        const pixels = context.getImageData(0, 0, 64, 36).data;
                        let sum = 0;
                        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
                        const key = `${reduced ? 'reduced' : 'full'}-${time}`;
                        brightness[key] = sum / (pixels.length / 4) / 765;
                        shots[key] = runtime.renderer.domElement.toDataURL('image/png');
                    }
                }
                overlay.userData.reduceMotion = true;
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                return { brightness, shots };
            });
            for (const [key, png] of Object.entries(flash.shots)) {
                await writeFile(testInfo.outputPath(`flash-${key}s.png`), Buffer.from(png.split(',')[1], 'base64'));
            }
            await writeFile(testInfo.outputPath('flash-brightness.json'), JSON.stringify(flash.brightness, null, 2));
            // Six-way light: moving the map's sun from above to below the cloud must swap which
            // half of the smoke is brighter. Smoke pixels come from a render with and without it.
            const shading = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
                arena.setGlbAnimationElapsedSeconds(20); arena._glbAnimation.advance(0);
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const smoke = slot.getObjectByName('reactor-soft-smoke_nocol_noshadow');
                const centre = slot.getObjectByName('roll').getWorldPosition(camera.position.clone());
                let sun = null;
                runtime.scene.traverseVisible((node) => { if (node.isDirectionalLight && node.intensity > (sun?.intensity ?? 0)) sun = node; });
                const heldSun = sun.position.clone();
                const target = sun.target.getWorldPosition(centre.clone());
                const probe = document.createElement('canvas'); probe.width = 128; probe.height = 72;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, 128, 72);
                    return context.getImageData(0, 0, 128, 72).data;
                };
                // The game camera's far plane is shorter than this vantage point.
                const heldFar = camera.far; camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(centre.x + 650, centre.y - 120, centre.z + 650);
                camera.lookAt(centre); camera.updateMatrixWorld(true);
                const result = {};
                const shots = {};
                for (const [name, offset] of [['above', 1], ['below', -1]]) {
                    sun.position.copy(target).add({ x: 0, y: 1000 * offset, z: 0 }); sun.updateMatrixWorld(true);
                    smoke.visible = false; const without = grab();
                    smoke.visible = true; const withSmoke = grab();
                    shots[name] = runtime.renderer.domElement.toDataURL('image/png');
                    const rows = [];
                    for (let y = 0; y < 72; y += 1) {
                        for (let x = 0; x < 128; x += 1) {
                            const i = (y * 128 + x) * 4;
                            const change = Math.abs(withSmoke[i] - without[i]) + Math.abs(withSmoke[i + 1] - without[i + 1]) + Math.abs(withSmoke[i + 2] - without[i + 2]);
                            if (change > 24) rows.push([y, withSmoke[i] + withSmoke[i + 1] + withSmoke[i + 2]]);
                        }
                    }
                    const ys = rows.map(([y]) => y).sort((a, b) => a - b);
                    const middle = ys[ys.length >> 1];
                    const mean = (list) => list.reduce((sum, [, v]) => sum + v, 0) / Math.max(1, list.length) / 765;
                    result[name] = { upper: mean(rows.filter(([y]) => y < middle)), lower: mean(rows.filter(([y]) => y >= middle)), pixels: rows.length };
                }
                sun.position.copy(heldSun); sun.updateMatrixWorld(true);
                camera.far = heldFar; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                return { ...result, shots };
            });
            for (const [name, png] of Object.entries(shading.shots)) {
                await writeFile(testInfo.outputPath(`smoke-sun-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
            }
            delete shading.shots;
            await writeFile(testInfo.outputPath('smoke-sun-shading.json'), JSON.stringify(shading, null, 2));
            expect(shading.above.pixels).toBeGreaterThan(300);
            expect(shading.above.upper / shading.above.lower).toBeGreaterThan(shading.below.upper / shading.below.lower * 1.08);
            // A shader the GPU refuses to link fails silently in three.js; Chromium still says so.
            expect(glMessages.filter((text) => /INVALID_OPERATION|not valid/i.test(text))).toEqual([]);
            const b = flash.brightness;
            expect(b['full-0.03']).toBeGreaterThan(0.9);
            expect(b['full-0.03']).toBeGreaterThan(b['full-0.4']);
            expect(b['full-0.4']).toBeGreaterThan(b['full-2']);
            expect(b['reduced-0.03']).toBeLessThan(b['full-0.03']);
            expect(b['reduced-0.03']).toBeGreaterThan(b['reduced-2']);
        }
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
