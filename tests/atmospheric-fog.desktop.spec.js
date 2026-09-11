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
        mapLighting: runtime.getMapLighting(),
        mapScale: runtime._mapScale,
        fogColor: scene.fog.color.getHex(),
        matchVisible: runtime.matchRoot.visible,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };

    // Isolate the seam from the map's intentional height and turbulence structure. A saturated
    // layer makes the sampled surface pure fog colour, so this probe measures only whether that
    // colour meets the dome at the horizon.
    runtime.setMapLighting({
        ...restore.mapLighting,
        fog: {
            ...restore.mapLighting.fog,
            height: 200,
            heightFalloff: 0,
            turbulence: 0,
        },
    }, restore.mapScale);

    // Collapsed range clamps the distance term to 1. The camera looks at the horizon, so the dome's
    // equator - where the haze band is at full strength - lands on the vertical centre of the image.
    scene.fog.near = 0;
    scene.fog.far = 1;
    camera.position.set(0, 15, 0);
    camera.lookAt(0, 15, -100);
    camera.updateMatrixWorld(true);

    const gl = three.getContext();
    function capture(matchVisible) {
        runtime.matchRoot.visible = matchVisible;
        three.setRenderTarget(null);
        three.render(scene, camera);
        const frame = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        return frame;
    }

    function sampleAt(frame, x, yFromTop) {
        // readPixels stores rows from the bottom.
        const offset = ((height - 1 - yFromTop) * width + x) * 4;
        return [frame[offset] / 255, frame[offset + 1] / 255, frame[offset + 2] / 255];
    }

    function maxDelta(a, b) {
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    }

    function pairAt(visibleFrame, skyFrame, x, y) {
        const fogged = sampleAt(visibleFrame, x, y);
        const sky = sampleAt(skyFrame, x, y);
        return { fogged, sky, delta: maxDelta(fogged, sky) };
    }

    function findHorizonGeometry(visibleFrame, skyFrame) {
        let best = null;
        const minY = Math.round(height * 0.35);
        const maxY = Math.round(height * 0.65);
        const minX = Math.round(width * 0.05);
        const maxX = Math.round(width * 0.95);
        for (let y = minY; y <= maxY; y += 2) {
            for (let x = minX; x <= maxX; x += 2) {
                const pair = pairAt(visibleFrame, skyFrame, x, y);
                if (pair.delta < 0.3) continue;
                const distanceToHorizon = Math.abs(y / height - 0.5);
                if (!best || distanceToHorizon < best.distanceToHorizon) {
                    best = { x, y, distanceToHorizon, ...pair };
                }
            }
        }
        return best;
    }
`;

const RESTORE_SEAM = `
    runtime.matchRoot.visible = restore.matchVisible;
    camera.position.copy(restore.position);
    camera.quaternion.copy(restore.quaternion);
    camera.updateMatrixWorld(true);
    runtime.setMapLighting(restore.mapLighting, restore.mapScale);
`;

for (const profile of [
    { key: 'magma_maze', near: 30, far: 130, color: 0x6b2410, height: 2.7 },
    { key: 'burg_falkenwacht', near: 450, far: 600, color: 0xcad4cc, height: 5 },
]) {
test(`${profile.key}: fog compiles and meets the sky at multiple elevations`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);

    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', profile.key);
    await page.waitForFunction(
        (key) => window.GAME_INSTANCE?.settings?.mapKey === key,
        profile.key,
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
        (key) => window.GAME_INSTANCE?.arena?.currentMapKey === key,
        profile.key,
        { timeout: 60_000 }
    );
    await waitForRenderFrames(page, 8);
    await page.screenshot({ path: testInfo.outputPath('map-atmosphere.png') });

    // The map's own profile has to arrive at the scene, not just sit in the preset.
    const applied = await page.evaluate(() => {
        const runtime = window.GAME_INSTANCE.renderer;
        return {
            fogNear: runtime.scene.fog.near,
            fogFar: runtime.scene.fog.far,
            fogColor: runtime.scene.fog.color.getHex(),
            fogHeight: runtime.getMapLighting()?.fog?.height ?? null,
            cameraFar: runtime.cameras[0].far,
        };
    });
    expect(applied.fogNear).toBe(profile.near);
    expect(applied.fogFar).toBe(profile.far);
    expect(applied.cameraFar).toBe(Math.max(200, profile.far));
    // Not the authored 0x2a0c06: with skyBlend at 1 the distance fades into the map's own horizon.
    expect(applied.fogColor).toBe(profile.color);
    expect(applied.fogHeight).toBe(profile.height);

    // Rendered proof plus its own control: repainting only the fog colour, without letting the sky
    // follow, is exactly the mismatch the haze band exists to prevent - so the same measurement has
    // to report a wide gap. Without that control a probe that always reads one colour would pass.
    const seam = await page.evaluate(`(() => {
        ${MEASURE_SEAM}
        const shader = { uniforms: {} };
        scene.getObjectByName('scene-atmosphere-sky').material.onBeforeCompile(shader, three);
        const skyHaze = shader.uniforms.fogSkyHaze.value.clone();
        shader.uniforms.fogSkyHaze.value.setHex(0x30c0ff);
        scene.fog.color.setHex(0x30c0ff);
        const mismatchedVisible = capture(true);
        const mismatchedSky = capture(false);
        const probe = findHorizonGeometry(mismatchedVisible, mismatchedSky);
        if (!probe) throw new Error('No fogged geometry crosses the measured horizon band');
        const mismatched = pairAt(mismatchedVisible, mismatchedSky, probe.x, probe.y);

        scene.fog.color.setHex(restore.fogColor);
        shader.uniforms.fogSkyHaze.value.copy(skyHaze);
        const matched = pairAt(capture(true), capture(false), probe.x, probe.y);
        ${RESTORE_SEAM}
        return { matched, mismatched, probe: { x: probe.x, y: probe.y } };
    })()`);

    // The controlled profile removes the map's density structure, so any remaining delta is a real
    // sky/fog mismatch. The deliberately mismatched control proves the probe can see that edge.
    expect(seam.matched.delta, JSON.stringify(seam)).toBeLessThan(0.05);
    expect(seam.mismatched.delta, JSON.stringify(seam)).toBeGreaterThan(0.5);

    // A horizon-only probe misses the old mismatch at steep viewing angles. Compare fully
    // fogged map geometry with the sky behind it above and below the haze band as well.
    const angledSeams = await page.evaluate(`(() => {
        ${MEASURE_SEAM}
        const shader = { uniforms: {} };
        scene.getObjectByName('scene-atmosphere-sky').material.onBeforeCompile(shader, three);
        const names = ['fogSkyZenith', 'fogSkyHorizon', 'fogSkyNadir', 'fogSkyHaze'];
        const saved = names.map(name => shader.uniforms[name].value.clone());
        const samples = [];
        for (const slope of [-0.6, 0.6]) {
            camera.lookAt(0, 15 + slope * 100, -100);
            camera.updateMatrixWorld(true);
            for (const name of names) shader.uniforms[name].value.setHex(0x30c0ff);
            const probe = findHorizonGeometry(capture(true), capture(false));
            names.forEach((name, i) => shader.uniforms[name].value.copy(saved[i]));
            if (!probe) throw new Error('No geometry for angled seam probe: ' + slope);
            samples.push({ slope, ...pairAt(capture(true), capture(false), probe.x, probe.y) });
        }
        ${RESTORE_SEAM}
        return samples;
    })()`);
    for (const seamAtAngle of angledSeams) {
        expect(seamAtAngle.delta, JSON.stringify(seamAtAngle)).toBeLessThan(0.05);
    }

    // A shader that fails to compile or link surfaces here and nowhere else.
    expect(errors).toHaveLength(0);
});
}
