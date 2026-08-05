import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('Eclipse Foundry loads and advances all thirteen GLB animation loops on desktop', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'eclipse_foundry');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'eclipse_foundry'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await expect.poll(() => page.evaluate(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'eclipse_foundry'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimationMixers?.length === 13
    )), {
        timeout: 90_000,
        message: 'Eclipse Foundry should load all animated GLBs',
    }).toBeTruthy();

    const initialTimes = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbAnimationMixers.map((mixer) => mixer.time)
    ));
    await expect.poll(() => page.evaluate((times) => {
        const game = window.GAME_INSTANCE;
        const mixers = game?.arena?._glbAnimationMixers || [];
        return mixers.length === times.length
            && mixers.every((mixer, index) => mixer.time > times[index]);
    }, initialTimes), {
        timeout: 10_000,
        message: 'all Eclipse Foundry animation mixers should advance after match start',
    }).toBeTruthy();

    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            mixerCount: arena._glbAnimationMixers.length,
            warningCount: arena._glbLoadWarnings.length,
            colliderMode: arena.currentMapDefinition?.glbColliderMode,
            glbSceneChildren: arena._glbScene?.children?.length || 0,
        };
    });

    expect(state).toEqual({
        mapKey: 'eclipse_foundry',
        mixerCount: 13,
        warningCount: 0,
        colliderMode: 'fallbackOnly',
        glbSceneChildren: 26,
    });
});
