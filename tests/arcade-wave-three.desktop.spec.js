import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, openCustomSubmenu } from './helpers.js';
import { BLOOM_CORE_FINAL_OPEN_SECONDS } from '../src/core/config/maps/presets/bloom_core.js';

const SEEDS = { bridge_convoy: 16, vault_breaker: 9, bloom_escape: 5 };

async function startScenario(page, id) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'standard');
    await page.evaluate((seed) => {
        const game = window.GAME_INSTANCE;
        game.settings.arcade.sectorCount = 5;
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['arcade.sectorCount'] });
        document.querySelector('#input-arcade-seed').value = String(seed);
        document.querySelector('#btn-arcade-seed-apply').click();
    }, SEEDS[id]);
    await page.click('#btn-start');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    await page.evaluate(() => {
        window.__waveThreePilotProtection = setInterval(() => {
            const pilot = window.GAME_INSTANCE?.entityManager?.humanPlayers?.[0];
            if (!pilot?.alive) return;
            pilot.hp = pilot.maxHp || 100;
            pilot.spawnProtectionTimer = 1;
        }, 100);
    });
    for (const sector of [2, 3]) {
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const pilot = game.entityManager.humanPlayers[0];
            pilot.alive = true; pilot.hp = pilot.maxHp || 100;
            game.matchFlowUiController.onRoundEnd(pilot, { reason: 'ARCADE_OBJECTIVE' });
        });
        await page.click('#btn-arcade-intermission-continue');
        await page.waitForFunction((next) => window.GAME_INSTANCE?.state === 'PLAYING'
            && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === next, sector);
    }
    expect((await readScenario(page)).scenarioId).toBe(id);
    if (id !== 'bloom_escape') {
        await expect.poll(() => page.evaluate(() => {
            const arena = window.GAME_INSTANCE.entityManager.arena;
            return !arena._glbLoadError && arena._glbScene?.children?.length === arena.currentMapDefinition.glbModels.length;
        }), { timeout: 120_000 }).toBe(true);
        await expect(page.locator('#hunt-objective')).toContainText(id === 'bridge_convoy' ? 'Konvoi' : 'Tresorknacker');
        const posedAt = await page.evaluate((mission) => {
            const game = window.GAME_INSTANCE;
            const pilot = game.entityManager.humanPlayers[0];
            pilot.position.set(mission === 'bridge_convoy' ? -55 : -85, mission === 'bridge_convoy' ? 38 : 65, -55);
            const forward = pilot.position.clone().set(0, 0, -1);
            const target = pilot.position.clone().set(0, mission === 'bridge_convoy' ? 22 : 65, 0).sub(pilot.position).normalize();
            pilot.quaternion.setFromUnitVectors(forward, target);
            pilot.trail.clear();
            return game.runtimeFacade.arcadeRunRuntime.getStateSnapshot().gameplayTimeMs;
        }, id);
        await page.waitForFunction((start) => window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().gameplayTimeMs - start >= 250, posedAt);
    }
}

function readScenario(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const run = game.runtimeFacade.arcadeRunRuntime.getStateSnapshot();
        const objective = run.objectiveState;
        const expansion = manager.arena?._builder?.expansionController;
        return {
            state: game.state, phase: run.phase, sectorIndex: run.sectorIndex,
            completedSectors: run.completedSectors, scenarioId: game.runtimeConfig.arcade.scenarioId || '',
            mapKey: game.runtimeConfig.session.mapKey,
            mode: manager.gameModeStrategy.modeType, pickupMode: manager.gameModeStrategy.getPickupModeType(),
            botCount: manager.bots.length,
            objectiveId: objective?.objectiveId, objectiveStatus: objective?.status,
            objectiveDuration: objective?.durationSec, breached: objective?.breachComplete === true,
            stoppedTanks: objective?.unitsDestroyed || 0,
            livingTanks: manager._mapUnitSystem.units.filter((unit) => unit.kind === 'tank' && unit.alive).length,
            vaultOpen: manager._secretRoomSystem?.isRoomOpen('vault') === true,
            expansionStage: expansion?.state?.stageIndex ?? -1,
            expansionPhase: expansion?.state?.phase || '',
            arenaHalfWidth: manager.arena.bounds.maxX,
        };
    });
}

test.afterEach(async ({ page }) => {
    await page.evaluate(() => clearInterval(window.__waveThreePilotProtection)).catch(() => {});
});

test('Arcade wave three: destroy the bridge convoy and return to ordinary Arcade', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startScenario(page, 'bridge_convoy');
    await expect.poll(() => readScenario(page)).toMatchObject({
        mapKey: 'storm_bridge_siege', mode: 'ARCADE', pickupMode: 'HUNT', botCount: 0,
        livingTanks: 3, stoppedTanks: 0, objectiveId: 'intercept', objectiveStatus: 'active',
    });
    await expect(page.locator('.arcade-mission-card').first()).toContainText('Panzer gestoppt 0/3');
    await page.screenshot({ path: testInfo.outputPath('bridge-convoy-active.png') });
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        for (const unit of manager._mapUnitSystem.units) {
            if (unit.alive) unit.takeDamage(unit.hp + 1, { sourcePlayer: manager.humanPlayers[0] });
        }
    });
    await expect.poll(() => readScenario(page)).toMatchObject({
        state: 'ROUND_END', objectiveStatus: 'completed', stoppedTanks: 3, livingTanks: 0,
    });
    await page.screenshot({ path: testInfo.outputPath('bridge-convoy-success.png') });
    await page.click('#btn-arcade-intermission-continue');
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.runtimeFacade.arcadeRunRuntime.getStateSnapshot().sectorIndex === 4);
    await expect.poll(() => readScenario(page)).toMatchObject({ scenarioId: '', pickupMode: 'ARCADE' });
});

test('Arcade wave three: first convoy arrival terminates the run despite a living pilot', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startScenario(page, 'bridge_convoy');
    // Advance the actual map-unit movement, with its authored routes and speeds. The fastest
    // tank arrives first; the objective uses the resulting runtime event to fail the run.
    await page.evaluate(() => window.GAME_INSTANCE.entityManager._mapUnitSystem.update(40));
    await expect.poll(() => readScenario(page)).toMatchObject({
        state: 'MATCH_END', phase: 'finished', objectiveStatus: 'failed', completedSectors: 2,
    });
    expect(await page.evaluate(() => window.GAME_INSTANCE.entityManager.humanPlayers[0].alive)).toBe(true);
    await expect(page.locator('#message-text')).toContainText('Konvoi durchgebrochen');
    await expect(page.locator('#btn-arcade-intermission-continue')).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('bridge-convoy-failure.png') });
});

test('Arcade wave three: the vault requires a leg, opens its portal, then accepts the boss kill', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await startScenario(page, 'vault_breaker');
    await expect.poll(() => readScenario(page)).toMatchObject({
        mapKey: 'eiffel_tower_siege', mode: 'ARCADE', pickupMode: 'HUNT', botCount: 0,
        objectiveId: 'breach_vault', objectiveStatus: 'active', breached: false, vaultOpen: false,
    });
    await expect(page.locator('.arcade-mission-card').first()).toContainText('Zuerst ein Turmbein zerstören');
    const premature = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const system = manager._mapDestructibleSystem;
        const upper = system.definition.segments.find((entry) => entry.kind !== 'leg_lower');
        system.applySegmentHit(upper.id, 100000, { sourcePlayer: manager.humanPlayers[0] });
        const boss = manager._mapUnitSystem.units.find((unit) => unit.kind === 'boss');
        boss.takeDamage(boss.hp + 1, { sourcePlayer: manager.humanPlayers[0] });
        return { sealed: system.getState().sealed, events: system.getState().events.length, bossAlive: boss.alive, bossHp: boss.hp, bossMaxHp: boss.maxHp };
    });
    expect(premature).toMatchObject({ sealed: false, events: 0, bossAlive: true });
    expect(premature.bossHp).toBe(premature.bossMaxHp);
    await page.screenshot({ path: testInfo.outputPath('vault-before-breach.png') });
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const system = manager._mapDestructibleSystem;
        const leg = system.definition.segments.find((entry) => entry.kind === 'leg_lower');
        system.applySegmentHit(leg.id, 100000, { sourcePlayer: manager.humanPlayers[0] });
    });
    await expect.poll(() => readScenario(page)).toMatchObject({ breached: true, objectiveStatus: 'active' });
    await expect.poll(() => readScenario(page), { timeout: 15_000 }).toMatchObject({ vaultOpen: true, state: 'PLAYING' });
    const travel = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.entityManager.arena;
        const portal = arena.portals.find((entry) => entry.roomId === 'vault');
        const result = arena.checkPortal(portal.posA.clone(), 0.8, 9001);
        return { ok: result?.ok === true, target: result?.target?.toArray(), roomTarget: portal.posB.toArray() };
    });
    expect(travel.ok).toBe(true);
    expect(travel.target).toEqual(travel.roomTarget);
    await page.screenshot({ path: testInfo.outputPath('vault-portal-open.png') });
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const boss = manager._mapUnitSystem.units.find((unit) => unit.kind === 'boss');
        boss.takeDamage(boss.hp + 1, { sourcePlayer: manager.humanPlayers[0] });
    });
    await expect.poll(() => readScenario(page)).toMatchObject({ state: 'ROUND_END', objectiveStatus: 'completed' });
    await page.screenshot({ path: testInfo.outputPath('vault-boss-defeated.png') });
});

test('Arcade wave three: bloom survives all real timed expansions and ends at the final opening', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await startScenario(page, 'bloom_escape');
    await expect.poll(() => readScenario(page)).toMatchObject({
        mapKey: 'bloom_core', mode: 'ARCADE', pickupMode: 'ARCADE', botCount: 4,
        objectiveId: 'survive_window', objectiveStatus: 'active',
        objectiveDuration: BLOOM_CORE_FINAL_OPEN_SECONDS, expansionStage: 0,
    });
    const initialWidth = (await readScenario(page)).arenaHalfWidth;
    await page.screenshot({ path: testInfo.outputPath('bloom-core-start.png') });
    // Empty the enemy roster to prove that survival, rather than elimination, holds this sector.
    await page.evaluate(() => {
        for (const bot of window.GAME_INSTANCE.entityManager.bots) {
            bot.player.alive = false; bot.player.hp = 0;
        }
    });
    await expect.poll(() => readScenario(page), { timeout: 50_000 }).toMatchObject({ expansionStage: 1, state: 'PLAYING', objectiveStatus: 'active' });
    expect((await readScenario(page)).arenaHalfWidth).toBeGreaterThan(initialWidth);
    await page.screenshot({ path: testInfo.outputPath('bloom-first-ring.png') });
    await expect.poll(() => readScenario(page), { timeout: 50_000 }).toMatchObject({ expansionStage: 2, state: 'PLAYING', objectiveStatus: 'active' });
    await page.screenshot({ path: testInfo.outputPath('bloom-second-ring.png') });
    await expect.poll(() => readScenario(page), { timeout: 50_000 }).toMatchObject({
        state: 'ROUND_END', objectiveStatus: 'completed', expansionStage: 3, expansionPhase: 'COMPLETE',
    });
    expect((await readScenario(page)).arenaHalfWidth / initialWidth).toBeCloseTo(200 / 68);
    await page.screenshot({ path: testInfo.outputPath('bloom-final-open.png') });
});
