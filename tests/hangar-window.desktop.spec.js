import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, openStartSetupSection, waitForLoadedGame } from './helpers.js';

test('Desktop-Hangar schließt mit Escape über denselben Pfad wie Zurück zum Menü', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await openStartSetupSection(page, 'arcade');
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
    await expect(hangarPage.locator('[data-build-view="workshop"]')).toHaveAttribute('aria-selected', 'true');
    await expect(hangarPage.locator('[data-build-view-panel="workshop"]')).toBeVisible();
    await expect(hangarPage.locator('[data-build-view-panel="stats"]')).toBeHidden();
    await hangarPage.locator('[data-build-view="stats"]').click();
    await expect(hangarPage.locator('[data-build-view-panel="stats"]')).toBeVisible();
    await expect(hangarPage.locator('[data-build-view="stats"]')).toHaveAttribute('aria-selected', 'true');
    await hangarPage.locator('[data-build-view="presets"]').click();
    await expect(hangarPage.locator('[data-build-view-panel="presets"]')).toBeVisible();
    await expect(hangarPage.locator('.hangar-starter-builds')).toBeVisible();
    await hangarPage.locator('[data-build-view="workshop"]').click();
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

    await hangarPage.locator('[data-catalog-view="parts"]').click();
    await expect(hangarPage.locator('.hangar-filter-field-label')).toHaveCount(4);
    const stoneListLayout = await hangarPage.locator('.hangar-catalog-list').evaluate((list) => ({
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        minimumCardHeight: Math.min(...Array.from(list.querySelectorAll('.hangar-part-card'))
            .map((card) => card.getBoundingClientRect().height)),
    }));
    expect(stoneListLayout.minimumCardHeight).toBeGreaterThan(100);
    expect(stoneListLayout.scrollHeight).toBeGreaterThan(stoneListLayout.clientHeight);
    await expect(hangarPage.locator('.hangar-part-card[data-part-id="stone_blue_t2"] .hangar-part-lock-reason')).toContainText('Freischaltung auf Level 10');
    await expect(hangarPage.locator('.hangar-part-card[data-part-id="stone_blue_t2"] .hangar-part-lock-reason')).toContainText('noch');
    await hangarPage.locator('.hangar-part-trait-filter').selectOption('speed');
    await expect(hangarPage.locator('.hangar-part-card')).not.toHaveCount(0);
    expect(await hangarPage.locator('.hangar-part-card').evaluateAll((cards) => cards.every((card) => card.dataset.partTrait === 'speed'))).toBe(true);
    await hangarPage.locator('.hangar-part-trait-filter').selectOption('all');
    await hangarPage.locator('.hangar-part-availability-filter').selectOption('available');
    await expect(hangarPage.locator('.hangar-part-card')).toHaveCount(3);

    await hangarPage.locator('#hangar-window-close').click();
    await expect.poll(() => electronApp.windows().length).toBe(1);
});
