import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

async function start(page, humans) {
    await waitForLoadedGame(page);
    const started = await page.evaluate(async count => {
        const game = window.GAME_INSTANCE, manager = game.playerProfileManager;
        const ids = [manager.getActiveProfile().id];
        for (let i = 1; i < count; i++) {
            const result = manager.createProfile(`Fox pilot ${i + 1}`);
            if (!result.ok) throw new Error('Profile fixture creation failed');
            ids.push(result.profile.id);
        }
        if (count === 3) game.settings.localSettings.threePlayerSplit = {
            ...game.settings.localSettings.threePlayerSplit, deviceAssignment: ['keyboard', 'keyboard', 'keyboard'] };
        return window.GAME_DEBUG.startHuntParcours('fox_hunt', { humanCount: count, profileIds: ids });
    }, humans);
    expect(started).toBe(true);
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    const session = { page }; await installControl(session); await setPaused(session, true); await step(session, 1000 / 60);
    return session;
}

for (const humans of [1, 2, 3]) {
    test(`Fuchsjagd controlled rules with ${humans} humans and four bots: death roles, respawn and all three timeout maps`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        const errors = collectErrors(page), session = await start(page, humans);
        await waitForRenderFrames(page, 3);
        await expect(page.locator('#arcade-score-hud')).toContainText('Fuchsjagd');
        await expect(page.locator('#hunt-objective')).toContainText('Fuchs');
        const initial = await page.evaluate(() => {
            const g = window.GAME_INSTANCE, m = g.entityManager, r = g.runtimeCoordinator.getRuntimeFacade()._arcadeSupport?.huntParcoursSupport?.runtime
                || g.runtimeCoordinator.getRuntimeHandle?.('arcadeSupport')?.huntParcoursSupport?.runtime;
            return { humans: m.humanPlayers.length, bots: m.bots.length,
                state: g.runtimeCoordinator.getRuntimeFacade().getArcadeRunState(), runtimeFound: Boolean(r) };
        });
        expect(initial.humans).toBe(humans); expect(initial.bots).toBe(4);
        // Controlled damage and deadline fixtures exercise normal death/respawn/outcome paths.
        // They do not stand in for the separate full-course MCP playability runs.
        const transfers = await page.evaluate(count => {
            const g = window.GAME_INSTANCE, m = g.entityManager;
            const r = g.runtimeCoordinator.getRuntimeFacade()._arcadeSupport.huntParcoursSupport.runtime;
            const bot = count, otherBot = count + 1;
            for (const p of m.players) { p.spawnProtectionTimer = 0; p.trail.clear(); }
            const hit = (killer, victim) => m.getRuntimeContext().combat.applyPlayerHit({ target: m.players[victim],
                amount: m.players[victim].hp + m.players[victim].shieldHP + 1, sourcePlayer: m.players[killer],
                cause: 'MG_BULLET', weaponKind: 'MACHINE_GUN', projectileType: 'MACHINE_GUN' });
            r.foxHunt.setFox(bot); const before = r.getHudState();
            hit(0, bot); const humanFox = r.foxHunt.foxIndex;
            hit(otherBot, 0); const botFox = r.foxHunt.foxIndex;
            hit(count + 2, otherBot); const botBotFox = r.foxHunt.foxIndex;
            // Isolate a non-P1 winner so the real result/profile path must not call it a bot win
            // or give P1 an unearned shared-success medal. Normal-flight specs never set scores.
            if (count > 1) r.foxHunt.addScore(count - 1, 2000);
            return { humanFox, botFox, botBotFox, before, after: r.getHudState(),
                humanAlive: m.players[0].alive, pending: m._respawnSystem.getRemainingForPlayer(0) };
        }, humans);
        expect(transfers.humanFox).toBe(0); expect(transfers.botFox).toBe(humans + 1);
        expect(transfers.botBotFox).toBe(humans + 2); expect(transfers.humanAlive).toBe(false);
        expect(transfers.pending).toBe(3);
        await step(session, 3100);
        expect(await page.evaluate(() => window.GAME_INSTANCE.entityManager.players[0].alive)).toBe(true);
        const maps = [];
        for (let map = 0; map < 3; map++) {
            maps.push(await page.evaluate(() => {
                const g = window.GAME_INSTANCE, m = g.entityManager;
                const r = g.runtimeCoordinator.getRuntimeFacade()._arcadeSupport.huntParcoursSupport.runtime;
                r.foxHunt.clockStart = m._simulationClockMs - 300000;
                return { key: m.arena.currentMapKey, index: r.mapIndex, fox: r.foxHunt.foxIndex, startOrder: r.foxHunt.startOrder };
            }));
            await step(session, 1000 / 60);
            await page.waitForFunction(() => ['ROUND_END', 'MATCH_END'].includes(window.GAME_INSTANCE.state));
            if (map < 2) {
                await step(session, 3500);
                await page.waitForFunction(expected => window.GAME_INSTANCE.state === 'PLAYING'
                    && window.GAME_INSTANCE.entityManager && window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState().mapIndex === expected,
                map + 1, { timeout: 60000 });
            }
        }
        expect(maps.map(m => m.key)).toEqual(['neon_carnival', 'kinetic_tide', 'orbital_shipyard']);
        await waitForRenderFrames(page, 3);
        await expect(page.locator('#arcade-overlay-panel')).toBeVisible();
        await expect(page.locator('#arcade-overlay-panel')).toContainText('Fuchsjagd');
        const result = await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState());
        expect(result.postRunSummary.maps).toHaveLength(3); expect(result.postRunSummary.participants).toHaveLength(humans);
        expect(result.postRunSummary.ranking?.key).toContain(`fox_hunt:humans-${humans}:`);
        expect(result.postRunSummary.saveFailures).toEqual([]);
        for (const participant of result.postRunSummary.participants) expect(participant.saveFailures).toEqual([]);
        if (humans > 1) {
            expect(result.postRunSummary.runWinnerSide).toBe('human');
            expect(result.postRunSummary.participants[humans - 1].succeeded).toBe(true);
            expect(result.postRunSummary.participants[0].succeeded).toBe(false);
            expect(result.postRunSummary.medal).toBe('');
        }
        await testInfo.attach(`fox-${humans}-result.png`, { body: await page.screenshot(), contentType: 'image/png' });
        await testInfo.attach(`fox-${humans}-controlled.json`, { body: JSON.stringify({ scope: 'controlled damage and deadline fixtures; not full normal flight', initial, transfers, maps, result }, null, 2), contentType: 'application/json' });
        expect(errors).toEqual([]); await setPaused(session, false); await returnToMenu(page);
    });
}
