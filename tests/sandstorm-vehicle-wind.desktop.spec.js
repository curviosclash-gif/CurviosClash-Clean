import { MAP_SANDSTORM_DIRECTIONS } from '../src/shared/contracts/MapSandstormContract.js';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, waitForLoadedGame, waitForRenderFrames, chooseFreePlayVariant, menuScreenSelector } from './helpers.js';

const MAP_KEY = 'clockwork_canyon';
const MAP_SCALE = 3;

test('sandstorm drift is felt in open air and blocked by the canyon walls @render', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
    await chooseFreePlayVariant(page, 'ffa');
    await page.waitForSelector(menuScreenSelector('freeplay'), { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.locator(`${menuScreenSelector('freeplay')} #btn-start`).click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.getHumanPlayers?.().length === 2;
    }, MAP_KEY, { timeout: 120_000 });

    // Exercise the authored storm through its real match clock. The canyon begins with a
    // 45-90 second calm period, followed by a 20 second warning and ingress.
    await page.waitForFunction(() => {
        const storm = window.GAME_INSTANCE?.entityManager?.getMapSandstormState?.();
        return storm?.phase === 'ACTIVE' && storm.intensity >= 0.9;
    }, null, { timeout: 180_000 });
    await waitForRenderFrames(page, 8);
    await page.screenshot({ path: testInfo.outputPath('canyon-vehicle-wind.png') });

    await page.evaluate(({ directions, mapScale }) => {
        const manager = window.GAME_INSTANCE.entityManager;
        const player = manager.getHumanPlayers()[0];
        const storm = manager.getMapSandstormState();
        const [directionX, directionZ] = directions[storm.directionIndex] || directions[0];
        const position = { x: 60.5 * mapScale, y: 6 * mapScale, z: 35 * mapScale };
        player.spawn(position);
        player.setLookAtWorld(position.x + directionZ * 100, position.y, position.z - directionX * 100);
    }, { directions: MAP_SANDSTORM_DIRECTIONS, mapScale: MAP_SCALE });
    await waitForRenderFrames(page, 4);
    const neutralJitter = await page.evaluate(() => {
        const player = window.GAME_INSTANCE.entityManager.getHumanPlayers()[0];
        const position = player.position.clone();
        const quaternion = player.quaternion.clone();
        if (!player.view?.copyRenderTransform?.(position, quaternion)) {
            throw new Error('The public render-transform snapshot is unavailable.');
        }
        return {
            positionOffset: player.group.position.distanceTo(position),
            angleOffset: player.group.quaternion.angleTo(quaternion),
        };
    });

    await page.evaluate(({ directions, mapScale }) => {
        const manager = window.GAME_INSTANCE.entityManager;
        const player = manager.getHumanPlayers()[0];
        const storm = manager.getMapSandstormState();
        const [directionX, directionZ] = directions[storm.directionIndex] || directions[0];
        const position = { x: 500 * mapScale, y: 100 * mapScale, z: 500 * mapScale };
        player.spawn(position);
        player.setLookAtWorld(position.x + directionZ * 100, position.y, position.z - directionX * 100);
    }, { directions: MAP_SANDSTORM_DIRECTIONS, mapScale: MAP_SCALE });
    let visualJitter = { positionOffset: 0, angleOffset: 0, intensity: 0 };
    for (let sample = 0; sample < 4; sample += 1) {
        await waitForRenderFrames(page, 2);
        const current = await page.evaluate(() => {
            const player = window.GAME_INSTANCE.entityManager.getHumanPlayers()[0];
            const position = player.position.clone();
            const quaternion = player.quaternion.clone();
            if (!player.view?.copyRenderTransform?.(position, quaternion)) {
                throw new Error('The public render-transform snapshot is unavailable.');
            }
            return {
                positionOffset: player.group.position.distanceTo(position),
                angleOffset: player.group.quaternion.angleTo(quaternion),
                intensity: player.sandstormVisualIntensity,
            };
        });
        if (current.positionOffset + current.angleOffset > visualJitter.positionOffset + visualJitter.angleOffset) {
            visualJitter = current;
        }
    }
    expect(neutralJitter.positionOffset + neutralJitter.angleOffset).toBeLessThan(0.001);
    expect(visualJitter.intensity).toBeGreaterThan(0.9);
    expect(visualJitter.positionOffset + visualJitter.angleOffset).toBeGreaterThan(0.001);

    const result = await page.evaluate(({ directions, mapScale }) => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const player = manager.getHumanPlayers()[0];
        const storm = manager.getMapSandstormState();
        const direction = directions[storm.directionIndex] || directions[0];
        const [directionX, directionZ] = direction;
        // Keep ordinary forward travel perpendicular to the wind so this measures the
        // force applied by the live Player.update path, not the vehicle's heading.
        const forwardX = directionZ;
        const forwardZ = -directionX;

        const measure = (position, ticks) => {
            player.spawn(position);
            if (!player.setLookAtWorld(
                position.x + forwardX * 100,
                position.y,
                position.z + forwardZ * 100,
            )) throw new Error('Could not orient the public player API for the wind measurement.');
            const start = player.position.clone();
            for (let tick = 0; tick < ticks; tick += 1) player.update(1 / 60, null, 0, null, 1);
            const dx = player.position.x - start.x;
            const dz = player.position.z - start.z;
            return {
                alongWind: dx * directionX + dz * directionZ,
                visualIntensity: player.sandstormVisualIntensity,
            };
        };

        // The open-air point is outside all authored canyon geometry; the nook is the
        // authored east shelter scaled with the arena's geometry.
        const openAir = measure({ x: 500 * mapScale, y: 100 * mapScale, z: 500 * mapScale }, 90);
        const sheltered = measure({ x: 60.5 * mapScale, y: 6 * mapScale, z: 35 * mapScale }, 12);
        return { mapKey: game.arena.currentMapKey, storm, openAir, sheltered };
    }, { directions: MAP_SANDSTORM_DIRECTIONS, mapScale: MAP_SCALE });

    expect(result.mapKey).toBe(MAP_KEY);
    expect(result.storm.phase).toBe('ACTIVE');
    expect(result.openAir.visualIntensity).toBeGreaterThan(0.9);
    expect(result.openAir.alongWind).toBeGreaterThan(0.3);
    expect(result.sheltered.visualIntensity).toBe(0);
    expect(Math.abs(result.sheltered.alongWind)).toBeLessThan(0.1);
    expect(errors).toEqual([]);
});
