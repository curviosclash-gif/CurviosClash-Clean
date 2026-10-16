import { expect, test } from './helpers.desktop.js';
import { returnToMenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

test('Nemesis developer start creates one named racing rival and a visible run HUD', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    const started = await page.evaluate(() => window.GAME_DEBUG.startHuntParcours());
    expect(started).toBe(true);
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    await waitForRenderFrames(page, 3);
    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const run = game.runtimeCoordinator.getRuntimeFacade().getArcadeRunState();
        return { run, mapKey: game.runtimeConfig.session.mapKey, combatMode: game.entityManager.combatModeType,
            humans: game.entityManager.humanPlayers.length,
            bots: game.entityManager.bots.map(({ player }) => ({ name: player.botDisplayName,
                racer: player.isHuntParcoursCompetitor, maxHp: player.maxHp })) };
    });
    expect(state.mapKey).toBe('mirror_docks');
    expect(state.humans).toBe(1);expect(state.bots).toHaveLength(1);
    expect(state.bots[0].racer).toBe(true);
    expect(state.bots[0].name).toBe(state.run.rival.name);
    expect(state.run.phase).toBe('hunting');
    expect(state.combatMode).toBe('HUNT');
    await expect(page.locator('#arcade-score-hud')).toContainText('Nemesis');
    await testInfo.attach('nemesis-start.json', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
    await testInfo.attach('nemesis-start.png', { body: await page.screenshot(), contentType: 'image/png' });
    await returnToMenu(page);
});

import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

async function finishByCombat(page, side) {
    return page.evaluate((side) => {
        const game = window.GAME_INSTANCE, manager = game.entityManager;
        const facade = game.runtimeCoordinator.getRuntimeFacade();
        const human = manager.humanPlayers[0], rival = manager.players.find(player => player.isBot);
        const killer = side === 'human' ? human : rival, victim = side === 'human' ? rival : human;
        const impacts = [];
        for (let index = 0; index < 3; index++) {
            if (!victim.alive) manager.runtime.systems.respawnSystem.update(60);
            if (!victim.alive) throw new Error('The real respawn path must restore the duelist');
            victim.spawnProtectionTimer = 0;
            const damage = manager.getRuntimeContext().combat.applyPlayerHit({
                target: victim, amount: victim.hp + victim.shieldHP + 10, cause: 'PROJECTILE',
                sourcePlayer: killer, weaponKind: 'MACHINE_GUN', projectileType: 'MACHINE_GUN', killOnDeath: true,
            });
            impacts.push({ applied: damage.applied, blocked: damage.blocked, dead: !victim.alive,
                kills: side === 'human' ? facade.getArcadeRunState().humanKills : facade.getArcadeRunState().rivalKills });
        }
        return { impacts, state: facade.getArcadeRunState() };
    }, side);
}

for (const winners of [['human', 'rival', 'human'], ['rival', 'rival']]) {
    test(`Nemesis real combat, respawns and session rebuilds settle ${winners.join('-')}`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        await waitForLoadedGame(page);
        expect(await page.evaluate(() => window.GAME_DEBUG.startHuntParcours())).toBe(true);
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
        const initialRival = await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState().rival);
        const retired = winners.at(-1) === 'human' && initialRival.stage === 5;
        const expectedStage = retired ? 0 : initialRival.stage + (winners.at(-1) === 'human' ? 1 : 0);
        const session = { page };await installControl(session);await setPaused(session, true);
        const results = [];
        const maps = ['mirror_docks', 'glass_serpent', 'wind_cathedral'];
        for (let index = 0; index < winners.length; index++) {
            expect(await page.evaluate(() => window.GAME_INSTANCE.runtimeConfig.session.mapKey)).toBe(maps[index]);
            const grid = await page.evaluate(() => {
                const game = window.GAME_INSTANCE, manager = game.entityManager;
                const start = manager.getParcoursRouteSnapshot().checkpoints[0];
                return manager.players.map(player => ({
                    distanceToFirst: player.position.distanceTo(player.position.clone().set(...start.pos)),
                    collision: game.arena.checkCollision(player.position, player.hitboxRadius),
                }));
            });
            expect(grid.every(entry => !entry.collision && entry.distanceToFirst < 25)).toBe(true);
            const board = await page.evaluate(() => window.GAME_INSTANCE.entityManager.players.map(player => player.score));
            expect(board).toEqual([winners.slice(0,index).filter(side => side === 'human').length, winners.slice(0,index).filter(side => side === 'rival').length]);
            const result = await finishByCombat(page, winners[index]);results.push(result);
            expect(result.impacts.every(hit => hit.dead && hit.blocked === null && hit.applied > 0)).toBe(true);
            expect(result.impacts.map(hit => hit.kills)).toEqual([1, 2, 3]);
            await step(session, 100);
            const last = index === winners.length - 1;
            await page.waitForFunction(expected => window.GAME_INSTANCE.state === expected, last ? 'MATCH_END' : 'ROUND_END');
            if (!last) {
                await step(session, 3500);
                await page.waitForFunction(expected => window.GAME_INSTANCE.state === 'PLAYING'
                    && window.GAME_INSTANCE.runtimeConfig.session.mapKey === expected, maps[index + 1]);
                await installControl(session);
            }
        }
        await waitForRenderFrames(page, 3);
        await expect(page.locator('#arcade-overlay-panel')).toBeVisible();
        await expect(page.locator('#arcade-overlay-panel')).toContainText(winners.at(-1) === 'human' ? 'Nemesis besiegt' : 'Nemesis gewinnt');
        const settled = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const profileId = game.runtimeConfig.arcade.playerProfileIds[0];
            return { state: game.runtimeCoordinator.getRuntimeFacade().getArcadeRunState(),
                record: game.playerProfileManager.getRecordStorePort(profileId).readJsonRecordResult('cuviosclash.arcade-hunt-parcours-rival.v1') };
        });
        expect(settled.state.mapResults).toHaveLength(winners.length);
        expect(settled.state.postRunSummary.saveFailures).toEqual([]);
        expect(settled.record.status).toBe('found');
        expect(settled.record.value.stage).toBe(expectedStage);
        expect(settled.record.value.rivalWins).toBe(retired ? 0 : initialRival.rivalWins + (winners.at(-1) === 'rival' ? 1 : 0));
        const facedTier = initialRival.stage >= 4 ? '4-5' : initialRival.stage >= 2 ? '2-3' : '0-1';
        expect(settled.state.postRunSummary.ranking?.key).toContain(`hunt_parcours:hunt-score.v1:nemesis:${facedTier}:`);
        await testInfo.attach('nemesis-combat.json', { body: JSON.stringify({ results, settled }, null, 2), contentType: 'application/json' });
        await testInfo.attach('nemesis-result.png', { body: await page.screenshot(), contentType: 'image/png' });
        await setPaused(session, false);
        await page.locator('#arcade-overlay-panel').getByRole('button', { name: 'Zum Menü', exact: true }).click();
        await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
        expect(await page.evaluate(() => window.GAME_DEBUG.startHuntParcours())).toBe(true);
        await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
        expect(await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState().rival.stage))
            .toBe(expectedStage);
        await returnToMenu(page);
    });
}

test('Nemesis rival makes real route progress while flying and fighting under normal collision', async ({ page }, testInfo) => {
    test.setTimeout(100_000);
    await waitForLoadedGame(page);
    expect(await page.evaluate(() => window.GAME_DEBUG.startHuntParcours())).toBe(true);
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    const session = { page };await installControl(session);await setPaused(session, true);
    const initial = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, bot = manager.players.find(player => player.isBot);
        return { index: bot.index, position: bot.position.toArray(), progress: manager.getParcoursHudState(bot.index) };
    });
    await step(session, 12_000);
    const actual = await page.evaluate(index => {
        const game = window.GAME_INSTANCE, manager = game.entityManager;
        const bot = manager.players.find(player => player.index === index);
        return { state: game.state, position: bot.position.toArray(), progress: manager.getParcoursHudState(index),
            run: game.runtimeCoordinator.getRuntimeFacade().getArcadeRunState(), decision: manager.bots[0].ai.getDecisionSnapshot() };
    }, initial.index);
    await testInfo.attach('nemesis-live-bot-flight.json', { body: JSON.stringify({ initial, actual }, null, 2), contentType: 'application/json' });
    expect(actual.position).not.toEqual(initial.position);
    expect(actual.progress.currentCheckpoint).toBeGreaterThanOrEqual(1);
    expect(actual.decision.mode).toBe('RACE_HUNT');
    await setPaused(session, false);await returnToMenu(page);
});

for (const side of ['human', 'rival']) {
    test(`Nemesis real ring-trigger completion awards the ${side} finish`, async ({ page }, testInfo) => {
        test.setTimeout(100_000);
        await waitForLoadedGame(page);
        expect(await page.evaluate(() => window.GAME_DEBUG.startHuntParcours())).toBe(true);
        await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
        const session = { page };await installControl(session);await setPaused(session, true);
        // Controlled geometric crossings exercise the real trigger/XP/finish callbacks. This is an
        // integration check, not a collision-free full-course flight or a manual steering acceptance.
        const crossed = await page.evaluate(side => {
            const game = window.GAME_INSTANCE, manager = game.entityManager, system = manager.runtime.systems.parcoursProgressSystem;
            const player = side === 'human' ? manager.humanPlayers[0] : manager.players.find(player => player.isBot);
            const route = manager.getParcoursRouteSnapshot();
            const events = [];
            let now = window.GAME_DEBUG.getSimulationClockMs() + 1000;
            for (let index = 0; index <= route.totalCheckpoints; index++) {
                const progress = system.getPlayerProgressSnapshot(player.index);
                if (progress.completed) break;
                const entry = route.checkpoints.find(entry => progress.expectedCheckpointIds?.includes(entry.id)) || route.finish;
                const forward = player.position.clone().set(...entry.forward).normalize();
                const before = player.position.clone().set(...entry.pos).addScaledVector(forward, -entry.radius - 4);
                player.position.set(...entry.pos).addScaledVector(forward, 0.5);
                events.push(system.updatePlayerProgress(player, before, now));now += 1000;
            }
            return { events, progress: system.getPlayerProgressSnapshot(player.index) };
        }, side);
        expect(crossed.progress.completed).toBe(true);
        expect(crossed.events.at(-1).type).toBe('finish');
        await step(session, 100);
        const state = await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState());
        expect(state.mapResults[0].reason).toBe('finish');
        expect(state.mapResults[0].winnerSide).toBe(side);
        await testInfo.attach('nemesis-finish-trigger.json', { body: JSON.stringify({ crossed, state }, null, 2), contentType: 'application/json' });
        await setPaused(session, false);await returnToMenu(page);
    });
}
