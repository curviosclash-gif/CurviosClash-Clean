import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { writeFile } from 'node:fs/promises';

// What the fire actually changed about flying this building, measured in the running app rather
// than argued from the model files.
//
// The map runs in glbColliderMode 'scene', so the drawn surface is the collision. On the intact
// cathedral the lead roof slopes are solid and close over the attic from both sides, leaving only
// a narrow slot along the ridge -- itself a decorative mesh -- to drop through. Burning the roof
// away is what opens the whole length of the building from above, and that is the assertion below.
//
// The vault was never solid on either map: its ribs and web are decorative meshes. The breaches
// are therefore not a new route, they are what finally makes an existing one readable. This test
// records that too, so nobody later "fixes" the open vault into a wall.
//
// Coordinates are authored units, the same space the preset writes, multiplied by the map scale of
// three on the way into the collision query. The nave centre line is x -34.65, the crossing x 17.15.

const MAP_SCALE = 3;
const NAVE_X = -34.65;
const CROSSING_X = 17.15;

async function startFireArena(page) {
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
        && window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 53
        && !window.GAME_INSTANCE?.arena?._glbLoadError
    )), {
        timeout: 150_000,
        message: 'four surviving fabric parts, four burnt ones and 32 shared trees; fire is particle-only',
    }).toBeTruthy();
}

// One test, not two. A desktop run keeps a single window and loading this cathedral is the
// expensive part, so both questions are asked of the same loaded arena. Splitting them cost a
// second full load of sixteen parts and timed the harness out on teardown under cluster load.
test('the fire opens the roof and puts the spire on the floor', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await startFireArena(page);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.arena.setGlbAnimationElapsedSeconds(310);
        game.entityManager._mapDestructibleSystem.updateFeedback();
        game.arena.setGlbAnimationElapsedSeconds(310);
    });

    const roof = await page.evaluate(({ scale, naveX }) => {
        const arena = window.GAME_INSTANCE.arena;
        const solid = (x, y, z) => arena.checkCollisionFast(
            { x: x * scale, y: y * scale, z: z * scale }, 0.1
        );
        // The exact points where the intact map's roof slopes are solid, measured beforehand:
        // the slope walks inward as it climbs, from z +-14 at y 58 to z +-6 at y 70.
        const roofLine = [
            [58, 14], [58, -14], [60, 12], [60, -12],
            [64, 10], [64, -10], [66, 8], [66, -8], [70, 6], [70, -6],
        ];
        const vaultLine = [[52, 0], [54, 0], [56, 0], [54, 6], [54, -6]];
        return {
            roofSolidCount: roofLine.filter(([y, z]) => solid(naveX, y, z)).length,
            vaultSolidCount: vaultLine.filter(([y, z]) => solid(naveX, y, z)).length,
            // Something must still be up there, or the timbers failed to export.
            fallenTimberFound: [-30, -26, -22, 20, 24].some((x) => (
                [55, 56, 57].some((y) => [-6, -3, 0, 3, 6].some((z) => solid(x, y, z)))
            )),
        };
    }, { scale: MAP_SCALE, naveX: NAVE_X });

    // Every one of the ten roof points was solid on the intact building. None may be now.
    expect(roof.roofSolidCount).toBe(0);
    // The vault was already open and stays open; the breaches only make that visible.
    expect(roof.vaultSolidCount).toBe(0);
    // The timbers that fell onto the vault back are real obstacles in the attic.
    expect(roof.fallenTimberFound).toBe(true);

    const crossing = await page.evaluate(({ scale, crossingX }) => {
        const arena = window.GAME_INSTANCE.arena;
        const solid = (x, y, z) => arena.checkCollisionFast(
            { x: x * scale, y: y * scale, z: z * scale }, 0.1
        );
        const debrisRing = [];
        for (let index = 0; index < 12; index += 1) {
            const angle = (index / 12) * Math.PI * 2;
            debrisRing.push([
                crossingX + 5 * Math.cos(angle),
                11,
                5 * Math.sin(angle),
            ]);
        }
        return {
            debrisSolidCount: debrisRing.filter(([x, y, z]) => solid(x, y, z)).length,
            // The crossing checkpoint of the parcours route sits here. The pile is 13 units tall
            // and must stay well clear of it.
            routeHeightClear: !solid(crossingX, 38, 0),
            aboveDebrisClear: !solid(crossingX, 26, 0),
        };
    }, { scale: MAP_SCALE, crossingX: CROSSING_X });

    expect(crossing.debrisSolidCount).toBeGreaterThan(0);
    expect(crossing.routeHeightClear).toBe(true);
    expect(crossing.aboveDebrisClear).toBe(true);

    const atmosphere = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const fx = arena._builder.fireFxController;
        const hazards = arena._builder.mapHazardVisualController;
        const crossingLight = fx.lightTracks.find((entry) => (
            entry.light?.userData?.authoredLightId === 'ndf_crossing_breach'
        ));
        arena.setGlbAnimationElapsedSeconds(300);
        const smokeAtStart = Array.from(fx.layers.smoke.positions.slice(0, 12));
        const lightAtStart = crossingLight?.light?.intensity || 0;
        const telegraphAtStart = hazards.visuals[0]?.mesh?.visible === true;
        arena.setGlbAnimationElapsedSeconds(303.5);
        return {
            fireLayerNames: fx.group.children.map((child) => child.name),
            emberCount: fx.layers.embers.positions.length / 3,
            smokeMoved: smokeAtStart.some((value, index) => (
                Math.abs(value - fx.layers.smoke.positions[index]) > 0.001
            )),
            lightMoved: Math.abs(lightAtStart - (crossingLight?.light?.intensity || 0)) > 0.001,
            hazardCount: hazards.visuals.length,
            telegraphAtStart,
            firstHazardActiveColor: hazards.visuals[0]?.material?.color?.getHex?.() || 0,
            firstHazardExpectedColor: hazards.visuals[0]?.hazard?.activeColor || 0,
        };
    });
    expect(atmosphere.fireLayerNames).toEqual([
        'map-fire-smoke',
        'map-fire-embers',
        'map-fire-ash',
    ]);
    expect(atmosphere.emberCount).toBe(128);
    expect(atmosphere.smokeMoved).toBe(true);
    expect(atmosphere.lightMoved).toBe(true);
    expect(atmosphere.hazardCount).toBe(4);
    expect(atmosphere.telegraphAtStart).toBe(true);
    expect(atmosphere.firstHazardActiveColor).toBe(atmosphere.firstHazardExpectedColor);
    const dynamicsImage = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.renderer;
        const camera = runtime.cameras[0];
        camera.position.set(0, 140, 230);
        camera.lookAt(0, 105, 0);
        camera.far = 2000;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        runtime.renderer.setRenderTarget(null);
        runtime.renderer.render(runtime.scene, camera);
        return runtime.renderer.domElement.toDataURL('image/png');
    });
    const dynamicsScreenshot = testInfo.outputPath('notre-dame-fire-dynamics.png');
    await writeFile(dynamicsScreenshot, Buffer.from(dynamicsImage.split(',')[1], 'base64'));
    await testInfo.attach('notre-dame-fire-dynamics.png', {
        path: dynamicsScreenshot,
        contentType: 'image/png',
    });
});
