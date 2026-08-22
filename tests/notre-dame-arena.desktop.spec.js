import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// The arena variant shares its fabric, its site and its collision with the parcours map, so the
// only thing worth proving in the running app is that sharing actually holds: the same fifteen
// parts load and the same eight clips run, but no ordered route is active. It gets its own file
// because a desktop run keeps one window, and a second map cannot be selected from inside a
// match that is already going.

test('the Notre-Dame arena flies the same building without a route', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'notre_dame_arena');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'notre_dame_arena'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await expect.poll(() => page.evaluate(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'notre_dame_arena'
        && window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 15
        && !window.GAME_INSTANCE?.arena?._glbLoadError
    )), {
        timeout: 150_000,
        message: 'the arena variant should load the same fifteen parts',
    }).toBeTruthy();

    const state = await page.evaluate(() => ({
        parcours: !!window.GAME_INSTANCE.arena.currentMapDefinition?.parcours?.enabled,
        tracks: window.GAME_INSTANCE.arena._glbAnimation.trackCount,
        warnings: window.GAME_INSTANCE.arena._glbLoadWarnings.length,
        colliderMode: window.GAME_INSTANCE.arena.currentMapDefinition?.glbColliderMode,
        authoredObstacleCount: window.GAME_INSTANCE.arena.obstacles
            .filter((entry) => !entry.isWall && !entry.dynamic).length,
        authoredObstacleVisuals: [
            window.GAME_INSTANCE.arena._mergedObstacleMesh,
            window.GAME_INSTANCE.arena._mergedFoamMesh,
            window.GAME_INSTANCE.arena._mergedObstacleEdges,
            window.GAME_INSTANCE.arena._mergedFoamEdges,
        ].filter(Boolean).length,
        authoredCollisionSolid: window.GAME_INSTANCE.arena
            .checkCollisionFast({ x: -249, y: 168, z: -60.9 }, 0.1),
    }));
    expect(state.authoredObstacleCount).toBeGreaterThan(0);
    expect(state).toEqual({
        parcours: false,
        tracks: 8,
        warnings: 0,
        colliderMode: 'dynamic',
        authoredObstacleCount: state.authoredObstacleCount,
        authoredObstacleVisuals: 0,
        authoredCollisionSolid: true,
    });
});
