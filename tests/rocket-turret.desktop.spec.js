import { test, expect } from './helpers.desktop.js';
import { waitForLoadedGame, collectErrors } from './helpers.js';

for (const session of ['single', 'splitscreen']) {
    test(`Raketenwerfer: ${session} deployed turrets, HUD and fixed destruction`, async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await page.locator(`#menu-nav [data-session-type="${session}"]`).click({ force: true });
        await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
        await page.selectOption('#map-select', 'parcours_assault');
        await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
        await page.waitForFunction(() => window.GAME_INSTANCE?.entityManager?.humanPlayers?.length > 0
            && window.GAME_INSTANCE?.activeGameMode === 'HUNT');
        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const system = manager._staticTurretSystem;
            const humans = manager.humanPlayers;
            const center = humans[0].position.clone();
            // Exercise inventory use at the authored safe spawn locations.
            const results = humans.map((pilot) => {
                pilot.alive = true;
                pilot.spawnProtectionTimer = 0;

                pilot.inventory = ['MG_TURRET', 'ROCKET_TURRET'];
                pilot.itemUseCooldownRemaining = 0;
                const mg = manager._huntCombatSystem.useInventoryItem(pilot, 0);
                pilot.itemUseCooldownRemaining = 0;
                const rocket = manager._huntCombatSystem.useInventoryItem(pilot, 0);
                return { mg: mg.ok, rocket: rocket.ok, states: system.getHudStatesForPlayer(pilot.index) };
            });
            const target = humans[0];
            const existingDefinition = manager.arena.currentMapDefinition;
            manager.arena.currentMapDefinition = {
                ...existingDefinition, scaleAuthoredAnchors: false,
                staticTurrets: [{ id: 'desktop-fixed', weapon: 'rocket', pos: center.clone().addScaledVector(center.clone().set(1, 0, 0), -30).toArray(),
                    destructible: true, maxHp: 90, targetPlayers: 'all', targetTrails: true }],
            };
            // Instantiate through the map lifecycle, and restore the owned turrets via snapshot.
            const ownedSnapshot = system.createNetworkSnapshot();
            system.startRound();
            const fixed = system.turrets[0];
            fixed.aimDirection.subVectors(target.position, fixed.position).normalize();
            const before = manager._projectileSystem.projectiles.length;
            system._fire(fixed, target);
            const fired = manager._projectileSystem.projectiles.length > before;
            fixed.takeDamage(90, { sourcePlayer: target, cause: 'ROCKET_WEAK' });
            system.update(0);
            const removed = !system.turrets.some((turret) => turret.id === 'desktop-fixed');
            manager.arena.currentMapDefinition = existingDefinition;
            system.applyNetworkSnapshot(ownedSnapshot, manager.players);
            system.setNetworkReplica(false);
            game.huntHud._playerPanelTickTimer = 9999;
            game.huntHud.update(0.001);
            return { results, fired, removed, humanCount: humans.length };
        });
        expect(state.humanCount).toBe(session === 'single' ? 1 : 2);
        for (const result of state.results) {
            expect(result.mg).toBe(true);
            expect(result.rocket).toBe(true);
            expect(result.states.map((entry) => entry.weapon)).toEqual(['mg', 'rocket']);
        }
        expect(state.fired).toBe(true);
        expect(state.removed).toBe(true);
        for (let index = 1; index <= state.humanCount; index++) {
            await expect(page.locator(`#hunt-p${index}-turret`)).toContainText('Raketenwerfer');
            await expect(page.locator(`#hunt-p${index}-turret`)).toContainText('MG');
        }
        await page.screenshot({ path: testInfo.outputPath(`rocket-turret-${session}.png`) });
        expect(errors).toHaveLength(0);
    });
}
