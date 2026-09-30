import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const MAP_KEY = 'pyramid';

// The height fade lives only in the shared fog uniforms the shader patch hands to every material
// (WebGLRenderer keeps them as materialProperties.uniforms), so read it where the GPU gets it.
function readRenderedFogHeightFalloff() {
    const renderer = window.GAME_INSTANCE.renderer;
    let value = null;
    renderer.scene.traverse((object) => {
        if (value !== null || !object.material) return;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        const uniform = renderer.renderer.properties.get(material)?.uniforms?.fogHeightFalloff;
        if (uniform) value = uniform.value;
    });
    return value;
}

async function startPyramidSplitScreen(page) {
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.evaluate(() => {
        const slider = document.getElementById('bot-count');
        slider.value = '1';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.numBots === 1);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.humanPlayers?.length === 2
            && game?.entityManager?.players?.some((player) => player?.isBot);
    }, MAP_KEY, { timeout: 120_000 });
    await waitForRenderFrames(page, 12);
}

test('Krone des Sonnengottes loads and runs warning, storm, shelter and reset @render', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await startPyramidSplitScreen(page);

    const loaded = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return {
            assets: game.arena.getMapAssetLoadState(),
            state: game.entityManager.getMapSandstormState(),
        };
    });
    expect(loaded.assets.error).toBeNull();
    expect(loaded.assets.warnings).toEqual([]);
    expect(loaded.assets.modelCount).toBe(7);
    expect(loaded.assets.beaconSurfaces).toBeGreaterThanOrEqual(6);
    expect(loaded.assets.foglessBeaconSurfaces).toBe(loaded.assets.beaconSurfaces);
    expect(loaded.state.phase).toBe('CALM');
    const calmHeightFalloff = await page.evaluate(readRenderedFogHeightFalloff);
    expect(calmHeightFalloff, 'calm air thins with height as authored').toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('pyramid-clear.png') });

    const warning = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        manager.matchSeed = 20260920;
        system.startRound();
        system.update(system.getState().remainingSeconds);
        return system.getState();
    });
    expect(warning.phase).toBe('WARNING');
    expect(warning.remainingSeconds).toBe(20);
    await page.waitForFunction(() => document.querySelector('#map-sandstorm-status')?.textContent
        === 'Sandsturm in 20 Sekunden');
    await page.screenshot({ path: testInfo.outputPath('pyramid-warning.png') });

    const swell = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        system.update(20);
        system.update(10);
        const outdoor = manager.humanPlayers[0];
        outdoor.position.set(300, 30, 300);
        system.update(0);
        return {
            state: system.getState(),
            gameplayRange: system.getVisibilityRange(outdoor.position),
            renderedFar: game.renderer.getEffectiveCameraFogRange(game.renderer.cameras[0]).far,
        };
    });
    // Half way through the 20 s swell the storm is half strong and the view has closed by the
    // same factor for bots, lock-on and the picture.
    expect(swell.state.phase).toBe('ACTIVE');
    // The running game loop adds a few frames between the steps above.
    expect(swell.state.intensity).toBeGreaterThan(0.45);
    expect(swell.state.intensity).toBeLessThan(0.6);
    expect(swell.gameplayRange).toBeLessThan(200);
    expect(swell.gameplayRange).toBeGreaterThan(12);
    expect(swell.renderedFar).toBeCloseTo(swell.gameplayRange, 3);

    const active = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        system.update(10);

        const outdoor = manager.humanPlayers[0];
        const sheltered = manager.humanPlayers[1];
        const enemy = manager.bots[0]?.player || manager.players.find((player) => player?.isBot);
        outdoor.position.set(300, 30, 300);
        sheltered.position.set(0, 30, -180);
        enemy.position.set(310, 30, 300);
        system.update(0);

        const renderer = game.renderer;
        const perCameraFog = renderer.cameras.slice(0, 2)
            .map((camera) => renderer.getEffectiveCameraFogRange(camera));
        renderer.render();
        const renderState = system.getRenderState();
        const heldRaycast = game.arena.raycast;
        const heldAlive = [outdoor.alive, enemy.alive];
        const heldTeams = [outdoor.teamId, enemy.teamId];
        let cue;
        try {
            outdoor.alive = true;
            enemy.alive = true;
            outdoor.teamId = 'storm-observer';
            enemy.teamId = 'storm-opponent';
            game.arena.raycast = () => null;
            cue = system.getProximityCue(outdoor, [outdoor, enemy]);
        } finally {
            game.arena.raycast = heldRaycast;
            [outdoor.alive, enemy.alive] = heldAlive;
            [outdoor.teamId, enemy.teamId] = heldTeams;
        }
        return {
            state: system.getState(),
            ranges: renderer.cameras.slice(0, 2).map((camera) => camera.userData.sandstormVisibilityRange),
            perCameraFog,
            cue,
            fogColor: renderer.scene.fog.color.getHex(),
            visualVisible: renderState.visible,
            particles: renderState.particleCount,
        };
    });
    expect(active.state.phase).toBe('ACTIVE');
    expect(active.state.remainingSeconds).toBeGreaterThan(49);
    expect(active.state.remainingSeconds).toBeLessThanOrEqual(50);
    expect(active.state.intensity).toBe(1);
    expect(active.ranges).toEqual([12, 85]);
    expect(active.perCameraFog).toEqual([{ near: 1.6, far: 12 }, { near: 18, far: 85 }]);
    expect(active.cue?.active).toBe(true);
    expect(Math.abs(active.cue?.angleDegrees || 0)).toBeLessThanOrEqual(180);
    expect(active.fogColor).toBe(0xb56d32);
    expect(active.visualVisible).toBe(true);
    expect(active.particles).toBeGreaterThan(0);
    expect(active.particles).toBeLessThanOrEqual(512);
    await page.screenshot({ path: testInfo.outputPath('pyramid-outdoor-and-shelter-storm.png') });

    // Peak storm seen from just under the map ceiling: without the height fade the fog thinned
    // out a few dozen metres up and the upper pyramids stood in clear air.
    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        manager.humanPlayers[0].position.set(0, 12, 200);
        manager.humanPlayers[1].position.set(0, 400, 120);
        manager.runtimePorts.weather.sandstormSystem.update(0);
    });
    await waitForRenderFrames(page, 6);
    expect(await page.evaluate(readRenderedFogHeightFalloff), 'the peak storm is as dense at the ceiling as on the ground')
        .toBe(0);
    await page.screenshot({ path: testInfo.outputPath('pyramid-storm-ceiling-and-ground.png') });

    const reset = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const system = game.entityManager.runtimePorts.weather.sandstormSystem;
        system.reset();
        const renderState = system.getRenderState();
        return {
            state: system.getState(),
            renderer: game.renderer.getMapSandstormEffect(),
            visualVisible: renderState.visible,
            cameraRanges: game.renderer.cameras.slice(0, 2)
                .map((camera) => camera.userData.sandstormVisibilityRange),
        };
    });
    expect(reset.state.enabled).toBe(false);
    expect(reset.renderer.enabled).toBe(false);
    expect(reset.visualVisible).toBe(false);
    expect(reset.cameraRanges).toEqual([Infinity, Infinity]);
    await expect(page.locator('#map-sandstorm-status')).toHaveClass(/hidden/);
    expect(errors).toEqual([]);
});
