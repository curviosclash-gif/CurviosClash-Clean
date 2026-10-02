import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, openStartSetupSection, waitForLoadedGame } from './helpers.js';

test('Desktop-Hangar schließt mit Escape über denselben Pfad wie Zurück zum Menü', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
    const windowPromise = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangarPage = await windowPromise;
    await hangarPage.waitForLoadState('domcontentloaded');
    await expect(hangarPage.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 10_000 });
    const escapePress = hangarPage.keyboard.press('Escape').catch(() => {});
    await expect.poll(() => electronApp.windows().length).toBe(1);
    await escapePress;
});

test('Desktop-Hangar wechselt Fahrzeuge über die neuen Richtungsschalter', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
    const windowPromise = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangarPage = await windowPromise;
    await hangarPage.waitForLoadState('domcontentloaded');
    await expect(hangarPage.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 10_000 });

    const selectedVehicleBefore = await hangarPage.locator('.arcade-vehicle-card[aria-selected="true"]')
        .getAttribute('data-vehicle-id');
    await hangarPage.getByRole('button', { name: 'Nächstes Fahrzeug' }).click();
    await expect(hangarPage.locator('.arcade-vehicle-card[aria-selected="true"]'))
        .not.toHaveAttribute('data-vehicle-id', selectedVehicleBefore);
    await hangarPage.getByRole('button', { name: 'Vorheriges Fahrzeug' }).click();
    await expect(hangarPage.locator('.arcade-vehicle-card[aria-selected="true"]'))
        .toHaveAttribute('data-vehicle-id', selectedVehicleBefore);

    await hangarPage.locator('#hangar-window-close').click();
    await expect.poll(() => electronApp.windows().length).toBe(1);
});

test('Desktop-Hangar öffnet maximiert in einem eigenen Fenster', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
    await expect(page.locator('.hangar-window-open')).toBeVisible();
    await expect(page.locator('#arcade-vehicle-manager')).toHaveCount(0);
    await expect(page.locator('#arcade-vehicle-manager-mount')).toHaveCount(0);

    const windowPromise = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangarPage = await windowPromise;
    await hangarPage.waitForLoadState('domcontentloaded');
    await expect(hangarPage.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 10_000 });
    await expect(hangarPage.locator('.hangar-viewport-canvas-node')).toBeVisible();
    await expect(hangarPage.locator('.hangar-activation-dock .hangar-activate-build')).toBeVisible();
    // Arcade (Paket 3): "Ausbau" with size build and stones opens first; "Umbau" is Fight only.
    await expect(hangarPage.locator('[data-build-view="upgrade"]')).toHaveAttribute('aria-selected', 'true');
    await expect(hangarPage.locator('[data-build-view-panel="upgrade"]')).toBeVisible();
    await expect(hangarPage.locator('[data-build-view="workshop"]')).toBeHidden();
    await expect(hangarPage.locator('[data-build-view-panel="stats"]')).toBeHidden();
    await hangarPage.locator('[data-build-view="stats"]').click();
    await expect(hangarPage.locator('[data-build-view-panel="stats"]')).toBeVisible();
    await expect(hangarPage.locator('[data-build-view="stats"]')).toHaveAttribute('aria-selected', 'true');
    await hangarPage.locator('[data-build-view="presets"]').click();
    await expect(hangarPage.locator('[data-build-view-panel="presets"]')).toBeVisible();
    await expect(hangarPage.locator('.arcade-vehicle-preset-select')).toBeVisible();
    await expect(hangarPage.locator('.hangar-starter-builds')).toBeHidden();
    await hangarPage.locator('[data-build-view="upgrade"]').click();
    await expect(hangarPage.locator('[data-build-view-panel="upgrade"] .hangar-stone-panel')).toBeVisible();
    expect(await hangarPage.locator('.hangar-build-scroll').evaluate((node) => (
        node.scrollWidth <= node.clientWidth + 1
    ))).toBe(true);

    const layout = await hangarPage.evaluate(() => {
        const shell = document.getElementById('arcade-vehicle-manager')?.getBoundingClientRect();
        return { innerWidth, innerHeight, shellWidth: shell?.width || 0, shellHeight: shell?.height || 0 };
    });
    expect(layout.shellWidth).toBeGreaterThan(layout.innerWidth * 0.95);
    expect(layout.shellHeight).toBeGreaterThan((layout.innerHeight - 54) * 0.95);
    const cameraButtons = await hangarPage.locator('.hangar-camera-toolbar .secondary-btn').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
    expect(Math.max(...cameraButtons) - Math.min(...cameraButtons)).toBeLessThan(8);

    // Arcade (Paket 3): no catalog of colour stones (Fight only); the stones of the workshop pool and
    // their slots sit in "Ausbau", locked slot packages visible, dimmed and naming their condition.
    await expect(hangarPage.locator('[data-catalog-view="parts"]')).toBeHidden();
    await expect(hangarPage.locator('.hangar-stone-item')).not.toHaveCount(0);
    await expect(hangarPage.locator('.hangar-stone-count')).toContainText('/ 21');
    await expect(hangarPage.locator('[data-hangar-slot-row]')).toHaveCount(7);
    const wings = hangarPage.locator('[data-stone-package="wings"]');
    if (await wings.evaluate((node) => node.classList.contains('is-locked'))) {
        await expect(wings.locator('.hangar-locked-condition')).toContainText('Flügelpaar');
        await expect(wings.locator('.hangar-locked-condition')).toContainText('250 XP');
        await expect(wings.locator('.hangar-stone-package-buy')).toBeVisible();
        await expect(hangarPage.locator('[data-select-slot="wing_left"]')).toBeDisabled();
    } else {
        await expect(hangarPage.locator('[data-select-slot="wing_left"]')).toBeEnabled();
    }

    await hangarPage.locator('#hangar-window-close').click();
    await expect.poll(() => electronApp.windows().length).toBe(1);
});
