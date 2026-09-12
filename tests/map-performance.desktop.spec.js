import { writeFile } from 'node:fs/promises';
import { test, expect } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Opt-in hardware acceptance: never turn a slow machine into a flaky default smoke.
// Measure real animation frames and retain state/actor coverage alongside timings.
const enabled = process.env.PW_MAP_PERF === '1';
const mapKey = process.env.PW_MAP_PERF_KEY || 'standard';
const diagnostic = process.env.PW_MAP_PERF_DIAGNOSTIC === '1';
const fallback = process.env.PW_MAP_PERF_FALLBACK === '1';
const shadowQuality = Number(process.env.PW_MAP_PERF_SHADOWS ?? 3);
const bloomQuality = Number(process.env.PW_MAP_PERF_BLOOM ?? 0);
const minFps = Number(process.env.PW_MAP_PERF_MIN_FPS ?? 59);
const maxP95 = Number(process.env.PW_MAP_PERF_MAX_P95 ?? 18);
const maxP99 = Number(process.env.PW_MAP_PERF_MAX_P99 ?? 25);
// A filled pickup field must not cost more than this share of the opening frame rate.
const fullFieldRatio = Number(process.env.PW_MAP_PERF_FULL_FIELD_RATIO ?? 0.85);
const warmupMs = (diagnostic ? 3 : 15) * 1000;
const windowMs = Number(process.env.PW_MAP_PERF_WINDOW_SECONDS ?? (diagnostic ? 5 : 30)) * 1000;
// Pickup spawning fills the arena over roughly a minute, so the second window starts late.
const fullFieldAtMs = Number(process.env.PW_MAP_PERF_FULL_FIELD_AT_SECONDS ?? (diagnostic ? 20 : 90)) * 1000;
test.describe.configure({ timeout: diagnostic ? 360000 : 1200000 });

test(`${mapKey}: 1080p desktop frame pacing with one player and four bots`, async ({ page, electronApp }, testInfo) => {
    test.skip(!enabled, 'Set PW_MAP_PERF=1 to run the three hardware acceptance trials.');
    await waitForLoadedGame(page);
    if (fallback) await page.route(`**/assets/maps/${mapKey}/glb/01_world.glb`, (route) => route.abort());
    await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
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
        slider.value = '4';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.GAME_INSTANCE.settings.numBots === 4);
    const reports = [];
    for (let trial = 0; trial < (diagnostic ? 1 : 3); trial++) {
        if (trial === 0) await page.click('#btn-start');
        else await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.startMatch());
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 45000 });
        const loaded = await page.evaluate(() => {
            const arena = window.GAME_INSTANCE.arena;
            return { key: arena.currentMapKey, world: !!arena._glbScene, failed: !!arena._glbLoadError };
        });
        expect(loaded).toEqual({ key: mapKey, world: !fallback, failed: fallback });
        await page.evaluate(({ shadowQuality, bloomQuality }) => {
            const r = window.GAME_INSTANCE.renderer;
            r.qualityController.setQualityLock(true, 'map-performance-fixed-resolution');
            r.setQuality('HIGH');
            r.setShadowQuality(shadowQuality);
            r.setBloomQuality(bloomQuality);
            r.renderer.setPixelRatio(1);
            r.postProcessingPipeline.setPixelRatio(1);
            r._onResize();
        }, { shadowQuality, bloomQuality });
        // This is a normal keyboard turn, with collision, bots and camera still active.
        await page.keyboard.down('a');
        const report = await page.evaluate(({ warmupMs, windowMs, fullFieldAtMs }) => new Promise((resolve) => {
            const game = window.GAME_INSTANCE;
            const r = game.renderer.renderer;
            const gl = r.getContext();
            const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            // three.js clears info on every render() call, so a frame with post processing or a
            // split screen would only report its last pass. Reset once per presented frame instead.
            r.info.autoReset = false;
            const createWindow = (label) => ({ label, samples: [], gpuMs: [], draws: 0, triangles: 0,
                playing: 0, fullActors: 0, minPlayers: Infinity, maxPickups: 0, states: {}, subsystems: null });
            const fresh = createWindow('fresh');
            const fullField = createWindow('full_field');
            const endMs = fullFieldAtMs + windowMs;
            const windowAt = (elapsed) => {
                if (elapsed >= warmupMs && elapsed < warmupMs + windowMs) return fresh;
                if (elapsed >= fullFieldAtMs && elapsed < endMs) return fullField;
                return null;
            };
            const pending = [];
            let openQuery = null;
            let current = null;
            const start = performance.now();
            let last = start;
            const sample = (now) => {
                const elapsed = now - start;
                const frameMs = now - last;
                last = now;
                if (openQuery) {
                    gl.endQuery(timer.TIME_ELAPSED_EXT);
                    pending.push(openQuery);
                    openQuery = null;
                }
                while (pending.length) {
                    const entry = pending[0];
                    if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) break;
                    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
                        entry.window.gpuMs.push(gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6);
                    }
                    gl.deleteQuery(entry.query);
                    pending.shift();
                }
                const next = windowAt(elapsed);
                if (next !== current) {
                    // The profiler ring buffer only holds 720 frames; the telemetry interval sums the
                    // whole window instead. collision/hunt_targeting/bot_sensing are nested in update.
                    if (current) current.subsystems = game.runtimePerfProfiler.getTelemetryIntervalSnapshot().subsystems;
                    if (next) game.runtimePerfProfiler.beginTelemetryInterval();
                    current = next;
                }
                if (current) {
                    current.samples.push(frameMs);
                    current.draws += r.info.render.calls;
                    current.triangles += r.info.render.triangles;
                    current.states[game.state] = (current.states[game.state] || 0) + 1;
                    if (game.state === 'PLAYING') current.playing++;
                    if (game.entityManager.players.filter((p) => p.alive).length === 5) current.fullActors++;
                    current.minPlayers = Math.min(current.minPlayers, game.entityManager.players.length);
                    current.maxPickups = Math.max(current.maxPickups, game.entityManager.powerupManager?.items?.length || 0);
                }
                r.info.reset();
                if (current && timer) {
                    const query = gl.createQuery();
                    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
                    openQuery = { query, window: current };
                }
                if (elapsed < endMs) return requestAnimationFrame(sample);
                if (current) current.subsystems = game.runtimePerfProfiler.getTelemetryIntervalSnapshot().subsystems;
                r.info.autoReset = true;
                const summarize = (entry) => {
                    const sorted = entry.samples.slice().sort((a, b) => a - b);
                    const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
                    const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
                    const gpu = entry.gpuMs.slice().sort((a, b) => a - b);
                    return { label: entry.label, fps: 1000 / mean, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
                        frames: sorted.length, slowFrames: { over33: sorted.filter((v) => v > 33.3).length, over50: sorted.filter((v) => v > 50).length },
                        playingRatio: entry.playing / Math.max(1, sorted.length), fullActorsRatio: entry.fullActors / Math.max(1, sorted.length),
                        minPlayers: entry.minPlayers, maxPickups: entry.maxPickups, states: entry.states,
                        render: { meanDraws: entry.draws / Math.max(1, sorted.length), meanTriangles: entry.triangles / Math.max(1, sorted.length) },
                        // GPU timings inflate under partial load because the iGPU lowers its clock;
                        // compare differences between runs, not absolute values.
                        gpuMs: gpu.length ? { mean: gpu.reduce((a, b) => a + b, 0) / gpu.length, p50: gpu[Math.floor(gpu.length / 2)] } : null,
                        cpu: entry.subsystems };
                };
                const extension = gl.getExtension('WEBGL_debug_renderer_info');
                resolve({ windows: { fresh: summarize(fresh), fullField: summarize(fullField) },
                    visibility: document.visibilityState,
                    dimensions: [r.domElement.width, r.domElement.height],
                    gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
                    gpuTimingAvailable: !!timer,
                    quality: game.renderer.qualityController.getQualityState() });
            };
            requestAnimationFrame(sample);
        }), { warmupMs, windowMs, fullFieldAtMs });
        await page.keyboard.up('a');
        reports.push(report);
        console.log(`[map-performance] trial ${trial + 1}: ${JSON.stringify(report)}`);
        await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.returnToMenu());
        await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
    }
    const reportPath = testInfo.outputPath('performance.json');
    await writeFile(reportPath, JSON.stringify({ mapKey, mode: 'fight', diagnostic, fallback, shadowQuality, bloomQuality,
        warmupSeconds: warmupMs / 1000, windowSeconds: windowMs / 1000, fullFieldAtSeconds: fullFieldAtMs / 1000, reports }, null, 2));
    await testInfo.attach('performance', { path: reportPath, contentType: 'application/json' });
    for (const report of reports) {
        expect(report.dimensions).toEqual([1920, 1080]);
        expect(report.visibility).toBe('visible');
        for (const measured of [report.windows.fresh, report.windows.fullField]) {
            // An occluded or throttled window drops the loop to ~1 fps and would otherwise
            // report nonsense percentiles from a handful of frames.
            expect(measured.frames, `${measured.label}: window produced too few frames to judge`)
                .toBeGreaterThan((windowMs / 1000) * 10);
            expect(measured.playingRatio, `${measured.label}: menu frames cannot count as gameplay performance`).toBeGreaterThan(.99);
            expect(measured.minPlayers, `${measured.label}: all five actor slots must remain in the live respawn match`).toBe(5);
        }
        if (diagnostic) continue;
        expect(report.windows.fresh.fps).toBeGreaterThanOrEqual(minFps);
        expect(report.windows.fresh.p95).toBeLessThanOrEqual(maxP95);
        expect(report.windows.fresh.p99).toBeLessThanOrEqual(maxP99);
        // Pickups accumulate to the arena-sized cap, so a full field must not sink the frame rate.
        expect(report.windows.fullField.fps, 'a filled pickup field must not slow the match down')
            .toBeGreaterThanOrEqual(report.windows.fresh.fps * fullFieldRatio);
    }
});
