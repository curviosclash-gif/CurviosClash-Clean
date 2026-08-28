import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

// Two things about the fog can only be shown on a real GPU. First, that the patched three shader
// chunks actually compile and link - a broken chunk shows up as a console error and a black scene,
// never as a failing unit test. Second, that fogged geometry and the sky arrive at the same pixel
// value at the horizon. Everything else about the fog is covered by the contract tests.
//
// With the fog range collapsed, every visible surface renders as the pure fog colour: three mixes
// fog after tone mapping and uploads fogColor in the output colour space. The sky is untone-mapped
// for the same reason, so where the haze band puts the fog colour on the dome, both sides have to
// land on the same pixel. If they ever drift apart, the horizon becomes an edge again.
const MEASURE_SEAM = `
    const runtime = window.GAME_INSTANCE.renderer;
    const three = runtime.renderer;
    const scene = runtime.scene;
    const camera = runtime.cameras[0];
    const width = three.domElement.width;
    const height = three.domElement.height;

    const restore = {
        near: scene.fog.near,
        far: scene.fog.far,
        fogColor: scene.fog.color.getHex(),
        matchVisible: runtime.matchRoot.visible,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };

    // Collapsed range clamps the distance term to 1, and the sampled floor sits below the map's fog
    // base height so the height term is 1 too. The surface colour then stops mattering entirely and
    // only the fog colour is left on screen. The camera looks at the horizon, so the dome's equator -
    // where the haze band is at full strength - lands on the vertical centre of the image.
    scene.fog.near = 0;
    scene.fog.far = 1;
    camera.position.set(0, 15, 0);
    camera.lookAt(0, 15, -100);
    camera.updateMatrixWorld(true);

    const gl = three.getContext();
    const pixel = new Uint8Array(4);
    function sampleAt(fractionFromTop) {
        // readPixels counts rows from the bottom.
        gl.readPixels(
            Math.round(width / 2),
            Math.round(height * (1 - fractionFromTop)),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel
        );
        return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
    }
    function renderAndSample(fractionFromTop) {
        three.setRenderTarget(null);
        three.render(scene, camera);
        return sampleAt(fractionFromTop);
    }
    function maxDelta(a, b) {
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    }

    function measure() {
        runtime.matchRoot.visible = true;
        const fogged = renderAndSample(0.85);
        runtime.matchRoot.visible = false;
        // Just above the horizon line, where the haze band is at full strength.
        const sky = renderAndSample(0.492);
        return { fogged, sky, delta: maxDelta(fogged, sky) };
    }
`;

const RESTORE_SEAM = `
    scene.fog.near = restore.near;
    scene.fog.far = restore.far;
    scene.fog.color.setHex(restore.fogColor);
    runtime.matchRoot.visible = restore.matchVisible;
    camera.position.copy(restore.position);
    camera.quaternion.copy(restore.quaternion);
    camera.updateMatrixWorld(true);
    runtime.setMapLighting(runtime.getMapLighting());
`;

test('the patched fog shader compiles and the sky meets the fog without a seam', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);

    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'magma_maze');
    await page.waitForFunction(
        () => window.GAME_INSTANCE?.settings?.mapKey === 'magma_maze',
        null,
        { timeout: 5000 }
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
        () => window.GAME_INSTANCE?.arena?.currentMapKey === 'magma_maze',
        null,
        { timeout: 60_000 }
    );
    await waitForRenderFrames(page, 8);

    // The map's own profile has to arrive at the scene, not just sit in the preset.
    const applied = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.renderer;
        return {
            fogNear: runtime.scene.fog.near,
            fogFar: runtime.scene.fog.far,
            fogColor: runtime.scene.fog.color.getHex(),
            fogHeight: runtime.getMapLighting()?.fog?.height ?? null,
        };
    });
    expect(applied.fogNear).toBe(30);
    expect(applied.fogFar).toBe(130);
    // Not the authored 0x2a0c06: with skyBlend at 1 the distance fades into the map's own horizon.
    expect(applied.fogColor).toBe(0x6b2410);
    expect(applied.fogHeight).toBe(8);

    // Rendered proof plus its own control: repainting only the fog colour, without letting the sky
    // follow, is exactly the mismatch the haze band exists to prevent - so the same measurement has
    // to report a wide gap. Without that control a probe that always reads one colour would pass.
    const seam = await page.evaluate(`(() => {
        ${MEASURE_SEAM}
        const matched = measure();
        scene.fog.color.setHex(0x30c0ff);
        const mismatched = measure();
        ${RESTORE_SEAM}
        return { matched, mismatched };
    })()`);

    // The residual is the density field, not a seam: turbulence thins the fog by up to 30% locally,
    // so even a saturated distance term lets a few percent of the surface through. That is the
    // structure the fog is supposed to have. A real seam is an order of magnitude wider, which is
    // what the control below shows.
    expect(seam.matched.delta).toBeLessThan(0.05);
    expect(seam.mismatched.delta).toBeGreaterThan(0.5);

    // A shader that fails to compile or link surfaces here and nowhere else.
    expect(errors).toHaveLength(0);
});
