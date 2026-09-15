import { writeFile } from 'node:fs/promises';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

// Falkenwacht's surfaces get their variation from vertex colours: a per-element tint written by the
// generator, multiplied by baked ambient occlusion. None of that is visible to a contract test --
// the attribute can be present and correct while the renderer ignores it, and it can survive an
// export while a material change quietly stops applying it. So this renders the map from fixed
// viewpoints and counts the colours that actually reach the screen.
//
// The thresholds sit between the two states this was measured in, on 2026-09-07: flat materials
// gave 773 / 190 / 332 / 97 distinct shades across the four views, tints plus occlusion gave
// 1159 / 443 / 556 / 330. They are set near the lower end of the new numbers, so ordinary
// rendering drift does not fail the run but losing the vertex colours altogether does.
//
// Each viewpoint names its subject in the authored coordinates the generator draws in, and the
// camera offset in world units. The map runs at scale 3, so an authored offset would put the camera
// three times too far away -- past the 200 unit fog, where every view is the same grey.
const VIEWPOINTS = [
    // Gatehouse front: two masonry towers and the arch, the densest block work on the map.
    { name: '01-gatehouse', target: [0, 40, 118], offset: [0, 10, 110], minShades: 900 },
    // North curtain from outside: one long wall, the case where flat colour was most obvious.
    { name: '02-curtain-north', target: [0, 28, -118], offset: [0, 25, -105], minShades: 330 },
    // The keep, seen across the inner court.
    { name: '03-keep', target: [-64, 40, -78], offset: [30, 30, 110], minShades: 430 },
    // Close on the west curtain, where a single material fills the frame.
    { name: '04-wall-close', target: [-145, 28, 0], offset: [70, 8, 10], minShades: 240 },
];

// Of the 171 meshes in the loaded map, the ones carrying tints were 75 when this was written. The
// floor is well below that: a handful of meshes legitimately come back neutral and get their layer
// pruned at export, but a drop to near zero means the pipeline stopped writing colours.
const MIN_MESHES_WITH_COLOR = 55;

async function startMap(page, mapKey) {
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', mapKey);
    await page.waitForFunction(
        (key) => window.GAME_INSTANCE?.settings?.mapKey === key,
        mapKey,
        { timeout: 5000 }
    );
    await page.click('#btn-start');
    await page.waitForFunction(
        (key) => {
            const arena = window.GAME_INSTANCE?.arena;
            return arena?.currentMapKey === key
                && arena?._glbScene?.children?.length === 14 && !arena._glbLoadError;
        },
        mapKey,
        { timeout: 120_000 }
    );
    await waitForRenderFrames(page, 20);
}

test('falkenwacht surfaces carry measurable colour variation @render', async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await startMap(page, 'burg_falkenwacht_arena');

    const measured = await page.evaluate((views) => {
        const runtime = window.GAME_INSTANCE.renderer;
        const three = runtime.renderer;
        const camera = runtime.cameras[0];
        const gl = three.getContext();
        const width = three.domElement.width;
        const height = three.domElement.height;

        // The normaliser group under a slot carries exactly the placement scale the loader applied,
        // so this converts authored coordinates into world ones without hardcoding the map scale.
        const slot = runtime.scene.getObjectByName('glb-slot-falkenwacht-03_gatehouse');
        const scale = slot ? slot.children[0].scale.x : 1;

        // How many of the loaded meshes actually received a COLOR_0 stream. This separates "the
        // attribute is missing" from "the attribute is there but changes nothing on screen".
        let meshes = 0;
        let withColor = 0;
        let vertexColorMaterials = 0;
        runtime.scene.traverse((child) => {
            if (!child.isMesh) return;
            meshes += 1;
            if (child.geometry?.attributes?.color) withColor += 1;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            if (materials.some((material) => material?.vertexColors)) vertexColorMaterials += 1;
        });

        function luminance(pixels, index) {
            return (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255;
        }

        // The grain varies between elements, not inside one: a single block of masonry covers far
        // more than a few pixels and stays one flat value across itself. Measuring the deviation
        // inside a small window therefore reports zero whether the grain is there or not. These
        // three numbers look at the variation between surfaces instead.
        //  - shades: distinct colours after quantising to 64 steps per channel. A flat material
        //    reuses a handful of them across the whole frame; per-element tints multiply that.
        //  - spread: standard deviation of brightness over the entire frame.
        //  - blockSpread: standard deviation of the 16x16 block averages, so neighbouring stones
        //    reading differently counts and a smooth lighting gradient largely does not.
        function analyse() {
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            let sum = 0;
            let sumSquares = 0;
            let count = 0;
            const shades = new Set();
            for (let index = 0; index < pixels.length; index += 4) {
                const value = luminance(pixels, index);
                sum += value;
                sumSquares += value * value;
                count += 1;
                shades.add(
                    ((pixels[index] >> 2) << 12) | ((pixels[index + 1] >> 2) << 6) | (pixels[index + 2] >> 2)
                );
            }
            const mean = sum / count;

            const block = 16;
            const averages = [];
            for (let y = 0; y + block <= height; y += block) {
                for (let x = 0; x + block <= width; x += block) {
                    let blockSum = 0;
                    for (let dy = 0; dy < block; dy += 1) {
                        for (let dx = 0; dx < block; dx += 1) {
                            blockSum += luminance(pixels, ((y + dy) * width + (x + dx)) * 4);
                        }
                    }
                    averages.push(blockSum / (block * block));
                }
            }
            const blockMean = averages.reduce((total, value) => total + value, 0) / averages.length;
            const blockVariance = averages.reduce(
                (total, value) => total + (value - blockMean) ** 2, 0
            ) / averages.length;

            return {
                shades: shades.size,
                spread: Number(Math.sqrt(Math.max(0, sumSquares / count - mean * mean)).toFixed(5)),
                blockSpread: Number(Math.sqrt(blockVariance).toFixed(5)),
            };
        }

        const results = [];
        for (const view of views) {
            const target = view.target.map((value) => value * scale);
            camera.position.set(
                target[0] + view.offset[0],
                target[1] + view.offset[1],
                target[2] + view.offset[2],
            );
            camera.lookAt(target[0], target[1], target[2]);
            camera.updateMatrixWorld(true);
            three.setRenderTarget(null);
            three.render(runtime.scene, camera);
            results.push({
                name: view.name,
                ...analyse(),
                image: three.domElement.toDataURL('image/png'),
            });
        }

        return { scale, meshes, withColor, vertexColorMaterials, width, height, results };
    }, VIEWPOINTS);

    for (const view of measured.results) {
        const file = testInfo.outputPath(`grain-${view.name}.png`);
        await writeFile(file, Buffer.from(view.image.split(',')[1], 'base64'));
        await testInfo.attach(view.name, { path: file, contentType: 'image/png' });
        delete view.image;
    }

    console.log('GRAIN_PROOF', JSON.stringify(measured));

    // The materials have to actually apply the attribute. A mesh can carry COLOR_0 while its
    // material ignores it, and then nothing of this reaches a player.
    expect(measured.withColor).toBeGreaterThanOrEqual(MIN_MESHES_WITH_COLOR);
    expect(measured.vertexColorMaterials).toBe(measured.withColor);

    for (const view of measured.results) {
        const expected = VIEWPOINTS.find((entry) => entry.name === view.name);
        expect(
            view.shades,
            `${view.name} rendered ${view.shades} distinct shades, expected at least ${expected.minShades}`
        ).toBeGreaterThanOrEqual(expected.minShades);
    }
    expect(errors).toHaveLength(0);
});
