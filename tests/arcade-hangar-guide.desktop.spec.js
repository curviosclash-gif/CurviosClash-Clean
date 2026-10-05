import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu, openStartSetupSection } from './helpers.js';
import { ARCADE_STONE_WORKSHOP_STORAGE_KEY, ARCADE_STONE_SLOT_IDS } from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY, arcadeVehicleXpForLevel } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';

test('T-ARC-G1: native Hangar gives one reachable goal, guides to it and remembers skipped/completed introduction', async ({ page, electronApp }, testInfo) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await openStartSetupSection(page,'arcade');
    await page.locator('.arcade-advanced-options-summary').click();
    const openHangar=async()=>{const opening=electronApp.waitForEvent('window');await page.locator('.hangar-window-open').click();const hangar=await opening;await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();return hangar;};
    let hangar=await openHangar();
    const card=hangar.getByRole('region',{name:'Nächstes Ziel',exact:true});
    await expect(card).toHaveCount(1);await expect(card).toHaveAttribute('data-goal-id','place-stone');
    await expect(card).toContainText('3 Steine');
    await expect(card.getByRole('region',{name:'Hangar-Einführung'})).toBeVisible();
    await card.getByRole('button',{name:'Zeigen',exact:true}).click();
    await expect(hangar.locator('.hangar-stone-panel')).toHaveClass(/is-guide-highlight/);
    await expect(card).toContainText('Lab: 0/6');
    await card.getByRole('button',{name:'Überspringen',exact:true}).click();
    await expect(card.locator('.hangar-guide-tutorial')).toBeHidden();
    await hangar.screenshot({path:testInfo.outputPath('arcade-next-goal.png')});
    await hangar.locator('#hangar-window-close').click();
    hangar=await openHangar();
    await expect(hangar.locator('.hangar-guide-tutorial')).toBeHidden();
    await hangar.getByRole('button',{name:'Einführung',exact:true}).click();
    for(let step=0;step<4;step++) await hangar.locator('.hangar-guide-tutorial').getByRole('button',{name:'Weiter',exact:true}).click();
    await expect(hangar.locator('#hangar-build-view-form')).toHaveAttribute('aria-selected','true');
    await hangar.locator('.hangar-guide-tutorial').getByRole('button',{name:'Fertig',exact:true}).click();
    await expect(hangar.locator('.hangar-guide-tutorial')).toBeHidden();
    const record=await page.evaluate(()=>window.GAME_INSTANCE.settingsManager.getPlayerRecordStorePort().loadJsonRecord('cuviosclash.arcade-hangar-guide.v1',null));
    expect(record.tutorial).toBe('completed');
    await hangar.locator('#hangar-window-close').click();
});

test('T-ARC-G2: mature native Hangar offers an unfinished color rather than recurring level seventy', async ({ page, electronApp }) => {
    await waitForLoadedGame(page);
    await page.evaluate(({ poolKey, profileKey, slots, xp }) => {
        const game = window.GAME_INSTANCE; const store = game.settingsManager.getPlayerRecordStorePort();
        game.settings.vehicles.PLAYER_1 = 'ship5';
        const profiles = store.loadJsonRecord(profileKey, {});
        profiles.ship5 = { schemaVersion:'arcade-vehicle-profile.v3', vehicleId:'ship5', level:60, xp, xpBank:100000,
            sizeWorkshopUnlocked:true,purchasedSizeSteps:25,purchasedItemSlots:3,purchasedRocketSlots:3,
            stoneSlotPackages:['wings','engines','utility'],partSizes:{hull:125,nose:125,wings:125,engines:125,utility:125} };
        store.saveJsonRecord(profileKey, profiles);
        store.saveJsonRecord(poolKey, {schemaVersion:'arcade-stone-workshop.v1',nextSerial:22,updatedAt:new Date().toISOString(),
            stones:['ship5','arrow','manta'].flatMap((vehicleId,index)=>slots.map((slotId,slot)=>({stoneId:`stone-${index*7+slot+1}`,level:7,placement:{vehicleId,slotId}})))});
    }, { poolKey:ARCADE_STONE_WORKSHOP_STORAGE_KEY,profileKey:ARCADE_VEHICLE_PROFILE_STORAGE_KEY,slots:ARCADE_STONE_SLOT_IDS,xp:arcadeVehicleXpForLevel(60) });
    await openCustomSubmenu(page); await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click();
    await openStartSetupSection(page,'arcade'); await page.locator('.arcade-advanced-options-summary').click();
    const opening = electronApp.waitForEvent('window'); await page.locator('.hangar-window-open').click(); const hangar = await opening;
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('.arcade-vehicle-card[data-vehicle-id="ship5"]').click();
    const card = hangar.getByRole('region',{name:'Nächstes Ziel',exact:true});
    await expect(card).toHaveAttribute('data-goal-id','frost'); await expect(card).toContainText('Frost freispielen');
    await card.getByRole('button',{name:'Zeigen',exact:true}).click();
    await expect(hangar.locator('#hangar-build-view-form')).toHaveAttribute('aria-selected','true');
    await hangar.locator('#hangar-window-close').click();
});
