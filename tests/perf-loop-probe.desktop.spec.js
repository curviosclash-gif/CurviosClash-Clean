import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Measurement probe of the performance loop (.claude/skills/perf-loop). It only reports;
// scripts/perf-loop-judge.mjs compares a baseline build against a candidate build.
// Phase "quality" steps the match on a virtual clock with one render per tick, so its
// pixel hashes and simulation checkpoints do not depend on machine speed; two app starts of
// the same build must produce identical bits (the judge calls the measurement invalid otherwise).
// Phase "timing" runs in real time like perf-match-ab and measures CPU update/render and GPU cost.
const maps = (process.env.PW_PERF_PROBE_MAPS || 'standard,cherry_grove,dandelion_sky').split(',').map((s) => s.trim()).filter(Boolean);
const measureSeconds = Number(process.env.PW_PERF_PROBE_SECONDS || 20);
const warmupSeconds = Number(process.env.PW_PERF_PROBE_WARMUP || 5);
const qualityTicks = [60, 600, 1200];
const outDir = process.env.PW_PERF_PROBE_OUT || '';
const cpuProfileDir = process.env.PW_PERF_PROBE_CPU_PROFILE || '';
// Diagnostics: raw RGBA frames and a camera trace for a pixel diff between two app starts.
const dumpDir = process.env.PW_PERF_PROBE_DUMP || '';
test.describe.configure({ timeout: (measureSeconds + warmupSeconds + 180) * 1000 });

// Seeds Math.random (and, for the quality phase, freezes the clock), then starts a fresh match.
const startSeededMatch = async ({ virtualClock }) => {
    const game = window.GAME_INSTANCE;
    const probe = window.__perfProbe = { random: Math.random, now: performance.now, dateNow: Date.now,
        state: 87103, renderState: 19471, updating: true, tick: 0 };
    Math.random = () => {
        if (probe.updating) { probe.state = (Math.imul(probe.state, 1664525) + 1013904223) >>> 0; return probe.state / 4294967296; }
        probe.renderState = (Math.imul(probe.renderState, 1664525) + 1013904223) >>> 0;
        return probe.renderState / 4294967296;
    };
    if (virtualClock) {
        // A fixed origin: camera shake reads absolute time, so the app's real uptime must not leak in.
        // It lies beyond any real uptime, so the clock never runs backwards while the quality phase
        // runs; the timing phase that follows the jump back starts a fresh match.
        const base = 1e8;
        performance.now = () => base + probe.tick * 1000 / 60;
        Date.now = () => 1790000000000 + Math.round(probe.tick * 1000 / 60);
    }
    await game.startMatch();
    game.gameLoop.stop();
    const renderer = game.renderer, r = renderer.renderer;
    renderer.qualityController.setQualityLock(true, 'perf-loop-probe');
    renderer.setQuality('HIGH'); renderer.setShadowQuality(3); renderer.setBloomQuality(1);
    r.setPixelRatio(1); renderer.postProcessingPipeline.setPixelRatio(1);
    renderer.viewportSystem.width = 1920; renderer.viewportSystem.height = 1080;
    r.setSize(1920, 1080); renderer.postProcessingPipeline.setSize(1920, 1080);
    renderer.viewportSystem.updateCameraAspects(renderer.cameras);
};

// Steps the seeded match on the virtual clock, one render per tick, and fingerprints fixed frames.
const runQualityPhase = async ({ qualityTicks, dump }) => {
    const game = window.GAME_INSTANCE, probe = window.__perfProbe;
    const r = game.renderer.renderer, gl = r.getContext();
    const width = r.domElement.width, height = r.domElement.height;
    const image = new Uint8Array(width * height * 4);
    // FNV-1a per screen tile, so a failed comparison can say where the image changed.
    const tileHashes = (tilesX, tilesY) => {
        const hashes = new Array(tilesX * tilesY).fill(0x811c9dc5);
        for (let y = 0; y < height; y++) {
            const row = Math.min(tilesY - 1, Math.floor(y * tilesY / height)) * tilesX;
            for (let x = 0; x < width; x++) {
                const tile = row + Math.min(tilesX - 1, Math.floor(x * tilesX / width));
                const offset = (y * width + x) * 4;
                let h = hashes[tile];
                for (let c = 0; c < 4; c++) h = Math.imul(h ^ image[offset + c], 16777619) >>> 0;
                hashes[tile] = h;
            }
        }
        return hashes.map((h) => h.toString(16).padStart(8, '0'));
    };
    const simState = () => game.entityManager.players.map((p) => ({ position: p.position.toArray(),
        quaternion: p.quaternion.toArray(), alive: p.alive, health: p.health, score: p.score }));
    const frames = [], cameraTrace = [];
    while (probe.tick < Math.max(...qualityTicks)) {
        probe.tick++;
        probe.updating = true; game.gameLoop.updateFn(1 / 60);
        probe.updating = false; game.gameLoop.renderFrameId++;
        // The camera rig reads the loop's smoothed frame time, which otherwise keeps the last real
        // frame from before this phase; the first frame resets the rig like a round start.
        game.gameLoop._updateRenderTiming(performance.now(), 1 / 60, 1 / 60, probe.tick === 1, 'perf-loop-probe');
        game.gameLoop.renderFn(1, 1 / 60);
        if (dump && (probe.tick <= 10 || probe.tick % 30 === 0)) {
            cameraTrace.push([probe.tick, ...game.renderer.cameras[0].position.toArray(), ...game.renderer.cameras[0].quaternion.toArray()]);
        }
        if (!qualityTicks.includes(probe.tick)) continue;
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, image);
        const digest = await crypto.subtle.digest('SHA-256', image);
        let rgba = null;
        if (dump) {
            let binary = '';
            for (let i = 0; i < image.length; i += 0x8000) binary += String.fromCharCode.apply(null, image.subarray(i, i + 0x8000));
            rgba = btoa(binary);
        }
        frames.push({ tick: probe.tick, sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
            tiles: tileHashes(16, 9), sim: simState(), rgba,
            camera: { position: game.renderer.cameras[0]?.position.toArray(), quaternion: game.renderer.cameras[0]?.quaternion.toArray() },
            renderInfo: { calls: r.info.render.calls, triangles: r.info.render.triangles,
                geometries: r.info.memory.geometries, textures: r.info.memory.textures } });
    }
    return { width, height, frames, cameraTrace, glError: gl.getError(),
        effectiveQuality: game.renderer.qualityController.getQualityState().effectiveQuality };
};

// Models fetched by the previous pass may still be in flight; one landing mid-pass would change
// that pass's frames. Waits until no resource has finished loading for 1.5 s.
const settleAssetLoads = async (page) => {
    await page.waitForFunction(() => {
        const count = performance.getEntriesByType('resource').length;
        const settle = window.__perfProbeSettle ||= { count, since: performance.now() };
        if (count !== settle.count) { settle.count = count; settle.since = performance.now(); }
        return performance.now() - settle.since > 1500;
    }, null, { polling: 250, timeout: 60000 });
    await page.evaluate(() => { delete window.__perfProbeSettle; });
};

const restoreNatives = () => {
    const probe = window.__perfProbe;
    if (!probe) return;
    Math.random = probe.random; performance.now = probe.now; Date.now = probe.dateNow;
    delete window.__perfProbe;
};

for (const mapKey of maps) {
    test(`perf loop probe: ${mapKey}`, async ({ page, electronApp }, testInfo) => {
        // Boot-time scene setup draws from Math.random too; a fixed stream from the first script on
        // keeps two app starts of the same build pixel-identical.
        await page.addInitScript(() => {
            // The default buffer of 250 entries would fill up and make loading look idle.
            performance.setResourceTimingBufferSize(100000);
            let state = 7919;
            Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
        });
        await loadGame(page, { forceReload: true });
        await waitForLoadedGame(page);
        await electronApp.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win.isMaximized()) win.unmaximize();
            win.setContentSize(1920, 1080); win.showInactive();
            win.webContents.setBackgroundThrottling(false);
        });
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)');
        // The arena is built (and later reused) from here on; its decorative dust points are
        // placed with Math.random, so that build must already see a fixed stream.
        await page.evaluate(() => {
            const native = Math.random;
            let state = 30011;
            window.__perfProbeBuildRandom = native;
            Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
        });
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
            game.gameLoop.stop();
            Math.random = window.__perfProbeBuildRandom;
            delete window.__perfProbeBuildRandom;
            const prototype = Object.getPrototypeOf(game.entityManager._setupOps);
            window.__perfProbeRestoreSeed = prototype.resolveMatchSeed;
            prototype.resolveMatchSeed = () => 45021;
        });

        let cdp = null, cpuProfileError = null;
        const runQuality = async (suffix) => {
            await page.evaluate(startSeededMatch, { virtualClock: true });
            const result = await page.evaluate(runQualityPhase, { qualityTicks, dump: Boolean(dumpDir) });
            await page.evaluate(restoreNatives);
            for (const frame of result.frames) {
                if (!frame.rgba) continue;
                await mkdir(dumpDir, { recursive: true });
                await writeFile(path.join(dumpDir, `${mapKey}-${frame.tick}${suffix}-${result.width}x${result.height}.rgba`), Buffer.from(frame.rgba, 'base64'));
                delete frame.rgba;
            }
            return result;
        };
        try {
            // Vehicle and power-up models load asynchronously on first use, so whether one is ready in
            // a given tick depends on disk speed. A priming pass fills those caches; only the second,
            // identical pass is fingerprinted.
            await settleAssetLoads(page);
            const priming = await runQuality('-priming');
            await settleAssetLoads(page);
            const quality = await runQuality('');
            quality.priming = priming.frames.map(({ tick, sha256 }) => ({ tick, sha256 }));

            await page.evaluate(startSeededMatch, { virtualClock: false });
            // Started after the match start, so one-off shader compilation does not hide the steady-state hotspots.
            if (cpuProfileDir) {
                try {
                    cdp = await page.context().newCDPSession(page);
                    await cdp.send('Profiler.enable');
                    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
                    await cdp.send('Profiler.start');
                } catch (error) { cpuProfileError = String(error?.message || error); cdp = null; }
            }
            const timing = await page.evaluate(async ({ measureSeconds, warmupSeconds }) => {
                const game = window.GAME_INSTANCE, probe = window.__perfProbe;
                const renderer = game.renderer, r = renderer.renderer, gl = r.getContext();
                const profiler = game.gameLoop.runtimePerfProfiler || game.runtimePerfProfiler || null;
                const simState = () => game.entityManager.players.map((p) => ({ position: p.position.toArray(),
                    quaternion: p.quaternion.toArray(), alive: p.alive, health: p.health, score: p.score }));
                const intervals = [], updateTimes = [], renderTimes = [], cpuTimes = [], drawCalls = [], triangles = [], checkpoints = [];
                const totalTicks = Math.round((warmupSeconds + measureSeconds) * 60);
                const warmupTicks = warmupSeconds * 60;
                const heap = () => performance.memory?.usedJSHeapSize ?? null;
                let ticks = 0, lastFrame = 0, measuringStarted = false, heapStart = null;
                const begin = performance.now();
                await new Promise((resolve, reject) => {
                    const frame = (now) => {
                        try {
                            const measuring = ticks >= warmupTicks;
                            if (measuring && !measuringStarted) {
                                measuringStarted = true; heapStart = heap();
                                renderer.qualityController.gpuFrameTimer.reset(); profiler?.reset?.();
                            }
                            if (measuring && lastFrame) intervals.push(now - lastFrame);
                            lastFrame = now;
                            if (measuring) profiler?.beginFrame?.(intervals.at(-1) || 0, now);
                            const target = Math.min(totalTicks, Math.floor((now - begin) / 1000 * 60));
                            const updateStart = performance.now();
                            probe.updating = true;
                            while (ticks < target) {
                                game.gameLoop.updateFn(1 / 60); ticks++;
                                if (ticks % 300 === 0) checkpoints.push({ tick: ticks, players: simState() });
                            }
                            probe.updating = false;
                            const updateMs = performance.now() - updateStart;
                            game.gameLoop.renderFrameId++;
                            const frameDt = Math.min(0.05, Math.max(0, (intervals.at(-1) ?? 1000 / 60) / 1000));
                            game.gameLoop._updateRenderTiming(now, frameDt, frameDt, ticks === 0, 'perf-loop-probe');
                            const renderStart = performance.now();
                            game.gameLoop.renderFn(1, 1 / 60);
                            const renderMs = performance.now() - renderStart;
                            if (measuring) {
                                // GameLoop samples "update" around its own tick; the renderer samples "render" itself.
                                profiler?.recordSubsystemDuration?.('update', updateMs);
                                profiler?.endFrame?.(updateMs + renderMs, now);
                                updateTimes.push(updateMs); renderTimes.push(renderMs); cpuTimes.push(updateMs + renderMs);
                                drawCalls.push(r.info.render.calls); triangles.push(r.info.render.triangles);
                            }
                            if (ticks >= totalTicks) resolve(); else requestAnimationFrame(frame);
                        } catch (error) { reject(error); }
                    };
                    requestAnimationFrame(frame);
                });
                const summary = (values) => {
                    const sorted = values.slice().sort((a, b) => a - b);
                    const p = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
                    return { samples: sorted.length, meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
                        p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: sorted.at(-1) };
                };
                const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
                const extension = gl.getExtension('WEBGL_debug_renderer_info');
                return { ticks, matchSeed: game.entityManager.matchSeed, checkpoints, final: simState(),
                    frame: summary(intervals), update: summary(updateTimes), render: summary(renderTimes), cpu: summary(cpuTimes),
                    gpu: renderer.qualityController.gpuFrameTimer.getStats(),
                    renderInfo: { meanCalls: mean(drawCalls), meanTriangles: mean(triangles),
                        geometries: r.info.memory.geometries, textures: r.info.memory.textures },
                    heap: { startBytes: heapStart, endBytes: heap() },
                    profiler: profiler?.getSnapshot?.({ windowSize: cpuTimes.length }) || null,
                    gpuName: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
                    quality: renderer.qualityController.getQualityState(), dimensions: [r.domElement.width, r.domElement.height],
                    visibility: document.visibilityState, glError: gl.getError() };
            }, { measureSeconds, warmupSeconds });
            await page.evaluate(restoreNatives);

            if (cdp) {
                try {
                    const { profile } = await cdp.send('Profiler.stop');
                    await mkdir(cpuProfileDir, { recursive: true });
                    await writeFile(path.join(cpuProfileDir, `${mapKey}.cpuprofile`), JSON.stringify(profile));
                } catch (error) { cpuProfileError = String(error?.message || error); }
            }

            const report = { schema: 'curvios-perf-probe/1', mapKey, measureSeconds, warmupSeconds, qualityTicks,
                cpuProfiled: Boolean(cdp) && !cpuProfileError, cpuProfileError, quality, timing };
            const target = outDir ? path.join(outDir, `${mapKey}.json`) : testInfo.outputPath(`perf-probe-${mapKey}.json`);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, JSON.stringify(report, null, 2));
            console.log(`[perf-probe] ${mapKey} cpu=${timing.cpu.meanMs.toFixed(3)} p95=${timing.cpu.p95Ms.toFixed(3)} `
                + `gpu=${timing.gpu.medianMs} frame=${timing.frame.meanMs.toFixed(3)} calls=${timing.renderInfo.meanCalls.toFixed(1)}`);

            expect(quality.glError).toBe(0);
            expect(quality.effectiveQuality).toBe('HIGH');
            expect(quality.frames.map((frame) => frame.tick)).toEqual(qualityTicks);
            expect(timing.glError).toBe(0);
            expect(timing.quality.effectiveQuality).toBe('HIGH');
            expect(timing.dimensions).toEqual([1920, 1080]);
            expect(timing.visibility).toBe('visible');
            expect(timing.matchSeed).toBe(45021);
            expect(timing.cpu.samples).toBeGreaterThan(measureSeconds * 20);
        } finally {
            await cdp?.detach().catch(() => {});
            await page.evaluate(() => {
                const probe = window.__perfProbe;
                if (probe) { Math.random = probe.random; performance.now = probe.now; Date.now = probe.dateNow; delete window.__perfProbe; }
                const game = window.GAME_INSTANCE;
                game.gameLoop.stop();
                Object.getPrototypeOf(game.entityManager._setupOps).resolveMatchSeed = window.__perfProbeRestoreSeed;
                delete window.__perfProbeRestoreSeed;
            });
        }
    });
}
