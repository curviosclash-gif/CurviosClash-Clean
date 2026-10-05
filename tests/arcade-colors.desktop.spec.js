import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu, openStartSetupSection } from './helpers.js';

async function openArcade(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await openStartSetupSection(page, 'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
}

test('T-ARC-C1: credited run events persist Ember in the actual player store', async ({ page }) => {
    await openArcade(page);
    await page.locator('#btn-arcade-start-inline').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const result = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.runtimeFacade._arcadeSupport.arcadeRunRuntime;
        const store = game.settingsManager.getPlayerRecordStorePort();
        for (let n = 0; n < 9; n++) runtime.applyGameplayEvent({ type: 'kill', count: 1, playerIndex: 0 });
        const before = store.loadJsonRecord('cuviosclash.arcade-colors.v1', null);
        runtime.applyGameplayEvent({ type: 'kill', count: 1, playerIndex: 0 });
        return { before, after: store.loadJsonRecord('cuviosclash.arcade-colors.v1', null) };
    });
    expect(result.before?.unlockedColorIds || []).not.toContain('ember');
    expect(result.after.unlockedColorIds).toContain('ember');
});

test('T-ARC-C2: global colors stay separate for parts, trails and weapon families in the native Hangar', async ({ page, electronApp }, testInfo) => {
    await openArcade(page);
    await page.evaluate(() => {
        const store = window.GAME_INSTANCE.settingsManager.getPlayerRecordStorePort();
        store.saveJsonRecord('cuviosclash.arcade-colors.v1', { schemaVersion: 'arcade-colors.v1', unlockedColorIds: ['standard', 'frost', 'ion'] });
        store.saveJsonRecord('cuviosclash.arcade-vehicle-profile.v2', {
            ship5: { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'ship5', level: 60, xp: 50000, xpBank: 3000 },
            arrow: { schemaVersion: 'arcade-vehicle-profile.v3', vehicleId: 'arrow', level: 1, xp: 0, xpBank: 0 },
        });
    });
    const opening = electronApp.waitForEvent('window');
    await page.locator('.hangar-window-open').click();
    const hangar = await opening;
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('[data-vehicle-id="ship5"]').first().click();
    const trail = hangar.getByLabel('Spurstil', { exact: true });
    await expect(trail.locator('option[value="prism"]')).toHaveAttribute('disabled', '');
    await trail.selectOption('frost');
    await hangar.locator('#hangar-build-view-form').click();
    await hangar.locator('.hangar-part-style-item').first().click();
    await hangar.getByLabel('Farbe des Teils').selectOption('ion');
    await hangar.getByLabel('Titellevel', { exact: true }).fill('20');
    await hangar.getByLabel('Titellevel', { exact: true }).press('Tab');
    await expect(hangar.locator('#arcade-vehicle-manager')).toContainText('Meister 20');
    await hangar.screenshot({ path: testInfo.outputPath('arcade-global-colors.png') });
    await hangar.locator('[data-vehicle-id="arrow"]').first().click();
    await expect(trail.locator('option[value="frost"]')).not.toHaveAttribute('disabled', '');
    await expect(trail).toHaveValue('standard');
    await hangar.locator('[data-vehicle-id="ship5"]').first().click();
    await expect(trail).toHaveValue('frost');
    await hangar.locator('.hangar-activate-build').click();
    await hangar.locator('#hangar-test-flight').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING' && window.GAME_INSTANCE.settings.arcade.runType === 'hangar_test');
    const actual = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const human = game.entityManager?.humanPlayers?.[0] || game.runtimeFacade.entityManager?.humanPlayers?.[0];
        const profile = game.settingsManager.getPlayerRecordStorePort().loadJsonRecord('cuviosclash.arcade-vehicle-profile.v2', {}).ship5;
        return { cosmetics: human.arcadeCosmeticLoadout, profile, vehicleId: human.vehicleId,
            colors: game.settingsManager.getPlayerRecordStorePort().loadJsonRecord('cuviosclash.arcade-colors.v1', null) };
    });
    expect(actual.cosmetics.trailStyleId, JSON.stringify(actual)).toBe('frost');
    expect(actual.cosmetics.weaponStyleIds.mg).toBe('standard');
    expect(actual.profile.xpBank).toBe(3000);
    expect(Object.values(actual.profile.partStyle).some(entry => entry.color === 0x48d7ff)).toBe(true);
});
