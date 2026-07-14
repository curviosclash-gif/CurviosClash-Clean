import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('Desktop-Hangar öffnet maximiert in einem eigenen Fenster', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await expect(page.locator('.hangar-window-open')).toBeVisible();

    const windowPromise = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangarPage = await windowPromise;
    await hangarPage.waitForLoadState('domcontentloaded');
    await expect(hangarPage.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 10_000 });
    await expect(hangarPage.locator('.hangar-viewport-canvas-node')).toBeVisible();

    const layout = await hangarPage.evaluate(() => {
        const shell = document.getElementById('arcade-vehicle-manager')?.getBoundingClientRect();
        return { innerWidth, innerHeight, shellWidth: shell?.width || 0, shellHeight: shell?.height || 0 };
    });
    expect(layout.shellWidth).toBeGreaterThan(layout.innerWidth * 0.95);
    expect(layout.shellHeight).toBeGreaterThan((layout.innerHeight - 54) * 0.95);

    await hangarPage.locator('#hangar-window-close').click();
    await expect.poll(() => electronApp.windows().length).toBe(1);
});
