import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// This is the first map in the pack that is flown upward, and the two things that makes fragile
// cannot be argued from the preset. The first is height: eight parts stacked on one axis either
// land on top of each other or leave a gap in the middle of the tower, and 330 m of it has to
// still be inside the map. The second is the open middle: the route climbs through the hole in
// each gallery, so a deck that collides across its centre closes the map without failing a
// single unit test. Both are checked in one run -- thirteen GLBs take long enough to load that
// doing it twice would be wasteful.

// World units are authored units times the map scale of 3.
const SCALE = 3;
const FIRST_DECK = 42.58;
const TOP_DECK = 173.66;

test('the Eiffel Tower loads as one tower with its galleries open in the middle', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'eiffel_tower');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'eiffel_tower'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    const loadStartedAt = await page.evaluate(() => performance.now());
    await page.click('#btn-start');
    await expect.poll(() => page.evaluate(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'eiffel_tower'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 5
    )), {
        timeout: 150_000,
        message: 'the tower should load all thirteen parts and animate the five machines',
    }).toBeTruthy();
    const loadDurationMs = await page.evaluate((startedAt) => performance.now() - startedAt, loadStartedAt);
    expect(loadDurationMs).toBeLessThan(120_000);

    const state = await page.evaluate(([scale, firstDeck, topDeck]) => {
        const arena = window.GAME_INSTANCE.arena;
        const at = (x, y, z) => arena.checkCollisionFast(
            { x: x * scale, y: y * scale, z: z * scale },
            0.1,
        );
        return {
            mapKey: arena.currentMapKey,
            trackCount: arena._glbAnimation.trackCount,
            warningCount: arena._glbLoadWarnings.length,
            colliderMode: arena.currentMapDefinition?.glbColliderMode,
            // Eight static parts plus the five machines: two leg lifts, the summit lift, the
            // beacon and the iris.
            glbSceneChildren: arena._glbScene?.children?.length || 0,
            authoredObstacleCount: arena.obstacles.filter((entry) => !entry.isWall && !entry.dynamic).length,
            // The middle of the first gallery is the way up. If this reads solid the climb is
            // sealed and the route cannot be flown at all.
            firstGalleryCentreOpen: !at(0, firstDeck, 0),
            // The gallery deck itself, halfway between its opening and its outer edge.
            firstGalleryDeckSolid: at(0, firstDeck, 18),
            // Geometry at 276 m proves the eight parts really did stack instead of piling up at
            // the bottom of the map.
            summitSolid: at(0, topDeck + 0.4, 0),
            // Nothing may stand above the antenna: that is the headroom the map ceiling leaves.
            aboveAntennaOpen: !at(0, 212, 0),
        };
    }, [SCALE, FIRST_DECK, TOP_DECK]);

    expect(state.authoredObstacleCount).toBeGreaterThan(0);
    expect(state).toEqual({
        mapKey: 'eiffel_tower',
        trackCount: 5,
        warningCount: 0,
        colliderMode: 'scene',
        glbSceneChildren: 13,
        authoredObstacleCount: state.authoredObstacleCount,
        firstGalleryCentreOpen: true,
        firstGalleryDeckSolid: true,
        summitSolid: true,
        aboveAntennaOpen: true,
    });

    await page.evaluate(() => window.GAME_INSTANCE?.returnToMenu?.());
});
