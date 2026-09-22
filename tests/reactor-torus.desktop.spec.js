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
                // Cards and, where the cloud is ray-marched, its head and stem volumes.
                const smoke = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow', 'reactor-volume-stem_nocol_noshadow']
                    .map((name) => slot.getObjectByName(name)).filter(Boolean);
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
                    for (const layer of smoke) layer.visible = false;
                    const without = grab();
                    for (const layer of smoke) layer.visible = true;
                    const withSmoke = grab();
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
            if (process.env.REACTOR_GPU_BENCH === '1') {
                // Opt-in GPU cost of the reactor effects: timer queries measure GPU time per frame,
                // independent of CPU scheduling. Configurations are interleaved frame by frame.
                const bench = await page.evaluate(async () => {
                    const game = window.GAME_INSTANCE;
                    const arena = game.arena;
                    const runtime = game.renderer;
                    const renderer = runtime.renderer;
                    const gl = renderer.getContext();
                    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
                    if (!ext) return { skipped: 'no EXT_disjoint_timer_query_webgl2' };
                    const camera = runtime.cameras[0];
                    const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                    const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                    const smoke = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow', 'reactor-volume-stem_nocol_noshadow']
                        .map((name) => slot.getObjectByName(name)).filter(Boolean);
                    const extras = ['reactor-debris_nocol_noshadow', 'reactor-debris-puffs_nocol_noshadow', 'reactor-fire-glow_nocol_noshadow',
                        'reactor-flash-overlay_nocol_noshadow'].map((name) => slot.getObjectByName(name));
                    extras.push(slot.getObjectByName('flash').children.find((node) => node.isMesh));
                    const configs = {
                        none: () => { for (const m of [...smoke, ...extras]) m.visible = false; },
                        smoke: () => { for (const m of smoke) m.visible = true; for (const m of extras) m.visible = false; },
                        all: () => { for (const m of [...smoke, ...extras]) m.visible = true; },
                    };
                    // Smoke plus one extra at a time, so a costly layer shows up on its own.
                    for (const extra of extras) {
                        configs[`+${extra.name}`] = () => {
                            for (const m of smoke) m.visible = true;
                            for (const m of extras) m.visible = m === extra;
                        };
                    }
                    camera.far = 5000; camera.updateProjectionMatrix();
                    camera.position.set(330, 90, 330); camera.lookAt(0, 250, 0); camera.updateMatrixWorld(true);
                    const result = { size: [renderer.domElement.width, renderer.domElement.height] };
                    // 5 s is when thrown debris and its trails cover the most sky.
                    for (const seconds of [3, 5, 20, 169]) {
                        arena.setGlbAnimationElapsedSeconds(seconds); arena._glbAnimation.advance(0);
                        const samples = Object.fromEntries(Object.keys(configs).map((name) => [name, []]));
                        const pending = [];
                        const names = Object.keys(configs);
                        for (let frame = 0; frame < 45; frame += 1) {
                            // GPU time depends on the position within a burst of renders; rotating the
                            // order every frame spreads that bias evenly over all configurations.
                            const order = names.map((_, index) => names[(index + frame) % names.length]);
                            for (const name of order) {
                                configs[name]();
                                const query = gl.createQuery();
                                gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
                                renderer.setRenderTarget(null);
                                renderer.render(runtime.scene, camera);
                                gl.endQuery(ext.TIME_ELAPSED_EXT);
                                if (frame >= 5) pending.push({ name, query });
                            }
                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }
                        for (let wait = 0; wait < 200 && pending.some(({ query }) => !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)); wait += 1) {
                            await new Promise((resolve) => setTimeout(resolve, 10));
                        }
                        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
                        for (const { name, query } of pending) {
                            if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) samples[name].push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
                            gl.deleteQuery(query);
                        }
                        const stat = (values) => {
                            const sorted = [...values].sort((a, b) => a - b);
                            return { p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], n: sorted.length };
                        };
                        result[seconds] = { disjoint, ...Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, stat(values)])) };
                    }
                    configs.all();
                    camera.far = held.far; camera.updateProjectionMatrix();
                    camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                    return result;
                });
                await writeFile(testInfo.outputPath('reactor-gpu-bench.json'), JSON.stringify(bench, null, 2));
            }
            // Split screen: two viewports of one frame, drawn the way RenderViewportSystem draws
            // them. The camera close to and facing the breach whites out, the far one looking away
            // is only dazzled.
            const split = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const renderer = runtime.renderer;
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const overlay = slot.getObjectByProperty('name', 'reactor-flash-overlay_nocol_noshadow');
                overlay.userData.reduceMotion = false;
                arena.setGlbAnimationElapsedSeconds(0.03); arena._glbAnimation.advance(0);
                const width = renderer.domElement.width / renderer.getPixelRatio();
                const height = renderer.domElement.height / renderer.getPixelRatio();
                const near = runtime.cameras[0].clone(); near.aspect = (width / 2) / height; near.far = 5000;
                near.position.set(260, 70, 260); near.lookAt(0, 60, 0); near.updateProjectionMatrix(); near.updateMatrixWorld(true);
                const far = near.clone(); far.position.set(-1300, 400, -1300); far.lookAt(-2600, 400, -2600); far.updateMatrixWorld(true);
                renderer.setRenderTarget(null);
                renderer.setScissorTest(true);
                renderer.setViewport(0, 0, width / 2, height); renderer.setScissor(0, 0, width / 2, height);
                renderer.render(runtime.scene, near);
                renderer.setViewport(width / 2, 0, width / 2, height); renderer.setScissor(width / 2, 0, width / 2, height);
                renderer.render(runtime.scene, far);
                renderer.setScissorTest(false);
                renderer.setViewport(0, 0, width, height); renderer.setScissor(0, 0, width, height);
                const probe = document.createElement('canvas'); probe.width = 128; probe.height = 36;
                const context = probe.getContext('2d', { willReadFrequently: true });
                context.drawImage(renderer.domElement, 0, 0, 128, 36);
                const pixels = context.getImageData(0, 0, 128, 36).data;
                const half = (from) => {
                    let sum = 0, n = 0;
                    for (let y = 0; y < 36; y += 1) for (let x = from; x < from + 64; x += 1) {
                        const i = (y * 128 + x) * 4; sum += pixels[i] + pixels[i + 1] + pixels[i + 2]; n += 1;
                    }
                    return sum / n / 765;
                };
                const png = renderer.domElement.toDataURL('image/png');
                overlay.userData.reduceMotion = true;
                return { near: half(0), far: half(64), png };
            });
            await writeFile(testInfo.outputPath('split-screen-flash.png'), Buffer.from(split.png.split(',')[1], 'base64'));
            delete split.png;
            await writeFile(testInfo.outputPath('split-screen-flash.json'), JSON.stringify(split, null, 2));
            expect(split.near).toBeGreaterThan(0.9);
            expect(split.far).toBeLessThan(split.near - 0.15);
            // Hearing: noise on the world bus, a close breach muffles it, highs drop and come back.
            const hearing = await page.evaluate(async () => {
                const audio = window.GAME_INSTANCE.entityManager.audio;
                const ctx = audio?.ctx;
                if (!ctx || !audio._hearing) return { skipped: 'no running audio' };
                if (ctx.state !== 'running') await ctx.resume().catch(() => {});
                if (ctx.state !== 'running') return { skipped: `audio ${ctx.state}` };
                const heldMaster = audio._masterGain.gain.value;
                const heldSfx = audio._sfxGain.gain.value;
                audio._masterGain.gain.value = 1; audio._sfxGain.gain.value = 1;
                const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
                audio._masterGain.connect(analyser);
                const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
                const channel = buffer.getChannelData(0);
                for (let i = 0; i < channel.length; i += 1) channel[i] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.4;
                const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
                noise.connect(audio._sfxGain); noise.start();
                const bins = new Float32Array(analyser.frequencyBinCount);
                const hz = ctx.sampleRate / analyser.fftSize;
                const highs = async () => {
                    let total = 0;
                    for (let sample = 0; sample < 5; sample += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 40));
                        analyser.getFloatFrequencyData(bins);
                        let sum = 0, n = 0;
                        for (let b = Math.floor(6000 / hz); b < Math.floor(12000 / hz); b += 1) { sum += 10 ** (bins[b] / 10); n += 1; }
                        total += sum / n;
                    }
                    return 10 * Math.log10(total / 5);
                };
                await new Promise((resolve) => setTimeout(resolve, 300));
                const before = await highs();
                audio._hearing.trigger(1, 2.5);
                await new Promise((resolve) => setTimeout(resolve, 500));
                const muffled = await highs();
                await new Promise((resolve) => setTimeout(resolve, 2600));
                const recovered = await highs();
                noise.stop(); noise.disconnect(); audio._masterGain.disconnect(analyser);
                audio._masterGain.gain.value = heldMaster; audio._sfxGain.gain.value = heldSfx;
                return { before, muffled, recovered, state: ctx.state };
            });
            await writeFile(testInfo.outputPath('hearing.json'), JSON.stringify(hearing, null, 2));
            if (!hearing.skipped) {
                expect(hearing.muffled).toBeLessThan(hearing.before - 20);
                expect(Math.abs(hearing.recovered - hearing.before)).toBeLessThan(3);
            } else testInfo.annotations.push({ type: 'hearing-skipped', description: hearing.skipped });
            // The Blender-keyed flash shell glows over the ruin in the first tenth of a second.
            const shell = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const mesh = slot.getObjectByName('flash').children.find((node) => node.isMesh);
                const overlay = slot.getObjectByName('reactor-flash-overlay_nocol_noshadow');
                const probe = document.createElement('canvas'); probe.width = 160; probe.height = 90;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
                    return context.getImageData(0, 0, 160, 90).data;
                };
                camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(420, 90, 420); camera.lookAt(0, 70, 0); camera.updateMatrixWorld(true);
                overlay.visible = false;
                const result = {};
                for (const seconds of [0.08, 1]) {
                    arena.setGlbAnimationElapsedSeconds(seconds); arena._glbAnimation.advance(0);
                    mesh.visible = false; const without = grab();
                    mesh.visible = true; const withShell = grab();
                    let brighter = 0;
                    for (let i = 0; i < without.length; i += 4) {
                        if (withShell[i] + withShell[i + 1] + withShell[i + 2] - without[i] - without[i + 1] - without[i + 2] > 30) brighter += 1;
                    }
                    result[seconds] = { brighter, material: mesh.material.name, png: runtime.renderer.domElement.toDataURL('image/png') };
                }
                overlay.visible = true;
                camera.far = held.far; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                return result;
            });
            for (const [seconds, entry] of Object.entries(shell)) {
                await writeFile(testInfo.outputPath(`flash-shell-${seconds}s.png`), Buffer.from(entry.png.split(',')[1], 'base64'));
                delete entry.png;
            }
            await writeFile(testInfo.outputPath('flash-shell.json'), JSON.stringify(shell, null, 2));
            expect(shell[0.08].brighter).toBeGreaterThan(100);
            expect(shell[1].brighter).toBe(0);
            // Thrown chunks and their smoke trails show up in the real renderer, and lie cooling later.
            const debris = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const layers = ['reactor-debris_nocol_noshadow', 'reactor-debris-puffs_nocol_noshadow'].map((name) => slot.getObjectByName(name));
                const flash = slot.getObjectByName('reactor-flash-overlay_nocol_noshadow');
                const probe = document.createElement('canvas'); probe.width = 160; probe.height = 90;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
                    return context.getImageData(0, 0, 160, 90).data;
                };
                camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(420, 90, 420); camera.lookAt(0, 70, 0); camera.updateMatrixWorld(true);
                flash.visible = false; // the whiteout would hide what is being measured
                const result = {};
                for (const seconds of [0.4, 3, 12]) {
                    arena.setGlbAnimationElapsedSeconds(seconds); arena._glbAnimation.advance(0);
                    for (const layer of layers) layer.visible = false;
                    const without = grab();
                    for (const layer of layers) layer.visible = true;
                    const withDebris = grab();
                    const png = runtime.renderer.domElement.toDataURL('image/png');
                    // The trails alone: chunks hidden, puffs on and off.
                    layers[0].visible = false;
                    const puffsOnly = grab();
                    layers[1].visible = false;
                    const neither = grab();
                    layers[0].visible = true; layers[1].visible = true;
                    const count = (a, b) => {
                        let changed = 0;
                        for (let i = 0; i < a.length; i += 4) {
                            if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) changed += 1;
                        }
                        return changed;
                    };
                    result[seconds] = { changed: count(withDebris, without), trails: count(puffsOnly, neither), png };
                }
                flash.visible = true;
                camera.far = held.far; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                return result;
            });
            for (const [seconds, entry] of Object.entries(debris)) {
                await writeFile(testInfo.outputPath(`debris-${seconds}s.png`), Buffer.from(entry.png.split(',')[1], 'base64'));
                delete entry.png;
            }
            await writeFile(testInfo.outputPath('debris.json'), JSON.stringify(debris, null, 2));
            expect(debris[3].changed).toBeGreaterThan(40);
            expect(debris[12].changed).toBeGreaterThan(5);
            // Dark trails read against the haze and still hang in the air after the chunks landed.
            // The blast wave's dust hangs over the site from this camera, so its density is set
            // where the trails still carry these numbers.
            expect(debris[3].trails).toBeGreaterThan(100);
            expect(debris[12].trails).toBeGreaterThan(50);
            // The host-rolled wind reaches the visible cloud and carries its top downwind.
            const wind = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const layers = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow', 'reactor-volume-stem_nocol_noshadow']
                    .map((name) => slot.getObjectByName(name)).filter(Boolean);
                const windYaw = slot.userData.windYaw;
                arena.setGlbAnimationElapsedSeconds(40); arena._glbAnimation.advance(0);
                camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(0, 2600, 1); camera.lookAt(0, 300, 0); camera.updateMatrixWorld(true);
                const probe = document.createElement('canvas'); probe.width = 160; probe.height = 90;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
                    return context.getImageData(0, 0, 160, 90).data;
                };
                const headHeight = slot.getObjectByName('roll').getWorldPosition(camera.position.clone()).y;
                // Centre of the smoke seen from above, as a point on the head's height: pixels that
                // change with the smoke are averaged and cast back into the world.
                const topCentre = () => {
                    for (const layer of layers) layer.visible = false;
                    const without = grab();
                    for (const layer of layers) layer.visible = true;
                    const withSmoke = grab();
                    let px = 0, py = 0, n = 0;
                    for (let y = 0; y < 90; y += 1) {
                        for (let x = 0; x < 160; x += 1) {
                            const i = (y * 160 + x) * 4;
                            const change = Math.abs(withSmoke[i] - without[i]) + Math.abs(withSmoke[i + 1] - without[i + 1]) + Math.abs(withSmoke[i + 2] - without[i + 2]);
                            if (change > 24) { px += x; py += y; n += 1; }
                        }
                    }
                    const ndc = camera.position.clone().set((px / n + 0.5) / 160 * 2 - 1, 1 - (py / n + 0.5) / 90 * 2, 0.5).unproject(camera);
                    const ray = ndc.sub(camera.position).normalize();
                    const t = (headHeight - camera.position.y) / ray.y;
                    return { x: camera.position.x + ray.x * t, z: camera.position.z + ray.z * t };
                };
                const windy = topCentre();
                const png = runtime.renderer.domElement.toDataURL('image/png');
                delete slot.userData.windYaw;
                const calm = topCentre();
                slot.userData.windYaw = windYaw;
                camera.far = held.far; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                const dx = windy.x - calm.x, dz = windy.z - calm.z;
                return { windYaw, drift: Math.hypot(dx, dz), heading: Math.atan2(dz, dx), png };
            });
            await writeFile(testInfo.outputPath('wind-from-above-40s.png'), Buffer.from(wind.png.split(',')[1], 'base64'));
            delete wind.png;
            await writeFile(testInfo.outputPath('wind.json'), JSON.stringify(wind, null, 2));
            expect(typeof wind.windYaw).toBe('number');
            expect(wind.drift).toBeGreaterThan(40);
            const headingError = Math.abs(Math.atan2(Math.sin(wind.heading - wind.windYaw), Math.cos(wind.heading - wind.windYaw)));
            expect(headingError).toBeLessThan(0.15);
            // Seen from the ground the head has to be a body, not a lattice: sky enclosed by
            // smoke is what made the old cloud look like a heap of separate lumps.
            const solidity = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena, runtime = game.renderer, camera = runtime.cameras[0];
                const quality = runtime.getQualityState().requestedQuality;
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const layers = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow', 'reactor-volume-stem_nocol_noshadow']
                    .map((name) => slot.getObjectByName(name)).filter(Boolean);
                arena.setGlbAnimationElapsedSeconds(48); arena._glbAnimation.advance(0);
                camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(0, 60, 300); camera.lookAt(0, 700, 0); camera.updateMatrixWorld(true);
                const width = 200, height = 120;
                const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, width, height);
                    return context.getImageData(0, 0, width, height).data;
                };
                const result = {};
                for (const step of ['HIGH', 'LOW']) {
                    runtime.setQuality(step);
                    for (const layer of layers) layer.visible = false;
                    const without = grab();
                    for (const layer of layers) layer.visible = true;
                    const withSmoke = grab();
                    const png = runtime.renderer.domElement.toDataURL('image/png');
                    // How much each pixel changed when the smoke was drawn: its cover.
                    const cover = new Float32Array(width * height);
                    for (let i = 0, p = 0; i < cover.length; i += 1, p += 4) {
                        cover[i] = (Math.abs(withSmoke[p] - without[p]) + Math.abs(withSmoke[p + 1] - without[p + 1])
                            + Math.abs(withSmoke[p + 2] - without[p + 2])) / 3;
                    }
                    // Grey smoke against a bright sky moves a pixel only a little; the threshold is
                    // what the thinnest place inside the body still reaches.
                    const solid = (x, y) => cover[y * width + x] > 12;
                    const reaches = (x, y, dx, dy) => {
                        for (let cx = x + dx, cy = y + dy; cx >= 0 && cx < width && cy >= 0 && cy < height; cx += dx, cy += dy) {
                            if (solid(cx, cy)) return true;
                        }
                        return false;
                    };
                    let smoke = 0, gaps = 0;
                    for (let y = 0; y < height; y += 1) {
                        for (let x = 0; x < width; x += 1) {
                            if (solid(x, y)) smoke += 1;
                            else if (reaches(x, y, 1, 0) && reaches(x, y, -1, 0) && reaches(x, y, 0, 1) && reaches(x, y, 0, -1)) gaps += 1;
                        }
                    }
                    result[step] = { smoke, gaps, share: gaps / (smoke + gaps), png };
                }
                camera.far = held.far; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                runtime.setQuality(quality);
                return result;
            });
            for (const step of ['HIGH', 'LOW']) {
                await writeFile(testInfo.outputPath(`solidity-from-below-${step}.png`), Buffer.from(solidity[step].png.split(',')[1], 'base64'));
                delete solidity[step].png;
            }
            await writeFile(testInfo.outputPath('solidity.json'), JSON.stringify(solidity, null, 2));
            expect(solidity.HIGH.smoke).toBeGreaterThan(2500);
            // Before the solid body the crown let a ring of sky through: 7.6 percent from here.
            expect(solidity.HIGH.share).toBeLessThan(0.05);
            expect(solidity.LOW.smoke).toBeGreaterThan(2500);
            expect(solidity.LOW.share).toBeLessThan(0.1);
            // The blast wave's dust: a haze over the site from the ground, gone a few minutes on.
            const collar = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena, runtime = game.renderer, camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const surge = slot.getObjectByName('reactor-volume-surge_nocol_noshadow');
                camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(0, 30, 420); camera.lookAt(0, 70, 0); camera.updateMatrixWorld(true);
                const width = 160, height = 90;
                const probe = document.createElement('canvas'); probe.width = width; probe.height = height;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, width, height);
                    return context.getImageData(0, 0, width, height).data;
                };
                const result = {};
                for (const seconds of [12, 49 + 240]) {
                    arena.setGlbAnimationElapsedSeconds(seconds); arena._glbAnimation.advance(0);
                    surge.visible = false;
                    const without = grab();
                    surge.visible = true;
                    const withDust = grab();
                    // Only the collar is switched, so the difference is its dust alone.
                    let change = 0;
                    for (let i = 0; i < withDust.length; i += 4) {
                        change += Math.abs(withDust[i] - without[i]) + Math.abs(withDust[i + 1] - without[i + 1])
                            + Math.abs(withDust[i + 2] - without[i + 2]);
                    }
                    result[seconds] = { change, png: runtime.renderer.domElement.toDataURL('image/png') };
                }
                camera.far = held.far; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                return result;
            });
            for (const [seconds, entry] of Object.entries(collar)) {
                await writeFile(testInfo.outputPath(`collar-${seconds}s.png`), Buffer.from(entry.png.split(',')[1], 'base64'));
                delete entry.png;
            }
            await writeFile(testInfo.outputPath('collar.json'), JSON.stringify(collar, null, 2));
            expect(collar[12].change).toBeGreaterThan(80_000);
            expect(collar[289].change).toBeLessThan(collar[12].change * 0.1);
            // After the clip the cloud thins out on the match clock and a faint rest stays.
            const dissolve = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const held = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), far: camera.far };
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                const layers = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow', 'reactor-volume-stem_nocol_noshadow']
                    .map((name) => slot.getObjectByName(name)).filter(Boolean);
                camera.far = 5000; camera.updateProjectionMatrix();
                camera.position.set(1050, 520, 1150); camera.lookAt(0, 490, 0); camera.updateMatrixWorld(true);
                const probe = document.createElement('canvas'); probe.width = 160; probe.height = 90;
                const context = probe.getContext('2d', { willReadFrequently: true });
                const grab = () => {
                    runtime.renderer.setRenderTarget(null);
                    runtime.renderer.render(runtime.scene, camera);
                    context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
                    return context.getImageData(0, 0, 160, 90).data;
                };
                const result = {};
                for (const seconds of [40, 49 + 120, 49 + 420]) {
                    arena.setGlbAnimationElapsedSeconds(seconds); arena._glbAnimation.advance(0);
                    for (const layer of layers) layer.visible = false;
                    const without = grab();
                    for (const layer of layers) layer.visible = true;
                    const withSmoke = grab();
                    // How strongly the smoke changes the picture: its visible amount of smoke.
                    let change = 0, pixels = 0;
                    for (let i = 0; i < withSmoke.length; i += 4) {
                        const d = Math.abs(withSmoke[i] - without[i]) + Math.abs(withSmoke[i + 1] - without[i + 1]) + Math.abs(withSmoke[i + 2] - without[i + 2]);
                        change += d; if (d > 24) pixels += 1;
                    }
                    result[seconds] = { change, pixels, overrun: slot.userData.clipOverrunSeconds ?? slot.children[0]?.userData?.clipOverrunSeconds ?? null,
                        png: runtime.renderer.domElement.toDataURL('image/png') };
                }
                camera.far = held.far; camera.updateProjectionMatrix();
                camera.position.copy(held.position); camera.quaternion.copy(held.quaternion); camera.updateMatrixWorld(true);
                return result;
            });
            for (const [seconds, entry] of Object.entries(dissolve)) {
                await writeFile(testInfo.outputPath(`dissolve-${seconds}s.png`), Buffer.from(entry.png.split(',')[1], 'base64'));
                delete entry.png;
            }
            await writeFile(testInfo.outputPath('dissolve.json'), JSON.stringify(dissolve, null, 2));
            // Two minutes after the clip the cloud still stands; after seven only a faint rest.
            expect(dissolve[169].change).toBeGreaterThan(dissolve[40].change * 0.5);
            expect(dissolve[469].change).toBeLessThan(dissolve[169].change * 0.6);
            expect(dissolve[469].pixels).toBeGreaterThan(20);
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
                    // Cards and volume alike: with their heat forced to zero the picture must change.
                    const layers = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow', 'reactor-volume-stem_nocol_noshadow']
                        .map((name) => slot.getObjectByName(name)).filter(Boolean);
                    const prepared = layers.map((layer) => layer.onBeforeRender);
                    try {
                        layers.forEach((layer, index) => {
                            layer.onBeforeRender = function (...args) { prepared[index].apply(this, args); this.material.uniforms.heat.value = 0; };
                        });
                        runtime.renderer.render(runtime.scene,camera);
                        if (png === runtime.renderer.domElement.toDataURL('image/png')) throw new Error('Local embers are invisible during ascent');
                    } finally { layers.forEach((layer, index) => { layer.onBeforeRender = prepared[index]; }); }
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
        const volume = [
            'reactor-volume-head_nocol_noshadow',
            'reactor-volume-stem_nocol_noshadow',
            'reactor-volume-surge_nocol_noshadow',
        ].map((name) => slot.getObjectByName(name)).filter(Boolean);
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
                for (const layer of [smoke, ...volume]) layer.visible = mode === 'smoke';
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
        for (const layer of [smoke, ...volume]) layer.visible = true;
        for (const material of materials) material.visible = false;
        camera.position.copy(oldPosition); camera.quaternion.copy(oldRotation); camera.far = oldFar;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        const times = {};
        for (const mode of ['mesh','smoke']) {
            samples[mode].sort((a,b)=>a-b);
            times[mode] = { p50: samples[mode][18], p95: samples[mode][34] };
        }
        return { images, times, draws, cards: smoke.geometry.instanceCount, volume: volume.length,
            dimensions: [renderer.domElement.width,renderer.domElement.height] };
    });
    for (const { angle, png } of smokeReport.images) {
        await writeFile(testInfo.outputPath(`smoke-view-${angle}.png`),Buffer.from(png.split(',')[1],'base64'));
    }
    delete smokeReport.images;
    await writeFile(testInfo.outputPath('smoke-performance.json'),JSON.stringify(smokeReport,null,2));
    // The lowest graphics step reduces the march cost without changing the cloud's body.
    const quality = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.renderer;
        const camera = runtime.cameras[0];
        const slot = game.arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
        const cards = slot.getObjectByName('reactor-soft-smoke_nocol_noshadow');
        const head = slot.getObjectByName('reactor-volume-head_nocol_noshadow');
        const surge = slot.getObjectByName('reactor-volume-surge_nocol_noshadow');
        game.arena.setGlbAnimationElapsedSeconds(40); game.arena._glbAnimation.advance(0);
        const held = runtime.getQualityState?.()?.requestedQuality || 'HIGH';
        const sample = (step) => {
            runtime.setQuality(step);
            runtime.renderer.setRenderTarget(null);
            runtime.renderer.render(runtime.scene, camera);
            return { step, cards: cards.geometry.instanceCount, volume: head ? head.material.uniforms.bounds.value.x : null,
                surge: surge ? surge.material.uniforms.bounds.value.x : null,
                steps: head?.material.uniforms.marchSteps.value, lowDetail: head?.material.uniforms.lowDetail.value,
                quality: runtime.scene.userData.graphicsQuality };
        };
        const result = [sample('HIGH'), sample('LOW'), sample('HIGH')];
        runtime.setQuality(held);
        return result;
    });
    await writeFile(testInfo.outputPath('quality-switch.json'), JSON.stringify(quality, null, 2));
    if (smokeReport.volume) {
        expect(quality[0]).toMatchObject({ quality: 'HIGH', cards: 0 });
        expect(quality[0].volume).toBeGreaterThan(100);
        expect(quality[0].surge).toBeGreaterThan(100);
        expect(quality[1].quality).toBe('LOW');
        expect(quality[1].cards).toBe(0);
        expect(quality[1].volume).toBeGreaterThan(100);
        expect(quality[1].surge).toBeGreaterThan(100);
        expect(quality[1].steps).toBeLessThan(quality[0].steps);
        expect(quality[1].lowDetail).toBe(1);
        expect(quality[2].cards).toBe(0);
        expect(quality[2].volume).toBeGreaterThan(100);
        expect(quality[2].surge).toBeGreaterThan(100);
        expect(quality[2].lowDetail).toBe(0);
    }
    if (process.env.REACTOR_SPLIT_BENCH === '1') {
        // Fixed 2560x1080 split render, independent of an off-screen Electron window's size.
        // Compare the whole scene with and without smoke on the actual quality pixel ratios.
        const bench = await page.evaluate(async () => {
            const runtime = window.GAME_INSTANCE.renderer;
            const renderer = runtime.renderer;
            const gl = renderer.getContext();
            const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            if (!timer) return { skipped: 'GPU timer queries unavailable' };
            const viewport = runtime.viewportSystem;
            const cameras = [runtime.cameras[0], runtime.cameras[0].clone()];
            const slot = window.GAME_INSTANCE.arena._glbScene.children.find((node) => node.visible
                && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
            const smoke = ['reactor-soft-smoke_nocol_noshadow', 'reactor-volume-head_nocol_noshadow',
                'reactor-volume-stem_nocol_noshadow', 'reactor-volume-surge_nocol_noshadow']
                .map((name) => slot.getObjectByName(name)).filter(Boolean);
            const saved = { width: viewport.width, height: viewport.height, layout: viewport.layout,
                quality: runtime.getQualityState().requestedQuality,
                windYaw: slot.userData.windYaw,
                camera: { position: cameras[0].position.clone(), quaternion: cameras[0].quaternion.clone(),
                    far: cameras[0].far } };
            viewport.width = 2560; viewport.height = 1080;
            viewport.setSplitScreen(true, cameras);
            cameras[0].position.set(-300, 60, 700); cameras[0].lookAt(0, 500, 0);
            cameras[1].position.set(-330, 60, 730); cameras[1].lookAt(0, 500, 0);
            for (const camera of cameras.slice(0, 2)) {
                camera.far = 5000; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
            }
            const arena = window.GAME_INSTANCE.arena;
            slot.userData.windYaw = 0;
            arena.setGlbAnimationElapsedSeconds(48); arena._glbAnimation.advance(0);
            const samples = {};
            const sizes = {};
            for (const quality of ['HIGH', 'LOW']) {
                runtime.setQuality(quality);
                renderer.setSize(2560, 1080);
                runtime.postProcessingPipeline.setSize(2560, 1080);
                sizes[quality] = [renderer.domElement.width, renderer.domElement.height];
                for (const mode of quality === 'LOW' ? ['bare', 'head', 'stem', 'surge', 'smoke'] : ['bare', 'smoke']) {
                    for (const mesh of smoke) mesh.visible = mode === 'smoke' || mesh.name.includes(`volume-${mode}_`);
                    const key = `${quality}-${mode}`;
                    const queries = [];
                    for (let frame = 0; frame < 18; frame += 1) {
                        const query = gl.createQuery();
                        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
                        viewport.render(runtime.scene, cameras);
                        gl.endQuery(timer.TIME_ELAPSED_EXT);
                        queries.push(query);
                    }
                    for (let wait = 0; wait < 1000 && queries.some((query) => !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)); wait += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                    const values = [];
                    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
                    queries.forEach((query, frame) => {
                        if (frame >= 3 && !disjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                            values.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
                        }
                        gl.deleteQuery(query);
                    });
                    values.sort((a, b) => a - b);
                    samples[key] = { p50: values[Math.floor(values.length * .5)] ?? null,
                        p95: values[Math.floor(values.length * .95)] ?? null, n: values.length, disjoint };
                }
            }
            for (const mesh of smoke) mesh.visible = true;
            runtime.setQuality('LOW');
            renderer.setSize(2560, 1080);
            runtime.postProcessingPipeline.setSize(2560, 1080);
            viewport.render(runtime.scene, cameras);
            const png = renderer.domElement.toDataURL('image/png');
            slot.userData.windYaw = saved.windYaw;
            runtime.setQuality(saved.quality);
            viewport.width = saved.width; viewport.height = saved.height;
            viewport.setViewportLayout(saved.layout, runtime.cameras);
            renderer.setSize(saved.width, saved.height);
            runtime.postProcessingPipeline.setSize(saved.width, saved.height);
            cameras[0].position.copy(saved.camera.position); cameras[0].quaternion.copy(saved.camera.quaternion);
            cameras[0].far = saved.camera.far;
            cameras[0].updateProjectionMatrix(); cameras[0].updateMatrixWorld(true);
            return { sizes, samples, png };
        });
        if (bench.png) {
            await writeFile(testInfo.outputPath('reactor-low-split.png'), Buffer.from(bench.png.split(',')[1], 'base64'));
            delete bench.png;
        }
        await writeFile(testInfo.outputPath('reactor-split-bench.json'), JSON.stringify(bench, null, 2));
    }
    // Three ray-marched proxies remain active; non-volume renderers retain the card fallback.
    if (smokeReport.volume) expect(smokeReport.volume).toBe(3);
    else expect(smokeReport.cards).toBeGreaterThan(100);
    expect(smokeReport.cards).toBeLessThanOrEqual(512);
    expect(smokeReport.draws.smoke).toBeLessThan(smokeReport.draws.mesh);
    expect(errors).toEqual([]);
});
