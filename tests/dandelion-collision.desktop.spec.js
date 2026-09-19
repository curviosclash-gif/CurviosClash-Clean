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

test('attached dandelion seeds damage and visibly deflect a vehicle in the desktop runtime', async ({ page }) => {
    test.setTimeout(180_000);
    await startDandelionFight(page);

    const contact = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const player = manager.humanPlayers[0];
        const seed = game.arena._dandelionSeeds.seeds[0];
        const previous = seed.tip.clone().addScaledVector(seed.normal, 30);
        player.position.copy(seed.tip);
        player.spawnProtectionTimer = 0;
        player.arenaCollisionGraceTimer = 0;
        const hpBefore = player.hp;
        const aborted = manager._playerLifecycleSystem._collisionPhase.run(
            player, previous, manager.gameModeStrategy,
        );
        const timer = Math.max(0, Number(player.slingshotTimer) || 0);
        const forwardImpulse = Math.max(0, Number(player.slingshotParams?.forwardImpulse) || 0);
        return {
            aborted,
            seedCount: game.arena._dandelionSeeds.count,
            hpBefore,
            hpAfter: player.hp,
            timer,
            forwardImpulse,
            initialDeflection: forwardImpulse * Math.min(1, timer),
        };
    });

    expect(contact.seedCount).toBeGreaterThanOrEqual(180);
    expect(contact.aborted).toBe(false);
    expect(contact.hpAfter).toBe(contact.hpBefore - 1);
    expect(contact.timer).toBeGreaterThan(0);
    expect(contact.initialDeflection).toBeGreaterThanOrEqual(2);
});
