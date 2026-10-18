import { ENDLESS_PARCOURS_RULE_VERSION } from '../src/shared/contracts/EndlessParcoursWaveContract.js';
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

test('Endlos P1 native loop grants grace, launches targeted salvos and resets on reentry', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const session = await startEndless(page);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE, manager = game.entityManager, human = manager.humanPlayers[0];
        human.position.set(100, 8, 10);
        human.spawnProtectionTimer = 0;
        human.markRenderDiscontinuity('endless-zone-acceptance');
        manager.getRuntimeContext().callbacks.lifecycle.resetExclusionZoneForSpawn(human);
    });
    expect((await step(session, 2900)).completed).toBe(true);
    const grace = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        return { zone: { ...human.exclusionZoneState }, alive: human.alive,
            rockets: manager.projectiles.filter(p => p.zoneProjectile).length };
    });
    expect(grace).toMatchObject({ alive: true, rockets: 0, zone: { phase: 'GRACE', countdownSeconds: 1 } });
    expect((await step(session, 200)).completed).toBe(true);
    const salvo = await page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager, human = manager.humanPlayers[0];
        return { zone: { ...human.exclusionZoneState }, alive: human.alive, baseSpeed: human.baseSpeed,
            boostFactor: human.gameplayConfig.PLAYER.BOOST_MULTIPLIER,
            rockets: manager.projectiles.filter(p => p.zoneProjectile).map(p => ({
                type: p.type, target: p.targetPlayerIndex, bound: p.target === human,
                noReacquire: p.targetReacquireDisabled, speed: p.velocity.length(),
                position: { x: p.position.x, y: p.position.y, z: p.position.z },
            })) };
    });
    expect(salvo.zone.phase).toBe('SALVO');
    expect(salvo.zone.stage).toBe('WEAK');
    expect(salvo.rockets.length).toBeGreaterThan(0);
    expect(salvo.rockets.every(p => p.type === 'ROCKET_WEAK' && p.target === 0 && p.noReacquire)).toBe(true);
    expect(salvo.rockets.every(p => p.speed >= salvo.baseSpeed * salvo.boostFactor - 0.001)).toBe(true);
    await testInfo.attach('endless-p1-zone.json', { body: JSON.stringify({ grace, salvo }, null, 2), contentType: 'application/json' });
    await testInfo.attach('endless-p1-salvo.png', { body: await page.screenshot(), contentType: 'image/png' });
    const reentry = await page.evaluate(() => {
        const game = window.GAME_INSTANCE, manager = game.entityManager, human = manager.humanPlayers[0];
        const runtime = manager.endlessParcoursRuntime;
        const metric = runtime.getPathMetric(), range = metric.getStationRange(1);
        const center = metric.sampleAtS(range.startS + range.lengthS * 0.5).position;
        human.position.set(center.x, center.y + 8, center.z);
        human.markRenderDiscontinuity('endless-reentry-acceptance');
        manager.runtime.systems.exclusionZoneSystem.update(0);
        return { phase: human.exclusionZoneState.phase, elapsed: human.exclusionZoneState.elapsedSeconds };
    });
    expect(reentry).toEqual({ phase: 'SAFE', elapsed: 0 });
    expect(errors).toHaveLength(0);
});

test('Endlos P1 native death and spawn paths exhaust three rescues and settle the fourth death', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const session = await startEndless(page);
    const result = await page.evaluate(() => {
        const game = window.GAME_INSTANCE, manager = game.entityManager;
        const runtime = manager.endlessParcoursRuntime, human = manager.humanPlayers[0], rescues = [];
        let summary;
        for (let index = 0; index < 4; index++) {
            human.position.copy(runtime.getCoursePoint(index, 0, 8, 110).position);
            human.spawnProtectionTimer = 0;
            human.markRenderDiscontinuity('endless-rescue-acceptance');
            runtime.update(0);
            human.position.copy(runtime.getCoursePoint(index, 0, 8, 119).position);
            runtime.update(1 / 60);
            const armed = runtime.getHudState().reviveArmed;
            manager.getRuntimeContext().callbacks.lifecycle.killPlayer(human, 'PROJECTILE', { projectileType: 'ROCKET_WEAK' });
            summary = runtime.update(0);
            rescues.push({ armed, alive: human.alive, count: runtime.reviveCount,
                reason: summary?.reason || '', position: { x: human.position.x, y: human.position.y, z: human.position.z } });
        }
        return { rescues, summary, state: game.state, rankContext: runtime.rankContext };
    });
    expect(result.rescues.map(r => [r.armed, r.alive, r.count])).toEqual([
        [true, true, 1], [true, true, 2], [true, true, 3], [false, false, 3],
    ]);
    expect(result.summary.reason).toBe('ENDLESS_PLAYER_DEATH');
    expect(result.summary.ruleVersion).toBe(ENDLESS_PARCOURS_RULE_VERSION);
    expect(result.rankContext.endlessRuleVersion).toBe(result.summary.ruleVersion);
    expect(result.summary.persistence.ok).toBe(true);
    expect(result.summary.ranking.key).toContain(`:${ENDLESS_PARCOURS_RULE_VERSION}:`);
    await step(session, 100);
    await waitForRenderFrames(page, 3);
    await testInfo.attach('endless-p1-rescues.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    await testInfo.attach('endless-p1-result.png', { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toHaveLength(0);
});
