import { expect, test } from './helpers.desktop.js';
import { openStartSetupSection, returnToMenu, selectSessionType, waitForLoadedGame } from './helpers.js';
import {
    createArcadeStoneWorkshopRecord,
    evaluateArcadeStoneUpgrade,
    ARCADE_STONE_WORKSHOP_STORAGE_KEY,
} from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import { applyArcadeStonePlacement, resolveArcadeStoneExtraSteps } from '../src/shared/contracts/ArcadeStonePlacementContract.js';
import { arcadeVehicleXpForLevel, createArcadeVehicleProfileRecord, ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    evaluateArcadeSizeResize,
    evaluateArcadeSizeStepPurchase,
    evaluateArcadeSizeUnlock,
} from '../src/shared/contracts/ArcadeVehicleBuildContract.js';

const PROFILE_NAMES = ['Arcade Bind A', 'Arcade Bind B', 'Arcade Bind C'];
const TRAIL_STYLES = ['ion', 'ember', 'violet'];

function createSizedVehicleProfile(vehicleId, trailStyleId) {
    const level = 30;
    const xp = arcadeVehicleXpForLevel(level);
    let profile = {
        ...createArcadeVehicleProfileRecord(vehicleId, 0),
        level,
        xp,
        xpBank: xp,
        totalXpEarned: xp,
        trailStyleId,
    };
    let result = evaluateArcadeSizeUnlock(profile);
    expect(result.ok).toBe(true);
    profile = result.next;
    for (let index = 0; index < 5; index += 1) {
        result = evaluateArcadeSizeStepPurchase(profile);
        expect(result.ok).toBe(true);
        profile = result.next;
    }
    result = evaluateArcadeSizeResize(profile, { ...profile.partSizes, hull: 125 });
    expect(result.ok).toBe(true);
    return result.next;
}

async function openProfileManager(page) {
    await returnToMenu(page);
    const gamePanel = page.locator('#submenu-game:not(.hidden)');
    if (await gamePanel.count()) {
        await gamePanel.locator('.submenu-header [data-back]').click();
        await expect(page.locator('#submenu-custom')).toBeVisible();
    }
    const modePanel = page.locator('#submenu-custom:not(.hidden)');
    if (await modePanel.count()) {
        await modePanel.locator('.submenu-header [data-back]').click();
        await expect(page.locator('#menu-nav')).toBeVisible();
    }
    await expect(page.locator('#menu-nav')).toBeVisible();
    await page.locator('[data-menu-action="level4-open"][data-level4-section="tools"][data-menu-text-id="menu.utility.profiles.label"]').click();
    await expect(page.locator('#level4-section-tools')).toBeVisible();
    await expect(page.locator('#player-profile-name')).toBeVisible();
}

async function createProfiles(page) {
    await openProfileManager(page);
    const ids = [];
    for (const name of PROFILE_NAMES) {
        await page.locator('#player-profile-name').fill(name);
        await page.locator('#btn-player-profile-create').click();
        await expect(page.locator('#player-profile-select option').filter({ hasText: name })).toHaveCount(1);
        ids.push(await page.evaluate((profileName) => window.GAME_INSTANCE.playerProfileManager.getProfiles()
            .find((profile) => profile.displayName === profileName)?.id || '', name));
    }
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(3);
    await page.locator('#btn-close-level4').click();
    return ids;
}

async function activateProfile(page, profileId) {
    await openProfileManager(page);
    const activeId = await page.evaluate(() => window.GAME_INSTANCE.playerProfileManager.getActiveProfile()?.id || '');
    if (activeId !== profileId) {
        await page.locator('#player-profile-select').selectOption(profileId);
        await page.evaluate(() => { window.__profileSwitchPending = true; });
        await page.locator('#btn-player-profile-activate').click();
        await expect.poll(() => page.evaluate(() => window.__profileSwitchPending !== true)).toBe(true);
        await waitForLoadedGame(page);
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.playerProfileManager.getActiveProfile()?.id || ''))
            .toBe(profileId);
    } else {
        await page.locator('#btn-close-level4').click();
    }
}

async function openArcadeMenu(page, sessionType) {
    await selectSessionType(page, sessionType);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await expect(page.locator('#submenu-game')).toBeVisible();
    await page.locator('#submenu-game [data-start-section-target="arcade"]').click();
}

async function setThreePlayerSetup(page, profileIds) {
    await openStartSetupSection(page, 'players');
    await page.locator('[data-split-player-count="3"]').click();
    await expect(page.locator('[data-split-player-count="3"]')).toHaveAttribute('aria-pressed', 'true');
    for (const device of await page.locator('[data-split-device]').all()) await device.selectOption('keyboard');

    await openStartSetupSection(page, 'vehicle');
    const vehicleId = await page.evaluate(() => {
        const values = ['p1', 'p2', 'p3'].map((player) => Array.from(
            document.querySelectorAll(`#vehicle-select-${player} option`), (option) => String(option.value || ''),
        ));
        return values[0].find((value) => value && values.every((list) => list.includes(value))) || '';
    });
    expect(vehicleId).not.toBe('');
    await page.locator('#vehicle-select-p1').selectOption(vehicleId);
    await page.locator('#vehicle-p2-container').click();
    await expect(page.locator('#vehicle-select-p2')).toBeVisible();
    await page.locator('#vehicle-select-p2').selectOption(vehicleId);
    await page.locator('#btn-vehicle-player-p3').click();
    await expect(page.locator('#vehicle-select-p3')).toBeVisible();
    await page.locator('#vehicle-select-p3').selectOption(vehicleId);

    await page.locator('#submenu-game [data-start-section-target="arcade"]').click();
    const profileSelects = profileIds.map((_, index) => page.getByLabel(`Arcade-Spielerprofil Spieler ${index + 1}`));
    for (let index = 0; index < profileIds.length; index += 1) {
        await profileSelects[index].focus();
        await expect(profileSelects[index].locator(`option[value="${profileIds[index]}"]`)).toHaveCount(1);
        await profileSelects[index].selectOption(profileIds[index]);
    }
    return vehicleId;
}

async function seedProfileBuilds(page, profileIds, vehicleId) {
    const profiles = profileIds.map((_, index) => createSizedVehicleProfile(vehicleId, TRAIL_STYLES[index]));
    const seeds = profileIds.map((_, index) => {
        const pool = createArcadeStoneWorkshopRecord(0);
        const stoneId = pool.stones[0].stoneId;
        let nextPool = pool;
        let profile = profiles[index];
        for (let level = 1; level < index + 1; level += 1) {
            const upgrade = evaluateArcadeStoneUpgrade(nextPool, profile, stoneId, 0);
            expect(upgrade.ok, `Spieler ${index + 1}: Stein T${level + 1} muss über den Workshopvertrag kaufbar sein`)
                .toBe(true);
            profile = upgrade.next;
            nextPool = upgrade.pool;
        }
        const placement = applyArcadeStonePlacement(
            nextPool,
            vehicleId,
            { core: stoneId },
            profile,
            { confirmTransfers: true, nowMs: 0 },
        );
        expect(placement.ok, `Spieler ${index + 1}: T${index + 1}-Stein muss im Rumpfplatz liegen`).toBe(true);
        const seededPool = placement.pool;
        const hullSteps = resolveArcadeStoneExtraSteps(seededPool, vehicleId, profile).hull;
        expect(hullSteps, `Spieler ${index + 1}: gültiger Build muss konkrete Rumpfschritte liefern`)
            .toBe(index + 1);
        return { profile, pool: seededPool, hullSteps };
    });
    const seeded = await page.evaluate(({ ids, seeds, profileKey, poolKey, vehicle }) => {
        const manager = window.GAME_INSTANCE?.playerProfileManager;
        if (!manager?.getRecordStorePort) return false;
        return ids.every((id, index) => {
            const store = manager.getRecordStorePort(id);
            if (!store?.saveJsonRecord || !store?.loadJsonRecord) return false;
            const { profile, pool } = seeds[index];
            const current = store.loadJsonRecord(profileKey, {});
            const savedProfile = store.saveJsonRecord(profileKey, { ...current, [vehicle]: profile });
            const savedPool = store.saveJsonRecord(poolKey, pool);
            return savedProfile?.success === true && savedPool?.success === true;
        });
    }, {
        ids: profileIds,
        seeds,
        profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
        poolKey: ARCADE_STONE_WORKSHOP_STORAGE_KEY,
        vehicle: vehicleId,
    });
    expect(seeded).toBe(true);
}

async function startNormalArcade(page, sessionType, humanCount) {
    await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE?.settings?.localSettings?.sessionType || ''))
        .toBe(sessionType);
    await page.locator('#btn-arcade-start-inline').click();
    await page.waitForFunction(({ expectedSessionType, expectedHumans }) => {
        const game = window.GAME_INSTANCE;
        return game?.settings?.localSettings?.sessionType === expectedSessionType
            && game?.runtimeConfig?.session?.numHumans === expectedHumans
            && game?.state === 'PLAYING'
            && game?.entityManager?.humanPlayers?.length === expectedHumans
            && game?.runtimeFacade?.arcadeRunRuntime?.getPhase?.() === 'sector_active';
    }, { expectedSessionType: sessionType, expectedHumans: humanCount });
}

test('Desktop normaler Arcade-Run bindet Profile je Spieler und beim Folgestart neu', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    const profileIds = await createProfiles(page);

    await openArcadeMenu(page, 'splitscreen');
    const vehicleId = await setThreePlayerSetup(page, profileIds);
    const secondProfileSelect = page.getByLabel('Arcade-Spielerprofil Spieler 2');
    await secondProfileSelect.selectOption(profileIds[0]);
    const beforeInvalidStart = await page.evaluate(() => ({
        settings: JSON.stringify(window.GAME_INSTANCE.settings),
        state: window.GAME_INSTANCE.state,
    }));
    await page.locator('#btn-start').click();
    const afterInvalidStart = await page.evaluate(() => ({
        settings: JSON.stringify(window.GAME_INSTANCE.settings),
        state: window.GAME_INSTANCE.state,
    }));
    expect(afterInvalidStart).toEqual(beforeInvalidStart);
    await expect(page.locator('#submenu-game')).toBeVisible();
    await secondProfileSelect.selectOption(profileIds[1]);
    await seedProfileBuilds(page, profileIds, vehicleId);
    await startNormalArcade(page, 'splitscreen', 3);

    const threePlayerRun = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const players = game.entityManager.humanPlayers;
        return {
            configuredIds: game.runtimeConfig.arcade.playerProfileIds,
            bindings: players.map((player) => {
                return {
                    profileId: game.runtimeConfig.arcade.playerProfileIds[player.index] || '',
                    vehicleId: player.vehicleId || '',
                    trailStyleId: player.arcadeCosmeticLoadout?.trailStyleId || '',
                };
            }),
        };
    });
    expect(threePlayerRun.configuredIds).toEqual(profileIds);
    expect(threePlayerRun.bindings.map((binding) => binding.profileId)).toEqual(profileIds);
    expect(threePlayerRun.bindings.map((binding) => binding.vehicleId)).toEqual([vehicleId, vehicleId, vehicleId]);
    expect(threePlayerRun.bindings.map((binding) => binding.trailStyleId)).toEqual(TRAIL_STYLES);

    await activateProfile(page, profileIds[0]);
    await openArcadeMenu(page, 'single');
    await page.locator('#submenu-game [data-start-section-target="arcade"]').click();
    await startNormalArcade(page, 'single', 1);
    const soloA = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return {
            profileId: game.runtimeConfig.arcade.playerProfileIds[0] || '',
            trailStyleId: game.entityManager.humanPlayers[0]?.arcadeCosmeticLoadout?.trailStyleId || '',
        };
    });
    expect(soloA).toEqual({ profileId: profileIds[0], trailStyleId: TRAIL_STYLES[0] });

    await activateProfile(page, profileIds[1]);
    await openArcadeMenu(page, 'single');
    await page.locator('#submenu-game [data-start-section-target="arcade"]').click();
    await startNormalArcade(page, 'single', 1);
    const soloB = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return {
            profileId: game.runtimeConfig.arcade.playerProfileIds[0] || '',
            trailStyleId: game.entityManager.humanPlayers[0]?.arcadeCosmeticLoadout?.trailStyleId || '',
        };
    });
    expect(soloB).toEqual({ profileId: profileIds[1], trailStyleId: TRAIL_STYLES[1] });
});
