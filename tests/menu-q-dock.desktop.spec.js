import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType, chooseFreePlayVariant, menuScreenSelector } from './helpers.js';
import { ARCADE_JOURNEY_STORAGE_KEY } from '../src/shared/contracts/ArcadeJourneyContract.js';

async function home(page) {
    await waitForLoadedGame(page);
    await returnToMenu(page);
    for (let attempt = 0; attempt < 4 && await page.locator('#main-menu').getAttribute('data-menu-depth') !== '1'; attempt++) {
        await page.keyboard.press('Escape');
    }
    await expect(page.locator('#main-menu')).toHaveAttribute('data-menu-depth', '1');
}

test('Q stage and four-column dock fit the two agreed desktop sizes', async ({ page }, testInfo) => {
    await home(page);
    for (const [width, height] of [[1280, 800], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        const geometry = await page.evaluate(() => {
            const box = selector => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
            };
            return { hero: box('.menu-primary-action'), dock: box('#menu-nav'), utilities: box('.menu-side-links'),
                sessions: Array.from(document.querySelectorAll('#menu-nav [data-session-type]')).map(button => {
                    const rect = button.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
                }), viewport: { width: innerWidth, height: innerHeight } };
        });
        expect(geometry.hero.bottom).toBeLessThanOrEqual(geometry.dock.y);
        expect(geometry.sessions.every(box => box.left >= 0 && box.right <= width)).toBe(true);
        expect(Math.max(...geometry.sessions.map(box => box.top)) - Math.min(...geometry.sessions.map(box => box.top))).toBeLessThan(2);
        expect(geometry.utilities.x).toBeGreaterThan(geometry.sessions[2].left);
        expect(geometry.dock.bottom).toBeLessThanOrEqual(height);
        await page.screenshot({ path: testInfo.outputPath(`q-dock-${width}.png`) });
    }
});

test('session opens the graphic journey directly; planned nodes, settings and back preserve profile data', async ({ page }, testInfo) => {
    await home(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await selectSessionType(page, 'single');
    const journey = page.getByRole('region', { name: 'Arcade-Reise', exact: true });
    await expect(journey).toBeVisible();
    await expect(journey.locator('[data-journey-world]')).toHaveCount(6);
    await expect(journey.locator('[data-journey-node]:visible')).toHaveCount(22);
    await expect(journey.locator('[data-journey-players="2"]')).toBeHidden();
    await expect(journey.locator('[data-journey-players="3"]')).toBeHidden();
    await expect(page.locator('#btn-quick-random-map')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('journey-full-map.png') });
    await page.locator('#btn-arcade-daily-open').click();
    await expect(page.locator('#arcade-daily-panel')).toBeVisible();
    await expect(page.locator('#arcade-daily-panel')).toContainText('Beliebig viele Versuche');
    await expect(journey).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(journey).toBeVisible();
    const readRecord = () => page.evaluate(key => {
        const manager = window.GAME_INSTANCE.playerProfileManager;
        return manager.getRecordStorePort(manager.getActiveProfile().id).readJsonRecordResult(key);
    }, ARCADE_JOURNEY_STORAGE_KEY);
    const before = await readRecord();
    await journey.locator('[data-journey-world="flight_school"]').click();
    await expect(journey.locator('[data-journey-node="first_flight"]')).toBeFocused();
    await journey.locator('[data-journey-node="gaps_lesson"]').click();
    await expect(journey.locator('[data-journey-stage="gaps_lesson"]')).toBeVisible();
    await expect(journey.locator('[data-journey-start="gaps_lesson"]')).toBeDisabled();
    const mapBox = await journey.locator('.journey-map').boundingBox();
    const detailBox = await journey.locator('.journey-detail').boundingBox();
    expect(detailBox.x).toBeGreaterThanOrEqual(mapBox.x + mapBox.width);
    await page.screenshot({ path: testInfo.outputPath('journey-map-and-detail.png') });
    await page.locator('#journey-hub-actions').getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await expect(page.locator(menuScreenSelector('settings'))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(journey.locator('[data-journey-stage="gaps_lesson"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(journey.locator('[data-journey-world="flight_school"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#main-menu')).toHaveAttribute('data-menu-depth', '1');
    expect(await readRecord()).toEqual(before);
});

test('free play remains separate and the four-player planar entry survives the new hub', async ({ page }, testInfo) => {
    await home(page);
    await selectSessionType(page, 'single');
    await chooseFreePlayVariant(page, 'classic');
    await expect(page.locator(menuScreenSelector('freeplay'))).toBeVisible();
    await expect(page.locator('#journey-hub-mount')).toBeHidden();
    await expect(page.locator('#start-map-preview-mount')).toBeVisible();
    const stageGeometry = await page.evaluate(() => {
        const map = document.getElementById('start-map-section').getBoundingClientRect();
        const vehicle = document.getElementById('start-vehicle-section').getBoundingClientRect();
        return { map: { x: map.x, right: map.right }, vehicle: { x: vehicle.x, right: vehicle.right } };
    });
    expect(stageGeometry.map.right).toBeLessThanOrEqual(stageGeometry.vehicle.x);
    await expect(page.locator('#btn-start')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('free-play-stage.png') });
    await page.locator(`${menuScreenSelector('freeplay')} .submenu-header [data-back]`).click();
    await expect(page.getByRole('region', { name: 'Arcade-Reise', exact: true })).toBeVisible();
    await home(page);
    await selectSessionType(page, 'splitscreen');
    await page.locator('[data-split-player-count="4"]').click();
    await expect(page.locator('#btn-four-player-planar')).toBeVisible();
    await expect(page.locator('#journey-hub-mount')).toBeHidden();
    await page.locator('#btn-four-player-planar').click();
    await expect(page.locator('#four-player-planar-setup')).toBeVisible();
});

test('daily starts with fixed equipment and restores the personal setup on return', async ({ page }, testInfo) => {
    await home(page);
    await selectSessionType(page, 'single');
    const readSelection = () => page.evaluate(() => {
        const s = window.GAME_INSTANCE.settings;
        return { mapKey: s.mapKey, modePath: s.localSettings.modePath, gameMode: s.gameMode,
            vehicles: { ...s.vehicles }, numBots: s.numBots, dailyChallenge: s.arcade.dailyChallenge };
    });
    const before = await readSelection();
    await page.locator('#btn-arcade-daily-open').click();
    await page.locator('#btn-arcade-daily').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    const config = await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig);
    expect(config.player.vehicles.PLAYER_1).toBe('ship5');
    expect(config.session.numHumans).toBe(1);
    expect(config.arcade.sectorCount).toBe(5);
    expect(config.arcade.dailyChallenge).toBe(true);
    expect(config.arcade.journeyStageId).toBe('');
    await page.screenshot({ path: testInfo.outputPath('daily-fixed-equipment.png') });
    await returnToMenu(page);
    expect(await readSelection()).toEqual(before);
});
