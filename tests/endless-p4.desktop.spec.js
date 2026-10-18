import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P4 enters and leaves streamed water through the real flight and camera loop', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung', { exact: true }).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session = { page }; await installControl(session); await setPaused(session, true);
    const entry = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, runtime = manager.endlessParcoursRuntime;
        const human = manager.humanPlayers[0];
        let wetIndex = -1;
        for (let index = 6; index <= 30; index++) {
            human.position.copy(runtime.getCoursePoint(index, 0, 0, 40).position); runtime.update(0);
            if (runtime.activeModules.get(index).underwater) { wetIndex = index; break; }
        }
        if (wetIndex < 0) throw new Error('No seeded water section found');
        const frame = runtime.getCoursePoint(wetIndex - 1, 0, 0, 104);
        human.position.copy(frame.position);
        human.quaternion.premultiply(human.quaternion.clone().setFromUnitVectors(human.getDirection().normalize(), human.position.clone().copy(frame.tangent)));
        human.spawnProtectionTimer = 99; human.markRenderDiscontinuity('water-entry-fixture'); runtime.update(0);
        human.activeEffects.push({ type: 'BURNING', remaining: 2 }); human.flameActive = true;
        const wet = runtime.activeModules.get(wetIndex);
        return { index: wetIndex, dry: !manager.arena.waterZoneSource.isPositionUnderwater(human.position),
            visual: Boolean(wet.waterMesh), sharedVolume: wet.waterMesh.geometry === wet.ownedGeometries[1] };
    });
    expect(entry.dry).toBe(true); expect(entry.visual).toBe(true); expect(entry.sharedVolume).toBe(true);
    expect((await step(session, 1000)).completed).toBe(true);
    const submerged = await page.evaluate(() => {
        const game = window.GAME_INSTANCE, manager = game.entityManager, human = manager.humanPlayers[0];
        return { inside: manager.arena.waterZoneSource.isPositionUnderwater(human.position),
            submerged: human.waterSubmerged, speed: human.waterSpeedMultiplier, turn: human.waterTurnMultiplier,
            projectile: human.waterProjectileSpeedMultiplier, buoyancy: human.waterBuoyancy,
            camera: game.renderer.cameras[0].userData.waterVisibilityMultiplier,
            flame: human.flameActive, burning: human.activeEffects.some(e => e.type === 'BURNING'), alive: human.alive };
    });
    expect(submerged).toMatchObject({ inside: true, submerged: true, speed: 0.64, turn: 0.7, projectile: 0.58,
        buoyancy: 7.5, camera: 0.42, flame: false, burning: false, alive: true });
    await testInfo.attach('endless-p4-underwater.png', { body: await page.screenshot(), contentType: 'image/png' });
    const exit = await page.evaluate(index => {
        const manager = window.GAME_INSTANCE.entityManager, runtime = manager.endlessParcoursRuntime, human = manager.humanPlayers[0];
        const frame = runtime.getCoursePoint(index + 5, 0, 0, 104);
        human.position.copy(frame.position);
        human.quaternion.premultiply(human.quaternion.clone().setFromUnitVectors(human.getDirection().normalize(), human.position.clone().copy(frame.tangent)));
        human.spawnProtectionTimer = 99; human.markRenderDiscontinuity('water-exit-fixture'); runtime.update(0);
        if (!manager.arena.waterZoneSource.isPositionUnderwater(human.position)) throw new Error('Exit fixture must begin underwater');
        return { position: human.position.toArray(), speed: human.baseSpeed, direction: human.getDirection().toArray() };
    }, entry.index);
    let dry;
    // Factory aircraft have different speeds. Observe the actual crossing, bounded
    // by three seconds of normal simulation, rather than assuming a one-second exit.
    for (let tick = 0; tick < 12; tick++) {
        expect((await step(session, 250)).completed).toBe(true);
        dry = await page.evaluate(() => {
        const game = window.GAME_INSTANCE, manager = game.entityManager, human = manager.humanPlayers[0];
        return { inside: manager.arena.waterZoneSource.isPositionUnderwater(human.position),
            submerged: human.waterSubmerged, speed: human.waterSpeedMultiplier, turn: human.waterTurnMultiplier,
            projectile: human.waterProjectileSpeedMultiplier, buoyancy: human.waterBuoyancy,
            camera: game.renderer.cameras[0].userData.waterVisibilityMultiplier, alive: human.alive,
            position: human.position.toArray() };
        });
        if (!dry.inside && !dry.submerged) break;
    }
    await testInfo.attach('endless-p4-boundaries.json', { body: JSON.stringify({ entry, submerged, exit, dry }, null, 2), contentType: 'application/json' });
    expect(dry).toMatchObject({ inside: false, submerged: false, speed: 1, turn: 1, projectile: 1, buoyancy: 0, camera: 1, alive: true });
    expect(errors).toHaveLength(0);
});
