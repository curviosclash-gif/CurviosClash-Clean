import { expect, test } from './helpers.desktop.js';
import { loadGame, openCustomSubmenu, returnToMenu, waitForRenderFrames } from './helpers.js';

const VEHICLE_PROFILE_KEY = 'cuviosclash.arcade-vehicle-profile.v2';

async function openArcadeMenu(page) {
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.locator('[data-start-section-target="arcade"]').evaluate((button) => button.click());
    await expect(page.locator('#btn-arcade-weapon-race-start-inline')).toBeVisible();
}

test('Wave 7: getrennte Fahrzeugprofile und Kosmetik sind im Desktop-Hangar sichtbar', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await loadGame(page);
    const seeded = await page.evaluate((storageKey) => {
        const store = window.GAME_INSTANCE?.settingsManager?.getPlayerRecordStorePort?.();
        if (!store?.saveJsonRecord) return false;
        const now = new Date().toISOString();
        const common = {
            schemaVersion: 'arcade-vehicle-profile.v2',
            unlockedSlots: ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right', 'utility'],
            unlockedPartFamilies: ['frame', 'wing', 'engine', 'utility'],
            unlockedUpgradeTiers: ['T1', 'T2', 'T3'],
            upgrades: {},
            createdAt: now,
            updatedAt: now,
        };
        return store.saveJsonRecord(storageKey, {
            ship1: {
                ...common,
                vehicleId: 'ship1', xp: 20000, xpBank: 4321, totalXpEarned: 20000, level: 30,
                trailStyleId: 'prism',
                weaponStyleIds: { mg: 'nova', rockets: 'ion', flamethrower: 'ember', railgun: 'nova', lightning: 'ion' },
            },
            ship2: {
                ...common,
                vehicleId: 'ship2', xp: 520, xpBank: 275, totalXpEarned: 520, level: 3,
                trailStyleId: 'standard',
                weaponStyleIds: { mg: 'standard', rockets: 'standard', flamethrower: 'standard', railgun: 'standard', lightning: 'standard' },
            },
        })?.success === true;
    }, VEHICLE_PROFILE_KEY);
    expect(seeded).toBe(true);

    await page.goto(new URL('/hangar.html?mode=arcade', page.url()).href);
    await expect(page.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#arcade-vehicle-preview-stage')).toHaveAttribute('data-preview-status', 'ready');
    await page.locator('.arcade-vehicle-card[data-vehicle-id="ship1"]').click();
    await expect(page.locator('.arcade-vehicle-level')).toContainText('Level 30');
    await expect(page.locator('.arcade-vehicle-level')).toContainText('XP-Bank 4321');
    await expect(page.locator('.hangar-cosmetics-panel')).toContainText('Spur');
    await expect(page.locator('.hangar-cosmetic-select').first()).toHaveValue('prism');
    await page.screenshot({ path: testInfo.outputPath('wave7-01-profile-a-prism.png'), fullPage: true, animations: 'disabled' });

    await page.locator('.arcade-vehicle-card[data-vehicle-id="ship2"]').click();
    await expect(page.locator('.arcade-vehicle-level')).toContainText('Level 3');
    await expect(page.locator('.arcade-vehicle-level')).toContainText('XP-Bank 275');
    await expect(page.locator('.hangar-cosmetic-select').first()).toHaveValue('standard');
    await page.screenshot({ path: testInfo.outputPath('wave7-02-profile-b-standard.png'), fullPage: true, animations: 'disabled' });
});

test('Wave 7: Waffenrennen, Ergebnisvergleich und Neustart bleiben sichtbar und sauber', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await loadGame(page);
    await openArcadeMenu(page);
    await page.locator('#btn-arcade-weapon-race-start-inline').click({ force: true });
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === 'parcours_assault'
            && game?.runtimeFacade?.getArcadeRunState?.()?.runType === 'weapon_race';
    }, null, { timeout: 60_000 });
    await waitForRenderFrames(page, 4);

    const start = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        let pickupMarkers = 0;
        game.renderer?.scene?.traverse?.((node) => {
            if (String(node?.name || '').startsWith('weapon-race-pickup:')) pickupMarkers += 1;
        });
        return {
            bots: manager?.bots?.length || 0,
            racers: game.runtimeFacade?.getArcadeRunState?.()?.racerCount || 0,
            pickupMarkers,
            mode: manager?.gameModeStrategy?.getPickupModeType?.() || '',
        };
    });
    expect(start).toEqual({ bots: 4, racers: 5, pickupMarkers: 5, mode: 'HUNT' });
    await page.screenshot({ path: testInfo.outputPath('wave7-07-weapon-race-start.png'), animations: 'disabled' });

    const exercise = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const runtime = game.runtimeFacade?._arcadeSupport?.weaponRaceRuntime;
        const human = manager?.humanPlayers?.[0];
        const bot = manager?.bots?.[0]?.player;
        if (!runtime || !human || !bot) return null;
        const stages = ['CP02_MG', 'CP03_MG', 'CP05_ROCKET', 'CP07_HEAVY', 'CP08_FINAL'];
        const weapons = [];
        let duplicateXp = null;
        for (const checkpointId of stages) {
            const beforeXp = runtime.xpEarned;
            runtime.handleCheckpoint({ playerIndex: human.index, checkpointId });
            weapons.push(human.weaponRaceWeaponId);
            if (checkpointId === 'CP02_MG') {
                runtime.handleCheckpoint({ playerIndex: human.index, checkpointId });
                duplicateXp = runtime.xpEarned - beforeXp;
            }
        }
        runtime.handleCheckpoint({ playerIndex: bot.index, checkpointId: 'CP02_MG' });
        const death = runtime.handleDeath({ playerIndex: human.index });
        const startedAt = runtime.state.startedAtMs;
        runtime.handleFinish({ playerIndex: human.index, finishedAtMs: startedAt + 61_500 });
        runtime.handleFinish({ playerIndex: bot.index, finishedAtMs: startedAt + 64_000 });
        const outcome = runtime.getRoundOutcome(startedAt + 76_501);
        game.matchFlowUiController.onRoundEnd(outcome.winner, outcome);
        game.hudRuntimeSystem?.refreshArcadeHud?.();
        return {
            weapons,
            duplicateXp,
            botWeapon: bot.weaponRaceWeaponId,
            death,
            graceMs: runtime.state.graceEndsAtMs - runtime.state.firstFinishAtMs,
            standings: outcome.standings,
        };
    });
    expect(exercise.weapons).toEqual(['machine_gun', 'flamethrower', 'rocket_medium', 'railgun', 'lightning']);
    expect(exercise.duplicateXp).toBe(10);
    expect(exercise.botWeapon).toBe('machine_gun');
    expect(exercise.death.weaponId).toBe('lightning');
    expect(exercise.graceMs).toBe(15_000);
    expect(exercise.standings.filter((row) => row.result === 'DNF').length).toBe(3);

    await expect(page.locator('#message-stats')).toBeVisible();
    await expect(page.locator('[data-stats-block-id="participant-comparison"]')).toBeAttached();
    await expect(page.locator('[data-stats-block-id="arcade-progression"]')).toBeAttached();
    const details = page.locator('#message-stats details.message-stats-details');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(page.locator('[data-stats-value="weaponRaceResult"]').first()).toContainText('61,5');
    await page.screenshot({ path: testInfo.outputPath('wave7-11-result-details.png'), animations: 'disabled' });

    await returnToMenu(page);
    await openArcadeMenu(page);
    await page.locator('#btn-arcade-weapon-race-start-inline').click({ force: true });
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.runtimeFacade?.getArcadeRunState?.()?.runType === 'weapon_race', null, { timeout: 60_000 });
    const restart = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        let pickupMarkers = 0;
        game.renderer?.scene?.traverse?.((node) => {
            if (String(node?.name || '').startsWith('weapon-race-pickup:')) pickupMarkers += 1;
        });
        return { pickupMarkers, racers: game.runtimeFacade.getArcadeRunState().racerCount };
    });
    expect(restart).toEqual({ pickupMarkers: 5, racers: 5 });
    await page.screenshot({ path: testInfo.outputPath('wave7-13-clean-restart.png'), animations: 'disabled' });
});
