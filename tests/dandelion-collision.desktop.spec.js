import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'dandelion_sky';

async function startDandelionFight(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.arena?._dandelionSeeds?.count > 0
            && game?.entityManager?.humanPlayers?.length > 0;
    }, MAP_KEY, { timeout: 90_000 });
}

test('attached dandelion seeds render in a few instanced batches in the desktop runtime', async ({ page }) => {
    test.setTimeout(180_000);
    await startDandelionFight(page);

    // The contact damage and deflection run in tests/dandelion-seed-hits.contract.test.mjs.
    const batch = await page.evaluate(() => {
        const seeds = window.GAME_INSTANCE.arena._dandelionSeeds;
        return { seedCount: seeds.count, renderBatch: seeds.getRenderBatchMetrics() };
    });

    expect(batch.seedCount).toBeGreaterThanOrEqual(180);
    expect(batch.renderBatch.enabled).toBe(true);
    expect(batch.renderBatch.instances).toBe(batch.seedCount);
    expect(batch.renderBatch.batches).toBeLessThanOrEqual(12);
    expect(batch.renderBatch.estimatedDrawCalls).toBeLessThanOrEqual(12);
});

test('the last dandelion seed opens the root chamber portal', async ({ page }) => {
    test.setTimeout(180_000);
    await startDandelionFight(page);

    // Guards, stay clock and eject point are covered by tests/dandelion-sky-secret-room.contract.test.mjs.
    const readState = () => page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            progress: { ...arena.getDandelionSeedProgress() },
            portalOpen: arena.portals.find((portal) => portal.roomId === 'root_chamber')?.active === true,
        };
    });
    const seedTotal = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const seeds = arena._dandelionSeeds.seeds;
        for (let index = 0; index < seeds.length - 1; index += 1) {
            arena.releaseDandelionSeed(seeds[index].node.name);
        }
        return seeds.length;
    });
    const before = await readState();
    expect(before.progress.released).toBe(seedTotal - 1);
    expect(before.portalOpen).toBe(false);

    await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        arena.releaseDandelionSeed(arena._dandelionSeeds.seeds.at(-1).node.name);
    });
    await expect.poll(async () => (await readState()).portalOpen).toBe(true);
    const after = await readState();
    expect(after.progress.released).toBe(seedTotal);
    expect(after.progress.allReleased).toBe(true);

    await expect(page.locator('.map-destructible-status').first()).toContainText(
        'PORTAL OFFEN · WURZELKAMMER',
    );
});
