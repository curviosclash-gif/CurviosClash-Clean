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
test.describe.configure({ timeout: 360000 });

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
        const report = await page.evaluate(({ diagnostic }) => new Promise((resolve) => {
            const game = window.GAME_INSTANCE;
            const start = performance.now();
            let last = start;
            let playing = 0;
            let fullActors = 0;
            let minPlayers = Infinity;
            let draws = 0;
            let triangles = 0;
            const samples = [];
            const states = {};
            const sample = (now) => {
                if (now - start >= (diagnostic ? 3000 : 15000)) {
                    samples.push(now - last);
                    states[game.state] = (states[game.state] || 0) + 1;
                    if (game.state === 'PLAYING') playing++;
                    if (game.entityManager.players.filter((p) => p.alive).length === 5) fullActors++;
                    minPlayers = Math.min(minPlayers, game.entityManager.players.length);
                    draws += game.renderer.renderer.info.render.calls;
                    triangles += game.renderer.renderer.info.render.triangles;
                }
                last = now;
                if (now - start < (diagnostic ? 13000 : 75000)) return requestAnimationFrame(sample);
                samples.sort((a, b) => a - b);
                const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
                const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
                const r = game.renderer.renderer;
                const gl = r.getContext();
                const extension = gl.getExtension('WEBGL_debug_renderer_info');
                resolve({ fps: 1000 / mean, p95: percentile(.95), p99: percentile(.99),
                    frames: samples.length, playingRatio: playing / samples.length, minPlayers,
                    fullActorsRatio: fullActors / samples.length, states,
                    visibility: document.visibilityState,
                    dimensions: [r.domElement.width, r.domElement.height],
                    gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
                    quality: game.renderer.qualityController.getQualityState(),
                    render: { meanDraws: draws / samples.length, meanTriangles: triangles / samples.length },
                    cpu: game.runtimePerfProfiler.getSnapshot({ windowSize: samples.length, spikeEventsLimit: 0 }).subsystems,
                });
            };
            requestAnimationFrame(sample);
        }), { diagnostic });
        await page.keyboard.up('a');
        reports.push(report);
        console.log(`[map-performance] trial ${trial + 1}: ${JSON.stringify(report)}`);
        await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.returnToMenu());
        await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
    }
    const reportPath = testInfo.outputPath('performance.json');
    await writeFile(reportPath, JSON.stringify({ mapKey, mode: 'fight', diagnostic, fallback, shadowQuality, bloomQuality,
        warmupSeconds: diagnostic ? 3 : 15, measureSeconds: diagnostic ? 10 : 60, reports }, null, 2));
    await testInfo.attach('performance', { path: reportPath, contentType: 'application/json' });
    for (const report of reports) {
        expect(report.dimensions).toEqual([1920, 1080]);
        expect(report.visibility).toBe('visible');
        expect(report.playingRatio, 'menu frames cannot count as gameplay performance').toBeGreaterThan(.99);
        expect(report.minPlayers, 'all five actor slots must remain in the live respawn match').toBe(5);
        if (diagnostic) continue;
        expect(report.fps).toBeGreaterThanOrEqual(59);
        expect(report.p95).toBeLessThanOrEqual(18);
        expect(report.p99).toBeLessThanOrEqual(25);
    }
});
