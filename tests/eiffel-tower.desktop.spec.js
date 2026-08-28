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

test('the Eiffel Tower loads as one tower with its galleries open in the middle', async ({ page }, testInfo) => {
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

    const wallFade = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const runtime = game.renderer;
        const three = runtime.renderer;
        const camera = runtime.cameras[0];
        const width = three.domElement.width;
        const height = three.domElement.height;
        const gl = three.getContext();
        let wallMesh = null;
        runtime.matchRoot.traverse((object) => {
            if (object.isMesh && object.material?.defines?.ATMOSPHERIC_FOG_ALPHA_FADE === 1) {
                wallMesh = object;
            }
        });
        if (!wallMesh) throw new Error('Arena boundary wall mesh was not found');

        const original = {
            cameraPosition: camera.position.clone(),
            cameraQuaternion: camera.quaternion.clone(),
            defines: { ...wallMesh.material.defines },
            meshVisibility: [],
        };
        runtime.matchRoot.traverse((object) => {
            if (object.isMesh) {
                original.meshVisibility.push([object, object.visible]);
                object.visible = object === wallMesh;
            }
        });

        function capture({ fade, wallVisible }) {
            wallMesh.visible = wallVisible;
            if (fade) {
                wallMesh.material.defines.ATMOSPHERIC_FOG_ALPHA_FADE = 1;
            } else {
                delete wallMesh.material.defines.ATMOSPHERIC_FOG_ALPHA_FADE;
            }
            wallMesh.material.needsUpdate = true;
            three.setRenderTarget(null);
            three.render(runtime.scene, camera);
            const frame = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            return {
                frame,
                image: three.domElement.toDataURL('image/png'),
            };
        }

        function maxRgbDelta(first, second, offset) {
            return Math.max(
                Math.abs(first[offset] - second[offset]),
                Math.abs(first[offset + 1] - second[offset + 1]),
                Math.abs(first[offset + 2] - second[offset + 2])
            );
        }

        function analyze(production, knownBad, sky) {
            let transitionPixels = 0;
            let productionTransitionDelta = 0;
            let knownBadTransitionDelta = 0;
            let nearPixels = 0;
            let nearChanged = 0;
            const minY = Math.floor(height * 0.15);
            const maxY = Math.ceil(height * 0.85);
            for (let y = minY; y < maxY; y += 1) {
                for (let x = 0; x < width; x += 1) {
                    const offset = (y * width + x) * 4;
                    const knownBadDelta = maxRgbDelta(knownBad, sky, offset);
                    const productionDelta = maxRgbDelta(production, sky, offset);
                    if (knownBadDelta >= 4 && knownBadDelta <= 48) {
                        transitionPixels += 1;
                        knownBadTransitionDelta += knownBadDelta;
                        productionTransitionDelta += productionDelta;
                    } else if ((x <= width * 0.1 || x >= width * 0.9) && knownBadDelta >= 20) {
                        nearPixels += 1;
                        if (maxRgbDelta(production, knownBad, offset) > 2) nearChanged += 1;
                    }
                }
            }
            return {
                transitionPixels,
                transitionRatio: productionTransitionDelta / Math.max(1, knownBadTransitionDelta),
                nearPixels,
                nearChangedRatio: nearChanged / Math.max(1, nearPixels),
            };
        }

        let production;
        let knownBad;
        let sky;
        try {
            const bounds = game.arena.bounds;
            const cameraX = bounds.maxX - 48;
            const cameraY = bounds.maxY * 0.32;
            camera.position.set(cameraX, cameraY, 0);
            camera.lookAt(cameraX, cameraY, bounds.maxZ + 100);
            camera.updateMatrixWorld(true);
            knownBad = capture({ fade: false, wallVisible: true });
            production = capture({ fade: true, wallVisible: true });
            sky = capture({ fade: true, wallVisible: false });
        } finally {
            Object.assign(wallMesh.material.defines, original.defines);
            wallMesh.material.needsUpdate = true;
            for (const [object, visible] of original.meshVisibility) object.visible = visible;
            camera.position.copy(original.cameraPosition);
            camera.quaternion.copy(original.cameraQuaternion);
            camera.updateMatrixWorld(true);
        }

        return {
            define: original.defines.ATMOSPHERIC_FOG_ALPHA_FADE,
            metrics: analyze(production.frame, knownBad.frame, sky.frame),
            images: {
                knownBad: knownBad.image,
                production: production.image,
                sky: sky.image,
            },
        };
    });

    for (const [name, image] of Object.entries(wallFade.images)) {
        await testInfo.attach(`eiffel-wall-grazing-${name}.png`, {
            body: Buffer.from(image.split(',')[1], 'base64'),
            contentType: 'image/png',
        });
    }
    expect(wallFade.define).toBe(1);
    expect(wallFade.metrics.transitionPixels).toBeGreaterThan(100);
    expect(wallFade.metrics.transitionRatio).toBeLessThan(0.8);
    expect(wallFade.metrics.nearPixels).toBeGreaterThan(100);
    expect(wallFade.metrics.nearChangedRatio).toBeLessThan(0.02);

    await page.evaluate(() => window.GAME_INSTANCE?.returnToMenu?.());
});
