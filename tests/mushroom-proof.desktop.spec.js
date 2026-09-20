import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const SHOT_DIR = path.resolve('test-results/mushroom-proof');

// Whether the mushrooms are actually visible in the running game.
//
// The contract tests hold positions, clearances, the emission band and the direction the glowing
// surfaces face. None of them can answer this question, and one of them was measured against the
// files and still missed it: the trumpet mushrooms carried their whole glow on the inner wall of
// their funnel, which every geometric measure counted as outward-facing surface and which the
// game rendered as nine black silhouettes standing in a lit cellar. What the file cannot show is
// occlusion - a surface pointing at the viewer through the far side of its own model is not
// visible, and only a renderer knows that.
//
// So the measurement happens here, in the real renderer, with the real tone mapping and the real
// map lighting: the same view is rendered twice, once as authored and once with the mushrooms'
// emission set to zero, and the difference is exactly what the glow contributes to the picture.
// Bloom is off by default, so this is also the worst case rather than a flattering one.
//
// Views are in world units: the maps author in map units and the runtime scales them, so every
// coordinate below is an authored position multiplied by the map's own scale.
// Which clump to look at on each map, by the id prefix the preset gave it. The camera is not
// written out here: map scales differ (Crystal Ruins renders at 1, Verdant Aperture at 3) and
// authored coordinates are not world coordinates, so a hand-written viewpoint is a guess that
// silently looks at empty floor. The test finds the clump in the live scene and frames it.
const SUBJECTS = {
    crystal_ruins: ['crystal-ruins-fungus-southwest', 'crystal-ruins-fungus-northeast'],
    verdant_aperture: ['verdant-aperture-fungus-west', 'verdant-aperture-fungus-east'],
};

async function startMap(page, mapKey) {
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', mapKey);
    await page.waitForFunction((key) => window.GAME_INSTANCE?.settings?.mapKey === key, mapKey,
        { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        document.getElementById('bot-count').value = '0';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction((key) => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?.currentMapKey === key
            && arena?._glbScene?.children?.length === arena?.currentMapDefinition?.glbModels?.length
            && !arena._glbLoadError;
    }, mapKey, { timeout: 120_000 });
    await waitForRenderFrames(page, 20);
}

for (const [mapKey, subjects] of Object.entries(SUBJECTS)) {
    test(`${mapKey} shows its mushrooms lit and standing @render`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await startMap(page, mapKey);

        const report = await page.evaluate(async (subjectList) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const three = runtime.renderer;
            const camera = runtime.cameras[0];
            const scale = runtime.getMapScale();
            const original = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
            };

            // What the map actually placed, read off the live scene rather than off the preset.
            const placed = [];
            const slots = [];
            let emissiveMeshes = 0;
            let colliderMeshes = 0;
            runtime.matchRoot.traverse((node) => {
                const url = node.userData?.glbModelUrl;
                if (typeof url === 'string' && url.includes('glowing_mushroom')) {
                    placed.push({ id: node.userData.glbModelId, url });
                    slots.push(node);
                }
                if (!node.isMesh) return;
                const name = String(node.name || '').toLowerCase();
                if (!name.includes('mushroom')) return;
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                if (materials.some((m) => (m?.emissiveIntensity ?? 0) > 0
                    && m?.emissive?.getHex?.() !== 0x000000)) emissiveMeshes += 1;
                if (!name.includes('_nocol')) colliderMeshes += 1;
            });

            // Every glowing mushroom material, so the light can be switched off and back on.
            const glowMaterials = [];
            runtime.matchRoot.traverse((node) => {
                if (!node.isMesh) return;
                if (!String(node.name || '').toLowerCase().includes('mushroom')) return;
                for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                    if ((material?.emissiveIntensity ?? 0) > 0
                        && material.emissive?.getHex?.() !== 0x000000) {
                        glowMaterials.push({ material, intensity: material.emissiveIntensity });
                    }
                }
            });

            const gl = three.getContext();
            const width = three.domElement.width;
            const height = three.domElement.height;
            const buffer = new Uint8Array(width * height * 4);
            function renderAndRead() {
                three.setRenderTarget(null);
                three.render(runtime.scene, camera);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
                return buffer.slice();
            }

            // Frame each clump from where its models actually ended up. World positions come
            // straight out of each slot's matrix, so this needs no THREE in page scope and no
            // assumption about the map's scale - which is the whole point, since Crystal Ruins
            // renders at scale 1 and Verdant Aperture at 3, and a hand-written viewpoint that
            // ignores that looks at empty floor.
            function frameFor(prefix) {
                const points = slots
                    .filter((slot) => String(slot.userData.glbModelId || '').startsWith(prefix))
                    .map((slot) => {
                        slot.updateWorldMatrix(true, false);
                        const m = slot.matrixWorld.elements;
                        return [m[12], m[13], m[14]];
                    });
                if (points.length === 0) return null;
                const lo = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis])));
                const hi = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis])));
                const centre = [0, 1, 2].map((axis) => (lo[axis] + hi[axis]) / 2);
                // The spread of the anchors plus room for the models standing on them.
                const spread = Math.max(hi[0] - lo[0], hi[2] - lo[2], 6);
                const offset = spread * 1.5;
                return {
                    from: [centre[0] + offset * 0.62, centre[1] + spread * 0.7, centre[2] + offset * 0.78],
                    to: [centre[0], centre[1] + spread * 0.18, centre[2]],
                    spread,
                    centre,
                };
            }

            const shots = [];
            for (const prefix of subjectList) {
                const view = frameFor(prefix);
                if (!view) {
                    shots.push({ name: prefix, missing: true });
                    continue;
                }
                camera.position.set(...view.from);
                camera.lookAt(...view.to);
                camera.updateMatrixWorld(true);
                const lit = renderAndRead();
                const data = three.domElement.toDataURL('image/png');
                for (const entry of glowMaterials) entry.material.emissiveIntensity = 0;
                const dark = renderAndRead();
                for (const entry of glowMaterials) entry.material.emissiveIntensity = entry.intensity;

                // How much of the frame the glow actually lights up, and by how much. A pixel
                // counts as lit when the emission moved it by more than a tenth of the range,
                // which is well above the renderer's own frame-to-frame noise.
                let litPixels = 0;
                let brightest = 0;
                let saturationSum = 0;
                let washedOut = 0;
                for (let index = 0; index < lit.length; index += 4) {
                    const delta = Math.max(lit[index] - dark[index],
                        lit[index + 1] - dark[index + 1], lit[index + 2] - dark[index + 2]);
                    if (delta > brightest) brightest = delta;
                    if (delta <= 25) continue;
                    litPixels += 1;
                    // How much colour survived. This is the measurement the project keeps
                    // relearning: emission the tone map saturates to white loses exactly the
                    // hue that made it read as a glow, and the pixel is bright but colourless.
                    const high = Math.max(lit[index], lit[index + 1], lit[index + 2]);
                    const low = Math.min(lit[index], lit[index + 1], lit[index + 2]);
                    const saturation = high > 0 ? (high - low) / high : 0;
                    saturationSum += saturation;
                    if (saturation < 0.25) washedOut += 1;
                }
                shots.push({
                    name: prefix,
                    data,
                    litShare: litPixels / (width * height),
                    brightest,
                    saturation: litPixels > 0 ? saturationSum / litPixels : 0,
                    washedOutShare: litPixels > 0 ? washedOut / litPixels : 0,
                    centre: view.centre.map((value) => Math.round(value * 10) / 10),
                    spread: Math.round(view.spread * 10) / 10,
                });
            }
            camera.position.copy(original.position);
            camera.quaternion.copy(original.quaternion);
            camera.updateMatrixWorld(true);
            return {
                placed, emissiveMeshes, colliderMeshes, mapScale: scale, shots,
                glowMaterials: glowMaterials.length,
            };
        }, subjects);

        await mkdir(SHOT_DIR, { recursive: true });
        for (const shot of report.shots) {
            expect(shot.missing, `${shot.name} was found in the live scene`).toBeFalsy();
            const body = Buffer.from(shot.data.split(',')[1], 'base64');
            await testInfo.attach(`${shot.name}.png`, { body, contentType: 'image/png' });
            // Also written as a plain file: an attachment only exists inside the report, and
            // this proof is meant to be looked at.
            await writeFile(path.join(SHOT_DIR, `${mapKey}-${shot.name}.png`), body);
        }

        expect(report.placed.length, 'mushrooms reached the live scene').toBeGreaterThan(0);
        expect(report.emissiveMeshes, 'their glowing material survived the load').toBeGreaterThan(0);
        expect(report.colliderMeshes, 'nothing of them can be collided with').toBe(0);
        expect(errors.filter((line) => /mushroom|glowing/i.test(line))).toEqual([]);

        for (const shot of report.shots) {
            // eslint-disable-next-line no-console
            console.log(`[mushroom-proof] ${mapKey} ${shot.name}: `
                + `lit=${(shot.litShare * 100).toFixed(2)}% peak=${shot.brightest} `
                + `saturation=${shot.saturation.toFixed(2)} `
                + `white=${(shot.washedOutShare * 100).toFixed(1)}% `
                + `at ${shot.centre.join('/')} spread=${shot.spread}`);
            // The thresholds are the point of this test. A mushroom whose glow is hidden behind
            // its own geometry moves no pixel at all, which is exactly what the trumpets did
            // before their outer bell wall was lit.
            expect(shot.brightest,
                `${shot.name}: the glow changes the picture`).toBeGreaterThan(40);
            expect(shot.litShare,
                `${shot.name}: the glow covers a readable part of the frame`).toBeGreaterThan(0.001);
            // And the other failure mode: bright but colourless. Emission the tone map pushes
            // to white is the mistake that turned the Notre-Dame flames into pale cones, and it
            // only shows against a map's own lighting, which is why it is measured here.
            expect(shot.washedOutShare,
                `${shot.name}: the glow keeps its colour instead of clipping to white`)
                .toBeLessThan(0.25);
        }
        // eslint-disable-next-line no-console
        console.log(`[mushroom-proof] ${mapKey}: placed=${report.placed.length} `
            + `emissive=${report.emissiveMeshes} collidable=${report.colliderMeshes} `
            + `glowMaterials=${report.glowMaterials} mapScale=${report.mapScale}`);
    });
}
