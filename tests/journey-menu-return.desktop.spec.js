import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, selectSessionType } from './helpers.js';

async function leaveThroughPause(page) {
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    await page.locator('#btn-pause-menu').click();
    await expect(page.locator('#btn-pause-menu')).toHaveAttribute('data-confirm-armed', 'true');
    await page.locator('#btn-pause-menu').click();
    await expect(page.locator('#submenu-custom')).toBeVisible();
    await expect(page.locator('#submenu-game')).toBeHidden();
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
