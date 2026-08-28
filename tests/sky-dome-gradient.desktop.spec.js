import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const MAP_KEYS = ['eiffel_tower', 'eiffel_tower_arena'];
const VIEWS = [
    { name: 'level', pitch: 0, roll: 0 },
    { name: 'raised', pitch: 0.18, roll: 0 },
    { name: 'banked', pitch: -0.1, roll: 0.55 },
];

async function startMap(page, mapKey) {
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
        (key) => window.GAME_INSTANCE?.arena?.currentMapKey === key,
        mapKey,
        { timeout: 120_000 }
    );
    await waitForRenderFrames(page, 8);
}

for (const mapKey of MAP_KEYS) {
    test(`${mapKey} renders its visible sky gradient per pixel without polygon edges`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const errors = collectErrors(page);
        await startMap(page, mapKey);

        const proof = await page.evaluate((views) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const three = runtime.renderer;
            const scene = runtime.scene;
            const camera = runtime.cameras[0];
            const skyDome = runtime._lightingRig?.skyDome;
            const starField = runtime._lightingRig?.starField;
            const width = three.domElement.width;
            const height = three.domElement.height;
            const gl = three.getContext();
            const restore = {
                matchVisible: runtime.matchRoot.visible,
                starsVisible: starField?.visible === true,
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
            };

            function analyze(frame) {
                let maxBend = 0;
                let hardBends = 0;
                let compared = 0;
                const minX = Math.floor(width * 0.08);
                const maxX = Math.ceil(width * 0.92);
                const minY = Math.floor(height * 0.08);
                const maxY = Math.ceil(height * 0.92);

                function channelBend(first, middle, last) {
                    return Math.max(
                        Math.abs(frame[first] - 2 * frame[middle] + frame[last]),
                        Math.abs(frame[first + 1] - 2 * frame[middle + 1] + frame[last + 1]),
                        Math.abs(frame[first + 2] - 2 * frame[middle + 2] + frame[last + 2])
                    );
                }

                for (let y = minY + 1; y < maxY - 1; y += 2) {
                    for (let x = minX + 1; x < maxX - 1; x += 2) {
                        const middle = (y * width + x) * 4;
                        const horizontal = channelBend(middle - 4, middle, middle + 4);
                        const vertical = channelBend(middle - width * 4, middle, middle + width * 4);
                        const bend = Math.max(horizontal, vertical);
                        maxBend = Math.max(maxBend, bend);
                        if (bend > 6) hardBends += 1;
                        compared += 1;
                    }
                }
                return {
                    maxBend,
                    hardBendRatio: hardBends / Math.max(1, compared),
                };
            }

            function sampleTopOrigin(frame, x, yFromTop) {
                const offset = ((height - 1 - yFromTop) * width + x) * 4;
                return [frame[offset], frame[offset + 1], frame[offset + 2]];
            }

            function render(view) {
                camera.position.set(0, 15, 0);
                camera.rotation.set(view.pitch, 0, view.roll, 'YXZ');
                camera.updateMatrixWorld(true);
                three.setRenderTarget(null);
                three.render(scene, camera);
                const frame = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
                return {
                    name: view.name,
                    metrics: analyze(frame),
                    center: sampleTopOrigin(frame, Math.floor(width / 2), Math.floor(height / 2)),
                    image: three.domElement.toDataURL('image/png'),
                };
            }

            runtime.matchRoot.visible = false;
            if (starField) starField.visible = false;
            const results = views.map(render);

            runtime.matchRoot.visible = restore.matchVisible;
            if (starField) starField.visible = restore.starsVisible;
            camera.position.copy(restore.position);
            camera.quaternion.copy(restore.quaternion);
            camera.updateMatrixWorld(true);

            const fogHex = scene.fog.color.getHex();
            return {
                isShaderMaterial: skyDome?.material?.isShaderMaterial === true,
                material: {
                    side: skyDome?.material?.side,
                    depthWrite: skyDome?.material?.depthWrite,
                    fog: skyDome?.material?.fog,
                    toneMapped: skyDome?.material?.toneMapped,
                },
                fogRgb: [(fogHex >> 16) & 255, (fogHex >> 8) & 255, fogHex & 255],
                results,
            };
        }, VIEWS);

        for (const result of proof.results) {
            await testInfo.attach(`${mapKey}-${result.name}.png`, {
                body: Buffer.from(result.image.split(',')[1], 'base64'),
                contentType: 'image/png',
            });
            delete result.image;
        }

        expect(proof.isShaderMaterial).toBe(true);
        expect(proof.material).toEqual({ side: 1, depthWrite: false, fog: false, toneMapped: false });
        for (const result of proof.results) {
            expect(
                result.metrics.hardBendRatio,
                `${mapKey}/${result.name} contains hard sky-gradient bends: ${JSON.stringify(result.metrics)}`
            ).toBeLessThan(0.0001);
        }
        const level = proof.results.find((entry) => entry.name === 'level');
        expect(level).toBeTruthy();
        expect(Math.max(...level.center.map((value, index) => Math.abs(value - proof.fogRgb[index])))).toBeLessThanOrEqual(2);
        expect(errors).toHaveLength(0);
    });
}
