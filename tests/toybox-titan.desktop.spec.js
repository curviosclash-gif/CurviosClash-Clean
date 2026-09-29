import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';

test('Riesen-Kinderzimmer starts a three-bot Hunt on the loaded nursery GLB', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await expect(page.locator('#map-select option[value="toybox_titan"]')).toHaveCount(1);
    await page.selectOption('#map-select', 'toybox_titan');
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => window.GAME_INSTANCE?.arena?.currentMapKey === 'toybox_titan',
        null, { timeout: 120_000 });

    await expect.poll(() => page.evaluate(() => {
        let meshes = 0;
        window.GAME_INSTANCE?.arena?._glbScene?.traverse((node) => { if (node.isMesh) meshes += 1; });
        return meshes;
    }), { timeout: 60_000 }).toBeGreaterThanOrEqual(20);

    // A spawn inside geometry kills the player before it gets far from its spawn point.
    const start = await page.evaluate(() => {
        const human = window.GAME_INSTANCE.entityManager.players.find((player) => !player.isBot);
        return { x: human.position.x, z: human.position.z };
    });
    await expect.poll(() => page.evaluate(({ x, z }) => {
        const human = window.GAME_INSTANCE?.entityManager?.players?.find((player) => !player.isBot);
        if (!human?.alive || !human.position) return 0;
        return Math.hypot(human.position.x - x, human.position.z - z);
    }, start), { timeout: 30_000 }).toBeGreaterThan(12);
    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const players = game.entityManager.players;
        return {
            mode: game.activeGameMode,
            bots: players.filter((player) => player.isBot).length,
            humanAlive: players.find((player) => !player.isBot)?.alive === true,
            mapLoadError: !!game.arena._glbLoadError,
        };
    });
    expect(state.mode).toBe('HUNT');
    expect(state.bots).toBe(3);
    expect(state.humanAlive).toBe(true);
    expect(state.mapLoadError).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('toybox-titan-ingame.png') });
});
