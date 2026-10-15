import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, selectSessionType, menuScreenSelector } from './helpers.js';
import { ARCADE_JOURNEY_STORAGE_KEY } from '../src/shared/contracts/ArcadeJourneyContract.js';

async function leaveThroughPause(page) {
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    await page.locator('#btn-pause-menu').click();
    await expect(page.locator('#btn-pause-menu')).toHaveAttribute('data-confirm-armed', 'true');
    await page.locator('#btn-pause-menu').click();
    await expect(page.locator(menuScreenSelector('modeChoice'))).toBeVisible();
    await expect(page.locator(menuScreenSelector('freeplay', { visible: false }))).toBeHidden();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
}

test('leaving the flight school through pause returns to the journey hub', async ({ page }, testInfo) => {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('[data-journey-start="flight_school"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.arena?.currentMapKey === 'tutorial_classic');
    await leaveThroughPause(page);
    await expect(page.getByRole('region', { name: 'Arcade-Reise', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('tutorial-pause-return-hub.png') });
});

test('leaving the daily returns to its hub while restoring the personal selection', async ({ page }, testInfo) => {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    const selection = () => page.evaluate(() => {
        const s = window.GAME_INSTANCE.settings;
        return { map: s.mapKey, path: s.localSettings.modePath, vehicles: s.vehicles, bots: s.numBots };
    });
    const before = await selection();
    await page.locator('#btn-arcade-daily-open').click();
    await page.locator('#btn-arcade-daily').click();
    await leaveThroughPause(page);
    expect(await selection()).toEqual(before);
    await expect(page.locator('#journey-hub-mount')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('daily-pause-return-hub.png') });
});

test('aborting the first Rift route returns without a medal and restores the personal setup', async ({ page }) => {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    // Journey changes to the separately remembered Arcade path before borrowing mission settings.
    // Compare the same personal path on both sides of the aborted run.
    await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.handleModePathChange({ modePath: 'arcade', stayOnPanel: true }));
    const selection = () => page.evaluate(() => {
        const s = window.GAME_INSTANCE.settings;
        return { map: s.mapKey, path: s.localSettings.modePath, bots: s.numBots, sectors: s.arcade.sectorCount, vehicles: s.vehicles };
    });
    const progress = () => page.evaluate(key => {
        const manager = window.GAME_INSTANCE.playerProfileManager;
        return manager.getRecordStorePort(manager.getActiveProfile().id).readJsonRecordResult(key);
    }, ARCADE_JOURNEY_STORAGE_KEY);
    const before = await selection();
    expect(before.path).toBe('arcade');
    const records = await progress();
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="first_route"]').click();
    await page.locator('[data-journey-start="first_run"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeConfig.session.mapKey === 'parcours_rift');
    await leaveThroughPause(page);
    await expect(page.getByRole('region', { name: 'Arcade-Reise', exact: true })).toBeVisible();
    expect(await progress()).toEqual(records);
    expect(await selection()).toEqual(before);
});
