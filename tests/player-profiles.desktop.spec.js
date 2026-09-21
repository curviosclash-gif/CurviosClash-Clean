import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';

test('Desktop-Spielerprofil erklärt gesperrtes Archivieren und Standardsetzen', async ({ page }) => {
    await waitForLoadedGame(page);
    await expect(page.locator('#btn-player-profile-default')).toBeDisabled();
    await expect(page.locator('#btn-player-profile-default')).toHaveAttribute('title', 'Dieses Profil ist bereits Standard.');
    await expect(page.locator('#btn-player-profile-archive')).toBeDisabled();
    await expect(page.locator('#btn-player-profile-archive')).toHaveAttribute('title', 'Das Standard-Profil kann nicht archiviert werden.');
    await expect(page.locator('#player-profile-action-hint')).toContainText('Dieses Profil ist bereits Standard.');
    await expect(page.locator('#player-profile-action-hint')).toContainText('Das Standard-Profil kann nicht archiviert werden.');
});

async function activatePlayerProfile(page, profileId) {
    await page.evaluate((id) => {
        // Survives only until the page reloads; the app has to reload on its own.
        window.__beforeProfileSwitch = true;
        const select = document.getElementById('player-profile-select');
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btn-player-profile-activate').click();
    }, profileId);
    await expect.poll(async () => {
        try {
            return await page.evaluate(() => window.__beforeProfileSwitch !== true);
        } catch {
            return false;
        }
    }, { timeout: 15000 }).toBe(true);
    await waitForLoadedGame(page);
    await expect.poll(() => page.evaluate(() => (
        JSON.parse(localStorage.getItem('cuviosclash.player-profiles.v1'))?.activeProfileId || ''
    ))).toBe(profileId);
}

test('Desktop-Spielerprofile isolate progression across activation and renderer reload', async ({ page }) => {
    await waitForLoadedGame(page);
    await expect(page.locator('#player-profile-summary')).toContainText('Spieler:');
    await expect(page.getByText('Gespeicherte Einstellungen', { exact: true }).first()).toBeAttached();

    const setup = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const first = game.playerProfileManager.getActiveProfile();
        game.playerProfileManager.getActiveRecordStorePort().saveJsonRecord(
            'cuviosclash.arcade-run-profile.v1',
            { bestScore: 1234 }
        );
        document.getElementById('player-profile-name').value = 'Profil B';
        document.getElementById('btn-player-profile-create').click();
        return { first };
    });
    await expect(page.locator('#player-profile-select option')).toHaveCount(2);
    const second = await page.evaluate(() => (
        window.GAME_INSTANCE.playerProfileManager.getProfiles().find((profile) => profile.displayName === 'Profil B')
    ));

    await activatePlayerProfile(page, second.id);
    const secondState = await page.evaluate(() => ({
        active: window.GAME_INSTANCE.playerProfileManager.getActiveProfile(),
        records: window.GAME_INSTANCE.playerProfileManager.getActiveRecordStorePort().loadJsonRecord(
            'cuviosclash.arcade-run-profile.v1',
            null
        ),
    }));
    expect(secondState.active.displayName).toBe('Profil B');
    expect(secondState.records).toBeNull();

    await activatePlayerProfile(page, setup.first.id);
    const restored = await page.evaluate(() => (
        window.GAME_INSTANCE.playerProfileManager.getActiveRecordStorePort().loadJsonRecord(
            'cuviosclash.arcade-run-profile.v1',
            null
        )
    ));
    expect(restored).toEqual({ bestScore: 1234 });
});

test('Desktop-Spielerprofil archivieren braucht zwei Klicks statt eines Systemdialogs', async ({ page }) => {
    await waitForLoadedGame(page);
    const profileId = await page.evaluate(() => {
        document.getElementById('player-profile-name').value = 'Archive QA';
        document.getElementById('btn-player-profile-create').click();
        return window.GAME_INSTANCE.playerProfileManager.getProfiles()
            .find((profile) => profile.displayName === 'Archive QA')?.id || '';
    });
    expect(profileId).not.toBe('');
    await page.evaluate((id) => {
        const select = document.getElementById('player-profile-select');
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btn-player-profile-archive').click();
    }, profileId);
    await expect(page.locator('#btn-player-profile-archive')).toHaveAttribute('data-confirm-armed', 'true');
    expect(await page.evaluate((id) => window.GAME_INSTANCE.playerProfileManager.getProfiles()
        .some((profile) => profile.id === id), profileId)).toBe(true);
    await page.evaluate(() => document.getElementById('btn-player-profile-archive').click());
    expect(await page.evaluate((id) => window.GAME_INSTANCE.playerProfileManager.getProfiles()
        .some((profile) => profile.id === id), profileId)).toBe(false);
});
