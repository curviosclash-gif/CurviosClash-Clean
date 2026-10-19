import { expect, test } from './helpers.desktop.js';
import { collectErrors, returnToMenu, waitForLoadedGame } from './helpers.js';
import { configurePilot, installControl, setPaused, step, stopPilot } from '../scripts/playtest/playtest-control.mjs';

for (const humans of [2, 3]) {
    test(`complete normal Fuchsjagd with ${humans} humans and four bots across all three maps`, async ({ page }, testInfo) => {
        test.setTimeout(30 * 60_000);
        await waitForLoadedGame(page);
        const errors = collectErrors(page);
        expect(await page.evaluate(async count => {
            const g = window.GAME_INSTANCE, manager = g.playerProfileManager, ids = [manager.getActiveProfile().id];
            for (let index = 1; index < count; index++) {
                const result = manager.createProfile(`Normal flight ${index + 1}`);
                if (!result.ok) throw new Error('Could not prepare independent test profile');
                ids.push(result.profile.id);
            }
            if (count === 3) g.settings.localSettings.threePlayerSplit = {
                ...g.settings.localSettings.threePlayerSplit, deviceAssignment: ['keyboard', 'keyboard', 'keyboard'] };
            return window.GAME_DEBUG.startHuntParcours('fox_hunt', { humanCount: count, profileIds: ids });
        }, humans)).toBe(true);
        const session = { page }; await installControl(session); await setPaused(session, true);
        const samples = [], maps = new Set();
        for (let turn = 0; turn < 110; turn++) {
            const sample = await page.evaluate(() => {
                const g = window.GAME_INSTANCE, m = g.entityManager;
                return { state: g.state, run: g.runtimeCoordinator.getRuntimeFacade().getArcadeRunState(),
                    humans: m?.humanPlayers?.map(p => ({ index: p.index, alive: p.alive, hp: p.hp, position: p.position.toArray(),
                        progress: m.getParcoursHudState(p.index) })),
                    bots: m?.bots?.map(b => ({ index: b.player.index, alive: b.player.alive, position: b.player.position.toArray(),
                        progress: m.getParcoursHudState(b.player.index) })) };
            });
            samples.push(sample); if (sample.run.currentMapKey) maps.add(sample.run.currentMapKey);
            if (sample.run.phase === 'finished') break;
            if (sample.state !== 'PLAYING') {
                await step(session, 3500);
                await page.waitForFunction(() => ['PLAYING', 'MATCH_END'].includes(window.GAME_INSTANCE.state)
                    && (window.GAME_INSTANCE.entityManager || window.GAME_INSTANCE.state === 'MATCH_END'), null, { timeout: 60000 });
                continue;
            }
            // Only device inputs: rotate the ordinary pilot through local seats. No position,
            // health, points, role, checkpoint or clock interventions are used in this test.
            await configurePilot(session, { mode: 'bot', policy: 'heuristic', player: turn % humans });
            await step(session, 10000); await stopPilot(session);
        }
        const result = samples.at(-1).run;
        await testInfo.attach(`fox-normal-${humans}.json`, { body: JSON.stringify({ scope: 'full normal simulation and virtual device input; isolated profiles and developer start only', samples }, null, 2), contentType: 'application/json' });
        expect([...maps]).toEqual(['neon_carnival', 'kinetic_tide', 'orbital_shipyard']);
        expect(result.phase).toBe('finished'); expect(result.postRunSummary.maps).toHaveLength(3);
        expect(result.postRunSummary.participants).toHaveLength(humans);
        expect(result.postRunSummary.saveFailures).toEqual([]);
        for (const p of result.postRunSummary.participants) expect(p.saveFailures).toEqual([]);
        await expect(page.locator('#arcade-overlay-panel')).toBeVisible();
        await testInfo.attach(`fox-normal-${humans}.png`, { body: await page.screenshot(), contentType: 'image/png' });
        expect(errors).toEqual([]); await setPaused(session, false); await returnToMenu(page);
    });
}
