import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

// These are world coordinates: Notre-Dame's authored anchors are scaled by the runtime factor 3.
// The first two views look down the long nave, while the third deliberately puts the far floor below
// the horizon. That last view is the regression case where the old mirrored high colour became a
// black plate even though the map only asked for a black upper sky.
const VIEWPOINTS = Object.freeze([
    { name: 'nave-west', from: [-270, 24, 0], to: [180, 24, 0] },
    { name: 'nave-centre', from: [-80, 38, 0], to: [260, 38, 0] },
    { name: 'looking-down', from: [-80, 82, 42], to: [130, 12, 0] },
    { name: 'west-exterior', from: [-340, 55, 95], to: [-240, 75, 0] },
]);

const MAP_KEYS = ['notre_dame', 'notre_dame_arena'];

async function startNotreDame(page, mapKey) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', mapKey);
    await page.waitForFunction(
        (key) => window.GAME_INSTANCE?.settings?.mapKey === key,
        mapKey,
        { timeout: 10_000 }
    );
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(
        (key) => (
            window.GAME_INSTANCE?.arena?.currentMapKey === key
            && window.GAME_INSTANCE?.arena?._glbScene?.children?.length === 47
            && !window.GAME_INSTANCE?.arena?._glbLoadError
        ),
        mapKey,
        { timeout: 150_000 }
    );
    await waitForRenderFrames(page, 20);
}

function decodePng(dataUrl) {
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

for (const mapKey of MAP_KEYS) {
    test(`${mapKey} keeps distant darkness atmospheric in the Electron app @render`, async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        const errors = collectErrors(page);
        await startNotreDame(page, mapKey);

        const proof = await page.evaluate((views) => {
            const game = window.GAME_INSTANCE;
            const runtime = game.renderer;
            const three = runtime.renderer;
            const camera = runtime.cameras[0];
            const gl = three.getContext();
            const width = three.domElement.width;
            const height = three.domElement.height;
            const authored = structuredClone(runtime.getMapLighting());
            const mapScale = Number(runtime.getMapScale()) || 1;

            // This is the exact visual failure mode the production profile must beat: no height
            // separation, black at both elevation ends, and no pull towards the authored sky.
            const knownBad = {
                ...authored,
                fog: {
                    ...authored.fog,
                    heightFalloff: 0,
                    skyBlend: 0,
                    colorHigh: 0x000000,
                    colorLow: 0x000000,
                },
                skyDome: {
                    zenithColor: 0x000000,
                    horizonColor: 0x120302,
                    nadirColor: 0x000000,
                },
            };

            function analyze(frame) {
                const minX = Math.floor(width * 0.08);
                const maxX = Math.ceil(width * 0.92);
                const minY = Math.floor(height * 0.08);
                const maxY = Math.ceil(height * 0.9);
                let pixels = 0;
                let nearBlack = 0;
                let flatDarkPairs = 0;
                let lumaSum = 0;
                let lumaSquaredSum = 0;
                const colourBins = new Set();

                for (let y = minY; y < maxY; y += 1) {
                    for (let x = minX; x < maxX; x += 1) {
                        const index = (y * width + x) * 4;
                        const r = frame[index];
                        const g = frame[index + 1];
                        const b = frame[index + 2];
                        const peak = Math.max(r, g, b);
                        const luma = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
                        pixels += 1;
                        if (peak <= 18) nearBlack += 1;
                        lumaSum += luma;
                        lumaSquaredSum += luma * luma;
                        colourBins.add(`${r >> 4}:${g >> 4}:${b >> 4}`);

                        if (x + 1 >= maxX || peak > 40) continue;
                        const next = index + 4;
                        const nextPeak = Math.max(frame[next], frame[next + 1], frame[next + 2]);
                        if (nextPeak > 40) continue;
                        const delta = Math.max(
                            Math.abs(r - frame[next]),
                            Math.abs(g - frame[next + 1]),
                            Math.abs(b - frame[next + 2])
                        );
                        if (delta <= 2) flatDarkPairs += 1;
                    }
                }

                const mean = lumaSum / pixels;
                return {
                    nearBlackRatio: Number((nearBlack / pixels).toFixed(5)),
                    flatDarkRatio: Number((flatDarkPairs / pixels).toFixed(5)),
                    lumaVariance: Number(Math.max(0, lumaSquaredSum / pixels - mean * mean).toFixed(6)),
                    colourBins: colourBins.size,
                };
            }

            function render(profile) {
                runtime.setMapLighting(profile, mapScale);
                three.setRenderTarget(null);
                three.render(runtime.scene, camera);
                const frame = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
                return {
                    metrics: analyze(frame),
                    image: three.domElement.toDataURL('image/png'),
                };
            }

            const results = [];
            try {
                game.arena.setGlbAnimationElapsedSeconds?.(0);
                game.arena.update?.(0);
                for (const view of views) {
                    camera.position.set(...view.from);
                    camera.lookAt(...view.to);
                    camera.updateMatrixWorld(true);
                    results.push({
                        name: view.name,
                        before: render(knownBad),
                        after: render(authored),
                    });
                }
            } finally {
                runtime.setMapLighting(authored, mapScale);
            }

            return {
                isElectron: globalThis.__CURVIOS_APP__ === true && globalThis.curviosApp?.isApp === true,
                mapScale,
                authoredFog: authored.fog,
                results,
            };
        }, VIEWPOINTS);

        for (const view of proof.results) {
            await testInfo.attach(`${mapKey}-${view.name}-known-bad.png`, {
                body: decodePng(view.before.image),
                contentType: 'image/png',
            });
            await testInfo.attach(`${mapKey}-${view.name}-production.png`, {
                body: decodePng(view.after.image),
                contentType: 'image/png',
            });
            delete view.before.image;
            delete view.after.image;
        }
        await testInfo.attach(`${mapKey}-atmosphere-metrics.json`, {
            body: Buffer.from(JSON.stringify(proof, null, 2)),
            contentType: 'application/json',
        });

        const regressionViews = proof.results.filter((view) => (
            view.name === 'nave-centre' || view.name === 'west-exterior'
        ));
        const lookingDown = proof.results.find((view) => view.name === 'looking-down');
        const mean = (side, metric) => regressionViews.reduce(
            (sum, view) => sum + view[side].metrics[metric],
            0
        ) / regressionViews.length;
        const beforeNearBlack = mean('before', 'nearBlackRatio');
        const afterNearBlack = mean('after', 'nearBlackRatio');
        const beforeFlatDark = mean('before', 'flatDarkRatio');
        const afterFlatDark = mean('after', 'flatDarkRatio');

        console.log('NOTRE_DAME_ATMOSPHERE_PROOF', JSON.stringify({ mapKey, proof }));
        expect(proof.isElectron).toBe(true);
        expect(proof.authoredFog.colorLow).toBe(0x260e0f);
        expect(proof.authoredFog.heightFalloff).toBeGreaterThan(0);
        expect(proof.authoredFog.skyBlend).toBeGreaterThan(0);
        expect(afterNearBlack).toBeLessThan(beforeNearBlack * 0.8);
        expect(afterFlatDark).toBeLessThan(beforeFlatDark * 0.85);
        expect(lookingDown.after.metrics.flatDarkRatio).toBeLessThan(
            lookingDown.before.metrics.flatDarkRatio * 0.75
        );
        expect(errors).toHaveLength(0);
    });
}
