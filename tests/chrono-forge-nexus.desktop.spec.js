import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('Chrono-Forge Nexus loads and advances all eight Blender loops on desktop', async ({ page }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'chrono_forge_nexus');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'chrono_forge_nexus'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'chrono_forge_nexus'
        && window.GAME_INSTANCE?.arena?._glbAnimationMixers?.length === 8
    ), null, { timeout: 30000 });

    const before = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbAnimationMixers.map((mixer) => mixer.time)
    ));
    await page.waitForTimeout(350);
    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            mixerTimes: arena._glbAnimationMixers.map((mixer) => mixer.time),
            loadError: arena._glbLoadError,
            warnings: arena._glbLoadWarnings,
            colliderMode: arena._glbFootprint?.colliderMode,
        };
    });

    expect(state.mapKey).toBe('chrono_forge_nexus');
    expect(state.loadError).toBeNull();
    expect(state.warnings).toEqual([]);
    expect(state.colliderMode).toBe('fallbackOnly');
    expect(state.mixerTimes).toHaveLength(8);
    expect(state.mixerTimes.every((time, index) => time > before[index])).toBeTruthy();
});
