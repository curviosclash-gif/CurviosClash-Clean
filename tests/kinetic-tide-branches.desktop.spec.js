import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

async function startKineticTide(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'kinetic_tide');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'kinetic_tide'
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 10
    ), null, { timeout: 90_000 });
}

test('Kinetic Tide accepts both alternatives of every route branch in the desktop runtime', async ({ page }) => {
    test.setTimeout(180_000);
    await startKineticTide(page);

    const runs = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager._parcoursProgressSystem;
        const player = manager.players[0];
        const route = system.getRouteSnapshot();
        const stages = new Map();
        for (const checkpoint of route.checkpoints) {
            const entries = stages.get(checkpoint.routeIndex) || [];
            entries.push(checkpoint);
            stages.set(checkpoint.routeIndex, entries);
        }

        const cross = (entry, now) => {
            const length = Math.hypot(...entry.forward) || 1;
            const unit = entry.forward.map((value) => value / length);
            const previous = {
                x: entry.pos[0] - unit[0] * entry.radius * 0.5,
                y: entry.pos[1] - unit[1] * entry.radius * 0.5,
                z: entry.pos[2] - unit[2] * entry.radius * 0.5,
            };
            player.position.set(
                entry.pos[0] + unit[0] * entry.radius * 0.5,
                entry.pos[1] + unit[1] * entry.radius * 0.5,
                entry.pos[2] + unit[2] * entry.radius * 0.5,
            );
            return system.updatePlayerProgress(player, previous, now);
        };

        return [0, 1].map((branchChoice) => {
            player.alive = true;
            system.startRound([player]);
            system.onPlayerSpawn(player, { reason: 'round_start' });
            let now = 1000;
            const crossedIds = [];
            for (const entries of [...stages.values()].sort((left, right) => left[0].routeIndex - right[0].routeIndex)) {
                const entry = entries[Math.min(branchChoice, entries.length - 1)];
                const result = cross(entry, now);
                crossedIds.push(result?.checkpointId || '');
                now += 500;
            }
            const finishResult = cross(route.finish, now);
            const hud = system.getPlayerHudState(player.index, now);
            return {
                crossedIds,
                finishType: finishResult?.type || '',
                completed: hud?.completed === true,
                currentCheckpoint: hud?.currentCheckpoint,
                wrongOrderCount: hud?.wrongOrderCount,
            };
        });
    });

    for (const run of runs) {
        expect(run.crossedIds).toHaveLength(16);
        expect(run.crossedIds.every(Boolean)).toBe(true);
        expect(run.finishType).toBe('finish');
        expect(run.completed).toBe(true);
        expect(run.currentCheckpoint).toBe(16);
        expect(run.wrongOrderCount).toBe(0);
    }
    expect(runs[0].crossedIds).not.toEqual(runs[1].crossedIds);
});
