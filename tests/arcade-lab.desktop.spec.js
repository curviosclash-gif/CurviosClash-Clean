import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu, openStartSetupSection } from './helpers.js';

async function openArcade(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
}

test('T-ARC-L1: locked Lab explains six complete factory ships and disables creation', async ({ page, electronApp }) => {
    await openArcade(page);
    const opening = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangar = await opening;
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('#hangar-window-open-lab').click();
    await expect(hangar.locator('.arcade-lab-fleet')).toContainText('0 von 6');
    await expect(hangar.getByRole('button', { name: 'Werkskopie erstellen' })).toBeDisabled();
    await hangar.locator('#hangar-window-close').click();
});

test('T-ARC-L2: a complete factory copy starts at level one, can be edited and flies only in Arcade', async ({ page, electronApp }, testInfo) => {
    await openArcade(page);
    await page.evaluate(() => {
        const store = window.GAME_INSTANCE.settingsManager.getPlayerRecordStorePort();
        store.saveJsonRecord('curviosclash.arcade-lab.unlock.v1', { schemaVersion: 'arcade-lab-unlock.v1', unlocked: true, unlockedAtMs: 17, qualifiedAtUnlock: [] });
    });
    const opening = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangar = await opening;
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('#hangar-window-open-lab').click();
    await hangar.getByLabel('Werksschiff als vollständige Kopie').selectOption('arrow');
    await hangar.getByRole('button', { name: 'Werkskopie erstellen' }).click();
    await expect(hangar.locator('.arcade-lab-metrics')).toContainText('Rolle: Allrounder');
    await expect(hangar.locator('.arcade-lab-valid')).toBeVisible();
    await hangar.getByLabel('Schiffsname', { exact: true }).fill('Mein Pfeil');
    await hangar.getByLabel('Schiffsname', { exact: true }).press('Tab');
    await hangar.getByRole('button', { name: 'Schiff speichern', exact: true }).click();
    await hangar.screenshot({ path: testInfo.outputPath('arcade-lab-copy.png') });
    await hangar.getByRole('button', { name: '← Hangar', exact: true }).click();
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('[data-vehicle-id="arcade_lab_1"]').first().click();
    await expect(hangar.locator('#arcade-vehicle-manager')).toContainText('Mein Pfeil');
    await hangar.locator('.hangar-activate-build').click();
    await expect(hangar.locator('.hangar-status-message')).toContainText('aktiviert');
    await hangar.locator('#hangar-test-flight').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING' && window.GAME_INSTANCE?.settings?.arcade?.runType === 'hangar_test');
    const actual = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const human = game.entityManager?.humanPlayers?.[0] || game.runtimeFacade.entityManager?.humanPlayers?.[0];
        const store = game.settingsManager.getPlayerRecordStorePort();
        const profile = store.loadJsonRecord('cuviosclash.arcade-vehicle-profile.v2', {})?.arcade_lab_1;
        return { vehicleId: human?.vehicleId, level: profile?.level, xp: profile?.xp, maxHp: human?.maxHp, settingsVehicle: game.settings.vehicles.PLAYER_1 };
    });
    expect(actual.vehicleId || actual.settingsVehicle).toBe('arcade_lab_1');
    expect(actual.level).toBe(1); expect(actual.xp).toBe(0);
    const reopened = electronApp.waitForEvent('window');
    await page.keyboard.press('Escape');
    const returned = await reopened;
    await expect(returned.locator('[data-vehicle-id="arcade_lab_1"]').first()).toBeVisible();
    await returned.locator('#hangar-window-close').click();
});
