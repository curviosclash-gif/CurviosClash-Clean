import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';
import { applyArenaWavesChoice } from '../src/shared/contracts/ArenaWavesContract.js';
import { EIFFEL_TOWER_SIEGE_MODELS } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeModels.js';

// This intentionally uses the runtime's test-visible arcade seam to avoid waiting
// for combat AI. It still exercises the production menu button and overlay clicks.
test('Five Fronts starts, offers one upgrade, retains it across a forced map transition, and shows final results', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="single"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ force: true });
    await page.locator('#submenu-game:not(.hidden) [data-start-section-target="arcade"]')
        .evaluate((button) => button.click());
    await page.locator('.arcade-start-mode-options-summary').click();
    await expect(page.locator('#btn-arcade-five-fronts-start-inline')).toBeVisible();
    await page.locator('#btn-arcade-five-fronts-start-inline').click({ force: true });
    await page.waitForFunction(() => {
        const runtime = window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.phase !== 'idle' && runtime?.entityManager?.bots?.length === 24;
    }, null, { timeout: 60_000 });
    const started = await page.evaluate(() => {
        const game = window.GAME_INSTANCE; const runtime = game.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return { map: runtime?.mapIndex, slots: runtime?.entityManager?.bots?.length, endless: !!runtime?.entityManager?.endlessParcoursRuntime, nextWaveInSeconds: runtime?.getHudState?.().nextWaveInSeconds };
    });
    expect(started.map).toBe(0);
    expect(started.slots).toBe(24);
    expect(started.endless).toBe(false);
    expect(started.nextWaveInSeconds).toBeGreaterThan(0);

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
    const deathChoice = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime.getHudState().choices[0]);
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
    expect(transitioned.upgrades).toEqual(applyArenaWavesChoice(retained, deathChoice));

    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        runtime._onHumanDeath();
        game.matchFlowUiController?._syncArcadeOverlayPanel?.();
    });
    await expect(page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn')).toHaveCount(4);
    await page.locator('#arcade-overlay-panel .arcade-overlay-choice-btn').first().click();
    await page.evaluate(async () => window.GAME_INSTANCE.runtimeFacade.restartRound());
    await page.waitForFunction((modelCount) => {
        const game = window.GAME_INSTANCE;
        const runtime = game?.runtimeFacade?._arcadeSupport?.arenaWavesRuntime;
        return runtime?.mapIndex === 2
            && runtime?.phase === 'countdown'
            && runtime?.getHudState?.().currentMapKey === 'eiffel_tower_siege'
            && game?.arena?.currentMapKey === 'eiffel_tower_siege'
            && game?.arena?._glbLoadError == null
            && game?.arena?._glbScene?.children?.length === modelCount;
    }, EIFFEL_TOWER_SIEGE_MODELS.length, { timeout: 360_000 });

    await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arenaWavesRuntime;
        runtime.mapIndex = 4; runtime._finalize();
        window.GAME_INSTANCE.matchFlowUiController?._syncArcadeOverlayPanel?.();
    });
    await page.waitForSelector('#arcade-overlay-panel:not(.hidden)');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Fünf Fronten abgeschlossen');
    await expect(page.locator('#arcade-overlay-panel button')).toBeFocused();
});
