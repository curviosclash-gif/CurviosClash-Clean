import { loadGame, openCustomSubmenu } from '../helpers.js';

// Arcade now stays in the journey hub. These geometry checks start the authored
// course through the public runtime, rather than waiting for the free-play form.
export async function startArcadeParcours(page, mapKey) {
    await loadGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.localSettings?.modePath === 'arcade');
    await page.evaluate(async key => {
        const game = window.GAME_INSTANCE;
        game.settings.mapKey = key;
        game.settings.numBots = 0;
        game.settings.gameMode = 'ARCADE';
        Object.assign(game.settings.arcade, { runType: 'gauntlet', dailyChallenge: false });
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['map', 'bots.count', 'arcade.runType'] });
        await game.runtimeFacade.startMatch();
    }, mapKey);
    await page.waitForFunction(key => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING' && game.runtimeConfig?.session?.mapKey === key
            && !!game.entityManager?._parcoursProgressSystem;
    }, mapKey, { timeout: 60000 });
}
