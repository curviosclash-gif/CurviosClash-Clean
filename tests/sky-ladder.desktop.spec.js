import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';

// The racing lines of each stage are checked against the compiled colliders in
// tests/sky-ladder-maps.contract.test.mjs; this spec proves the chain itself in the desktop shell.
const SKY_LADDER_MAPS = ['sky_ladder_abyss', 'sky_ladder_foundry', 'sky_ladder_storm', 'sky_ladder_star'];

test('Himmelsleiter starts from the arcade menu and climbs four parcours through exit portals', async ({ page }) => {
    test.setTimeout(240_000);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="single"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ force: true });
    await page.locator('#submenu-game:not(.hidden) [data-start-section-target="arcade"]')
        .evaluate((button) => button.click());
    await page.locator('.arcade-start-mode-options-summary').click();
    await expect(page.locator('#btn-arcade-sky-ladder-start-inline')).toBeVisible();
    await page.locator('#btn-arcade-sky-ladder-start-inline').click({ force: true });

    for (let index = 0; index < SKY_LADDER_MAPS.length; index += 1) {
        await page.waitForFunction((expected) => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
            return runtime?.phase === 'racing' && runtime?.getHudState()?.currentMapKey === expected
                && runtime?.entityManager === game?.entityManager
                && game?.arena?.currentMapKey === expected;
        }, SKY_LADDER_MAPS[index], { timeout: 60_000 });

        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const hud = game.runtimeFacade._arcadeSupport.fivePortalsRuntime.getHudState();
            return {
                chainId: hud.chainId,
                mapCount: hud.mapCount,
                mapIndex: hud.mapIndex,
                bots: game.entityManager.bots.length,
                exits: game.arena.exitPortals.length,
                exitActive: game.arena.exitPortals[0]?.active,
                rings: game.arena.checkpointRings.filter((ring) => !ring.isFinish).length,
                hasFinish: game.arena.checkpointRings.some((ring) => ring.isFinish),
            };
        });
        expect(state).toEqual(expect.objectContaining({
            chainId: 'sky_ladder',
            mapCount: 4,
            mapIndex: index,
            bots: 0,
            exits: 1,
            exitActive: false,
            hasFinish: true,
        }));
        expect(state.rings).toBeGreaterThanOrEqual(12);
        await expect(page.locator('#arcade-score-hud')).toContainText(`Map ${index + 1}/4`);

        await page.evaluate((mapIndex) => {
            const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.fivePortalsRuntime;
            runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: (mapIndex + 1) * 1000 });
        }, index);
        await expect(page.locator('#arcade-score-hud')).toContainText('Goldenes Portal');
        const triggered = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const result = game.arena.checkExitPortal(game.arena.exitPortals[0].pos, 1, 0);
            if (result?.triggered) game.entityManager._emitArcadeGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
            return result?.triggered === true;
        });
        expect(triggered).toBe(true);
    }

    await page.waitForFunction(() => window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime?.phase === 'finished');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Himmelsleiter abgeschlossen');
    await expect(page.locator('#arcade-overlay-panel [data-stats-block-id="five-portals-maps"] [data-stats-row-key]')).toHaveCount(4);
    await expect(page.locator('#arcade-overlay-panel [data-stats-block-id="five-portals-total"] [data-stats-row-key="total"] .message-stats-value')).toHaveText(/10,00\s*s/);
});
