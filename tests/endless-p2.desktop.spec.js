import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame, waitForRenderFrames } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

async function startEndless(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung', { exact: true }).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session = { page };
    await installControl(session);
    await setPaused(session, true);
    return session;
}

test('Endlos P2 native loop flies a curved segment with consistent stations and cabin collision', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page), session = await startEndless(page);
    const before = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        const runtime = manager.endlessParcoursRuntime;
        let frame;
        for (let index = 1; index <= 24; index++) {
            frame = runtime.getCoursePoint(index, 0, 0, 36);
            if (Math.abs(frame.tangent.x) + Math.abs(frame.tangent.y) > 0.001) break;
        }
        human.position.copy(frame.position);
        runtime.update(0);
        const from = human.getDirection().normalize(), to = human.position.clone().copy(frame.tangent);
        human.quaternion.premultiply(human.quaternion.clone().setFromUnitVectors(from, to));
        human.markRenderDiscontinuity('endless-p2-curve-start');
        human.spawnProtectionTimer = 0;
        return { hp: human.hp, progress: runtime.maxProgressMeters, position: human.position.toArray(),
            collision: Boolean(manager.arena.getCollisionInfo(human.position, human.hitboxRadius)),
            tangent: { ...frame.tangent } };
    });
    expect(before.collision).toBe(false);
    expect(Math.abs(before.tangent.x) + Math.abs(before.tangent.y)).toBeGreaterThan(0.001);
    expect((await step(session, 400)).completed).toBe(true);
    const after = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        const runtime = manager.endlessParcoursRuntime, sample = runtime.projectCoursePoint(human.position);
        return { hp: human.hp, alive: human.alive, progress: runtime.maxProgressMeters,
            station: sample.s, position: human.position.toArray(), outside: manager.arena.exclusionZoneSource.isOutside(human),
            rescues: runtime.reviveCount };
    });
    expect(after.alive).toBe(true);
    expect(after.hp).toBe(before.hp);
    expect(after.progress).toBeGreaterThan(before.progress + 2);
    expect(after.progress).toBeCloseTo(after.station, 4);
    expect(after.outside).toBe(false);
    expect(after.rescues).toBe(0);
    await waitForRenderFrames(page, 2);
    await testInfo.attach('endless-p2-curve.json', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
    await testInfo.attach('endless-p2-curve.png', { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toHaveLength(0);
});

test('Endlos P2 native loop hits the visible inner wall instead of an obsolete box shell', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page), session = await startEndless(page);
    const before = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        const runtime = manager.endlessParcoursRuntime;
        const frame = runtime.getCoursePoint(0, 0, 0, 60);
        const right = human.position.clone().copy(frame.right), center = human.position.clone().copy(frame.position);
        const hit = manager.arena.raycast(center, right, 100);
        return { hit: hit ? { distance: hit.distance } : null };
    });
    // The fixture uses the actual wall ray query, so changing the seed/radius cannot invalidate its starting gap.
    expect(before.hit?.distance).toBeGreaterThan(27);
    const start = await page.evaluate(radius => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        const frame = manager.endlessParcoursRuntime.getCoursePoint(0, 0, 0, 60);
        const right = human.position.clone().copy(frame.right), center = human.position.clone().copy(frame.position);
        const contact = manager.arena.getCollisionInfo(center.clone().addScaledVector(right, radius - 0.1), 1);
        const normal = contact?.normal?.dot(right);
        human.position.copy(center).addScaledVector(right, radius - human.hitboxRadius - 5);
        human.quaternion.premultiply(human.quaternion.clone().setFromUnitVectors(human.getDirection().normalize(), right));
        human.spawnProtectionTimer = 0; human.shieldHP = 0;
        human.markRenderDiscontinuity('endless-p2-wall-start');
        return { hp: human.hp, wall: contact?.isWall, normal, position: human.position.toArray() };
    }, before.hit.distance);
    expect(start.wall).toBe(true);
    expect(start.normal).toBeLessThan(-0.8);
    expect((await step(session, 600)).completed).toBe(true);
    const after = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        return { hp: human.hp, alive: human.alive, position: human.position.toArray(), rescues: manager.endlessParcoursRuntime.reviveCount };
    });
    expect(after.hp).toBeLessThan(start.hp);
    expect(after.rescues).toBe(0);
    await testInfo.attach('endless-p2-wall.json', { body: JSON.stringify({ before, start, after }, null, 2), contentType: 'application/json' });
    expect(errors).toHaveLength(0);
});
