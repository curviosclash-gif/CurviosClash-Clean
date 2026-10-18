import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P5c announces a simultaneous ambush and replaces a real MG kill after its three-second gate', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page); await selectSessionType(page, 'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung', { exact: true }).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING' && window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session = { page }; await installControl(session); await setPaused(session, true);
    await page.evaluate(() => {
        const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0];
        const f = r.getCoursePoint(1, 0, 0, 30); h.position.copy(f.position);
        h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(), h.position.clone().copy(f.tangent)));
        h.spawnProtectionTimer = 99; h.markRenderDiscontinuity('wave-start-fixture'); r.update(0);
        const events = []; window.__endlessSpawnEvents = events;
        const activate = m.activateBotSlot;
        m.activateBotSlot = function(options) {
            const ambushId = r._botSlots[options.slot].ambushId || '';
            const activated = activate.call(this, options);
            if (activated) events.push({ slot: options.slot, time: r.elapsedCombatSeconds, ambushId,
                position: [options.position.x, options.position.y, options.position.z] });
            return activated;
        };
        const died = r.handlePlayerDeath;
        window.__endlessDeaths = [];
        r.handlePlayerDeath = function(player, cause, options) {
            window.__endlessDeaths.push({ index: player.index, cause, time: r.elapsedCombatSeconds });
            return died.call(this, player, cause, options);
        };
    });
    let warning;
    // Follow the centreline through normal simulation until the real fourth wave.
    // No wave number, slot reservation, clock or attack phase is forced by the fixture.
    for (let tick = 0; tick < 380; tick++) {
        await page.evaluate(() => {
            const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0];
            const f = r.projectCoursePoint(h.position);
            h.position.copy(f.position);
            h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(), h.position.clone().copy(f.tangent)));
            h.spawnProtectionTimer = 99; h.markRenderDiscontinuity('centreline-flight-fixture');
        });
        expect((await step(session, 500)).completed).toBe(true);
        warning = await page.evaluate(() => {
            const r = window.GAME_INSTANCE.entityManager.endlessParcoursRuntime;
            return { wave: r.waveNumber, phase: r.wavePhase, warning: r.spawnWarning,
                alive: window.GAME_INSTANCE.entityManager.humanPlayers[0].alive };
        });
        if (warning.wave === 4) break;
    }
    await testInfo.attach('endless-p5c-warning.json', { body: JSON.stringify(warning, null, 2), contentType: 'application/json' });
    expect(warning).toMatchObject({ wave: 4, phase: 'attack', alive: true, warning: { ambush: true, count: 3 } });
    await testInfo.attach('endless-p5c-warning.png', { body: await page.screenshot(), contentType: 'image/png' });
    let group;
    for (let tick = 0; tick < 16; tick++) {
        expect((await step(session, 250)).completed).toBe(true);
        group = await page.evaluate(() => window.__endlessSpawnEvents.filter(e => e.ambushId));
        if (group.length >= 3) break;
    }
    await testInfo.attach('endless-p5c-ambush.json', { body: JSON.stringify(group, null, 2), contentType: 'application/json' });
    expect(group).toHaveLength(3); expect(new Set(group.map(e => e.time)).size).toBe(1);
    const target = await page.evaluate(slot => {
        const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0], s = r._botSlots[slot];
        const index = r.currentModuleIndex;
        for (const [p, z] of [[h, 20], [s.player, 45]]) {
            const f = r.getCoursePoint(index, 0, 0, z); p.position.copy(f.position);
            p.quaternion.premultiply(p.quaternion.clone().setFromUnitVectors(p.getDirection().normalize(), p.position.clone().copy(f.tangent)));
            p.markRenderDiscontinuity('MG-target-fixture');
        }
        h.spawnProtectionTimer = 99; h.shootCooldown = 0;
        s.player.hp = 1; s.player.shieldHP = 0; s.player.spawnProtectionTimer = 0; r.update(0);
        return { slot, index: s.player.index, generation: s.activationGeneration, previousKills: r.botKills };
    }, group[0].slot);
    await page.keyboard.down('x');
    let killed;
    for (let tick = 0; tick < 12; tick++) {
        expect((await step(session, 100)).completed).toBe(true);
        killed = await page.evaluate(t => {
            const r = window.GAME_INSTANCE.entityManager.endlessParcoursRuntime, s = r._botSlots[t.slot];
            return { alive: s.player.alive, state: s.state, eligible: s.eligibleAt,
                kills: r.botKills, now: r.elapsedCombatSeconds, deaths: window.__endlessDeaths.filter(e => e.index === t.index) };
        }, target);
        if (killed.kills > target.previousKills) break;
    }
    await page.keyboard.up('x');
    await testInfo.attach('endless-p5c-kill.json', { body: JSON.stringify({ target, killed }, null, 2), contentType: 'application/json' });
    expect(killed.kills).toBe(target.previousKills + 1); expect(killed.state).toBe('reserved');
    const death = killed.deaths.at(-1); expect(death.cause).toBe('PROJECTILE');
    expect(killed.eligible - death.time).toBeCloseTo(3, 5);
    let replacement;
    for (let tick = 0; tick < 30; tick++) {
        expect((await step(session, 200)).completed).toBe(true);
        replacement = await page.evaluate(t => {
            const r = window.GAME_INSTANCE.entityManager.endlessParcoursRuntime, s = r._botSlots[t.slot];
            return { alive: s.player.alive, generation: s.activationGeneration, now: r.elapsedCombatSeconds,
                activation: window.__endlessSpawnEvents.filter(e => e.slot === t.slot).at(-1),
                occupied: r._botSlots.filter(slot => slot.state !== 'idle').length };
        }, target);
        if (replacement.now < killed.eligible) expect(replacement.generation).toBe(target.generation);
        if (replacement.generation > target.generation) break;
    }
    await testInfo.attach('endless-p5c-replacement.json', { body: JSON.stringify({ death, replacement }, null, 2), contentType: 'application/json' });
    expect(replacement.generation).toBe(target.generation + 1); expect(replacement.alive).toBe(true);
    expect(replacement.activation.time - death.time).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(replacement.occupied).toBeLessThanOrEqual(5);
    expect(errors).toHaveLength(0);
});
