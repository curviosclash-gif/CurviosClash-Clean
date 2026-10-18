import { expect, test } from './helpers.desktop.js';
import { collectErrors, selectSessionType, waitForLoadedGame } from './helpers.js';
import { installControl, setPaused, step } from '../scripts/playtest/playtest-control.mjs';

test('Endlos P5b flies through four real side shafts and guides an attacking bot through its entrance', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page); await selectSessionType(page, 'single');
    await page.locator('[data-journey-world="flight_school"]').click();
    await page.locator('[data-journey-node="endless_hunt"]').click();
    await page.getByLabel('Endlosjagd: Wertung', { exact: true }).selectOption('free');
    await page.locator('[data-journey-start="endless_hunt"]').click();
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING' && window.GAME_INSTANCE.entityManager?.endlessParcoursRuntime);
    const session = { page }; await installControl(session); await setPaused(session, true);
    const passages = [];
    for (const side of ['left', 'right', 'top', 'bottom']) {
        const start = await page.evaluate(wanted => {
            const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0];
            let found;
            for (let index = Math.max(4, r.currentModuleIndex + 1); index < 180; index++) {
                r._syncModules(index, 4);
                const instance = r.activeModules.get(index);
                if (instance.sidePort?.side === wanted && !instance.underwater) { found = instance; break; }
            }
            if (!found) throw new Error(`No dry ${wanted} shaft`);
            const p = found.sidePort, q = p.endQ - 10;
            h.position.set(p.origin.x + p.axis.x * q, p.origin.y + p.axis.y * q, p.origin.z + p.axis.z * q);
            const inward = h.position.clone().copy(p.axis).negate();
            h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(), inward));
            h.spawnProtectionTimer = 99; h.markRenderDiscontinuity('side-shaft-entry-fixture'); r.update(0);
            return { index: found.module.moduleIndex, side: p.side, radius: p.radius, origin: p.origin, axis: p.axis,
                q, hp: h.hp, rescues: r.reviveCount, collision: Boolean(m.arena.getCollisionInfo(h.position, h.hitboxRadius)),
                outside: r._exclusionZoneSource.isOutside(h) };
        }, side);
        expect(start.collision).toBe(false); expect(start.outside).toBe(false);
        if (side === 'left') await testInfo.attach('endless-p5b-shaft.png', { body: await page.screenshot(), contentType: 'image/png' });
        let end;
        for (let tick = 0; tick < 24; tick++) {
            expect((await step(session, 250)).completed).toBe(true);
            end = await page.evaluate(s => {
                const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0];
                const q = (h.position.x - s.origin.x) * s.axis.x + (h.position.y - s.origin.y) * s.axis.y + (h.position.z - s.origin.z) * s.axis.z;
                return { q, hp: h.hp, alive: h.alive, rescues: r.reviveCount,
                    outside: r._exclusionZoneSource.isOutside(h), position: h.position.toArray() };
            }, start);
            if (end.q < start.radius - 6) break;
        }
        passages.push({ start, end });
        await testInfo.attach(`endless-p5b-${side}.json`, { body: JSON.stringify({ start, end }, null, 2), contentType: 'application/json' });
        expect(end.q).toBeLessThan(start.radius - 6); expect(end.alive).toBe(true);
        expect(end.rescues).toBe(start.rescues); expect(end.hp).toBe(start.hp); expect(end.outside).toBe(false);
    }
    const wetStart = await page.evaluate(() => {
        const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0];
        for (let index = r.currentModuleIndex + 1; index < 300; index++) {
            r._syncModules(index, 4);
            const i = r.activeModules.get(index), p = i.sidePort;
            if (!p || !i.underwater || !['left', 'right'].includes(p.side)) continue;
            const q = p.endQ + 6;
            h.position.set(p.origin.x + p.axis.x * q, p.origin.y + p.axis.y * q, p.origin.z + p.axis.z * q);
            h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(), h.position.clone().copy(p.axis).negate()));
            h.spawnProtectionTimer = 99; h.markRenderDiscontinuity('wet-shaft-boundary-fixture'); r.update(0);
            return { index, inside: m.arena.waterZoneSource.isPositionUnderwater(h.position), rescues: r.reviveCount,
                sharedVolume: i.waterMesh.geometry === i.ownedGeometries[1] };
        }
        throw new Error('No lateral wet shaft');
    });
    expect(wetStart.inside).toBe(false); expect(wetStart.sharedVolume).toBe(true);
    let wetEnd;
    for (let tick = 0; tick < 16; tick++) {
        expect((await step(session, 250)).completed).toBe(true);
        wetEnd = await page.evaluate(() => {
            const g = window.GAME_INSTANCE, m = g.entityManager, h = m.humanPlayers[0];
            return { inside: m.arena.waterZoneSource.isPositionUnderwater(h.position), submerged: h.waterSubmerged,
                speed: h.waterSpeedMultiplier, camera: g.renderer.cameras[0].userData.waterVisibilityMultiplier,
                rescues: m.endlessParcoursRuntime.reviveCount, alive: h.alive };
        });
        if (wetEnd.inside && wetEnd.submerged) break;
    }
    await testInfo.attach('endless-p5b-water.json', { body: JSON.stringify({ wetStart, wetEnd }, null, 2), contentType: 'application/json' });
    expect(wetEnd).toMatchObject({ inside: true, submerged: true, speed: 0.64, camera: 0.42, alive: true, rescues: wetStart.rescues });
    // An actual normal-wave bot is placed in a shaft, then only normal AI ticks
    // move it across the opening. Spawn timing/direction are covered by Runtime contracts.
    const fixture = await page.evaluate(() => {
        const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, h = m.humanPlayers[0];
        for (let index = Math.max(4, r.currentModuleIndex + 1); index < 400; index++) {
            r._syncModules(index, 4);
            const i = r.activeModules.get(index);
            if (i.sidePort && !i.underwater) {
                const f = r.getCoursePoint(index, 0, 0, 80); h.position.copy(f.position); r.update(0);
                h.quaternion.premultiply(h.quaternion.clone().setFromUnitVectors(h.getDirection().normalize(), h.position.clone().copy(f.tangent)));
                h.spawnProtectionTimer = 99; return { index, port: i.sidePort };
            }
        }
        throw new Error('No bot shaft fixture');
    });
    let botIndex;
    for (let tick = 0; tick < 40; tick++) {
        expect((await step(session, 250)).completed).toBe(true);
        botIndex = await page.evaluate(() => window.GAME_INSTANCE.entityManager.bots.find(b => b.player.alive && b.player.entitySlotActive)?.player.index);
        if (botIndex != null) break;
    }
    expect(botIndex).not.toBeUndefined();
    const botStart = await page.evaluate(({ index, fixture }) => {
        const m = window.GAME_INSTANCE.entityManager, r = m.endlessParcoursRuntime, b = m.players[index], p = fixture.port;
        const q = p.endQ - 8;
        b.position.set(p.origin.x + p.axis.x * q, p.origin.y + p.axis.y * q, p.origin.z + p.axis.z * q);
        b.endlessPortId = p.id;
        b.quaternion.premultiply(b.quaternion.clone().setFromUnitVectors(b.getDirection().normalize(), b.position.clone().copy(p.axis).negate()));
        b.spawnProtectionTimer = 99; b.markRenderDiscontinuity('bot-side-shaft-fixture'); r.update(0);
        return { hp: b.hp, q, policy: m.bots.find(entry => entry.player === b).ai.type,
            collision: Boolean(m.arena.getCollisionInfo(b.position, b.hitboxRadius)) };
    }, { index: botIndex, fixture });
    const samples = [];
    for (let tick = 0; tick < 24; tick++) {
        expect((await step(session, 250)).completed).toBe(true);
        samples.push(await page.evaluate(({ index, p }) => {
            const m = window.GAME_INSTANCE.entityManager, b = m.players[index];
            return { q: (b.position.x - p.origin.x) * p.axis.x + (b.position.y - p.origin.y) * p.axis.y + (b.position.z - p.origin.z) * p.axis.z,
                alive: b.alive, hp: b.hp, objective: b.botObjectiveType, position: b.position.toArray() };
        }, { index: botIndex, p: fixture.port }));
        if (samples.at(-1).q < fixture.port.radius - 6) break;
    }
    await testInfo.attach('endless-p5b-bot.json', { body: JSON.stringify({ fixture, botStart, samples }, null, 2), contentType: 'application/json' });
    expect(botStart.collision).toBe(false); expect(botStart.policy).toBe('hunt-3d');
    expect(samples.at(-1).q).toBeLessThan(fixture.port.radius - 6);
    expect(samples.every(s => s.alive && s.hp === botStart.hp)).toBe(true);
    expect(samples.some(s => s.objective === 'ENDLESS_ROUTE')).toBe(true);
    expect(errors).toHaveLength(0);
});
