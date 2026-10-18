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
    const back = page.locator('[data-journey-back]');
    if (await back.isVisible()) await back.click();
    await page.getByLabel('Kartenziele anzeigen', { exact: true }).selectOption('all');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator(`[data-journey-node="${stageId}"]`).click();
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
    await expect(root.locator('[data-journey-stage="five_portals"]')).toBeVisible();
    await expect(page.locator('#arcade-difficulty-tier')).toBeEnabled();
    await expect(page.locator('#btn-arcade-daily')).toBeEnabled();
});

test('controlled Rift crossings exercise the three-sector result, persisted medal and next-stage launch', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openJourney(page);
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="first_route"]').click();
    await page.locator('[data-journey-start="first_run"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const config = await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig.arcade);
    expect(config.journeyStageId).toBe('first_run');
    expect(config.sectorCount).toBe(3);
    // Integration fixture: enter normal round outcomes at the established lifecycle seam.
    // This checks wiring/storage/UI; it is not a gameplay or flight-completion acceptance proof.
    await finishJourneyFixture(page, testInfo);
    await expect(page.locator('[data-journey-action="next"]')).toBeEnabled();
    const result = await readJourney(page);
    expect(result.status).toBe('found');
    expect(result.value.stages.first_run.medals.normal.medal).toBeGreaterThanOrEqual(1);
    expect(result.value.boards['first_run:normal:1:v2']).toHaveLength(1);
    for (const button of await page.locator('[data-journey-action]').all()) {
        const box = await button.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath('journey-result.png') });
    await page.locator('[data-journey-action="next"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeConfig.arcade.journeyStageId === 'notre_dame');
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

test('First Run keeps old scores and gold while new course results survive menu return and reload separately', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    const old = { schema: ARCADE_JOURNEY_SCHEMA, note: 'keep historic rules',
        stages: { first_run: { note: 'earned gold', medals: { normal: { medal: 3, runId: 'old-course' } } } },
        boards: { 'first_run:normal:1': [{ runId: 'old-course', value: 99999, medal: 3, playerCount: 1 }] } };
    expect(await page.evaluate(({ key, value }) => {
        const manager = window.GAME_INSTANCE.playerProfileManager;
        return manager.getRecordStorePort(manager.getActiveProfile().id).saveJsonRecord(key, value);
    }, { key: ARCADE_JOURNEY_STORAGE_KEY, value: old })).toMatchObject({ success: true });
    await openJourney(page);
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="first_route"]').click();
    const card = page.locator('[data-journey-stage="first_run"]');
    const history = card.locator('.arcade-journey-board-history');
    await expect(card.locator('.arcade-journey-board')).toHaveText('Noch kein Ergebnis');
    await expect(card).toContainText('Drei-Sektoren-Kurs');
    await history.locator('summary').click();
    await expect(history.locator('li')).toHaveText('99.999 Punkte');
    const hitbox = await history.locator('summary').boundingBox();
    expect(hitbox.height).toBeGreaterThanOrEqual(44);
    await page.locator('[data-journey-start="first_run"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    await finishJourneyFixture(page);
    const saved = (await readJourney(page)).value;
    expect(saved.boards['first_run:normal:1']).toEqual(old.boards['first_run:normal:1']);
    expect(saved.boards['first_run:normal:1:v2']).toHaveLength(1);
    expect(saved.boards['first_run:normal:1:v2'][0].value).toBeGreaterThan(0);
    expect(saved.boards['first_run:normal:1:v2'][0].value).toBeLessThan(99999);
    expect(saved.stages).toEqual(old.stages); expect(saved.note).toBe(old.note);
    await page.locator('[data-journey-action="map"]').click();
    await expect(card.locator('.arcade-journey-board li')).toHaveCount(1);
    await expect(card.locator('.arcade-journey-board')).not.toContainText('99.999');
    await page.reload();
    await openJourney(page);
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="first_route"]').click();
    expect((await readJourney(page)).value).toEqual(saved);
    await expect(card.locator('.arcade-journey-board li')).toHaveCount(1);
    await expect(card.locator('.arcade-journey-board')).not.toContainText('99.999');
    await history.locator('summary').click();
    await expect(history.locator('li')).toHaveText('99.999 Punkte');
    await history.locator('summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('journey-current-and-historic-scores.png') });
});

async function finishJourneyFixture(page, testInfo = null) {
    for (let sector = 1; sector <= 3; sector++) {
        const profile = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const strategy = game.entityManager.gameModeStrategy;
            return { map: game.runtimeConfig.session.mapKey, sector: game.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex,
                weaponless: game.runtimeConfig.arcade.weaponsDisabled, allowsWeapons: strategy.allowsWeaponActions(),
                machineGun: strategy.hasMachineGun(), weaponPickups: strategy.filterSpawnableTypes(['ROCKET_HEAVY', 'ROCKET_TURRET'], game.entityManager.entityRuntimeConfig.POWERUP.TYPES), route: game.entityManager.getParcoursRouteSnapshot().routeId };
        });
        expect(profile).toEqual({ map: 'parcours_rift', sector, weaponless: sector === 2, allowsWeapons: sector !== 2,
            machineGun: sector !== 2, weaponPickups: sector === 2 ? [] : ['ROCKET_HEAVY'], route: 'rift_gauntlet_v1' });
        if (sector === 2) {
            const pickups = await page.evaluate(() => {
                const manager = window.GAME_INSTANCE.entityManager.powerupManager;
                manager.clear();
                for (let index = 0; index < 8; index++) manager.update(10);
                return manager.items.map(item => item.type);
            });
            expect(pickups.length).toBeGreaterThan(0);
            expect(pickups.every(type => ['SHIELD', 'SPEED_UP'].includes(type))).toBe(true);
        }
        if (testInfo && sector === 2) await page.screenshot({ path: testInfo.outputPath('first-route-weaponless-sector.png') });
        // Controlled ordered ring crossings exercise the real route predicates and outcome callback.
        // This is integration evidence, not a manually flown route or a full-flight acceptance claim.
        const crossed = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const system = manager.runtimePorts.spawn.parcoursProgressSystem;
            const player = manager.humanPlayers[0];
            for (const human of manager.humanPlayers) { human.alive = true; human.hp = Math.max(60, human.hp); }
            const route = system.getRouteSnapshot();
            const ids = ['CP01', 'CP02', 'CP03', 'CP04', 'CP04A_TUNNEL', 'CP05', 'CP06', 'CP07', 'CP08'];
            let nowMs = Math.max(performance.now(), system.getPlayerProgressSnapshot(0).lastCheckpointAtMs || 0) + 1000;
            for (const entry of [...ids.map(id => route.checkpoints.find(cp => cp.id === id)), route.finish]) {
                if (!entry) throw new Error('Rift fixture checkpoint missing');
                const length = Math.hypot(...entry.forward) || 1;
                const unit = entry.forward.map(value => value / length);
                const previous = { x: entry.pos[0] - unit[0] * entry.radius * 0.5,
                    y: entry.pos[1] - unit[1] * entry.radius * 0.5, z: entry.pos[2] - unit[2] * entry.radius * 0.5 };
                player.position.set(entry.pos[0] + unit[0] * entry.radius * 0.5,
                    entry.pos[1] + unit[1] * entry.radius * 0.5, entry.pos[2] + unit[2] * entry.radius * 0.5);
                nowMs += 1000;
                system.updatePlayerProgress(player, previous, nowMs);
            }
            const progress = system.getPlayerProgressSnapshot(0);
            const outcome = system.getRoundOutcome();
            if (!outcome?.shouldEnd) throw new Error('Ordered Rift crossings did not finish the route: ' + JSON.stringify(progress));
            game.matchFlowUiController.onRoundEnd(player, outcome);
            return { completed: progress.completed, reason: outcome.reason };
        });
        expect(crossed).toEqual({ completed: true, reason: 'PARCOURS_COMPLETE' });
        if (sector < 3) {
            await page.locator('#btn-arcade-intermission-continue').click();
            await page.waitForFunction(next => window.GAME_INSTANCE.state === 'PLAYING'
                && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === next, sector + 1);
        }
    }
    await expect(page.locator('[data-journey-action="map"]')).toBeVisible();
    await expect(page.locator('#btn-arcade-victory-continue')).toBeHidden();
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
        expect(records[index + 1].value.boards[`first_run:normal:${count}:v2`]).toHaveLength(1);
        expect(records[index + 1].value.boards['first_run:normal:1:v2']).toBeUndefined();
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

async function startWormJourney(page) {
    await waitForLoadedGame(page);
    // Test-profile fixture, never the real user profile: unlock without seeding earned medals.
    await page.evaluate(({ key, schema }) => {
        const game = window.GAME_INSTANCE;
        const manager = game.playerProfileManager;
        manager.getRecordStorePort(manager.getActiveProfile().id).saveJsonRecord(key, { schema, stages: {}, allStagesUnlocked: true });
        game.settings.arcade.difficultyTierId = 'normal';
    }, { key: ARCADE_JOURNEY_STORAGE_KEY, schema: ARCADE_JOURNEY_SCHEMA });
    await openJourney(page);
    await page.locator('[data-journey-world="exclusion_zone"]').click();
    await page.locator('[data-journey-node="worm_hunt"]').click();
    await page.locator('[data-journey-start="worm_hunt"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
}

function wormState(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const run = game.runtimeFacade.arcadeRunRuntime.getStateSnapshot();
        return { state: game.state, stageId: game.runtimeConfig.arcade.journeyStageId,
            sectorCount: run?.config?.sectorCount, scenarioId: run?.encounterSequence?.[0]?.scenarioId,
            objective: run?.objectiveState?.status, gameplayTimeMs: run?.gameplayTimeMs,
            creatures: (game.entityManager?.runtimePorts?.combat?.mapUnitSystem?.getTargets() || [])
                .filter(unit => unit.kind === 'creature' && unit.alive).length };
    });
}

test('Wurmjagd: destroying all 100 creatures settles the mission and retry creates a fresh pack', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startWormJourney(page);
    await expect.poll(() => wormState(page)).toMatchObject({ state: 'PLAYING', stageId: 'worm_hunt', sectorCount: 1,
        scenarioId: 'worm_hunt', objective: 'active', creatures: 100 });
    // Controlled clock/damage fixture: exercise the real unit/objective/result chain, not a flight proof.
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const human = game.entityManager.humanPlayers[0];
        human.spawnProtectionTimer = 5;
        for (const bot of game.entityManager.players.filter(player => player.isBot)) { bot.alive = false; bot.hp = 0; }
        game.runtimeFacade.arcadeRunRuntime.tickGameplay(61);
    });
    await expect.poll(() => wormState(page)).toMatchObject({ state: 'PLAYING', objective: 'active', creatures: 100 });
    expect((await readJourney(page)).value.stages.worm_hunt).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('worm-journey-active.png') });
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const worms = manager.runtimePorts.combat.mapUnitSystem.getTargets().filter(unit => unit.kind === 'creature' && unit.alive);
        for (const worm of worms) worm.takeDamage(worm.hp + 1, { sourcePlayer: manager.humanPlayers[0] });
    });
    await expect(page.locator('[data-journey-action="retry"]')).toBeVisible();
    const saved = (await readJourney(page)).value;
    expect(saved.stages.worm_hunt.medals.normal.medal).toBe(2);
    expect(saved.boards['worm_hunt:normal:1'][0].value).toBeGreaterThanOrEqual(61000);
    expect(saved.boards['worm_hunt:normal:1'][0].value).toBeLessThan(90000);
    await expect(page.locator('.arcade-journey-result-time')).toHaveText(`Zeit: ${(saved.boards['worm_hunt:normal:1'][0].value / 1000).toFixed(2)} s`);
    await page.screenshot({ path: testInfo.outputPath('worm-journey-result.png') });
    await page.locator('[data-journey-action="retry"]').click();
    await expect.poll(() => wormState(page)).toMatchObject({ state: 'PLAYING', objective: 'active', creatures: 100 });
    expect((await wormState(page)).gameplayTimeMs).toBeLessThan(10000);
    expect((await readJourney(page)).value.boards['worm_hunt:normal:1']).toHaveLength(1);
});

test('Wurmjagd: the authored deadline loses the mission without awarding a medal', async ({ page }, testInfo) => {
    await startWormJourney(page);
    await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.tickGameplay(121));
    await expect(page.locator('[data-journey-action="retry"]')).toBeVisible();
    await expect(page.locator('.arcade-journey-result-medal')).toHaveText('Ziel noch nicht erreicht');
    expect((await readJourney(page)).value.stages.worm_hunt).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('worm-journey-deadline.png') });
});

test('Wurmjagd: returning before destroying the worm preserves profile progress', async ({ page }) => {
    await startWormJourney(page);
    const before = await readJourney(page);
    await returnToMenu(page);
    expect(await readJourney(page)).toEqual(before);
});
