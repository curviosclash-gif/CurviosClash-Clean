import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const MAP_KEY = 'clockwork_canyon';

test('Clockwork Canyon storm drives players into the rock nooks at the arena scale', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING' && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.humanPlayers?.length === 2;
    }, MAP_KEY, { timeout: 120_000 });
    await waitForRenderFrames(page, 12);

    const storm = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        const scale = Number(game.entityManager.entityRuntimeConfig?.ARENA?.MAP_SCALE) || 1;
        system.startRound();
        system.update(system.getState().remainingSeconds);
        system.update(20);
        system.update(20);
        // East nook, authored x 56.5..64.5, y 0.5..11.5, z 27..43; the arena builds it at MAP_SCALE.
        const [outside, inside] = manager.humanPlayers;
        inside.position.set(60.5 * scale, 6 * scale, 35 * scale);
        outside.position.set(0, 20 * scale, -30 * scale);
        system.update(0);
        const blocked = game.arena.raycast?.(
            { x: 60.5 * scale, y: 6 * scale, z: 35 * scale }, { x: 0, y: 1, z: 0 }, 20 * scale
        );
        return {
            scale,
            state: system.getState(),
            ranges: game.renderer.cameras.slice(0, 2).map((camera) => camera.userData.sandstormVisibilityRange),
            roofAbove: blocked?.hit === true,
            dust: system.getRenderState().particleCount,
        };
    });
    expect(storm.scale).toBeGreaterThan(1);
    expect(storm.state.phase).toBe('ACTIVE');
    expect(storm.state.intensity).toBe(1);
    expect(storm.ranges).toEqual([12, 85]);
    expect(storm.roofAbove, 'the nook has a rock roof in the built arena').toBe(true);
    expect(storm.dust).toBeGreaterThan(0);
    await waitForRenderFrames(page, 6);
    await page.screenshot({ path: testInfo.outputPath('canyon-storm-outside-and-nook.png') });
    expect(errors).toEqual([]);
});
