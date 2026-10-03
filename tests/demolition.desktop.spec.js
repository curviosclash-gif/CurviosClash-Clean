import { expect, test } from './helpers.desktop.js';
import { openStartSetupSection, returnToMenu, waitForLoadedGame } from './helpers.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';

test.afterEach(async ({ page }) => {
    await returnToMenu(page).catch(() => {});
    await openThreePlayerArcadeMenu(page).catch(() => {});
    await page.locator('[data-split-player-count="2"]').click({ timeout: 1000 }).catch(() => {});
});

async function openThreePlayerArcadeMenu(page) {
    await waitForLoadedGame(page);
    await page.evaluate(() => window.GAME_INSTANCE?.runtimeCoordinator?.getUiManager?.()?.showMainNav?.());
    await page.locator('[data-session-type="splitscreen"]').click();
    await page.locator('#submenu-custom [data-mode-path="arcade"]').click();
    await expect(page.locator('#submenu-game')).toBeVisible();
    const playersTab = page.locator('#btn-start-step-players');
    if (await playersTab.isVisible()) await playersTab.click();
    else await openStartSetupSection(page, 'players');
    await page.locator('[data-split-player-count="3"]').click();
    await expect(page.locator('[data-split-player-count="3"]')).toHaveAttribute('aria-pressed', 'true');
    for (const device of await page.locator('[data-split-device]').all()) {
        await device.selectOption('keyboard');
    }
}

async function selectSameVehicleForThreePlayers(page) {
    await openStartSetupSection(page, 'vehicle');
    await expect(page.locator('#btn-vehicle-player-p3')).toBeVisible();
    const vehicleId = await page.evaluate(() => {
        const options = ['p1', 'p2', 'p3'].map((player) => Array.from(
            document.querySelectorAll(`#vehicle-select-${player} option`),
            (option) => String(option.value || '').trim(),
        ));
        return options[0].find((id) => id && options.every((list) => list.includes(id))) || '';
    });
    expect(vehicleId).not.toBe('');
    await page.selectOption('#vehicle-select-p1', vehicleId);
    await page.locator('#vehicle-p2-container').click();
    await expect(page.locator('#vehicle-select-p2')).toBeVisible();
    await page.selectOption('#vehicle-select-p2', vehicleId);
    await page.locator('#btn-vehicle-player-p3').click();
    await expect(page.locator('#vehicle-select-p3')).toBeVisible();
    await page.selectOption('#vehicle-select-p3', vehicleId);
    return vehicleId;
}

async function assignDemolitionProfiles(page, profileIds) {
    await page.locator('#submenu-game [data-start-section-target="arcade"]').click();
    await page.locator('.arcade-start-mode-options-summary').click();
    for (let index = 0; index < profileIds.length; index += 1) {
        const select = page.getByLabel(`Arcade-Spielerprofil Spieler ${index + 1}`);
        await select.focus();
        await expect(select.locator(`option[value="${profileIds[index]}"]`)).toHaveCount(1);
        await select.selectOption(profileIds[index]);
    }
}

test('Desktop Abrisskommando binds three UUID profiles across timeout and card rebuild', async ({ page }) => {
    test.setTimeout(150_000);
    await waitForLoadedGame(page);
    await page.locator('[data-menu-action="level4-open"][data-level4-section="tools"][data-menu-text-id="menu.utility.profiles.label"]').click();
    await expect(page.locator('#level4-section-tools')).toBeVisible();
    await expect(page.locator('#player-profile-name')).toBeVisible();
    await expect(page.locator('#btn-player-profile-create')).toBeVisible();
    const profileNames = ['Abriss QA 1', 'Abriss QA 2', 'Abriss QA 3'];
    const profileIds = [];
    for (const name of profileNames) {
        await page.locator('#player-profile-name').fill(name);
        await page.locator('#btn-player-profile-create').click();
        await expect(page.locator('#player-profile-select option').filter({ hasText: name })).toHaveCount(1);
        const id = await page.evaluate((profileName) => window.GAME_INSTANCE.playerProfileManager.getProfiles()
            .find((profile) => profile.displayName === profileName)?.id || '', name);
        profileIds.push(id);
    }
    await page.locator('#btn-close-level4').click();
    expect(profileIds).toHaveLength(3);
    expect(profileIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))).toBe(true);
    expect(new Set(profileIds).size).toBe(3);

    await openThreePlayerArcadeMenu(page);
    const vehicleId = await selectSameVehicleForThreePlayers(page);
    await assignDemolitionProfiles(page, profileIds);
    await page.locator('#btn-arcade-demolition-start-inline').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 3
        && window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.demolitionSupport?.runtime?.phase === 'active');

    const setup = await page.evaluate(({ ids, profileKey }) => {
        const game = window.GAME_INSTANCE;
        const runtime = game.runtimeFacade._arcadeSupport.demolitionSupport.runtime;
        const vehicleId = game.entityManager.humanPlayers[0].vehicleId;
        const readXp = (profileId) => {
            const data = game.playerProfileManager.getRecordStorePort(profileId).loadJsonRecord(profileKey, {});
            return Number(data?.[vehicleId]?.totalXpEarned) || 0;
        };
        return {
            vehicleIds: game.entityManager.humanPlayers.map((player) => player.vehicleId),
            profiles: game.runtimeConfig.arcade.demolitionProfileIds,
            mapIndex: runtime.mapIndex,
            rockets: game.entityManager.humanPlayers.map((player) => player.rocketInventory
                .filter((weapon) => weapon === 'ROCKET_MEDIUM').length),
            xpBefore: ids.map(readXp),
            vehicleId,
        };
    }, { ids: profileIds, profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY });
    expect(setup.vehicleIds).toEqual([vehicleId, vehicleId, vehicleId]);
    expect(setup.profiles).toEqual(profileIds);
    expect(setup.mapIndex).toBe(0);
    expect(setup.rockets).toEqual([2, 2, 2]);
    expect(setup.vehicleId).toBe(vehicleId);

    const xpAfterKills = await page.evaluate(({ ids, profileKey, vehicleId }) => {
        const game = window.GAME_INSTANCE;
        const emit = game.entityManager.onArcadeGameplayEvent;
        emit({ type: 'kill', playerIndex: 0, count: 1 });
        emit({ type: 'kill', playerIndex: 1, count: 2 });
        emit({ type: 'kill', playerIndex: 2, count: 3 });
        return ids.map((profileId) => {
            const data = game.playerProfileManager.getRecordStorePort(profileId).loadJsonRecord(profileKey, {});
            return Number(data?.[vehicleId]?.totalXpEarned) || 0;
        });
    }, { ids: profileIds, profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY, vehicleId });
    expect(xpAfterKills.map((xp, index) => xp - setup.xpBefore[index])).toEqual([15, 60, 135]);

    await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.demolitionSupport.runtime;
        runtime.update(runtime.remainingSeconds + 1);
    });
    await page.waitForFunction(() => window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.demolitionSupport?.runtime?.mapIndex === 1
        && window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 3);
    const rebuilt = await page.evaluate(({ ids, profileKey, vehicleId }) => {
        const game = window.GAME_INSTANCE;
        const runtime = game.runtimeFacade._arcadeSupport.demolitionSupport.runtime;
        const readXp = (profileId) => {
            const data = game.playerProfileManager.getRecordStorePort(profileId).loadJsonRecord(profileKey, {});
            return Number(data?.[vehicleId]?.totalXpEarned) || 0;
        };
        return {
            mapIndex: runtime.mapIndex,
            timedOut: runtime.mapStats[0]?.timedOut,
            rockets: game.entityManager.humanPlayers.map((player) => player.rocketInventory
                .filter((weapon) => weapon === 'ROCKET_MEDIUM').length),
            vehicleIds: game.entityManager.humanPlayers.map((player) => player.vehicleId),
            profiles: game.runtimeConfig.arcade.demolitionProfileIds,
            xpAfterTimeout: ids.map(readXp),
        };
    }, { ids: profileIds, profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY, vehicleId });
    expect(rebuilt.mapIndex).toBe(1);
    expect(rebuilt.timedOut).toBe(true);
    expect(rebuilt.rockets).toEqual([2, 2, 2]);
    expect(rebuilt.vehicleIds).toEqual([vehicleId, vehicleId, vehicleId]);
    expect(rebuilt.profiles).toEqual(profileIds);
    expect(rebuilt.xpAfterTimeout).toEqual(xpAfterKills);

});
