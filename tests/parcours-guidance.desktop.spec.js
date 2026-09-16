import { test, expect } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu } from './helpers.js';

async function countChangedMotifPixels(page, first, second) {
    return page.evaluate(async ({ firstPng, secondPng }) => {
        async function pixels(base64) {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            return context.getImageData(580, 390, 120, 140).data;
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
    }, { firstPng: first.toString('base64'), secondPng: second.toString('base64') });
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
        const runtime = game.arena._portalGateSystem.checkpointRingRuntime;
        const now = performance.now();
        runtime._guidanceTargetChangedAtMs = now - 400;
        runtime._animateGuidance(game.arena.checkpointRings, now);
    });

    const visibleMotifs = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const camera = game.renderer.cameras[0];
        const targets = game.arena._portalGateSystem.checkpointRingRuntime.getGuidanceView().targets;
        let count = 0;
        for (const target of targets) {
            for (const motif of target.mesh.userData.guidanceMotifs) {
                if (!motif.visible || motif.userData.guidanceCore.material.opacity <= 0) continue;
                const projected = motif.getWorldPosition(motif.position.clone()).project(camera);
                if (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1) count += 1;
            }
        }
        return count;
    });
    expect(visibleMotifs).toBeGreaterThanOrEqual(2);

    const screenshot = testInfo.outputPath('arcade-checkpoint-breath-no-bloom.png');
    const activePng = await page.screenshot({ path: screenshot, animations: 'disabled' });
    expect(await page.locator('#hud').isVisible()).toBe(true);
    await testInfo.attach('arcade-checkpoint-breath-no-bloom', { path: screenshot, contentType: 'image/png' });

    const laterPosition = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.arena._portalGateSystem.checkpointRingRuntime;
        const motif = runtime.getGuidanceView().targets[0].mesh.userData.guidanceMotifs[0];
        const before = motif.getWorldPosition(motif.position.clone());
        const now = performance.now();
        runtime._guidanceTargetChangedAtMs = now - 800;
        runtime._animateGuidance(game.arena.checkpointRings, now);
        const after = motif.getWorldPosition(motif.position.clone());
        return { before: before.toArray(), after: after.toArray() };
    });
    expect(laterPosition.after).not.toEqual(laterPosition.before);
    const laterScreenshot = testInfo.outputPath('arcade-checkpoint-breath-later-no-bloom.png');
    const laterPng = await page.screenshot({ path: laterScreenshot, animations: 'disabled' });
    await testInfo.attach('arcade-checkpoint-breath-later-no-bloom', { path: laterScreenshot, contentType: 'image/png' });
    expect(await countChangedMotifPixels(page, activePng, laterPng)).toBeGreaterThan(40);

    await page.evaluate(() => {
        window.GAME_INSTANCE.arena._portalGateSystem.checkpointRingRuntime.setGuidanceProvider(null);
    });
    const withoutBreath = testInfo.outputPath('arcade-checkpoint-without-breath-no-bloom.png');
    const withoutPng = await page.screenshot({ path: withoutBreath, animations: 'disabled' });
    await testInfo.attach('arcade-checkpoint-without-breath', { path: withoutBreath, contentType: 'image/png' });
    expect(await countChangedMotifPixels(page, activePng, withoutPng)).toBeGreaterThan(100);
});
