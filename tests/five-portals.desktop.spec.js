import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';

test('Fünf Portale starts solo, rebuilds each map and shows five times', async ({ page }) => {
    test.setTimeout(240_000);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="single"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ force: true });
    await page.locator('#submenu-game:not(.hidden) [data-start-section-target="arcade"]')
        .evaluate((button) => button.click());
    await expect(page.locator('#btn-arcade-five-portals-start-inline')).toBeVisible();
    await page.locator('#btn-arcade-five-portals-start-inline').click({ force: true });

    const maps = ['micro_maw', 'mirror_docks', 'glass_serpent', 'storm_switchyard', 'wind_cathedral'];
    for (let index = 0; index < maps.length; index += 1) {
        await page.waitForFunction((expected) => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime;
            return runtime?.phase === 'racing' && runtime?.getHudState()?.currentMapKey === expected
                && runtime?.entityManager === game?.entityManager
                && game?.arena?.currentMapKey === expected;
        }, maps[index], { timeout: 60_000 });
        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const runtime = game.runtimeFacade._arcadeSupport.fivePortalsRuntime;
            return {
                mapIndex: runtime.mapIndex,
                bots: game.entityManager.bots.length,
                exits: game.arena.exitPortals.length,
                exitColor: game.arena.exitPortals[0]?.color,
                exitActive: game.arena.exitPortals[0]?.active,
                inactiveInteraction: game.arena.checkExitPortal(game.arena.exitPortals[0].pos, 1, 0)?.triggered === true,
                turrets: game.entityManager._staticTurretSystem.turrets.length,
                arenaMap: game.arena.currentMapKey,
                runtimeMap: game.runtimeFacade.getRuntimeState()?.runtimeConfig?.session?.mapKey,
            };
        });
        expect(state.mapIndex).toBe(index);
        expect(state.bots).toBe(0);
        expect(state.exits).toBe(1);
        expect(state.exitColor).toBe(0xffcc44);
        expect(state.exitActive).toBe(false);
        expect(state.inactiveInteraction).toBe(false);
        expect(state.turrets).toBeGreaterThan(0);
        expect(state.arenaMap).toBe(maps[index]);
        const sightlines = await page.evaluate(() => {
            const arena = window.GAME_INSTANCE.arena;
            return window.GAME_INSTANCE.entityManager._staticTurretSystem.turrets.map((turret) => {
                const clear = arena.checkpointRings.filter((ring) => {
                    const target = ring.pos.clone(); target.y += 9;
                    const distance = turret.position.distanceTo(target);
                    if (distance > turret.range) return false;
                    const sample = turret.position.clone();
                    for (let step = 1, steps = Math.ceil(distance / 0.5); step < steps; step += 1) {
                        sample.lerpVectors(turret.position, target, step / steps);
                        if (arena.checkCollisionFast(sample, 0.18)) return false;
                    }
                    return true;
                }).map((ring) => ring.checkpointId);
                return {
                    id: turret.id,
                    clear,
                    startBlocked: arena.checkCollisionFast(turret.position, 0.18),
                    exitOutOfRange: turret.position.distanceTo(arena.exitPortals[0].pos) > turret.range,
                };
            });
        });
        for (const turret of sightlines) {
            expect(turret.startBlocked, `${turret.id} must be outside colliders`).toBe(false);
            expect(turret.clear.length, `${turret.id} must see a playable route point`).toBeGreaterThan(0);
            expect(turret.exitOutOfRange, `${turret.id} must not cover the exit`).toBe(true);
        }
        if (maps[index] === 'glass_serpent') {
            expect(sightlines.find((turret) => turret.id === 'gs_rocket_balcony')?.clear).toContain('CP07_BALCONY');
            expect(sightlines.find((turret) => turret.id === 'gs_rocket_balcony')?.clear).not.toContain('CP07_TUBE');
        }

        await page.evaluate((mapIndex) => {
            const runtime = window.GAME_INSTANCE.runtimeFacade._arcadeSupport.fivePortalsRuntime;
            runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: (mapIndex + 1) * 1000 });
        }, index);
        await expect(page.locator('#arcade-score-hud')).toContainText('Goldenes Portal');
        const portalActive = await page.evaluate(() => window.GAME_INSTANCE.arena.exitPortals[0].active);
        expect(portalActive).toBe(true);
        const triggered = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const result = game.arena.checkExitPortal(game.arena.exitPortals[0].pos, 1, 0);
            if (result?.triggered) game.entityManager._emitArcadeGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
            return result?.triggered === true;
        });
        expect(triggered).toBe(true);
    }

    await page.waitForFunction(() => window.GAME_INSTANCE?.runtimeFacade?._arcadeSupport?.fivePortalsRuntime?.phase === 'finished');
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Fünf Portale abgeschlossen');
    await expect(page.locator('#arcade-overlay-panel li')).toHaveCount(5);
    await expect(page.locator('#arcade-overlay-panel')).toContainText('Gesamtzeit: 15.00 s');
});
