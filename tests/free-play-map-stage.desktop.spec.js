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
    await expect(page.locator('.free-play-sidebar-settings > #start-vehicle-section')).toHaveCount(1);
    await expect(page.locator('.free-play-vehicle-more')).toHaveCount(1);
    await expect(page.locator('#vehicle-select-p1')).toHaveCount(1);
    await expect(page.locator('#map-select')).toHaveValue('dandelion_sky');
});

test('free combat aircraft sidebar leaves the map clear with details open and on narrow screens', async ({ page }, testInfo) => {
    await waitForLoadedGame(page);
    await returnToMenu(page);
    for (let i = 0; i < 4 && await page.locator('#main-menu').getAttribute('data-menu-depth') !== '1'; i++) {
        await page.keyboard.press('Escape');
    }
    await selectSessionType(page, 'single');
    await chooseFreePlayVariant(page, 'ffa');
    await expect(page.locator('#btn-vehicle-player-p1')).toBeHidden();
    await expect(page.locator('#btn-vehicle-next')).toBeVisible();
    const selected = await page.locator('#vehicle-select-p1').inputValue();
    await page.locator('#btn-vehicle-next').click();
    await expect(page.locator('#vehicle-select-p1')).not.toHaveValue(selected);
    await page.locator('#btn-vehicle-previous').click();
    await expect(page.locator('#vehicle-select-p1')).toHaveValue(selected);

    for (const [width, height] of [[1920, 1080], [1280, 800], [1024, 768], [800, 900], [560, 900]]) {
        await page.setViewportSize({ width, height });
        for (const open of [false, true]) {
            const more = page.locator('.free-play-vehicle-more');
            if (await more.evaluate(node => node.open) !== open) await more.locator('summary').click();
            if (!open && width >= 900) {
                await page.locator('.free-play-sidebar-settings').evaluate(node => { node.scrollTop = 0; });
                await expect(page.locator('#start-vehicle-preview-stage')).toBeInViewport({ ratio: 1 });
                await expect(page.locator('#vehicle-select-p1')).toBeInViewport({ ratio: 1 });
            }
            const geometry = await page.evaluate(() => {
                const box = id => {
                    const r = document.getElementById(id).getBoundingClientRect();
                    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
                };
                const content = document.querySelector('#main-menu .menu-content');
                return { map: box('start-map-preview-stage'), vehicle: box('start-vehicle-section'),
                    rules: box('start-match-section'), preview: box('start-vehicle-preview-stage'),
                    contentWidth: content.clientWidth, scrollWidth: content.scrollWidth };
            });
            const horizontalOverlap = Math.min(geometry.map.right, geometry.vehicle.right) - Math.max(geometry.map.x, geometry.vehicle.x);
            const verticalOverlap = Math.min(geometry.map.bottom, geometry.vehicle.bottom) - Math.max(geometry.map.y, geometry.vehicle.y);
            expect(horizontalOverlap > 1 && verticalOverlap > 1, `map stays clear at ${width}px, details ${open}`).toBe(false);
            expect(geometry.rules.y).toBeGreaterThanOrEqual(geometry.vehicle.bottom - 1);
            expect(geometry.preview.height).toBeGreaterThanOrEqual(150);
            expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.contentWidth + 1);
            if (width >= 900) {
                expect(geometry.vehicle.x).toBeGreaterThanOrEqual(geometry.map.right);
                expect(geometry.map.height).toBeGreaterThanOrEqual(340);
                await expect(page.locator('#btn-start')).toBeInViewport();
            } else {
                expect(geometry.vehicle.y).toBeGreaterThanOrEqual(geometry.map.bottom);
            }
        }
        await page.locator('.free-play-vehicle-more > summary').click();
        await page.locator('.free-play-sidebar-settings').evaluate(node => { node.scrollTop = 0; });
        await page.locator('#start-vehicle-section').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`aircraft-sidebar-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator(menuScreenSelector('freeplay')).locator('.submenu-header [data-back]').click();
    await page.locator(`${menuScreenSelector('modeChoice')} .submenu-header [data-back]`).click();
    await selectSessionType(page, 'splitscreen');
    await chooseFreePlayVariant(page, 'ffa');
    await expect(page.locator('#btn-vehicle-player-p1')).toBeVisible();
    await expect(page.locator('#vehicle-p2-container')).toBeVisible();
    await page.locator('#vehicle-p2-container').click();
    await expect(page.locator('#vehicle-select-p2')).toBeVisible();
});
