import { writeFile } from 'node:fs/promises';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'storm_lighthouse_siege';
const MAP_SCALE = 3;

async function startLighthouseMatch(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
        && window.GAME_INSTANCE?.entityManager?.players?.length > 0
    ), MAP_KEY, { timeout: 120_000 });
}

async function captureArena(page, camera) {
    return page.evaluate(({ from, to }) => {
        const runtime = window.GAME_INSTANCE.renderer;
        const activeCamera = runtime.cameras[0];
        activeCamera.position.set(...from);
        activeCamera.lookAt(...to);
        activeCamera.far = 2000;
        activeCamera.updateProjectionMatrix();
        activeCamera.updateMatrixWorld(true);
        runtime.renderer.setRenderTarget(null);
        runtime.renderer.render(runtime.scene, activeCamera);
        return runtime.renderer.domElement.toDataURL('image/png');
    }, camera);
}

test('the storm eye loads three routes and settles its lighthouse into a new ramp', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startLighthouseMatch(page);
    await expect.poll(() => page.evaluate(() => {
        const arena = window.GAME_INSTANCE?.arena;
        return !arena?._glbLoadError && arena?._glbScene?.children?.length === 5;
    }), { timeout: 150_000 }).toBe(true);

    const intactPicture = await captureArena(page, {
        from: [0, 120, -235],
        to: [0, 38, 0],
    });

    const result = await page.evaluate(({ mapScale }) => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const entityManager = game.entityManager;
        const destructibles = entityManager._mapDestructibleSystem;
        const model = (id) => arena._glbScene.getObjectByName(`glb-slot-${id}`);
        const island = model('storm-lighthouse-island');
        const intact = model('storm-lighthouse-intact');
        const collapse = model('storm-lighthouse-collapse');
        const lift = model('storm-lighthouse-lift');
        const beacon = model('storm-lighthouse-beacon');
        const definition = destructibles.getDefinition();
        const segment = definition.segments.find((entry) => entry.id === 'lighthouse_tower');
        const blockedSpawns = [
            arena.currentMapDefinition.playerSpawn,
            ...arena.currentMapDefinition.botSpawns,
        ].filter((spawn) => arena.checkCollisionFast({
            x: spawn.x * mapScale,
            y: spawn.y * mapScale,
            z: spawn.z * mapScale,
        }, 0.8)).length;

        const before = {
            islandVisible: island.visible,
            intactVisible: intact.visible,
            collapseVisible: collapse.visible,
            liftVisible: lift.visible,
            beaconVisible: beacon.visible,
        };
        const hit = destructibles.applyMeshHit('lighthouse_tower_shaft_1', segment.hp, {
            hitPoint: { x: 0, y: segment.anchor[1] * mapScale, z: 0 },
            hitDirection: { x: 0, y: 0, z: 1 },
            cause: 'MG_BULLET',
        });
        const event = destructibles.getState().events.at(-1);
        arena.setGlbAnimationElapsedSeconds(event.atSeconds + 5.1);
        arena.update(0.001);

        const wreck = arena._glbDynamicObstacles.filter(
            (collider) => collider.modelId === 'storm-lighthouse-collapse'
        );
        const bounds = wreck.reduce((resultBounds, collider) => ({
            minX: Math.min(resultBounds.minX, collider.box.min.x),
            maxX: Math.max(resultBounds.maxX, collider.box.max.x),
            minY: Math.min(resultBounds.minY, collider.box.min.y),
            maxY: Math.max(resultBounds.maxY, collider.box.max.y),
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

        return {
            warningCount: arena._glbLoadWarnings.length,
            trackCount: arena._glbAnimation.trackCount,
            gateCount: arena.specialGates.length,
            blockedSpawns,
            before,
            destroyed: hit?.destroyed === true,
            islandVisibleAfter: island.visible,
            intactVisibleAfter: intact.visible,
            collapseVisibleAfter: collapse.visible,
            liftVisibleAfter: lift.visible,
            beaconVisibleAfter: beacon.visible,
            collapseYaw: collapse.rotation.y,
            wreckColliderCount: wreck.length,
            wreckWidth: bounds.maxX - bounds.minX,
            wreckHeight: bounds.maxY - bounds.minY,
        };
    }, { mapScale: MAP_SCALE });

    expect(result.warningCount).toBe(0);
    expect(result.trackCount).toBe(3);
    expect(result.gateCount).toBe(4);
    expect(result.blockedSpawns).toBe(0);
    expect(result.before).toEqual({
        islandVisible: true,
        intactVisible: true,
        collapseVisible: false,
        liftVisible: true,
        beaconVisible: true,
    });
    expect(result.destroyed).toBe(true);
    expect(result.islandVisibleAfter).toBe(true);
    expect(result.intactVisibleAfter).toBe(false);
    expect(result.collapseVisibleAfter).toBe(true);
    expect(result.liftVisibleAfter).toBe(false);
    expect(result.beaconVisibleAfter).toBe(false);
    expect(result.collapseYaw).toBeCloseTo(0, 5);
    expect(result.wreckColliderCount).toBeGreaterThan(10);
    expect(result.wreckWidth).toBeGreaterThan(result.wreckHeight * 1.5);

    const collapsedPicture = await captureArena(page, {
        from: [190, 105, -175],
        to: [18, 28, 0],
    });
    for (const [name, picture] of [
        ['storm-lighthouse-intact', intactPicture],
        ['storm-lighthouse-collapsed', collapsedPicture],
    ]) {
        const screenshot = testInfo.outputPath(`${name}.png`);
        await writeFile(screenshot, Buffer.from(picture.split(',')[1], 'base64'));
        await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
});
