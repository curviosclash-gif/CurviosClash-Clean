import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// The arena variant shares its fabric and collision with the parcours map, so the
// running app proves that the same seven cathedral parts and 32 tree instances load, but no ordered route
// is active. It gets its own file
// because a desktop run keeps one window, and a second map cannot be selected from inside a
// match that is already going.

test('the Notre-Dame arena flies the same building with ten flapping pigeons and no route', async ({ page }, testInfo) => {
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
        && window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 45
        && !window.GAME_INSTANCE?.arena?._glbLoadError
    )), {
        timeout: 150_000,
        message: 'the arena variant should load the same seven parts and 32 trees',
    }).toBeTruthy();

    await expect.poll(() => page.evaluate(() => {
        const system = window.GAME_INSTANCE?.entityManager?._mapUnitSystem;
        const flock = system?.units?.find((unit) => unit.id === 'notre_dame_pigeons');
        return flock?.members?.length === 10
            && flock.root?.children?.length === 10;
    }), { timeout: 20_000, message: 'the arena should start its ten-pigeon swarm' }).toBeTruthy();
    await expect.poll(() => page.evaluate(() => {
        const parts = window.GAME_INSTANCE?.entityManager?._mapUnitSystem?._modelLibrary?.parts;
        return parts?.has('pigeon_body') === true && parts?.has('pigeon_wing') === true;
    }), { timeout: 20_000, message: 'the shared GLB should supply both authored pigeon parts' }).toBeTruthy();

    const flockVisual = await page.evaluate(() => {
        const system = window.GAME_INSTANCE.entityManager._mapUnitSystem;
        const flock = system.units.find((unit) => unit.id === 'notre_dame_pigeons');
        const birds = flock.root.children;
        const bodyGeometry = system._modelLibrary.parts.get('pigeon_body').geometry;
        const wingGeometry = system._modelLibrary.parts.get('pigeon_wing').geometry;
        const containsGeometry = (root, geometry) => {
            let found = false;
            root?.traverse?.((node) => { if (node.geometry === geometry) found = true; });
            return found;
        };
        const wings = flock.members.map((member) => member.visualWings?.map((wing) => wing.rotation.z) || []);
        const authoredBodies = birds.filter((bird) => containsGeometry(bird, bodyGeometry));
        const authoredWingPairs = flock.members.filter((member) => member.visualWings?.length === 2
            && member.visualWings.every((wing) => containsGeometry(wing, wingGeometry)));
        return {
            visibleBirds: birds.filter((bird) => bird.visible).length,
            authoredBodies: authoredBodies.length,
            authoredWingPairs: authoredWingPairs.length,
            wings,
            parcours: !!window.GAME_INSTANCE.arena.currentMapDefinition?.parcours?.enabled,
        };
    });
    expect(flockVisual.visibleBirds).toBe(10);
    expect(flockVisual.authoredBodies).toBe(10);
    expect(flockVisual.authoredWingPairs).toBe(10);
    expect(flockVisual.parcours).toBe(false);
    await page.waitForTimeout(220);
    const flappedWings = await page.evaluate(() => {
        const flock = window.GAME_INSTANCE.entityManager._mapUnitSystem.units
            .find((unit) => unit.id === 'notre_dame_pigeons');
        return flock.members.map((member) => member.visualWings?.map((wing) => wing.rotation.z) || []);
    });
    expect(flappedWings.some((pair, index) => pair.some((angle, wingIndex) => (
        Math.abs(angle - (flockVisual.wings[index]?.[wingIndex] ?? angle)) > 0.08
    )))).toBe(true);
    await testInfo.attach('notre-dame-arena-pigeons-gameplay.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
    });

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
        // Retain a positive GLB-backed solid probe on the parvis island, away from J6's open gallery.
        authoredCollisionSolid: window.GAME_INSTANCE.arena
            .checkCollisionFast({ x: -67.2, y: 21.48, z: 0 }, 0.1),
        galleryOpeningClear: !window.GAME_INSTANCE.arena
            .checkCollisionFast({ x: -249, y: 183.6, z: 0 }, 0.1),
    }));
    expect(state.authoredObstacleCount).toBeGreaterThan(0);
    expect(state).toEqual({
        parcours: false,
        tracks: 7,
        warnings: 0,
        colliderMode: 'scene',
        authoredObstacleCount: state.authoredObstacleCount,
        authoredObstacleVisuals: 2,
        authoredCollisionSolid: true,
        galleryOpeningClear: true,
    });
});
