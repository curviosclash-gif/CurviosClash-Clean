import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu, openStartSetupSection } from './helpers.js';
import { ARCADE_DIFFICULTY_STORAGE_KEY } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';

async function openArcade(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
}

test('T-ARC-D1: locked tiers stay visible and the run uses its own tier with a frozen level range', async ({ page }) => {
    await openArcade(page);
    const tiers = page.locator('#arcade-difficulty-tier');
    await expect(tiers.locator('option[value="hard"]')).toHaveAttribute('disabled', '');
    await expect(tiers.locator('option[value="nightmare"]')).toHaveAttribute('disabled', '');
    await page.evaluate(({ key, profiles }) => {
        const game = window.GAME_INSTANCE;
        const store = game.settingsManager.getPlayerRecordStorePort();
        store.saveJsonRecord(key, { schemaVersion: 'arcade-difficulty-progress.v1', unlockedTierIds: ['normal', 'hard'] });
        const vehicleId = game.settings.vehicles.PLAYER_1;
        store.saveJsonRecord(profiles, { [vehicleId]: { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId, level: 6, xp: 2000, xpBank: 2000 } });
        game.settings.botDifficulty = 'EASY';
    }, { key: ARCADE_DIFFICULTY_STORAGE_KEY, profiles: ARCADE_VEHICLE_PROFILE_STORAGE_KEY });
    // A menu synchronization reads persisted unlocks again.
    await page.locator('#input-arcade-seed').fill('1234');
    await page.locator('#btn-arcade-seed-apply').click();
    await expect(tiers.locator('option[value="hard"]')).not.toHaveAttribute('disabled', '');
    await tiers.selectOption('hard');
    await page.locator('#btn-arcade-start-inline').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const context = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade._arcadeSupport.arcadeRunRuntime.rankContext);
    expect(context.tierId).toBe('hard');
    expect(context.vehicleLevel).toBe(6);
    expect(context.levelRange.label).toBe('6–10');
    expect(context.botStrength.ai).toBe('HARD');
});

test('T-ARC-D2: native Hangar test flight closes the window, grants no records and Escape returns to Hangar', async ({ page, electronApp }) => {
    await openArcade(page);
    const before = await page.evaluate(() => ({ ...localStorage }));
    const opening = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangar = await opening;
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('#hangar-test-flight').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.settings?.arcade?.runType === 'hangar_test');
    expect(electronApp.windows().length).toBe(1);
    const reopened = electronApp.waitForEvent('window');
    await page.keyboard.press('Escape');
    const returned = await reopened;
    await expect(returned.locator('#arcade-vehicle-manager')).toBeVisible();
    const after = await page.evaluate(() => ({ ...localStorage }));
    for (const key of Object.keys(after).filter((key) => /arcade-(vehicle-profile|records|ranked|leaderboard|difficulty|colors)/.test(key))) {
        expect(after[key], key).toBe(before[key]);
    }
    await returned.locator('#hangar-window-close').click();
});
