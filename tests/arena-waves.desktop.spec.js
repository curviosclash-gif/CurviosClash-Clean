import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';

// This intentionally uses the runtime's test-visible arcade seam to avoid waiting
// for combat AI. It still exercises the production menu button and overlay clicks.
test('Five Fronts starts, offers one upgrade, retains it across a forced map transition, and shows final results', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="single"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ force: true });
    await page.locator('#submenu-game:not(.hidden) [data-start-section-target="arcade"]')
        .evaluate((button) => button.click());
    await expect(page.locator('#btn-arcade-five-fronts-start-inline')).toBeVisible();
    await page.locator('#btn-arcade-five-fronts-start-inline').click({ force: true });
    await page.waitForFunction(() => {
        const runtime = window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.phase !== 'idle' && runtime?.entityManager?.bots?.length === 12;
    }, null, { timeout: 60_000 });
    const started = await page.evaluate(() => {
        const game = window.GAME_INSTANCE; const runtime = game.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return { map: runtime?.mapIndex, slots: runtime?.entityManager?.bots?.length, endless: !!runtime?.entityManager?.endlessParcoursRuntime };
    });
    expect(started).toEqual({ map: 0, slots: 12, endless: false });

    await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        runtime.wave = 4; runtime._openChoices('wave');
        window.GAME_INSTANCE.matchFlowUiController?._syncArcadeOverlayPanel?.();
    });
    await page.waitForSelector('#arcade-overlay-panel:not(.hidden) .arcade-overlay-choice-btn');
    await expect(page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn')).toHaveCount(4);
    const upgradeIndex = await page.evaluate(() => {
        const choices = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().choices;
        const preferred = choices.findIndex((choice) => choice === 'mg_tuning' || choice.startsWith('machine_gun:'));
        return preferred >= 0 ? preferred : 0;
    });
    await page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn').nth(upgradeIndex).click();
    const retained = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().upgrades);
    expect(retained).toBeTruthy();

    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        runtime._onHumanDeath();
        game.matchFlowUiController?._syncArcadeOverlayPanel?.();
    });
    await expect(page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn')).toHaveCount(4);
    await page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn').first().click();
    await page.evaluate(async () => window.GAME_INSTANCE.runtimeFacade.restartRound());
    await page.waitForFunction(() => {
        const runtime = window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.mapIndex === 1 && runtime?.phase === 'countdown'
            && runtime?.getHudState?.().currentMapKey === 'notre_dame_fire_arena';
    }, null, { timeout: 60_000 });
    const transitioned = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        return {
            mapIndex: runtime.mapIndex,
            mapKey: runtime.getHudState().currentMapKey,
            upgrades: runtime.getHudState().upgrades,
            managerRebuilt: runtime.entityManager !== null,
        };
    });
    expect(transitioned.mapIndex).toBe(1);
    expect(transitioned.mapKey).toBe('notre_dame_fire_arena');
    expect(transitioned.managerRebuilt).toBeTruthy();
    expect(transitioned.upgrades).toEqual(retained);

    await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        runtime.mapIndex = 4; runtime._finalize();
        window.GAME_INSTANCE.matchFlowUiController?._syncArcadeOverlayPanel?.();
    });
    await page.waitForSelector('#arcade-overlay-panel:not(.hidden)');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Fünf Fronten abgeschlossen');
    await expect(page.locator('#arcade-overlay-panel button')).toBeFocused();
});
