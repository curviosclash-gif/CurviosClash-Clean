import { test, expect } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu } from './helpers.js';

// The trail now starts just ahead of the ship, so the compared window follows the projected
// motifs instead of a fixed spot near the ring.
async function countChangedMotifPixels(page, first, second, region) {
    return page.evaluate(async ({ firstPng, secondPng, cssRegion }) => {
        async function pixels(base64) {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const scale = image.width / Math.max(1, window.innerWidth);
            const x = Math.max(0, Math.floor(cssRegion.x * scale));
            const y = Math.max(0, Math.floor(cssRegion.y * scale));
            const width = Math.max(1, Math.min(image.width - x, Math.ceil(cssRegion.width * scale)));
            const height = Math.max(1, Math.min(image.height - y, Math.ceil(cssRegion.height * scale)));
            return context.getImageData(x, y, width, height).data;
        }
        const a = await pixels(firstPng);
        const b = await pixels(secondPng);
        let changed = 0;
        for (let i = 0; i < a.length; i += 4) {
            if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 18) {
                changed += 1;
            }
        }
        return changed;
    }, { firstPng: first.toString('base64'), secondPng: second.toString('base64'), cssRegion: region });
}

// Sets the breath phase on the runtime's game clock. The loop is frozen (time scale 0), so
// the clock stands still; the progress stamp keeps the stall watchdog from restarting the breath.
async function setBreathPhase(page, elapsedMs) {
    await page.evaluate((elapsed) => {
        const game = window.GAME_INSTANCE;
        const runtime = game.arena._portalGateSystem.checkpointRingRuntime;
        const now = runtime._clockMs;
        runtime._guidanceTargetChangedAtMs = now - elapsed;
        runtime._guidanceLastProgressMs = now;
        runtime._animateGuidance(game.arena.checkpointRings, now);
    }, elapsedMs);
}

test('Arcade checkpoint breath remains visible without bloom in a frozen scene', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'parcours_rift');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const botSlider = document.getElementById('bot-count');
        if (botSlider) botSlider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 20000 });
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        const guidance = game?.arena?._portalGateSystem?.checkpointRingRuntime?.getGuidanceView?.();
        return guidance?.targets?.length > 0;
    }, null, { timeout: 10000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.gameLoop.setTimeScale(0);
        game.renderer.setBloomQuality('OFF');
        const banner = document.querySelector('#arcade-sector-transition-overlay');
        if (banner) banner.style.setProperty('display', 'none', 'important');
    });
    await setBreathPhase(page, 400);

    const motifProbe = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const camera = game.renderer.cameras[0];
        const targets = game.arena._portalGateSystem.checkpointRingRuntime.getGuidanceView().targets;
        let count = 0;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const target of targets) {
            for (const motif of target.mesh.userData.guidanceMotifs) {
                if (!motif.visible || motif.userData.guidanceCore.material.opacity <= 0) continue;
                const projected = motif.getWorldPosition(motif.position.clone()).project(camera);
                if (!(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1)) continue;
                count += 1;
                const px = (projected.x + 1) * 0.5 * window.innerWidth;
                const py = (1 - projected.y) * 0.5 * window.innerHeight;
                minX = Math.min(minX, px); maxX = Math.max(maxX, px);
                minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }
        }
        const pad = 60;
        const region = count > 0
            ? { x: Math.max(0, minX - pad), y: Math.max(0, minY - pad), width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
            : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        return { count, region };
    });
    expect(motifProbe.count).toBeGreaterThanOrEqual(2);

    const screenshot = testInfo.outputPath('arcade-checkpoint-breath-no-bloom.png');
    const activePng = await page.screenshot({ path: screenshot, animations: 'disabled' });
    expect(await page.locator('#hud').isVisible()).toBe(true);
    await testInfo.attach('arcade-checkpoint-breath-no-bloom', { path: screenshot, contentType: 'image/png' });

    const motifWorldPosition = () => page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.arena._portalGateSystem.checkpointRingRuntime;
        const motif = runtime.getGuidanceView().targets[0].mesh.userData.guidanceMotifs[0];
        return motif.getWorldPosition(motif.position.clone()).toArray();
    });
    const before = await motifWorldPosition();
    await setBreathPhase(page, 800);
    const after = await motifWorldPosition();
    expect(after).not.toEqual(before);
    const laterScreenshot = testInfo.outputPath('arcade-checkpoint-breath-later-no-bloom.png');
    const laterPng = await page.screenshot({ path: laterScreenshot, animations: 'disabled' });
    await testInfo.attach('arcade-checkpoint-breath-later-no-bloom', { path: laterScreenshot, contentType: 'image/png' });
    expect(await countChangedMotifPixels(page, activePng, laterPng, motifProbe.region)).toBeGreaterThan(40);

    const bloomEnabled = await page.evaluate(() => {
        const renderer = window.GAME_INSTANCE.renderer;
        renderer.setBloomQuality(2);
        return renderer.postProcessingPipeline.enabled;
    });
    expect(bloomEnabled).toBe(true);
    const bloomScreenshot = testInfo.outputPath('arcade-checkpoint-breath-high-bloom.png');
    await page.screenshot({ path: bloomScreenshot, animations: 'disabled' });
    await testInfo.attach('arcade-checkpoint-breath-high-bloom', { path: bloomScreenshot, contentType: 'image/png' });

    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.renderer.setBloomQuality(0);
        game.arena._portalGateSystem.checkpointRingRuntime.setGuidanceProvider(null);
    });
    const withoutBreath = testInfo.outputPath('arcade-checkpoint-without-breath-no-bloom.png');
    const withoutPng = await page.screenshot({ path: withoutBreath, animations: 'disabled' });
    await testInfo.attach('arcade-checkpoint-without-breath', { path: withoutBreath, contentType: 'image/png' });
    expect(await countChangedMotifPixels(page, activePng, withoutPng, motifProbe.region)).toBeGreaterThan(100);
});
