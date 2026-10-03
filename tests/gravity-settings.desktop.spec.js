import { test, expect } from './helpers.desktop.js';
import { loadGame, openLevel4Drawer } from './helpers.js';

test('fine settings gravity slider offers 0..50 with default 20 and saves the chosen strength', async ({ page }, testInfo) => {
    await loadGame(page);
    await openLevel4Drawer(page, { section: 'gameplay' });
    const slider = page.locator('#gravity-slider');
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute('min', '0');
    await expect(slider).toHaveAttribute('max', '50');
    await expect(slider).toHaveValue('20');
    await page.screenshot({ path: testInfo.outputPath('gravity-settings.png') });
    for (const strength of [50, 0, 20]) {
        await slider.fill(String(strength));
        await slider.dispatchEvent('input');
        await expect(page.locator('#gravity-label')).toHaveText(`${strength} %`);
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.settings.gameplay.gravityStrength)).toBe(strength);
    }
    await slider.fill('35');
    await slider.dispatchEvent('input');
    await expect(page.locator('#gravity-label')).toHaveText('35 %');
    const persisted = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settingsManager.saveSettings(game.settings);
        return game.settingsManager.loadSettings().gameplay.gravityStrength;
    });
    expect(persisted).toBe(35);
});
