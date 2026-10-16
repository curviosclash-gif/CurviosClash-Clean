import { expect, test } from './helpers.desktop.js';
import { openGameSubmenu, openStartSetupSection, waitForLoadedGame } from './helpers.js';
import { installControl, readEvents, stopPilot } from '../scripts/playtest/playtest-control.mjs';

test('Skyscraper loads all parts and flies the complete street-to-roof course', async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    await waitForLoadedGame(page);
    await openGameSubmenu(page);
    await openStartSetupSection(page, 'map');
    await page.selectOption('#map-select', 'skyscraper_site');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'skyscraper_site');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING' && game?.arena?.currentMapKey === 'skyscraper_site'
            && game.arena._glbScene && !game.arena._glbLoadError
            && game.arena._glbAnimation?.trackCount === 4;
    }, null, { timeout: 150_000 });
    const session = { page };
    await installControl(session);
    await stopPilot(session, 'deterministic native course traversal');
    const initial = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const route = game.entityManager.getParcoursRouteSnapshot();
        return {
            routeId: route.routeId,
            ids: route.checkpoints.map(entry => entry.id),
            maxSegmentTimeMs: route.rules.maxSegmentTimeMs,
            warnings: game.arena._glbLoadWarnings.length,
            parts: game.arena._glbScene.children.length,
            portals: game.arena.portals.length,
            animationSeconds: game.arena._glbAnimation.elapsedSeconds,
            progress: game.entityManager.getParcoursHudState(0),
        };
    });
    expect(initial.routeId).toBe('skyscraper_site_v1');
    expect(initial.ids).toEqual(Array.from({ length: 18 }, (_, index) => `CP${String(index + 1).padStart(2, '0')}`));
    expect(initial.maxSegmentTimeMs).toBe(30_000);
    expect(initial.warnings).toBe(0);
    expect(initial.parts).toBe(13);
    expect(initial.portals).toBe(0);
    expect(initial.progress.passedCheckpointIds).toEqual([]);
    expect(initial.progress.resetCount).toBe(0);
    const eventSequenceStart = (await readEvents(session, 0)).lastSeq;
    await page.evaluate(() => {
        // Only orientation changes. The real GameLoop retains translation, collision, animated
        // hazards, trails, checkpoint consumption and authored segment deadlines.
        const watcher = window.__skyscraperFlight = { frame: null, checkpoints: [], samples: [], ticks: 0 };
        const observe = () => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const progress = manager.getParcoursHudState(0);
            if (!progress || progress.completed) return;
            if (++watcher.ticks % 10 === 0) {
                watcher.samples.push({ checkpoint: progress.currentCheckpoint,
                    position: manager.players[0].position.toArray(), alive: manager.players[0].alive });
                if (watcher.samples.length > 60) watcher.samples.shift();
            }
            const route = manager.getParcoursRouteSnapshot();
            const target = route.checkpoints[progress.currentCheckpoint]
                || (progress.currentCheckpoint === progress.totalCheckpoints ? route.finish : null);
            if (target) {
                if (watcher.checkpoints.at(-1) !== target.id) watcher.checkpoints.push(target.id);
                // The parallel six-world-unit line avoids the racing bot's trail while remaining
                // inside the authored ring. Ship motion and all collision rules remain active.
                // Pass behind the moving lift before crossing its X lane. Flying directly
                // between the two ring centres can meet the cabin during its normal loop.
                const behindLift = target.id === 'CP08' && manager.players[0].position.z > -96;
                const point = behindLift ? [84, 198, -102]
                    : target.pos.map((value, axis) => value + (target.forward?.[axis] || 0) * 3 + (axis === 1 ? 6 : 0));
                manager.players[0].setLookAtWorld(...point);
            }
            watcher.frame = requestAnimationFrame(observe);
        };
        watcher.frame = requestAnimationFrame(observe);
    });
    let final;
    try {
        await expect.poll(async () => {
            final = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const player = game.entityManager.players[0];
                return {
                    progress: game.entityManager.getParcoursHudState(0),
                    alive: player.alive,
                    hp: player.hp,
                    state: game.state,
                    position: player.position.toArray(),
                    animationSeconds: game.arena._glbAnimation.elapsedSeconds,
                    steered: window.__skyscraperFlight.checkpoints,
                    samples: window.__skyscraperFlight.samples,
                };
            });
            return final.progress?.completed === true || final.alive === false || final.progress?.resetCount > 0;
        }, { timeout: 210_000, intervals: [200] }).toBe(true);
    } finally {
        if (final) await testInfo.attach('skyscraper-flight-last-state.json', {
            body: JSON.stringify({ initial, final, events: await readEvents(session, eventSequenceStart) }, null, 2),
            contentType: 'application/json',
        });
        if (!page.isClosed()) await page.evaluate(() => {
            cancelAnimationFrame(window.__skyscraperFlight?.frame);
            delete window.__skyscraperFlight;
        });
        await stopPilot(session, 'Skyscraper flight finished');
    }
    const events = await readEvents(session, eventSequenceStart);
    expect(events.events.length, 'complete event history').toBe(events.lastSeq - eventSequenceStart);
    expect(events.events.filter(entry => entry.type === 'death' && entry.isHuman)).toHaveLength(0);
    expect(final.progress.passedCheckpointIds).toEqual(initial.ids);
    expect(final.progress.currentCheckpoint).toBe(18);
    expect(final.progress.completed).toBe(true);
    expect(final.progress.resetCount).toBe(0);
    expect(final.progress.checkpointRespawnsUsed).toBe(0);
    expect(final.progress.wrongOrderCount).toBe(0);
    expect(final.progress.segmentElapsedMs).toBeLessThan(30_000);
    expect(final.alive).toBe(true);
    expect(final.hp).toBeGreaterThan(0);
    expect(final.animationSeconds).toBeGreaterThan(initial.animationSeconds);
    await testInfo.attach('skyscraper-full-flight.json', {
        body: JSON.stringify({ initial, final, humanDeaths: 0 }, null, 2), contentType: 'application/json',
    });
    await testInfo.attach('skyscraper-roof.png', { body: await page.screenshot(), contentType: 'image/png' });
});
