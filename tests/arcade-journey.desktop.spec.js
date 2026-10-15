import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, returnToMenu, selectSessionType, openStartSetupSection, chooseFreePlayVariant, menuScreenSelector } from './helpers.js';
import { ARCADE_JOURNEY_STORAGE_KEY, ARCADE_JOURNEY_SCHEMA } from '../src/shared/contracts/ArcadeJourneyContract.js';

async function openJourney(page, sessionType = 'single') {
    await waitForLoadedGame(page);
    await returnToMenu(page);
    await selectSessionType(page, sessionType);
    await expect(page.getByRole('region', { name: 'Arcade-Reise', exact: true })).toBeVisible();
}

async function readJourney(page) {
    return page.evaluate(key => {
        const manager = window.GAME_INSTANCE.playerProfileManager;
        return manager.getRecordStorePort(manager.getActiveProfile().id).readJsonRecordResult(key);
    }, ARCADE_JOURNEY_STORAGE_KEY);
}

async function openExtraStage(page, stageId) {
    const group = page.locator('.journey-extra-runs');
    if (!await group.evaluate(element => element.open)) await group.locator('summary').click();
    await group.locator(`[data-journey-extra="extra_${stageId}"]`).click();
}

test('journey overview, world focus, party boards and native Hangar return keep the selected stage', async ({ page, electronApp }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openJourney(page);
    const root = page.getByRole('region', { name: 'Arcade-Reise', exact: true });
    await expect(root.locator('[data-journey-world]')).toHaveCount(6);
    await root.locator('[data-journey-world="flight_school"]').click();
    await expect(root.locator('[data-journey-node="first_flight"]')).toBeFocused();
    await expect(root.locator('[data-journey-players="2"]')).toBeHidden();
    await expect(root.locator('[data-journey-players="3"]')).toBeHidden();
    await root.locator('[data-journey-back]').click();
    await expect(root.locator('[data-journey-world="flight_school"]')).toBeFocused();
    await openExtraStage(page, 'five_portals');
    await expect(root.locator('[data-journey-start="five_portals"]')).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('journey-locked-portals-1280.png') });
    const opening = electronApp.waitForEvent('window');
    await root.locator('[data-journey-hangar="five_portals"]').click();
    const hangar = await opening;
    await expect(hangar.locator('#arcade-vehicle-manager')).toBeVisible();
    await hangar.locator('#hangar-window-close').click();
    await expect(root.locator('[data-journey-world-panel="extras"]')).toBeVisible();
    await expect(page.locator('#arcade-difficulty-tier')).toBeEnabled();
    await expect(page.locator('#btn-arcade-daily')).toBeEnabled();
});

test('controlled round outcomes exercise native journey result, persisted medal and validated next-stage launch', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openJourney(page);
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="first_route"]').click();
    await page.locator('[data-journey-start="first_run"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const config = await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig.arcade);
    expect(config.journeyStageId).toBe('first_run');
    expect(config.sectorCount).toBe(5);
    // Integration fixture: enter normal round outcomes at the established lifecycle seam.
    // This checks wiring/storage/UI; it is not a gameplay or flight-completion acceptance proof.
    await finishJourneyFixture(page);
    await expect(page.locator('[data-journey-action="next"]')).toBeEnabled();
    const result = await readJourney(page);
    expect(result.status).toBe('found');
    expect(result.value.stages.first_run.medals.normal.medal).toBeGreaterThanOrEqual(1);
    expect(result.value.boards['first_run:normal:1']).toHaveLength(1);
    for (const button of await page.locator('[data-journey-action]').all()) {
        const box = await button.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath('journey-result.png') });
    await page.locator('[data-journey-action="next"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeConfig.arcade.journeyStageId === 'five_portals');
    expect((await readJourney(page)).value).toEqual(result.value);
});


test('controlled tutorial crossings award only at finish and return to the journey world', async ({ page }, testInfo) => {
    await openJourney(page);
    const beforeTutorial = await readJourney(page);
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-start="flight_school"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING'
        && window.GAME_INSTANCE.entityManager.getParcoursRouteSnapshot()?.routeId === 'classic_tutorial_v1');
    expect(await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig.arcade.enabled)).toBe(false);
    // Controlled geometry fixture, not a native flight proof: real ordered ring predicates and finish callback.
    const checkpoints = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager.runtimePorts.spawn.parcoursProgressSystem;
        const player = manager.humanPlayers[0];
        let fixtureNowMs = performance.now();
        for (const entry of system.getRouteSnapshot().checkpoints) {
            const length = Math.hypot(...entry.forward) || 1;
            const unit = entry.forward.map(value => value / length);
            const previous = { x: entry.pos[0] - unit[0] * entry.radius * 0.5,
                y: entry.pos[1] - unit[1] * entry.radius * 0.5, z: entry.pos[2] - unit[2] * entry.radius * 0.5 };
            player.position.set(entry.pos[0] + unit[0] * entry.radius * 0.5,
                entry.pos[1] + unit[1] * entry.radius * 0.5, entry.pos[2] + unit[2] * entry.radius * 0.5);
            fixtureNowMs += 1000;
            system.updatePlayerProgress(player, previous, fixtureNowMs);
        }
        return system.getPlayerProgressSnapshot(0);
    });
    expect(checkpoints.completed).toBe(false);
    expect(await readJourney(page)).toEqual(beforeTutorial);
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const system = manager.runtimePorts.spawn.parcoursProgressSystem;
        const player = manager.humanPlayers[0];
        const entry = system.getRouteSnapshot().finish;
        const length = Math.hypot(...entry.forward) || 1;
        const unit = entry.forward.map(value => value / length);
        const previous = { x: entry.pos[0] - unit[0] * entry.radius * 0.5,
            y: entry.pos[1] - unit[1] * entry.radius * 0.5, z: entry.pos[2] - unit[2] * entry.radius * 0.5 };
        player.position.set(entry.pos[0] + unit[0] * entry.radius * 0.5,
            entry.pos[1] + unit[1] * entry.radius * 0.5, entry.pos[2] + unit[2] * entry.radius * 0.5);
        const fixtureNowMs = Math.max(performance.now(), system.getPlayerProgressSnapshot(0).lastCheckpointAtMs) + 1000;
        system.updatePlayerProgress(player, previous, fixtureNowMs);
    });
    await expect(page.locator('[data-journey-action="map"]')).toBeVisible();
    const saved = await readJourney(page);
    expect(saved.value.stages.flight_school.medals.normal.medal).toBe(1);
    expect(saved.value.boards['flight_school:normal:1']).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath('flight-school-result.png') });
    await page.locator('[data-journey-action="map"]').click();
    await expect(page.locator('[data-journey-world-panel="flight_school"]')).toBeVisible();
    await expect(page.locator('[data-journey-start="first_run"]')).toBeEnabled();
});

async function finishJourneyFixture(page) {
    for (let sector = 1; sector <= 5; sector++) {
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            for (const player of game.entityManager.humanPlayers) { player.alive = true; player.hp = Math.max(60, player.hp); }
            const human = game.entityManager.humanPlayers[0];
            game.matchFlowUiController.onRoundEnd(human, { reason: 'ARCADE_OBJECTIVE' });
        });
        if (sector < 5) {
            await page.locator('#btn-arcade-intermission-continue').click();
            await page.waitForFunction(next => window.GAME_INSTANCE.state === 'PLAYING'
                && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === next, sector + 1);
        }
    }
    await page.locator('#btn-arcade-victory-finish').click();
}


async function openJourneyProfileManager(page) {
    await returnToMenu(page);
    for (const screen of ['freeplay', 'modeChoice']) {
        const panel = page.locator(menuScreenSelector(screen));
        if (await panel.count()) await panel.locator('.submenu-header [data-back]').click();
    }
    await expect(page.locator('#menu-nav')).toBeVisible();
    await page.locator('#btn-main-player').click();
    await expect(page.locator('#player-profile-name')).toBeVisible();
}

async function activateJourneyProfile(page, id) {
    await openJourneyProfileManager(page);
    if (await page.evaluate(() => window.GAME_INSTANCE.playerProfileManager.getActiveProfile().id) === id) {
        await page.locator('#btn-close-level4').click(); return;
    }
    await page.locator('#player-profile-select').selectOption(id);
    await Promise.all([
        page.waitForEvent('domcontentloaded'),
        page.locator('#btn-player-profile-activate').click(),
    ]);
    await waitForLoadedGame(page);
    await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.playerProfileManager.getActiveProfile()?.id)).toBe(id);
}

async function createJourneyProfileFixture(page) {
    await waitForLoadedGame(page);
    await openJourneyProfileManager(page);
    const ids = [];
    const fixtureSerial = Date.now();
    for (const label of ['Journey A', 'Journey B', 'Journey C', 'Journey D']) {
        const name = `${label} ${fixtureSerial}`;
        await page.locator('#player-profile-name').fill(name);
        await page.locator('#btn-player-profile-create').click();
        const id = await page.evaluate(label => window.GAME_INSTANCE.playerProfileManager.getProfiles()
            .find(profile => profile.displayName === label)?.id, name);
        expect(id).toBeTruthy(); ids.push(id);
    }
    await page.locator('#btn-close-level4').click();
    const neutral = ids.shift();
    await activateJourneyProfile(page, neutral);
    // Historical progress fixture: these medals are seeded, not earned by this test.
    const saved = await page.evaluate(({ id, key, schema }) => window.GAME_INSTANCE.playerProfileManager.getRecordStorePort(id)
        .saveJsonRecord(key, { schema, stages: { flight_school: { medals: { normal: { medal: 1, runId: 'fixture-school' } } } } }),
    { id: ids[0], key: ARCADE_JOURNEY_STORAGE_KEY, schema: ARCADE_JOURNEY_SCHEMA });
    expect(saved === true || saved?.success === true || saved?.ok === true).toBe(true);
    return { neutral, ids };
}

async function readJourneyProfiles(page, ids) {
    return page.evaluate(({ ids, key }) => ids.map(id => window.GAME_INSTANCE.playerProfileManager.getRecordStorePort(id)
        .readJsonRecordResult(key)), { ids, key: ARCADE_JOURNEY_STORAGE_KEY });
}

async function chooseJourneyParty(page, count, ids) {
    await openJourney(page, 'splitscreen');
    await openStartSetupSection(page, 'players');
    await page.locator(`[data-split-player-count="${count}"]`).click();
    for (const device of await page.locator('[data-split-device]:visible').all()) await device.selectOption('keyboard');
    await chooseFreePlayVariant(page, 'ffa');
    await openStartSetupSection(page, 'vehicle');
    await page.locator('#vehicle-select-p1').selectOption('ship5');
    await page.locator('#vehicle-p2-container').click();
    await page.locator('#vehicle-select-p2').selectOption('ship5');
    if (count === 3) {
        await page.locator('#btn-vehicle-player-p3').click();
        await page.locator('#vehicle-select-p3').selectOption('ship5');
    }
    await openStartSetupSection(page, 'arcade');
    for (let index = 0; index < count; index++) {
        const select = page.getByLabel(`Arcade-Spielerprofil Spieler ${index + 1}`);
        await select.focus(); await select.selectOption(ids[index]);
    }
}

for (const count of [2, 3]) test(`journey ${count}-player result belongs to all selected seats while active profile A stays unchanged`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const { neutral, ids } = await createJourneyProfileFixture(page);
    const seats = ids.slice(0, count);
    await chooseJourneyParty(page, count, seats);
    const root = page.getByRole('region', { name: 'Arcade-Reise', exact: true });
    await openExtraStage(page, 'five_portals');
    await expect(root.locator('[data-journey-start="five_portals"]')).toBeEnabled();
    await expect(root).toContainText('Journey B');
    await root.locator('[data-journey-back]').click();
    await root.locator('[data-journey-world="flight_school"]').click();
    await expect(root.locator('[data-journey-start="flight_school"]')).toBeDisabled();
    await root.locator('[data-journey-node="first_route"]').click();
    await root.locator('[data-journey-start="first_run"]').click();
    await page.waitForFunction(expected => window.GAME_INSTANCE.state === 'PLAYING'
        && window.GAME_INSTANCE.entityManager.humanPlayers.length === expected
        && window.GAME_INSTANCE.runtimeConfig.arcade.journeyStageId === 'first_run', count);
    await finishJourneyFixture(page);
    await expect(page.locator('[data-journey-action="next"]')).toBeEnabled();
    const records = await readJourneyProfiles(page, [neutral, ...ids]);
    expect(records[0].status).toBe('missing');
    for (let index = 0; index < count; index++) {
        expect(records[index + 1].value.stages.first_run.medals.normal.medal).toBeGreaterThanOrEqual(1);
        expect(records[index + 1].value.boards[`first_run:normal:${count}`]).toHaveLength(1);
        expect(records[index + 1].value.boards['first_run:normal:1']).toBeUndefined();
    }
    if (count === 2) expect(records[3].status).toBe('missing');
    await page.screenshot({ path: testInfo.outputPath(`journey-${count}-profiles-result.png`) });
    await page.locator('[data-journey-action="map"]').click();
    await expect(root.locator('[data-journey-world-panel="flight_school"]')).toBeVisible();
    const snapshot = await readJourneyProfiles(page, [neutral, ...ids]);
    expect(snapshot).toEqual(records);
});

test('switching real profiles reloads only their own journey gates and keeps the other profile untouched', async ({ page }) => {
    test.setTimeout(180_000);
    const { neutral, ids } = await createJourneyProfileFixture(page);
    const before = await readJourneyProfiles(page, [neutral, ...ids]);
    await activateJourneyProfile(page, ids[0]);
    await openJourney(page);
    await openExtraStage(page, 'five_portals');
    await expect(page.locator('[data-journey-start="five_portals"]')).toBeEnabled();
    await activateJourneyProfile(page, neutral);
    await openJourney(page);
    await openExtraStage(page, 'five_portals');
    await expect(page.locator('[data-journey-start="five_portals"]')).toBeDisabled();
    expect(await readJourneyProfiles(page, [neutral, ...ids])).toEqual(before);
});
