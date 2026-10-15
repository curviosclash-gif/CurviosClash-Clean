import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType, chooseFreePlayVariant, menuScreenSelector } from './helpers.js';
import { ARCADE_JOURNEY_STORAGE_KEY } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ARCADE_DAILY_RULES_VERSION } from '../src/shared/contracts/ArcadeDailyRulesContract.js';
import { createArcadeRunRecords } from '../src/state/arcade/ArcadeRunState.js';
import { computeDailySeed } from '../src/shared/utils/ArcadeUtils.js';

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
    for (const [width, height] of [[1280, 800], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        const geometry = await page.evaluate(() => {
            const box = id => {
                const r = document.getElementById(id).getBoundingClientRect();
                return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
            };
            const menu = document.querySelector('#main-menu .menu-content');
            return { map: box('start-map-preview-stage'), vehicle: box('start-vehicle-section'), rules: box('start-match-section'),
                contentWidth: menu.clientWidth, scrollWidth: menu.scrollWidth };
        });
        expect(geometry.vehicle.x).toBeGreaterThan(geometry.map.x);
        expect(geometry.vehicle.y).toBeGreaterThan(geometry.map.y);
        expect(geometry.vehicle.right).toBeLessThanOrEqual(geometry.map.right);
        expect(geometry.vehicle.bottom).toBeLessThanOrEqual(geometry.map.bottom);
        expect(geometry.vehicle.width).toBeLessThan(geometry.map.width * .65);
        expect(geometry.rules.x).toBeGreaterThanOrEqual(geometry.map.right);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.contentWidth + 1);
        await expect(page.locator('.start-step-rail')).toBeHidden();
        await expect(page.locator('#vehicle-select-p1')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`free-play-stage-${width}.png`) });
        await expect(page.locator('#btn-start')).toBeInViewport();
    }
    const choices = await page.locator('#vehicle-select-p1 option').evaluateAll(options => options.map(option => option.value));
    const current = await page.locator('#vehicle-select-p1').inputValue();
    const next = choices.find(value => value !== current);
    expect(next).toBeTruthy();
    await page.locator('#vehicle-select-p1').selectOption(next);
    expect(await page.evaluate(() => window.GAME_INSTANCE.settings.vehicles.PLAYER_1)).toBe(next);
    await page.locator('.free-play-vehicle-more > summary').click();
    await expect(page.locator('#vehicle-filter-select')).toBeVisible();
    await expect(page.locator('#start-vehicle-stat-armor')).toBeVisible();
    await page.locator('.free-play-vehicle-more > summary').click();
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
    const fixture = createArcadeRunRecords();
    fixture.daily = { seed: computeDailySeed(), runsPlayed: 3, bestScore: 99999, lastScore: 90000, note: 'legacy fixture' };
    const seeded = await page.evaluate(async ({ key, records }) => {
        const game = window.GAME_INSTANCE;
        const manager = game.playerProfileManager;
        const saved = await manager.getRecordStorePort(manager.getActiveProfile().id).saveJsonRecord(key, records);
        game.runtimeFacade.arcadeRunRuntime.configure({ arcade: { ...game.runtimeConfig.arcade, enabled: false } });
        return saved;
    }, { key: ARCADE_RUN_PROFILE_STORAGE_KEY, records: fixture });
    expect(seeded === true || seeded?.success === true || seeded?.ok === true).toBe(true);
    const readSelection = () => page.evaluate(() => {
        const s = window.GAME_INSTANCE.settings;
        return { mapKey: s.mapKey, modePath: s.localSettings.modePath, gameMode: s.gameMode,
            vehicles: { ...s.vehicles }, numBots: s.numBots, dailyChallenge: s.arcade.dailyChallenge };
    });
    const before = await readSelection();
    await page.locator('#btn-arcade-daily-open').click();
    await expect(page.locator('#arcade-daily-line')).toContainText('Heute noch nicht gespielt');
    await page.locator('#btn-arcade-daily').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    const config = await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig);
    expect(config.player.vehicles.PLAYER_1).toBe('ship5');
    expect(config.session.numHumans).toBe(1);
    expect(config.arcade.sectorCount).toBe(5);
    expect(config.arcade.dailyChallenge).toBe(true);
    expect(config.arcade.dailyRulesVersion).toBe(ARCADE_DAILY_RULES_VERSION);
    expect(config.arcade.journeyStageId).toBe('');
    await page.screenshot({ path: testInfo.outputPath('daily-fixed-equipment.png') });
    await returnToMenu(page);
    expect(await readSelection()).toEqual(before);
    const readDaily = () => page.evaluate(key => {
        const manager = window.GAME_INSTANCE.playerProfileManager;
        return manager.getRecordStorePort(manager.getActiveProfile().id).readJsonRecordResult(key).value?.daily;
    }, ARCADE_RUN_PROFILE_STORAGE_KEY);
    await expect.poll(async () => (await readDaily())?.rulesVersion).toBe(ARCADE_DAILY_RULES_VERSION);
    const daily = await readDaily();
    expect(daily.runsPlayed).toBe(1);
    expect(daily.bestScore).toBeLessThan(99999);
    expect(daily.history).toHaveLength(1);
    expect(daily.history[0]).toMatchObject({ bestScore: 99999, runsPlayed: 3, note: 'legacy fixture', rulesVersion: '' });
});
