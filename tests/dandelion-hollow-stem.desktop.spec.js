import { test, expect } from './helpers.desktop.js';
import { writeFile } from 'node:fs/promises';
import { waitForLoadedGame } from './helpers.js';
import { startMatch } from '../scripts/playtest/playtest-driver.mjs';
import { step } from '../scripts/playtest/playtest-control.mjs';
import { DANDELION_STEM_FLIGHT_ROUTE } from '../src/core/config/maps/presets/dandelion_sky/DandelionSkyStem.js';

const expectedHuntItems = ['ROCKET_MEDIUM', 'REPAIR_DRONE', 'ROCKET_MEDIUM', 'ROCKET_MEDIUM',
    'FAN_5', 'ROCKET_MEDIUM', 'SHIELD', 'ROCKET_MEDIUM'];

async function readState(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const player = manager.humanPlayers[0];
        const camera = game.renderer.cameras[0];
        return {
            pilot: window.__playtestPilotRuntime.describe(),
            hp: player.hp, alive: player.alive, pos: player.position.toArray(),
            cameraBlocked: game.arena.checkCollisionFast(camera.position, 0.15),
            items: manager.powerupManager.items.filter((item) => item.ownerId?.startsWith('map-owned:dandelion_stem_'))
                .map((item) => item.type),
            drones: manager.runtimePorts.combat.repairDroneSystem.getTargets().length,
            damage: window.__playtest.events.filter((event) => event.type === 'damage' && event.targetIndex === player.index),
            gateCooldowns: game.arena.specialGates.slice(-3).map((gate) => gate.cooldowns.size),
        };
    });
}

for (const vehicle of ['ship5', 'ship4']) {
    for (const direction of ['up', 'down']) {
        test(`${vehicle} flies ${direction} through both stem doors with a repair drone @render`, async ({ page }, testInfo) => {
            test.setTimeout(180_000);
            await waitForLoadedGame(page);
            const session = { page };
            const started = await startMatch(session, { map: 'dandelion_sky', mode: 'HUNT',
                bots: 0, humans: 2, session: 'splitscreen', vehicle, paused: true });
            expect(started.ok, JSON.stringify(started)).toBe(true);
            expect(started.problems).toEqual([]);
            const points = DANDELION_STEM_FLIGHT_ROUTE.map((point) => point.map((value) => value * 3));
            if (direction === 'down') points.reverse();
            expect((await readState(page)).items).toEqual(expectedHuntItems);

            // The only flight interventions are the initial pose and starting the drone.
            // The pilot then steers through the normal input device and simulation.
            await page.evaluate((route) => {
                const game = window.GAME_INSTANCE;
                const player = game.entityManager.humanPlayers[0];
                const Vector = player.position.constructor;
                player.position.fromArray(route[0]);
                const heading = new Vector(...route[1]).sub(player.position).normalize();
                player.quaternion.setFromUnitVectors(new Vector(0, 0, -1), heading);
                player.trail.clear();
                player.markRenderDiscontinuity('stem-flight-start');
                player.applyPowerup('REPAIR_DRONE');
                window.__playtest.events.length = 0;
                window.__playtestPilotRuntime.configure({ mode: 'waypoints', player: player.index,
                    points: route.slice(1), arriveRadius: 4 });
            }, points);

            const samples = [];
            for (let chunk = 0; chunk < 75; chunk++) {
                const advanced = await step(session, 400);
                expect(advanced.completed).toBe(true);
                const state = await readState(page);
                samples.push(state);
                if (chunk === 6 || chunk === 16) {
                    await page.screenshot({ path: testInfo.outputPath(`stem-${chunk}.png`) });
                }
                if (!state.alive || state.pilot.status !== 'active') break;
            }
            await testInfo.attach('flight-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
            await writeFile(testInfo.outputPath('flight-samples.json'), JSON.stringify(samples, null, 2));
            const final = samples.at(-1);
            expect(final.pilot.status, JSON.stringify(final)).toBe('done');
            expect(final.alive).toBe(true);
            expect(final.items).toEqual([]);
            expect(final.damage).toEqual([]);
            expect(samples.some((sample) => sample.drones > 0)).toBe(true);
            expect(samples.filter((sample) => sample.cameraBlocked).length).toBeLessThan(3);
            if (direction === 'up') expect(samples.some((sample) => sample.gateCooldowns.some((count) => count > 0))).toBe(true);
            else expect(samples.every((sample) => sample.gateCooldowns.every((count) => count === 0))).toBe(true);
            await page.screenshot({ path: testInfo.outputPath('stem-exit.png') });
        });
    }
}

test('ARCADE exposes only the drone and shield in the stem @render', async ({ page }) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    const started = await startMatch({ page }, { map: 'dandelion_sky', mode: 'ARCADE',
        bots: 0, humans: 2, session: 'splitscreen', paused: true, arcade: { enabled: false } });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    expect(started.mapKey).toBe('dandelion_sky');
    expect((await readState(page)).items).toEqual(['REPAIR_DRONE', 'SHIELD']);
});
