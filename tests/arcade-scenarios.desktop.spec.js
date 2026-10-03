import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu } from './helpers.js';

// Seeds whose five-sector plan carries the scenarios under test (see ArcadeScenarioCatalog).
const WORM_AND_HYDRA_SEED = 8;
const STORM_FLOOD_SEED = 7;
const BOMBER_ALARM_SEED = 5;

async function startArcadeRun(page, seed) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'standard');
    // The menu writes its own stored seed into the run on start, so the seed goes in the way a
    // player enters it: the seed field and its apply button.
    await page.evaluate((runSeed) => {
        const game = window.GAME_INSTANCE;
        game.settings.arcade.sectorCount = 5;
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['arcade.sectorCount'] });
        document.querySelector('#input-arcade-seed').value = String(runSeed);
        document.querySelector('#btn-arcade-seed-apply').click();
    }, seed);
    await page.click('#btn-start');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    expect(await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig.arcade.seed)).toBe(seed);
}

async function completeSector(page) {
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const human = game.entityManager.humanPlayers[0];
        human.alive = true; human.hp = Math.max(60, human.hp);
        game.matchFlowUiController.onRoundEnd(human, { reason: 'ARCADE_OBJECTIVE' });
    });
}

async function advanceToSector(page, sector) {
    await completeSector(page);
    await page.click('#btn-arcade-intermission-continue');
    await page.waitForFunction((next) => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === next, sector);
}

function readSector(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const entityManager = game.entityManager;
        const objective = game.runtimeFacade.arcadeRunRuntime.getStateSnapshot().objectiveState || null;
        return {
            state: game.state,
            mapKey: game.runtimeConfig.session.mapKey,
            scenarioId: game.runtimeConfig.arcade.scenarioId || '',
            combatProfile: game.runtimeConfig.arcade.combatProfile || '',
            modeType: entityManager.gameModeStrategy.modeType,
            pickupMode: entityManager.gameModeStrategy.getPickupModeType(),
            creatures: (entityManager._mapUnitSystem?.units || []).filter((unit) => unit.kind === 'creature' && unit.alive).length,
            waterPhase: entityManager._waterZoneSystem?.getZone?.() ? entityManager._waterZoneSystem.getState().phase : 'none',
            objectiveId: objective?.objectiveId || '',
            objectiveStatus: objective?.status || '',
            objectiveDuration: objective?.durationSec || 0,
            objectiveTimeLimited: objective?.timeLimited !== false,
            missionHud: document.querySelector('.arcade-mission-card')?.textContent || '',
        };
    });
}

// The idle test pilot flies unsteered: bots shoot it and walls end it (one run died after 18.5 s,
// before the dam broke). These checks are about the sector, not survival, so the pilot keeps the
// game's own spawn protection and full health while they run.
function keepPilotAlive(page, active) {
    return page.evaluate((on) => {
        clearInterval(window.__scenarioKeepAlive);
        if (!on) return;
        window.__scenarioKeepAlive = setInterval(() => {
            const human = window.GAME_INSTANCE.entityManager.humanPlayers[0];
            if (!human?.alive) return;
            human.hp = human.maxHp || 100;
            human.spawnProtectionTimer = 1;
        }, 100);
    }, active);
}

function killBots(page) {
    return page.evaluate(() => {
        for (const bot of window.GAME_INSTANCE.entityManager.bots) {
            if (bot?.player) { bot.player.alive = false; bot.player.hp = 0; }
        }
    });
}

function destroyCreatures(page) {
    return page.evaluate(() => {
        const entityManager = window.GAME_INSTANCE.entityManager;
        const human = entityManager.humanPlayers[0];
        for (const unit of entityManager._mapUnitSystem.units) {
            if (unit.kind === 'creature' && unit.alive) unit.takeDamage(unit.hp + 1, { sourcePlayer: human });
        }
    });
}

test('Arcade scenarios: worm hunt wakes the worm, outlives the bots and hands back arcade weapons; the finale is the hydra', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await startArcadeRun(page, WORM_AND_HYDRA_SEED);
    expect((await readSector(page)).pickupMode).toBe('ARCADE');

    await advanceToSector(page, 2);
    await completeSector(page);
    await expect(page.locator('[data-stats-block-id="arcade-next-sector"]')).toContainText('Einsatz: Wurmjagd');
    await expect(page.locator('[data-arcade-choice-id]')).toHaveCount(1);
    await page.click('#btn-arcade-intermission-continue');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === 3);
    await keepPilotAlive(page, true);

    await expect.poll(() => readSector(page), { timeout: 15_000 }).toMatchObject({
        mapKey: 'standard',
        combatProfile: 'hunt',
        modeType: 'ARCADE',
        pickupMode: 'HUNT',
        creatures: 1,
        objectiveId: 'destroy_units',
        objectiveStatus: 'active',
    });
    await expect(page.locator('.arcade-mission-card').first()).toContainText('Hauptziel: Wurmjagd');
    await page.screenshot({ path: testInfo.outputPath('worm-hunt-sector.png') });

    await killBots(page);
    const botsDownAt = await page.evaluate(() => window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().gameplayTimeMs);
    await page.waitForFunction((start) => (
        window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().gameplayTimeMs - start >= 1500
    ), botsDownAt);
    expect((await readSector(page)).state, 'the living worm keeps the sector open').toBe('PLAYING');

    await destroyCreatures(page);
    await keepPilotAlive(page, false);
    await expect.poll(() => readSector(page), { timeout: 10_000 }).toMatchObject({
        state: 'ROUND_END',
        objectiveStatus: 'completed',
    });

    await page.click('#btn-arcade-intermission-continue');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === 4);
    await expect.poll(() => readSector(page), { timeout: 15_000 }).toMatchObject({
        combatProfile: '',
        pickupMode: 'ARCADE',
    });

    await advanceToSector(page, 5);
    await expect.poll(() => readSector(page), { timeout: 15_000 }).toMatchObject({
        mapKey: 'hydra_temple',
        modeType: 'ARCADE',
        pickupMode: 'HUNT',
        creatures: 1,
        objectiveId: 'destroy_units',
        objectiveTimeLimited: false,
    });
    await page.screenshot({ path: testInfo.outputPath('hydra-finale.png') });
});

test('Arcade scenarios: Bomberalarm replaces the standard map unit', async ({ page }) => {
    test.setTimeout(180_000);
    await startArcadeRun(page, BOMBER_ALARM_SEED);
    await advanceToSector(page, 2);
    await advanceToSector(page, 3);
    await keepPilotAlive(page, true);
    await expect.poll(() => readSector(page), { timeout: 15_000 }).toMatchObject({
        mapKey: 'standard',
        scenarioId: 'bomber_alarm',
        combatProfile: 'hunt',
        pickupMode: 'HUNT',
        creatures: 0,
        objectiveId: 'destroy_units',
        objectiveStatus: 'active',
        objectiveDuration: 120,
    });
    await keepPilotAlive(page, false);
});

test('Arcade scenarios: storm flood stays an arcade sector on the dam map', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startArcadeRun(page, STORM_FLOOD_SEED);
    await advanceToSector(page, 2);
    await advanceToSector(page, 3);
    await keepPilotAlive(page, true);
    await expect.poll(() => readSector(page), { timeout: 15_000 }).toMatchObject({
        mapKey: 'storm_dam_siege',
        combatProfile: '',
        modeType: 'ARCADE',
        pickupMode: 'ARCADE',
        waterPhase: 'dry',
        objectiveId: 'survive_window',
        objectiveDuration: 90,
    });
    await expect(page.locator('.arcade-mission-card').first()).toContainText('Hauptziel: Sturmflut');
    await expect.poll(async () => (await readSector(page)).waterPhase, { timeout: 40_000 }).not.toBe('dry');
    await page.screenshot({ path: testInfo.outputPath('storm-flood-sector.png') });
    await keepPilotAlive(page, false);
});
