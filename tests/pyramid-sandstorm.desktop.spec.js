import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const MAP_KEY = 'pyramid';

async function startPyramidSplitScreen(page) {
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 1;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '1';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.humanPlayers?.length === 2
            && game?.entityManager?.bots?.length === 1;
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

    const active = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        system.update(20);
        system.update(4);

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
        return {
            state: system.getState(),
            ranges: renderer.cameras.slice(0, 2).map((camera) => camera.userData.sandstormVisibilityRange),
            perCameraFog,
            cue: manager.getSandstormProximityCue(outdoor.index),
            fogColor: renderer.scene.fog.color.getHex(),
            visualVisible: renderState.visible,
            particles: renderState.particleCount,
        };
    });
    expect(active.state.phase).toBe('ACTIVE');
    expect(active.state.remainingSeconds).toBeGreaterThan(55);
    expect(active.state.remainingSeconds).toBeLessThanOrEqual(56);
    expect(active.state.intensity).toBe(1);
    expect(active.ranges).toEqual([40, 85]);
    expect(active.perCameraFog).toEqual([{ near: 8, far: 40 }, { near: 18, far: 85 }]);
    expect(active.cue?.active).toBe(true);
    expect(Math.abs(active.cue?.angleDegrees || 0)).toBeLessThanOrEqual(180);
    expect(active.fogColor).toBe(0xb56d32);
    expect(active.visualVisible).toBe(true);
    expect(active.particles).toBeGreaterThan(0);
    expect(active.particles).toBeLessThanOrEqual(512);
    await page.screenshot({ path: testInfo.outputPath('pyramid-outdoor-and-shelter-storm.png') });

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
