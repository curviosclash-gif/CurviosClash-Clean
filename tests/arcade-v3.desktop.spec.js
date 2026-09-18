import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu, openStartSetupSection } from './helpers.js';

async function openArcade(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
}
async function completeSector(page) {
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const human = game.entityManager.humanPlayers[0];
        human.alive = true; human.hp = Math.max(60, human.hp);
        game.matchFlowUiController.onRoundEnd(human, { reason: 'ARCADE_OBJECTIVE' });
    });
}

test('Arcade desktop: held countdown, explicit victory and voluntary continuation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openArcade(page);
    await page.selectOption('#map-select', 'standard');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        Object.assign(game.settings.arcade, { sectorCount: 2, seed: 5, dailyChallenge: false });
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['arcade.sectorCount', 'arcade.seed'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    await completeSector(page);
    await expect(page.locator('#btn-arcade-intermission-pause')).toBeVisible();
    await page.locator('#btn-arcade-intermission-pause').focus();
    await page.keyboard.press('Space');
    const rest = await page.evaluate(() => window.GAME_INSTANCE.roundPause);
    const heldAt = Date.now();
    await page.waitForFunction(start => Date.now() - start >= 1100, heldAt);
    expect(await page.evaluate(() => window.GAME_INSTANCE.roundPause)).toBe(rest);
    await expect(page.locator('#btn-arcade-intermission-pause')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('arcade-intermission-1280.png') });
    await page.keyboard.press('Enter');
    await expect(page.locator('#btn-arcade-intermission-pause')).toHaveAttribute('aria-pressed', 'false');
    const routeOption = page.locator('[data-arcade-choice-id]').first();
    await routeOption.focus();
    await page.keyboard.press('Enter');
    await expect(routeOption).toBeFocused();
    await expect(routeOption).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.GAME_INSTANCE.state)).toBe('ROUND_END');
    await page.locator('#btn-arcade-intermission-continue').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === 2);
    await completeSector(page);
    await expect(page.locator('#btn-arcade-victory-finish')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('arcade-victory-1280.png') });
    const victoryAt = Date.now();
    await page.waitForFunction(start => Date.now() - start >= 1200, victoryAt);
    expect(await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getPhase())).toBe('victory');
    await page.click('#btn-arcade-victory-continue');
    await expect(page.locator('#btn-arcade-intermission-continue')).toBeVisible();
    await page.click('#btn-arcade-intermission-continue');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getPhase() === 'sudden_death');
});

test('Daily desktop uses fixed vehicle and records victory before optional continuation', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openArcade(page);
    await page.locator('#arcade-inline-surface').evaluate(node => { node.open = true; });
    await page.click('#btn-arcade-daily');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const config = await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig);
    expect(config.player.vehicles.PLAYER_1).toBe('ship5');
    expect(config.session.numHumans).toBe(1);
    expect(config.arcade.sectorCount).toBe(5);
    for (let sector = 1; sector < 5; sector += 1) {
        await completeSector(page);
        await page.click('#btn-arcade-intermission-continue');
        await page.waitForFunction(next => window.GAME_INSTANCE?.state === 'PLAYING'
            && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === next, sector + 1);
    }
    await completeSector(page);
    await expect(page.locator('#btn-arcade-victory-finish')).toBeVisible();
    const daily = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getMenuSurfaceState().dailyResult);
    expect(daily.attempt).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('arcade-daily-victory-1920.png') });
    await page.click('#btn-arcade-victory-finish');
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MATCH_END');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Daily geschafft');
    await page.screenshot({ path: testInfo.outputPath('arcade-daily-result-1920.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    const options = await page.locator('#arcade-ghost-duel-mode-select option').evaluateAll(nodes => nodes.map(node => node.value));
    expect(options).toContain('self_best_time_ghost');
    await openStartSetupSection(page, 'match');
    const advanced = page.locator('#submenu-game:not(.hidden) details.start-inline-advanced');
    if (!await advanced.evaluate(node => node.open)) await advanced.locator('summary').click();
    await page.selectOption('#arcade-ghost-duel-mode-select', 'self_best_time_ghost');
    await expect(page.locator('#arcade-ghost-duel-mode-select')).toHaveValue('self_best_time_ghost');
});
