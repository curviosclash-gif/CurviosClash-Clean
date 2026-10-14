import { expect, test } from './helpers.desktop.js';
import * as THREE from 'three';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames, chooseFreePlayVariant } from './helpers.js';

let previousGraphicsStyle = null;
test.afterEach(async ({ page }) => {
    if (!previousGraphicsStyle) return;
    await page.evaluate((graphicsStyle) => {
        const game = window.GAME_INSTANCE;
        game.settings.localSettings.graphicsStyle = graphicsStyle;
        game.renderer.setGraphicsStyle(graphicsStyle);
        return game.runtimeFacade.onSettingsChanged({ changedKeys: ['local.graphicsStyle'] });
    }, previousGraphicsStyle);
    previousGraphicsStyle = null;
});

async function startNotreDame(page) {
    await waitForLoadedGame(page);
    previousGraphicsStyle = await page.evaluate(() => window.GAME_INSTANCE.renderer.getGraphicsStyle());
    await openCustomSubmenu(page);
    await chooseFreePlayVariant(page, 'ffa');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', 'notre_dame');
    await page.waitForFunction(
        () => window.GAME_INSTANCE?.settings?.mapKey === 'notre_dame',
        null,
        { timeout: 10_000 }
    );
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        game.settings.localSettings = {
            ...(game.settings.localSettings || {}),
            graphicsStyle: 'classic',
        };
        game.renderer.setGraphicsStyle('classic');
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(
        () => (
            window.GAME_INSTANCE?.arena?.currentMapKey === 'notre_dame'
            && window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 45
            && !window.GAME_INSTANCE?.arena?._glbLoadError
        ),
        null,
        { timeout: 150_000 }
    );
    await waitForRenderFrames(page, 20);
}

function decodePng(dataUrl) {
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test('near-wall flight keeps the Electron arena walls visually continuous @render', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await startNotreDame(page);

    const proof = await page.evaluate((doubleSide) => {
        const game = window.GAME_INSTANCE;
        const runtime = game.renderer;
        const three = runtime.renderer;
        const camera = runtime.cameras[0];
        const wallMaterial = game.arena._wallMat;
        const bounds = game.arena.bounds;
        const authoredWalls = game.arena.obstacles.filter((obstacle) => obstacle.isWall).length;
        const openFaces = [...game.arena.openFaces];
        // Notre-Dame now has open exclusion boundaries. Exercise the shared wall material on
        // actual closed-box geometry, otherwise both samples only render the same empty sky.
        const obstacleCount = game.arena.obstacles.length;
        const previousWallMesh = game.arena._mergedWallMesh;
        const pipeline = game.arena._builder.geometryPipeline;
        pipeline.compileWallStage({ sx: bounds.maxX - bounds.minX, sy: bounds.maxY,
            sz: bounds.maxZ - bounds.minZ, scale: runtime.getMapScale(), openFaces: [] });
        pipeline.flushMergeStage({ wallMat: wallMaterial });
        const fixtureWall = game.arena._mergedWallMesh;
        const wallGeometry = fixtureWall.geometry;
        const shadowAutoUpdate = three.shadowMap.autoUpdate;
        three.shadowMap.autoUpdate = false;
        const original = {
            side: wallMaterial.side,
            transparent: wallMaterial.transparent,
            opacity: wallMaterial.opacity,
            depthWrite: wallMaterial.depthWrite,
        };
        const views = [
            {
                name: 'north-wall-straight',
                from: [0, bounds.maxY * 0.28, bounds.maxZ - 18],
                to: [0, bounds.maxY * 0.28, bounds.maxZ + 20],
            },
            {
                name: 'north-east-corner',
                from: [bounds.maxX - 22, bounds.maxY * 0.28, bounds.maxZ - 22],
                to: [bounds.maxX + 15, bounds.maxY * 0.28, bounds.maxZ + 15],
            },
            {
                name: 'east-wall-grazing',
                from: [bounds.maxX - 12, bounds.maxY * 0.22, 45],
                to: [bounds.maxX + 12, bounds.maxY * 0.22, 105],
            },
        ];

        function analyze(frame) {
            const minX = Math.floor(three.domElement.width * 0.05);
            const maxX = Math.ceil(three.domElement.width * 0.95);
            const minY = Math.floor(three.domElement.height * 0.05);
            const maxY = Math.ceil(three.domElement.height * 0.95);
            let comparedPairs = 0;
            let moderateEdgePairs = 0;

            function compare(first, second) {
                const delta = Math.max(
                    Math.abs(frame[first] - frame[second]),
                    Math.abs(frame[first + 1] - frame[second + 1]),
                    Math.abs(frame[first + 2] - frame[second + 2])
                );
                comparedPairs += 1;
                // Normal lighting stays below this band, while the intended checker transitions
                // are stronger. The unwanted transparent triangle plates land between the two.
                if (delta >= 4 && delta <= 36) moderateEdgePairs += 1;
            }

            const width = three.domElement.width;
            for (let y = minY; y < maxY; y += 1) {
                for (let x = minX; x < maxX; x += 1) {
                    const index = (y * width + x) * 4;
                    if (x + 1 < maxX) compare(index, index + 4);
                    if (y + 1 < maxY) compare(index, index + width * 4);
                }
            }
            return {
                moderateEdgeRatio: moderateEdgePairs / Math.max(1, comparedPairs),
            };
        }

        function render(view, materialState) {
            Object.assign(wallMaterial, materialState);
            wallMaterial.needsUpdate = true;
            camera.position.set(...view.from);
            camera.lookAt(...view.to);
            camera.updateMatrixWorld(true);
            three.setRenderTarget(null);
            three.render(runtime.scene, camera);
            const gl = three.getContext();
            const frame = new Uint8Array(three.domElement.width * three.domElement.height * 4);
            gl.readPixels(
                0,
                0,
                three.domElement.width,
                three.domElement.height,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                frame
            );
            return {
                image: three.domElement.toDataURL('image/png'),
                metrics: analyze(frame),
                frame,
            };
        }

        function facingGeometry(view) {
            // Reference: the same UVs and positions, with only faces directed at this camera.
            // Keeping DoubleSide on this surface cannot add the closed boxes' hidden back layer.
            const positions = wallGeometry.getAttribute('position');
            const normals = wallGeometry.getAttribute('normal');
            const indices = wallGeometry.index;
            const facing = [];
            for (let offset = 0; offset < indices.count; offset += 3) {
                const a = indices.getX(offset);
                const b = indices.getX(offset + 1);
                const c = indices.getX(offset + 2);
                const x = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3;
                const y = (positions.getY(a) + positions.getY(b) + positions.getY(c)) / 3;
                const z = (positions.getZ(a) + positions.getZ(b) + positions.getZ(c)) / 3;
                if (normals.getX(a) * (view.from[0] - x)
                    + normals.getY(a) * (view.from[1] - y)
                    + normals.getZ(a) * (view.from[2] - z) > 0) facing.push(a, b, c);
            }
            const geometry = wallGeometry.clone();
            geometry.setIndex(facing);
            return geometry;
        }

        function differingPixels(actual, reference) {
            let count = 0;
            for (let offset = 0; offset < actual.length; offset += 4) {
                if (Math.max(Math.abs(actual[offset] - reference[offset]),
                    Math.abs(actual[offset + 1] - reference[offset + 1]),
                    Math.abs(actual[offset + 2] - reference[offset + 2])) > 1) count += 1;
            }
            return count;
        }

        const results = [];
        try {
            for (const view of views) {
                const knownBad = render(view, { ...original, side: doubleSide });
                const production = render(view, original);
                const referenceGeometry = facingGeometry(view);
                let reference;
                try {
                    fixtureWall.geometry = referenceGeometry;
                    reference = render(view, { ...original, side: doubleSide });
                } finally {
                    fixtureWall.geometry = wallGeometry;
                    referenceGeometry.dispose();
                }
                const singleLayer = {
                    knownBadDifferingPixels: differingPixels(knownBad.frame, reference.frame),
                    productionDifferingPixels: differingPixels(production.frame, reference.frame),
                    pixelCount: production.frame.length / 4,
                };
                delete knownBad.frame;
                delete production.frame;
                delete reference.frame;
                results.push({ name: view.name, knownBad, production, singleLayer });
            }
        } finally {
            Object.assign(wallMaterial, original);
            wallMaterial.needsUpdate = true;
            three.shadowMap.autoUpdate = shadowAutoUpdate;
            runtime.scene.remove(fixtureWall);
            fixtureWall.geometry.dispose();
            game.arena._mergedWallMesh = previousWallMesh;
            game.arena.obstacles.length = obstacleCount;
        }

        return {
            isElectron: globalThis.__CURVIOS_APP__ === true && globalThis.curviosApp?.isApp === true,
            bounds,
            authoredWalls,
            openFaces,
            original,
            results,
        };
    }, THREE.DoubleSide);

    for (const view of proof.results) {
        await testInfo.attach(`wall-${view.name}-known-bad.png`, {
            body: decodePng(view.knownBad.image),
            contentType: 'image/png',
        });
        await testInfo.attach(`wall-${view.name}-production.png`, {
            body: decodePng(view.production.image),
            contentType: 'image/png',
        });
        delete view.knownBad.image;
        delete view.production.image;
    }
    await testInfo.attach('wall-approach-material-proof.json', {
        body: Buffer.from(JSON.stringify(proof, null, 2)),
        contentType: 'application/json',
    });

    const liveProfiles = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.renderer;
        const authored = structuredClone(runtime.getMapLighting());
        const atmosphereColor = runtime.scene.fog.color.getHex();
        return {
            authored,
            mapScale: Number(runtime.getMapScale()) || 1,
            flat: {
                ...authored,
                fog: {
                    ...authored.fog,
                    color: atmosphereColor,
                    skyBlend: 0,
                },
                skyDome: {
                    zenithColor: atmosphereColor,
                    horizonColor: atmosphereColor,
                    nadirColor: atmosphereColor,
                },
            },
        };
    });

    async function poseLiveWallApproach(profile) {
        return page.evaluate(({ requestedProfile, mapScale }) => {
            const game = window.GAME_INSTANCE;
            const player = game.entityManager.players[0];
            const rig = game.renderer.cameraRigSystem;
            const bounds = game.arena.bounds;
            const wallMaterial = game.arena._wallMat;

            game.renderer.setMapLighting(requestedProfile, mapScale);
            wallMaterial.side = 0;
            wallMaterial.needsUpdate = true;
            player.position.set(bounds.maxX - 4, bounds.maxY * 0.28, 0);
            player.quaternion.setFromUnitVectors(
                player.position.clone().set(0, 0, -1),
                player.position.clone().set(0, 0, 1)
            );
            player.speed = 0;
            player.isBoosting = false;
            player.markRenderDiscontinuity('wall-approach-proof');
            player.view.syncFromState();
            rig.setCinematicEnabled(false);
            rig.cameraModes[0] = 0;
            rig.cameraSubjectInitialized[0] = false;
            game.entityManager.updateCameras(1 / 60, 1, true);
            game.renderer.render();
            return {
                player: player.position.toArray(),
                camera: rig.cameras[0].position.toArray(),
                side: wallMaterial.side,
            };
        }, { requestedProfile: profile, mapScale: liveProfiles.mapScale });
    }

    const liveKnownBad = await poseLiveWallApproach(liveProfiles.flat);
    await testInfo.attach('wall-live-flight-flat-classic-sky.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
    });
    const liveProduction = await poseLiveWallApproach(liveProfiles.authored);
    await testInfo.attach('wall-live-flight-production-gradient.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
    });
    expect(liveKnownBad.side).toBe(THREE.FrontSide);
    expect(liveProduction.side).toBe(THREE.FrontSide);
    expect(liveProduction.camera[2]).toBeLessThan(liveProduction.player[2]);

    console.log('NOTRE_DAME_WALL_APPROACH_PROOF', JSON.stringify(proof));
    expect(proof.isElectron).toBe(true);
    expect(proof.authoredWalls).toBe(0);
    expect(proof.openFaces.slice().sort()).toEqual(['maxX', 'maxY', 'maxZ', 'minX', 'minZ']);
    expect(proof.original).toEqual({
        side: THREE.FrontSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: true,
    });
    for (const view of proof.results) {
        expect(view.singleLayer.knownBadDifferingPixels,
            `${view.name}: positive control must expose the additional wall layer`).toBeGreaterThan(1000);
        expect(view.singleLayer.productionDifferingPixels,
            `${view.name}: production must equal one visible wall layer`).toBe(0);
    }
    expect(errors).toHaveLength(0);
});
