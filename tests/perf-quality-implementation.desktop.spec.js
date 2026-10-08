import { writeFile } from 'node:fs/promises';
import { test, expect } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Compare production uploads with a full-upload reference and verify GPU bytes and pixels.
test.describe.configure({ timeout: 360000 });
const auditTimings = process.env.PW_PERF_AUDIT_TIMING !== '0';
const uploadScope = process.env.PW_PERF_UPLOAD_SCOPE || 'all';
if (!['all', 'particles', 'leaves'].includes(uploadScope)) throw new Error(`Invalid PW_PERF_UPLOAD_SCOPE: ${uploadScope}`);

for (const mapKey of ['standard', 'cherry_grove', 'dandelion_sky']) {
    test(`performance audit: ${mapKey} real GPU uploads and identical pixels`, async ({ page, electronApp }, testInfo) => {
        await waitForLoadedGame(page);
        await electronApp.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            if (window.isMaximized()) window.unmaximize();
            window.setContentSize(1920, 1080);
            window.showInactive();
            window.webContents.setBackgroundThrottling(false);
        });
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        await page.selectOption('#map-select', mapKey);
        await page.evaluate(() => {
            const slider = document.getElementById('bot-count');
            slider.value = '4'; slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => window.GAME_INSTANCE.settings.numBots === 4);
        await page.click('#btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const r = game.renderer;
            r.qualityController.setQualityLock(true, 'performance-audit');
            r.setQuality('HIGH'); r.setShadowQuality(3); r.setBloomQuality(1);
            r.renderer.setPixelRatio(1); r.postProcessingPipeline.setPixelRatio(1);
            r.viewportSystem.width = 1920; r.viewportSystem.height = 1080;
            r.renderer.setSize(1920, 1080); r.postProcessingPipeline.setSize(1920, 1080);
            r.viewportSystem.updateCameraAspects(r.cameras);
        });
        const baseline = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const times = [];
            let previous = 0;
            const start = performance.now();
            await new Promise((resolve) => {
                const sample = (now) => {
                    if (previous && now - start >= 2000) times.push(now - previous);
                    previous = now;
                    if (now - start < 10000) requestAnimationFrame(sample); else resolve();
                };
                requestAnimationFrame(sample);
            });
            const sorted = times.slice().sort((a, b) => a - b);
            const p = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
            const snapshot = game.runtimePerfProfiler.getSnapshot?.({ windowSize: times.length }) || null;
            game.gameLoop.stop();
            return {
                frames: times.length, fps: 1000 / (times.reduce((a, b) => a + b, 0) / times.length),
                p50: p(.5), p95: p(.95), p99: p(.99),
                state: game.state, actors: game.entityManager.players.length,
                quality: game.renderer.qualityController.getQualityState(),
                gpu: game.renderer.qualityController.gpuFrameTimer.getStats(),
                actorDetails: game.entityManager.players.map((player) => ({ index: player.index, bot: player.isBot })),
                cpu: snapshot ? { frameMs: snapshot.frameMs, subsystems: snapshot.subsystems } : null,
            };
        });
        const report = await page.evaluate(async ({ mapKey, auditTimings, uploadScope }) => {
            const game = window.GAME_INSTANCE;
            const renderer = game.renderer;
            const r = renderer.renderer;
            const gl = r.getContext();
            const extension = gl.getExtension('WEBGL_debug_renderer_info');
            const gpuName = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown';
            const records = [];
            const boundBuffers = new Map();
            let recording = false;
            let trackedArrays = null;
            const originalSubData = gl.bufferSubData;
            gl.bufferSubData = function (target, offset, source, sourceOffset, sourceCount) {
                if (recording && target === gl.ARRAY_BUFFER && trackedArrays?.has(source)) {
                    const bytes = (arguments.length >= 5 ? sourceCount : source.length) * source.BYTES_PER_ELEMENT;
                    const buffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
                    records.push({ bytes, offset, buffer });
                    boundBuffers.set(buffer, new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice());
                }
                return originalSubData.apply(this, arguments);
            };
            const pixels = () => {
                const result = new Uint8Array(r.domElement.width * r.domElement.height * 4);
                gl.readPixels(0, 0, r.domElement.width, r.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, result);
                return result;
            };
            const visualArtifacts = [];
            const capture = (dirty, retainVisual = false) => {
                records.length = 0; dirty(); recording = true;
                try { renderer.render(); } finally { recording = false; }
                return { bytes: records.reduce((sum, entry) => sum + entry.bytes, 0), calls: records.length,
                    image: pixels(), visual: retainVisual ? r.domElement.toDataURL('image/png') : null };
            };
            const pixelDiff = (a, b) => {
                let changed = 0, maxChannelDelta = 0;
                for (let i = 0; i < a.length; i++) {
                    const difference = Math.abs(a[i] - b[i]);
                    if (difference) changed++;
                    maxChannelDelta = Math.max(maxChannelDelta, difference);
                }
                return { changedChannels: changed, maxChannelDelta };
            };
            const timeRender = async (dirty) => {
                if (!auditTimings) return { skipped: true };
                const cpu = [], frame = [];
                renderer.qualityController.gpuFrameTimer.reset();
                let previous = 0;
                for (let i = 0; i < 90; i++) {
                    const now = await new Promise(requestAnimationFrame);
                    const start = performance.now(); dirty(); renderer.render();
                    if (i >= 30) { cpu.push(performance.now() - start); if (previous) frame.push(now - previous); }
                    previous = now;
                }
                cpu.sort((a, b) => a - b); frame.sort((a, b) => a - b);
                return { cpuMedianMs: cpu[Math.floor(cpu.length / 2)], frameP95Ms: frame[Math.floor(frame.length * .95)],
                    gpu: renderer.qualityController.gpuFrameTimer.getStats() };
            };
            const checks = [];
            try {
                if (mapKey !== 'cherry_grove' || uploadScope === 'all' || uploadScope === 'particles') {
                    const particles = game.particles;
                    particles.clear();
                    trackedArrays = new Set([particles.mesh.instanceMatrix.array]);
                    const camera = renderer.cameras[0];
                    const anchor = camera.position.clone().addScaledVector(camera.getWorldDirection(camera.position.clone()), 6);
                    for (const count of [100, 500, 1000]) {
                        particles.mesh.count = 0; renderer.render();
                        const emptyImage = pixels();
                        particles.count = count;
                        for (let i = 0; i < count; i++) {
                            const index = i * 3;
                            particles.positions[index] = anchor.x + (i % 10) * .2;
                            particles.positions[index + 1] = anchor.y + 2 + Math.floor(i / 100) * .2;
                            particles.positions[index + 2] = anchor.z + Math.floor(i / 10) % 10 * .2;
                            particles.velocities.fill(0, index, index + 3);
                            particles.colors.set([1, .35, .1], index);
                            particles.lifetimes[i] = particles.maxLifetimes[i] = 10;
                            particles.gravities[i] = 0; particles.scales[i] = .25;
                        }
                        particles.update(0);
                        trackedArrays.add(particles.mesh.instanceColor.array);
                        renderer.render();
                        const full = () => {
                            particles.update(0);
                            particles.mesh.instanceMatrix.clearUpdateRanges(); particles.mesh.instanceColor.clearUpdateRanges();
                            particles.mesh.instanceMatrix.needsUpdate = true; particles.mesh.instanceColor.needsUpdate = true;
                        };
                        const prefix = () => { particles.update(0); };
                        const before = capture(full, count === 100), after = capture(prefix, count === 100);
                        if (count === 100) visualArtifacts.push({ name: 'particles-100', baseline: before.visual, candidate: after.visual });
                        const timing = [];
                        for (const order of [['full', 'prefix'], ['prefix', 'full'], ['full', 'prefix']]) {
                            for (const variant of order) timing.push({ variant, ...(await timeRender(variant === 'full' ? full : prefix)) });
                        }
                        checks.push({ candidate: 'particle-prefix', count, controlledParticleCount: particles.count,
                            timingMethod: 'both variants update(0); baseline adds full-range dirty marking',
                            baselineBytes: before.bytes, candidateBytes: after.bytes,
                            baselineCalls: before.calls, candidateCalls: after.calls, pixels: pixelDiff(before.image, after.image),
                            visibleEffect: pixelDiff(emptyImage, before.image), timing });
                    }
                    particles.clear();
                }
                if (mapKey === 'cherry_grove' && (uploadScope === 'all' || uploadScope === 'leaves')) {
                    const controller = game.arena._cherryLeaves;
                    trackedArrays = new Set(controller.batches.map((batch) => batch.instanceMatrix.array));
                    controller.reset();
                    const group = controller.leaves[0].batchGroup;
                    const released = group.leaves.slice(0, Math.min(12, group.leaves.length));
                    for (const leaf of released) controller.release(leaf.index, 0);
                    controller.update(2);
                    // Frame the tested moving leaves so pixel equality cannot pass merely
                    // because the selected group is behind the player's camera.
                    const matrix = renderer.cameras[0].matrixWorld.clone();
                    group.batch.getMatrixAt(released[0].instance, matrix);
                    const target = released[0].releasePosition.clone().setFromMatrixPosition(matrix);
                    group.batch.localToWorld(target);
                    renderer.cameras[0].position.copy(target).add(target.clone().set(3, 2, 3));
                    renderer.cameras[0].lookAt(target); renderer.cameras[0].updateMatrixWorld(true);
                    renderer.render();
                    const full = () => {
                        controller.update(2);
                        for (const batch of controller.batches) { batch.instanceMatrix.clearUpdateRanges(); batch.instanceMatrix.needsUpdate = true; }
                    };
                    const partial = () => { controller.update(2); };
                    const before = capture(full, true), after = capture(partial, true);
                    visualArtifacts.push({ name: 'cherry-leaves', baseline: before.visual, candidate: after.visual });
                    const originalMatrices = group.batch.instanceMatrix.array.slice();
                    for (const leaf of released) {
                        group.batch.instanceMatrix.array.fill(0, leaf.instance * 16, leaf.instance * 16 + 16);
                        group.batch.instanceMatrix.array[leaf.instance * 16 + 15] = 1;
                    }
                    group.batch.instanceMatrix.needsUpdate = true; renderer.render();
                    const emptyImage = pixels();
                    group.batch.instanceMatrix.array.set(originalMatrices);
                    group.batch.instanceMatrix.needsUpdate = true; renderer.render();
                    checks.push({ candidate: 'cherry-dirty-groups', leaves: controller.count, groups: controller.batches.length,
                        timingMethod: 'both variants update(2); baseline adds full-group dirty marking',
                        released: released.length, baselineBytes: before.bytes, candidateBytes: after.bytes,
                        baselineCalls: before.calls, candidateCalls: after.calls, pixels: pixelDiff(before.image, after.image),
                        visibleEffect: pixelDiff(emptyImage, before.image),
                        timing: [{ variant: 'full', ...(await timeRender(full)) }, { variant: 'partial', ...(await timeRender(partial)) },
                            { variant: 'partial', ...(await timeRender(partial)) }, { variant: 'full', ...(await timeRender(full)) }] });
                }
                let buffersChecked = 0, bufferMismatches = 0;
                // Read back actual uploaded buffers, not just the JavaScript attribute arrays.
                const previousBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
                for (const [buffer, expected] of boundBuffers) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    const size = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
                    const data = new Uint8Array(size);
                    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
                    buffersChecked++;
                    if (data.length !== expected.length || data.some((byte, i) => byte !== expected[i])) bufferMismatches++;
                }
                gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
                return { mapKey, uploadScope, gpuName, dimensions: [r.domElement.width, r.domElement.height],
                    visibility: document.visibilityState, quality: renderer.qualityController.getQualityState(), checks,
                    gpuReadback: { buffersChecked, bufferMismatches }, visualArtifacts, glError: gl.getError() };
            } finally { gl.bufferSubData = originalSubData; }
        }, { mapKey, auditTimings, uploadScope });
        for (const visual of report.visualArtifacts || []) {
            for (const variant of ['baseline', 'candidate']) {
                const path = testInfo.outputPath(`${visual.name}-${variant}.png`);
                await writeFile(path, Buffer.from(visual[variant].split(',')[1], 'base64'));
                await testInfo.attach(`${visual.name}-${variant}`, { path, contentType: 'image/png' });
            }
        }
        delete report.visualArtifacts;
        const fullReport = { baseline, ...report };
        await writeFile(testInfo.outputPath('performance-audit.json'), JSON.stringify(fullReport, null, 2));
        await testInfo.attach('performance-audit', { path: testInfo.outputPath('performance-audit.json'), contentType: 'application/json' });
        console.log(`[performance-audit] ${JSON.stringify(fullReport)}`);
        expect(report.dimensions).toEqual([1920, 1080]);
        expect(report.visibility).toBe('visible');
        expect(report.quality.effectiveQuality).toBe('HIGH');
        expect(report.glError).toBe(0);
        expect(report.gpuReadback.bufferMismatches).toBe(0);
        expect(baseline.state).toBe('PLAYING');
        // Kirschhain intentionally selects its authored five-bot scenario at match start.
        expect(baseline.actors).toBe(mapKey === 'cherry_grove' ? 6 : 5);
        for (const check of report.checks) {
            if (check.mismatches !== undefined) expect(check.mismatches).toBe(0);
            if (check.visibleEffect) expect(check.visibleEffect.changedChannels).toBeGreaterThan(0);
            if (!check.pixels) continue;
            expect(check.pixels.changedChannels).toBe(0);
            expect(check.candidateBytes).toBeLessThanOrEqual(check.baselineBytes);
        }
        await page.screenshot({ path: testInfo.outputPath('scene.png') });
    });
}
