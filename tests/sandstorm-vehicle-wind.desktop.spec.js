import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames, chooseFreePlayVariant } from './helpers.js';

const MAP_KEY = 'clockwork_canyon';

test('sandstorm drift is felt in open air and blocked by the canyon walls @render', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await chooseFreePlayVariant(page, 'ffa');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.humanPlayers?.length === 2;
    }, MAP_KEY, { timeout: 120_000 });
    await waitForRenderFrames(page, 12);

    await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        system.startRound();
        system.state.phase = 'ACTIVE';
        system.state.remainingSeconds = 45;
        system.state.intensity = 1;
        const player = manager.humanPlayers[0];
        player.sandstormVisualIntensity = 1;
        player.view._reduceMotion = false;
    });
    await waitForRenderFrames(page, 8);
    const visualJitter = await page.evaluate(() => {
        const player = window.GAME_INSTANCE.entityManager.humanPlayers[0];
        return {
            positionOffset: Math.abs(player.group.position.y - player.view._renderPosition.y),
            angleOffset: player.view._renderQuaternion.angleTo(player.group.quaternion),
        };
    });
    expect(visualJitter.positionOffset + visualJitter.angleOffset).toBeGreaterThan(0.001);
    await page.screenshot({ path: testInfo.outputPath('canyon-vehicle-wind.png') });

    const result = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const system = manager.runtimePorts.weather.sandstormSystem;
        const scale = Number(manager.entityRuntimeConfig?.ARENA?.MAP_SCALE) || 1;

        const player = manager.humanPlayers[0];
        const openPosition = { x: 500 * scale, y: 100 * scale, z: 500 * scale };
        let openWind = null;
        for (let directionIndex = 0; directionIndex < 4; directionIndex += 1) {
            system.state.directionIndex = directionIndex;
            player.position.set(openPosition.x, openPosition.y, openPosition.z);
            player._sandstormWindSample.windOcclusionSampleValid = false;
            const state = system.getVehicleWindState(player.position, player._sandstormWindSample);
            if (state.exposure === 1) {
                openWind = { directionIndex, directionX: state.directionX, directionZ: state.directionZ };
                break;
            }
        }
        if (!openWind) throw new Error('The open-air test position is wind-blocked in every direction.');

        player.position.set(openPosition.x, openPosition.y, openPosition.z);
        player.quaternion.set(0, 0, 0, 1);
        player._sandstormDriftVelocity.set(0, 0, 0);
        player._sandstormWindSample.windOcclusionSampleValid = false;
        const openStartX = player.position.x;
        const openStartZ = player.position.z;
        for (let tick = 0; tick < 90; tick += 1) player.update(1 / 60, null, 0, null, 1);
        const openDrift = {
            displacementX: player.position.x - openStartX,
            displacementZ: player.position.z - openStartZ,
            driftSpeed: player._sandstormDriftVelocity.length(),
            intensity: player.sandstormVisualIntensity,
            directionX: openWind.directionX,
            directionZ: openWind.directionZ,
        };

        const obstacles = Array.isArray(game.arena.obstacles) ? game.arena.obstacles : [];
        const windCases = [
            { index: 0, axis: 'z', side: 'min' },
            { index: 1, axis: 'x', side: 'max' },
            { index: 2, axis: 'z', side: 'max' },
            { index: 3, axis: 'x', side: 'min' },
        ];
        let blockedCase = null;
        for (const windCase of windCases) {
            system.state.directionIndex = windCase.index;
            for (const obstacle of obstacles) {
                const box = obstacle?.box;
                if (!obstacle?.isWall || obstacle.tunnel || obstacle.tube || !box?.min || !box?.max) continue;
                const crosswindSize = windCase.axis === 'x'
                    ? box.max.z - box.min.z
                    : box.max.x - box.min.x;
                const height = box.max.y - box.min.y;
                if (crosswindSize < 3 || height < 2) continue;
                const position = {
                    x: (box.min.x + box.max.x) * 0.5,
                    y: (box.min.y + box.max.y) * 0.5,
                    z: (box.min.z + box.max.z) * 0.5,
                };
                if (windCase.side === 'max') position[windCase.axis] = box.max[windCase.axis] + 2;
                else position[windCase.axis] = box.min[windCase.axis] - 2;
                if (system.isSheltered(position)) continue;

                player.position.set(position.x, position.y, position.z);
                player._sandstormWindSample.windOcclusionSampleValid = false;
                const state = system.getVehicleWindState(player.position, player._sandstormWindSample);
                if (state.exposure < 1) {
                    blockedCase = {
                        exposure: state.exposure,
                        sourceName: obstacle.sourceName || '',
                        directionIndex: windCase.index,
                    };
                    break;
                }
            }
            if (blockedCase) break;
        }
        if (!blockedCase) throw new Error('No canyon wall produced a wind shadow.');

        player._sandstormDriftVelocity.set(0, 0, 0);
        player._sandstormWindSample.windOcclusionSampleValid = false;
        player.update(1 / 60, null, 0, null, 1);
        const shelteredStep = {
            exposure: player._sandstormWindSample.exposure,
            intensity: player.sandstormVisualIntensity,
            driftSpeed: player._sandstormDriftVelocity.length(),
        };
        system.reset();
        return { mapKey: game.arena.currentMapKey, scale, openWind, openDrift, blockedCase, shelteredStep };
    });

    expect(result.mapKey).toBe(MAP_KEY);
    expect(result.openWind.directionX !== 0 || result.openWind.directionZ !== 0).toBe(true);
    const driftAlongWind = result.openDrift.displacementX * result.openDrift.directionX
        + result.openDrift.displacementZ * result.openDrift.directionZ;
    expect(driftAlongWind).toBeGreaterThan(0.3);
    expect(result.openDrift.driftSpeed).toBeGreaterThan(0.3);
    expect(result.openDrift.intensity).toBe(1);
    expect(result.blockedCase.exposure).toBeLessThan(1);
    expect(result.shelteredStep.exposure).toBe(result.blockedCase.exposure);
    expect(result.shelteredStep.intensity).toBe(result.blockedCase.exposure);
    expect(result.shelteredStep.driftSpeed).toBeLessThanOrEqual(0.1);
    expect(errors).toEqual([]);
});
