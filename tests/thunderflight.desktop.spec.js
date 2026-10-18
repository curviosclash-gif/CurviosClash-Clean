import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';
import { configurePilot, installControl, setPaused, step, stopPilot } from '../scripts/playtest/playtest-control.mjs';
import { startMatch } from '../scripts/playtest/playtest-driver.mjs';

async function start(page) {
    await waitForLoadedGame(page);
    expect(await page.evaluate(() => window.GAME_DEBUG.startHuntParcours('thunderflight'))).toBe(true);
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING');
    const session = { page }; await installControl(session); await setPaused(session, true);
    await step(session, 1000 / 60); await waitForRenderFrames(page, 3);
    return session;
}

test('Gewitterflug has four real racing bots and environmental warnings let the human dive to safety', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page), session = await start(page);
    const initial = await page.evaluate(() => {
        const g = window.GAME_INSTANCE, m = g.entityManager;
        return { map: g.runtimeConfig.session.mapKey, run: g.runtimeCoordinator.getRuntimeFacade().getArcadeRunState(),
            bots: m.bots.map(b => ({ index: b.player.index, position: b.player.position.toArray(), progress: m.getParcoursHudState(b.player.index) })) };
    });
    expect(initial.map).toBe('sky_islands'); expect(initial.bots).toHaveLength(4);
    await expect(page.locator('#arcade-score-hud')).toContainText('Gewitterflug');
    await expect(page.locator('#hunt-objective')).toContainText('Ringpunkte');
    await expect(page.locator('#hunt-scoreboard')).toBeHidden();
    await step(session, 12000);
    const botFlight = await page.evaluate(() => {
        const m = window.GAME_INSTANCE.entityManager;
        return m.bots.map(b => ({ index: b.player.index, position: b.player.position.toArray(), progress: m.getParcoursHudState(b.player.index) }));
    });
    expect(botFlight.some((b, i) => b.progress.currentCheckpoint > initial.bots[i].progress.currentCheckpoint)).toBe(true);
    await step(session, 2100); // Let the automatic twelve-second warning finish before the isolated weather fixture.
    const casting = await page.evaluate(() => {
        const g = window.GAME_INSTANCE, m = g.entityManager, h = m.humanPlayers[0], max = g.arena.bounds.maxY;
        for (const p of m.players) {
            p.position.set(p.index * 20, max - 100, 0); p.spawnProtectionTimer = 0; p.trail.clear();
            p.markRenderDiscontinuity('weather-fixture');
        }
        h.position.y = max - 15;
        const activated = m._lightningStrikeSystem.activateEnvironment();
        return { activated, hp: h.hp, warning: m._lightningStrikeSystem.getWarningState(), max };
    });
    expect(casting.activated).toBe(true); expect(casting.warning.remainingSeconds).toBe(2);
    await step(session, 500);
    await expect(page.locator('#arcade-score-hud')).toContainText('Blitz in');
    await testInfo.attach('thunderflight-warning.png', { body: await page.screenshot(), contentType: 'image/png' });
    await page.evaluate(() => {
        const g = window.GAME_INSTANCE, m = g.entityManager;
        m.humanPlayers[0].position.set(g.arena.bounds.maxX - 35, 60, g.arena.bounds.maxZ - 35);
        m.humanPlayers[0].markRenderDiscontinuity('weather-dive-fixture');
        m.players[4].position.set(g.arena.bounds.maxX - 60, g.arena.bounds.maxY - 15, -80);
        m.players[4].markRenderDiscontinuity('weather-high-bot-fixture');
    });
    await step(session, 1600);
    const escaped = await page.evaluate(() => {
        const m = window.GAME_INSTANCE.entityManager;
        return { hp: m.humanPlayers[0].hp, alive: m.humanPlayers[0].alive, strike: m._lightningStrikeSystem.lastStrike,
            kills: m.players.map(p => p.kills || 0) };
    });
    expect(escaped.hp).toBe(casting.hp); expect(escaped.strike.targetIndices).toEqual([4]);
    expect(escaped.strike.casterIndex).toBe(-1);
    await testInfo.attach('thunderflight-weather-before-death.json', { body: JSON.stringify({ casting, escaped }, null, 2), contentType: 'application/json' });
    expect(escaped.alive).toBe(true);
    const beforeDeath = await page.evaluate(() => {
        const g = window.GAME_INSTANCE, m = g.entityManager, h = m.humanPlayers[0];
        for (const p of m.players) { p.position.set(-200 + p.index * 35, 90, -90); p.spawnProtectionTimer = 99; p.trail.clear(); p.markRenderDiscontinuity('weather-death-fixture'); }
        h.position.set(0, g.arena.bounds.maxY - 40, 0); h.setLookAtWorld(100, h.position.y, 0);
        h.markRenderDiscontinuity('weather-death-fixture'); h.spawnProtectionTimer = 0;
        // Use normal damage so its regeneration delay is stamped; merely assigning 29 HP
        // lets the ship heal above the lethal threshold during the two-second warning.
        const damage = m.getRuntimeContext().combat.applyPlayerHit({ target: h, amount: h.hp + h.shieldHP - 29,
            cause: 'PROJECTILE', sourcePlayer: null, weaponKind: 'MACHINE_GUN', projectileType: 'MACHINE_GUN' });
        return { activated: m._lightningStrikeSystem.activateEnvironment(), alive: h.alive, position: h.position.toArray(), hp: h.hp, damage };
    });
    expect(beforeDeath.activated).toBe(true); expect(beforeDeath.alive).toBe(true);
    await configurePilot(session, { mode: 'maneuver', input: { turn: 0, climb: 0, roll: 0 }, frames: 180 });
    await step(session, 2100); await stopPilot(session);
    const death = await page.evaluate(() => {
        const m = window.GAME_INSTANCE.entityManager;
        return { alive: m.humanPlayers[0].alive, hp: m.humanPlayers[0].hp,
            kills: m.players.map(p => p.kills || 0), cause: m.humanPlayers[0].lastDeathCause,
            projectile: m.humanPlayers[0].lastDeathProjectileType, strike: m._lightningStrikeSystem.lastStrike };
    });
    await testInfo.attach('thunderflight-weather-death-diagnostic.json', { body: JSON.stringify({ beforeDeath, death }, null, 2), contentType: 'application/json' });
    expect(death.alive).toBe(false); expect(death.hp).toBe(0); expect(death.kills).toEqual(escaped.kills);
    expect(death.projectile).toBe('LIGHTNING');
    await step(session, 3500);
    expect(await page.evaluate(() => window.GAME_INSTANCE.entityManager.humanPlayers[0].alive)).toBe(true);
    await testInfo.attach('thunderflight-weather.json', { body: JSON.stringify({ initial, botFlight, casting, escaped, death }, null, 2), contentType: 'application/json' });
    expect(errors).toHaveLength(0); await setPaused(session, false); await returnToMenu(page);
});

test('Gewitterflug traverses actual checkpoint planes on all three maps, rebuilds and shows its own scored result', async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const errors = collectErrors(page), session = await start(page), flights = [];
    for (const map of ['sky_islands', 'spiral_tower', 'abyssal_descent']) {
        await page.waitForFunction(map => window.GAME_INSTANCE.state === 'PLAYING' && window.GAME_INSTANCE.runtimeConfig.session.mapKey === map, map);
        await installControl(session); await setPaused(session, true);
        const route = await page.evaluate(() => window.GAME_INSTANCE.entityManager.getParcoursRouteSnapshot());
        expect(route.checkpoints.length).toBeGreaterThanOrEqual(8);
        const rings = [...route.checkpoints.filter(cp => !cp.aliasOf), route.finish];
        const legs = [];
        for (let index = 0; index < rings.length; index++) {
            const ring = rings[index];
            const placed = await page.evaluate(ring => {
                const g = window.GAME_INSTANCE, h = g.entityManager.humanPlayers[0];
                const forward = h.position.clone().set(...ring.forward).normalize();
                const horizontal = forward.clone().setY(0).normalize();
                const directions = [horizontal, forward, h.position.clone().set(1, 0, 0), h.position.clone().set(-1, 0, 0),
                    h.position.clone().set(0, 0, 1), h.position.clone().set(0, 0, -1), h.position.clone().set(0, -1, 0)];
                const direction = directions.find(dir => dir.lengthSq() > 0 && Array.from({ length: 15 }, (_, i) => -18 + i * 1.5)
                    .every(distance => !g.arena.checkCollisionFast(h.position.clone().set(...ring.pos).addScaledVector(dir, distance), h.hitboxRadius)));
                if (!direction) throw new Error(`No collision-free directed approach for ${ring.id}`);
                h.position.set(...ring.pos).addScaledVector(direction, -18); h.setLookAtWorld(...ring.pos);
                h.trail.clear(); h.spawnProtectionTimer = 0; h.arenaCollisionGraceTimer = 0;
                h.markRenderDiscontinuity('directed-ring-flight');
                return { collision: g.arena.checkCollisionFast(h.position, h.hitboxRadius), hp: h.hp, direction: direction.toArray() };
            }, ring);
            expect(placed.collision, `${map}/${ring.id} approach`).toBe(false);
            await configurePilot(session, { mode: 'maneuver', input: { turn: 0, climb: 0, roll: 0 }, frames: 180 });
            let result;
            for (let tick = 0; tick < 30; tick++) {
                await step(session, 50);
                result = await page.evaluate(() => {
                    const g = window.GAME_INSTANCE, m = g.entityManager, h = m.humanPlayers[0];
                    return { state: g.state, progress: m.getParcoursHudState(h.index), hp: h.hp, alive: h.alive,
                        wall: h.wallDamageCooldown, run: g.runtimeCoordinator.getRuntimeFacade().getArcadeRunState() };
                });
                if (result.state !== 'PLAYING' || result.progress.currentCheckpoint >= index + 1) break;
            }
            await stopPilot(session); legs.push({ ring: ring.id, placed, result });
            expect(result.alive).toBe(true); expect(result.hp, `${map}/${ring.id} has no collision damage`).toBeGreaterThanOrEqual(placed.hp);
            if (index < rings.length - 1) expect(result.progress.currentCheckpoint).toBe(index + 1);
        }
        await page.waitForFunction(() => ['ROUND_END', 'MATCH_END'].includes(window.GAME_INSTANCE.state));
        flights.push({ map, legs });
        if (map !== 'abyssal_descent') { await step(session, 3500); }
    }
    await waitForRenderFrames(page, 3);
    await expect(page.locator('#arcade-overlay-panel')).toBeVisible();
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Gewitterflug');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Ringpunkte');
    const result = await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState());
    expect(result.postRunSummary.maps).toHaveLength(3); expect(result.postRunSummary.score).toBeGreaterThan(0);
    expect(result.postRunSummary.vehicleXpEarned).toBeGreaterThan(0);
    expect(result.postRunSummary.saveFailures).toEqual([]);
    expect(result.postRunSummary.ranking.key).toContain('hunt_parcours:hunt-score.v1:thunderflight:');
    await testInfo.attach('thunderflight-result.png', { body: await page.screenshot(), contentType: 'image/png' });
    await testInfo.attach('thunderflight-flights.json', { body: JSON.stringify({ scope: 'Initial placement before each checkpoint, actual normal simulation crossing; not one continuous full-course flight', flights, result }, null, 2), contentType: 'application/json' });
    expect(errors).toHaveLength(0); await setPaused(session, false);
    await page.locator('#arcade-overlay-panel').getByRole('button', { name: 'Zum Menü', exact: true }).click();
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'MENU');
    expect(await page.evaluate(() => window.GAME_DEBUG.startHuntParcours('thunderflight'))).toBe(true);
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    const fresh = await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().getArcadeRunState());
    expect(fresh.mapIndex).toBe(0); expect(fresh.mapResults).toEqual([]);
    expect(fresh.score).toBeLessThanOrEqual(100); expect(fresh.ringClaims).toBeLessThanOrEqual(1);
    await returnToMenu(page);
    expect((await startMatch(session, { map: 'standard', mode: 'HUNT', bots: 1, paused: true, arcade: { enabled: false } })).ok).toBe(true);
    await step(session, 500); await waitForRenderFrames(page, 3);
    await expect(page.locator('#hunt-scoreboard')).toBeVisible();
    await expect(page.locator('#hunt-objective')).not.toContainText('Gewitterflug');
    await setPaused(session, false); await returnToMenu(page);
});
