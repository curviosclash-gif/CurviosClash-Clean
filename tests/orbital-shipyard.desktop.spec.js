import { writeFileSync } from 'node:fs';

import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Thirteen parts modelled in one shared frame only form a station if the loader puts each back on
// the centre it was exported from. A part that lands a few units off still passes every node test
// but closes the hull's flight channel or floats the airlock above its own floor, so the probes
// below sample geometry that only exists where the parts line up: solid where the layout builds
// structure, open where the route flies.

// World units are authored units times the map scale of 3.
const SCALE = 3;

test('the Orbital Shipyard loads all thirteen parts with its flight channels open', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    // The first test of a run pays for the app's cold start; 5 s was not always enough there.
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 15_000 });
    await page.selectOption('#map-select', 'orbital_shipyard');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'orbital_shipyard'
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
        window.GAME_INSTANCE?.arena?.currentMapKey === 'orbital_shipyard'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 5
    )), {
        timeout: 150_000,
        message: 'the station should load and animate its five machines',
    }).toBeTruthy();

    const state = await page.evaluate((scale) => {
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
            glbSceneChildren: arena._glbScene?.children?.length || 0,
            // The deck under everything, and the launch bay's closed back wall.
            deckSolid: at(0, 1.5, 0),
            launchBayBackSolid: at(-175, 40, 110),
            launchBayInsideOpen: !at(-150, 40, 110),
            // The rib cage is hollow along its axis: that channel is the route.
            hullAxisOpen: !at(30, 38, 20) && !at(30, 30, -40),
            // The airlock floor slab and the roof slab that doubles as the duct floor.
            airlockFloorSolid: at(95, 24, -123),
            airlockRoofSolid: at(70, 63.5, -123),
            ductOpen: !at(90, 80, -110),
            // The tower core at mid height, and open sky above its tip where the summit ring hangs.
            towerCoreSolid: at(125, 60, -15),
            aboveTowerOpen: !at(125, 142, -15),
            // The fuel canyon floor, and its channel between two piston stations.
            canyonFloorSolid: at(128, 8.5, 115),
        };
    }, SCALE);

    expect(state).toEqual({
        mapKey: 'orbital_shipyard',
        trackCount: 5,
        warningCount: 0,
        colliderMode: 'scene',
        glbSceneChildren: 13,
        deckSolid: true,
        launchBayBackSolid: true,
        launchBayInsideOpen: true,
        hullAxisOpen: true,
        airlockFloorSolid: true,
        airlockRoofSolid: true,
        ductOpen: true,
        towerCoreSolid: true,
        aboveTowerOpen: true,
        canyonFloorSolid: true,
    });

    // What a pilot sees from four rings, looking down the next leg.
    const views = await page.evaluate((scale) => {
        const runtime = window.GAME_INSTANCE.renderer;
        const three = runtime.renderer;
        const camera = runtime.cameras[0];
        const originalPosition = camera.position.clone();
        const originalQuaternion = camera.quaternion.clone();
        const legs = {
            'launch-bay': [[-150, 42, 110], [-65, 58, 75]],
            'hull-bow': [[5, 48, 95], [30, 38, 20]],
            'airlock-split': [[20, 70, -128], [87, 45, -110]],
            'tower-helix': [[178, 58, -60], [125, 90, -15]],
            'canyon-dive': [[170, 70, 60], [102, 30, 115]],
        };
        const captures = {};
        try {
            for (const [name, [position, target]] of Object.entries(legs)) {
                camera.position.set(...position.map((value) => value * scale));
                camera.lookAt(...target.map((value) => value * scale));
                camera.updateMatrixWorld(true);
                three.setRenderTarget(null);
                three.render(runtime.scene, camera);
                captures[name] = three.domElement.toDataURL('image/png');
            }
        } finally {
            camera.position.copy(originalPosition);
            camera.quaternion.copy(originalQuaternion);
            camera.updateMatrixWorld(true);
        }
        return captures;
    }, SCALE);
    for (const [name, image] of Object.entries(views)) {
        const outputPath = testInfo.outputPath(`orbital-shipyard-${name}.png`);
        writeFileSync(outputPath, Buffer.from(image.split(',')[1], 'base64'));
        await testInfo.attach(`orbital-shipyard-${name}.png`, { path: outputPath });
    }

    await page.evaluate(() => window.GAME_INSTANCE?.returnToMenu?.());
});
