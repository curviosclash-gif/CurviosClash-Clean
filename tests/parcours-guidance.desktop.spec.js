import { test, expect } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu } from './helpers.js';

test('Arcade checkpoint breath screenshots include in-frustum motifs', async ({ page }, testInfo) => {
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
        const runtime = window.GAME_INSTANCE.arena._portalGateSystem.checkpointRingRuntime;
        runtime._guidanceTargetChangedAtMs = performance.now();
    });
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        const guidance = game?.arena?._portalGateSystem?.checkpointRingRuntime?.getGuidanceView?.();
        return guidance?.active === true && guidance.targets.some((target) => (
            target.mesh?.userData?.guidanceMotifs?.some((motif) => motif.visible && motif.material.opacity > 0)
        ));
    }, null, { timeout: 3000 });

    const visibleMotifs = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const camera = game.renderer.cameras[0];
        const targets = game.arena._portalGateSystem.checkpointRingRuntime.getGuidanceView().targets;
        let count = 0;
        for (const target of targets) {
            for (const motif of target.mesh.userData.guidanceMotifs) {
                if (!motif.visible || motif.material.opacity <= 0) continue;
                const projected = motif.getWorldPosition(motif.position.clone()).project(camera);
                if (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1) count += 1;
            }
        }
        return count;
    });
    expect(visibleMotifs).toBeGreaterThanOrEqual(2);

    await page.evaluate(() => {
        const banner = document.querySelector('#arcade-sector-transition-overlay');
        if (banner) banner.style.visibility = 'hidden';
    });
    const screenshot = testInfo.outputPath('arcade-checkpoint-breath.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    expect(await page.locator('#hud').isVisible()).toBe(true);
    await testInfo.attach('arcade-checkpoint-breath', { path: screenshot, contentType: 'image/png' });

    await page.evaluate(() => {
        window.GAME_INSTANCE.arena._portalGateSystem.checkpointRingRuntime.setGuidanceProvider(null);
    });
    const withoutBreath = testInfo.outputPath('arcade-checkpoint-without-breath.png');
    await page.screenshot({ path: withoutBreath, animations: 'disabled' });
    await testInfo.attach('arcade-checkpoint-without-breath', { path: withoutBreath, contentType: 'image/png' });
});
