import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

// Whole-map screenshots retain the visual context. Assertions measure a uniform emissive surface:
// building silhouettes and textures must not masquerade as a fog edge. All coordinates are world
// units, including the last view above the scaled tower's antenna.
const VIEWPOINTS = [
    { name: '01-esplanade', from: [0, 12, 95], to: [0, 10, -140] },
    { name: '02-between-the-legs', from: [0, 40, 62], to: [0, 34, -150] },
    { name: '03-lower-lattice', from: [0, 72, 80], to: [0, 66, -170] },
    { name: '04-below-first-gallery', from: [0, 110, 120], to: [0, 104, -190] },
    { name: '05-above-first-gallery', from: [0, 150, 150], to: [0, 142, -200] },
    { name: '06-middle-lattice', from: [70, 205, 70], to: [0, 120, 0] },
    { name: '07-tower-from-afar', from: [0, 70, 195], to: [0, 110, -20] },
    { name: '08-looking-down', from: [0, 160, 40], to: [0, 20, -60] },
    { name: '09-above-the-antenna', from: [70, 650, 70], to: [0, 520, 0] },
];

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
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        document.getElementById('bot-count').value = '0';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(
        (key) => {
            const arena = window.GAME_INSTANCE?.arena;
            return arena?.currentMapKey === key && arena?._glbScene?.children?.length === 13
                && arena?._glbAnimation?.trackCount === 5 && !arena._glbLoadError;
        },
        mapKey,
        { timeout: 120_000 }
    );
    await waitForRenderFrames(page, 20);
}

for (const mapKey of ['eiffel_tower_arena', 'eiffel_tower']) {
    test(mapKey + ' spreads fog closure smoothly across distance at multiple heights', async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await startMap(page, mapKey);

        const measured = await page.evaluate((views) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const three = runtime.renderer;
            const camera = runtime.cameras[0];
            const gl = three.getContext();
            const authored = runtime.getMapLighting();
            const mapScale = runtime.getMapScale();
            const original = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
                matchVisible: runtime.matchRoot.visible,
                renderTarget: three.getRenderTarget(),
            };
            let floor = null;
            runtime.matchRoot.traverse((node) => {
                if (node.geometry?.type === 'PlaneGeometry' && node.material?.isMeshStandardMaterial) {
                    floor = node;
                }
            });
            if (!floor) throw new Error('No standard arena surface for the fog probe');

            // Reuse the arena's geometry/material classes and the production fog shader. Emission
            // provides a steady white reference at every distance, independent of shadow coverage.
            const probe = floor.clone(false);
            probe.matrixAutoUpdate = true;
            probe.geometry = new floor.geometry.constructor(8, 8);
            probe.material = new floor.material.constructor({
                color: 0x000000, emissive: 0xffffff, toneMapped: false, fog: true,
            });
            probe.quaternion.identity();
            probe.scale.setScalar(1);
            probe.castShadow = false;
            probe.receiveShadow = false;
            probe.visible = false;
            runtime.scene.add(probe);

            const pixel = new Uint8Array(4);
            const fractions = Array.from({ length: 32 }, (_, i) => 0.2 + i * 0.025);
            fractions.push(0.99); // Still before the clip plane: clipping must not fake full closure.
            const results = [];

            function applyClosure(start) {
                runtime.setMapLighting({
                    ...authored, fog: { ...authored.fog, clipClosureStart: start },
                }, mapScale);
            }

            function render() {
                three.setRenderTarget(null);
                three.render(runtime.scene, camera);
            }

            function luminance() {
                render();
                gl.readPixels(Math.floor(three.domElement.width / 2), Math.floor(three.domElement.height / 2),
                    1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                return (pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722) / 255;
            }

            function curve(start, height, sky) {
                applyClosure(start);
                probe.visible = true;
                const values = fractions.map((fraction) => {
                    probe.position.set(0, height, -camera.far * fraction);
                    return Math.abs(luminance() - sky);
                });
                const contrast = values[0];
                const normalized = values.map((value) => value / Math.max(0.001, contrast));
                return {
                    contrast,
                    values: normalized,
                    maxStep: Math.max(...normalized.slice(1).map((value, i) => Math.abs(value - normalized[i]))),
                    end: normalized.at(-1),
                };
            }

            try {
                for (const view of views) {
                    probe.visible = false;
                    runtime.matchRoot.visible = original.matchVisible;
                    camera.position.set(...view.from);
                    camera.lookAt(...view.to);
                    camera.updateMatrixWorld(true);
                    const images = {};
                    for (const [label, start] of [['late', 0.8], ['authored', authored.fog.clipClosureStart]]) {
                        applyClosure(start);
                        render();
                        images[label] = three.domElement.toDataURL('image/png');
                    }

                    runtime.matchRoot.visible = false;
                    camera.position.set(0, view.from[1], 0);
                    camera.lookAt(0, view.from[1], -1);
                    camera.updateMatrixWorld(true);
                    const sky = luminance();
                    const late = curve(0.8, view.from[1], sky);
                    const current = curve(authored.fog.clipClosureStart, view.from[1], sky);
                    results.push({ name: view.name, height: view.from[1], late, current, images });
                }
            } finally {
                runtime.scene.remove(probe);
                probe.geometry.dispose();
                probe.material.dispose();
                runtime.matchRoot.visible = original.matchVisible;
                camera.position.copy(original.position);
                camera.quaternion.copy(original.quaternion);
                camera.updateMatrixWorld(true);
                runtime.setMapLighting(authored, mapScale);
                three.setRenderTarget(original.renderTarget);
            }
            return { clipClosureStart: authored.fog.clipClosureStart, fractions, results };
        }, VIEWPOINTS);

        for (const view of measured.results) {
            for (const [label, dataUrl] of Object.entries(view.images)) {
                await testInfo.attach(view.name + '-' + label + '.png', {
                    body: Buffer.from(dataUrl.split(',')[1], 'base64'), contentType: 'image/png',
                });
            }
            delete view.images;
        }
        await testInfo.attach('fog-closure-curves', {
            body: JSON.stringify(measured, null, 2), contentType: 'application/json',
        });
        console.log('FOG_PROOF_' + mapKey, JSON.stringify(measured.results.map((view) => ({
            name: view.name, currentStep: view.current.maxStep, lateStep: view.late.maxStep,
            contrast: view.current.contrast, end: view.current.end,
        }))));

        for (const view of measured.results) {
            const message = view.name + ': ' + JSON.stringify(view);
            // A blank framebuffer or a surface already hidden by fog cannot prove smooth closure.
            expect(view.current.contrast, message).toBeGreaterThan(0.1);
            expect(view.late.contrast, message).toBeGreaterThan(0.1);
            expect(view.current.end, message).toBeLessThan(0.03);
            // No step may consume more than 13% of the surface/sky contrast over 2.5% of the range.
            expect(view.current.maxStep, message).toBeLessThan(0.13);
            // Above the dense ground layer, the old start must show a measurably sharper change.
            // This control also fails if the shader stops applying clipClosureStart altogether.
            if (view.height >= 150) {
                expect(view.late.maxStep, message).toBeGreaterThan(0.1);
                expect(view.current.maxStep, message).toBeLessThan(view.late.maxStep * 0.8);
            }
        }
        expect(errors).toHaveLength(0);
    });
}
