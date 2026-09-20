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
            renderBatch: game.arena._dandelionSeeds.getRenderBatchMetrics(),
            hpBefore,
            hpAfter: player.hp,
            timer,
            forwardImpulse,
            initialDeflection: forwardImpulse * Math.min(1, timer),
        };
    });

    expect(contact.seedCount).toBeGreaterThanOrEqual(180);
    expect(contact.renderBatch.enabled).toBe(true);
    expect(contact.renderBatch.instances).toBe(contact.seedCount);
    expect(contact.renderBatch.batches).toBeLessThanOrEqual(12);
    expect(contact.renderBatch.estimatedDrawCalls).toBeLessThanOrEqual(12);
    expect(contact.aborted).toBe(false);
    expect(contact.hpAfter).toBe(contact.hpBefore - 1);
    expect(contact.timer).toBeGreaterThan(0);
    expect(contact.initialDeflection).toBeGreaterThanOrEqual(2);
});

test('the last dandelion seed opens the guarded root chamber and keeps its interior safe', async ({ page }) => {
    test.setTimeout(180_000);
    await startDandelionFight(page);

    const result = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const manager = game.entityManager;
        const seeds = arena._dandelionSeeds.seeds;
        const roomSystem = manager._secretRoomSystem;
        const turretSystem = manager._staticTurretSystem;
        const roomPortal = arena.portals.find((portal) => portal.roomId === 'root_chamber');

        for (let index = 0; index < seeds.length - 1; index += 1) {
            arena.releaseDandelionSeed(seeds[index].node.name);
        }
        roomSystem.update(0);
        turretSystem.update(0);
        const before = {
            progress: { ...arena.getDandelionSeedProgress() },
            portalOpen: roomPortal?.active === true,
            visibleGuards: turretSystem.turrets.filter((turret) => turret.root?.visible).length,
        };

        arena.releaseDandelionSeed(seeds.at(-1).node.name);
        roomSystem.update(0);
        turretSystem.update(0);
        const entry = roomSystem.getRooms().find((candidate) => candidate.room.id === 'root_chamber');
        const insideTurrets = turretSystem.turrets.filter((turret) => {
            const bounds = entry.scaledRoom.bounds;
            return turret.position.x >= bounds.min[0] && turret.position.x <= bounds.max[0]
                && turret.position.y >= bounds.min[1] && turret.position.y <= bounds.max[1]
                && turret.position.z >= bounds.min[2] && turret.position.z <= bounds.max[2];
        }).length;

        const player = manager.humanPlayers[0];
        player.position.set(0, -33, 0);
        roomSystem.update(0);
        const entered = { ...roomSystem.getHudStateForPlayer(player.index) };
        roomSystem.update(20);

        return {
            seedTotal: seeds.length,
            before,
            after: {
                progress: { ...arena.getDandelionSeedProgress() },
                portalOpen: roomPortal?.active === true,
                visibleGuards: turretSystem.turrets.filter((turret) => turret.root?.visible).length,
                insideTurrets,
            },
            entered,
            ejectPosition: player.position.toArray(),
        };
    });

    expect(result.before.progress.released).toBe(result.seedTotal - 1);
    expect(result.before.portalOpen).toBe(false);
    expect(result.before.visibleGuards).toBe(0);
    expect(result.after.progress.released).toBe(result.seedTotal);
    expect(result.after.progress.allReleased).toBe(true);
    expect(result.after.portalOpen).toBe(true);
    expect(result.after.visibleGuards).toBe(3);
    expect(result.after.insideTurrets).toBe(0);
    expect(result.entered.inside).toBe(true);
    expect(result.entered.roomId).toBe('root_chamber');
    expect(result.ejectPosition).toEqual([0, 360, 510]);

    await expect(page.locator('.map-destructible-status').first()).toContainText(
        'ALLE SAMEN GELÖST · PORTAL OFFEN',
    );
});
