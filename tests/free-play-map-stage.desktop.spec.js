import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType, chooseFreePlayVariant, menuScreenSelector } from './helpers.js';

test('single-player free combat restores filtered adventure maps and starts Dandelion', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await waitForLoadedGame(page);
    await returnToMenu(page);
    for (let i = 0; i < 4 && await page.locator('#main-menu').getAttribute('data-menu-depth') !== '1'; i++) {
        await page.keyboard.press('Escape');
    }
    await selectSessionType(page, 'single');
    await chooseFreePlayVariant(page, 'ffa');
    await page.locator('#map-filter-select').selectOption('favorites');
    await page.locator('#map-search-input').fill('no-such-map');
    await expect(page.locator('#map-select option[value="dandelion_sky"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Alle Karten anzeigen', exact: true }).click();
    await expect(page.locator('#map-search-input')).toHaveValue('');
    await expect(page.locator('#map-filter-select')).toHaveValue('all');
    for (const mapKey of ['dandelion_sky', 'sunflower_meadow', 'giant_forest', 'cherry_grove']) {
        await expect(page.locator(`#map-select option[value="${mapKey}"]`)).toHaveCount(1);
        await expect(page.locator(`#start-map-choice-strip [data-map-key="${mapKey}"]`)).toHaveCount(1);
    }
    await page.locator('#map-select').selectOption('dandelion_sky');
    await expect(page.locator('#map-select')).toHaveValue('dandelion_sky');
    await page.screenshot({ path: testInfo.outputPath('free-combat-dandelion-selected.png') });
    await page.locator('#btn-start').click();
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING' && game?.arena?.currentMapKey === 'dandelion_sky'
            && game?.arena?._dandelionSeeds?.count > 0;
    }, null, { timeout: 90000 });
    expect(await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig.session.activeGameMode)).toBe('HUNT');
    await page.screenshot({ path: testInfo.outputPath('free-combat-dandelion-playing.png') });
    await returnToMenu(page);
    await expect(page.locator('#map-select')).toHaveValue('dandelion_sky');
    await page.locator(menuScreenSelector('freeplay')).locator('.submenu-header [data-back]').click();
    await page.locator('[data-journey-node="first_route"]').click();
    await page.locator('[data-journey-start="first_run"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    await expect(page.locator(`${menuScreenSelector('freeplay', { visible: false })} > .level3-body > #start-vehicle-section`)).toHaveCount(1);
    await expect(page.locator('.free-play-vehicle-more')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-overlay')).toBeVisible();
    await page.locator('#btn-pause-menu').click();
    await expect(page.locator('#btn-pause-menu')).toHaveAttribute('data-confirm-armed', 'true');
    await page.locator('#btn-pause-menu').click();
    await expect(page.getByRole('region', { name: 'Arcade-Reise', exact: true })).toBeVisible();
    await expect(page.locator(menuScreenSelector('freeplay', { visible: false }))).toBeHidden();
    await chooseFreePlayVariant(page, 'ffa');
    await expect(page.locator('#start-map-preview-stage > #start-vehicle-section')).toHaveCount(1);
    await expect(page.locator('.free-play-vehicle-more')).toHaveCount(1);
    await expect(page.locator('#vehicle-select-p1')).toHaveCount(1);
    await expect(page.locator('#map-select')).toHaveValue('dandelion_sky');
});
