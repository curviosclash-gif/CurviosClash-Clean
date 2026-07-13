import { test, expect } from '@playwright/test';
import { loadGame, openCustomSubmenu } from './helpers.js';

const V130_START_SMOKE_MAPS = [
    { mapKey: 'micro_maw', routeId: 'micro_maw_v1' },
    { mapKey: 'mirror_docks', routeId: 'mirror_docks_v1' },
    { mapKey: 'chrono_spillway', routeId: 'chrono_spillway_v1' },
];

async function startArcadeMap(page, mapKey) {
    await loadGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForFunction(() => (
        String(window.GAME_INSTANCE?.settings?.localSettings?.modePath || '') === 'arcade'
    ), null, { timeout: 5000 });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', mapKey);
    await page.waitForFunction((expectedMapKey) => (
        window.GAME_INSTANCE?.settings?.mapKey === expectedMapKey
    ), mapKey, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        if (!game?.settings) return;
        game.settings.numBots = 0;
        const botSlider = document.getElementById('bot-count');
        if (botSlider) botSlider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => {
        const hud = document.getElementById('hud');
        return !!(hud && !hud.classList.contains('hidden'));
    }, null, { timeout: 20000 });
}

async function completeAuthoredRoute(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const entityManager = game?.entityManager;
        const system = entityManager?._parcoursProgressSystem;
        const route = system?.getRouteSnapshot?.();
        const player = entityManager?.players?.find((entry) => !entry?.isBot) || entityManager?.players?.[0] || null;
        if (!system || !route || !player) {
            return { ok: false, error: 'missing-runtime-state' };
        }

        const triggerAt = (entry, nowMs) => {
            const pos = Array.isArray(entry?.pos) ? entry.pos : [0, 0, 0];
            const forward = Array.isArray(entry?.forward) ? entry.forward : [1, 0, 0];
            const previousPosition = {
                x: pos[0] - ((forward[0] || 1) * 1.0),
                y: pos[1] - ((forward[1] || 0) * 1.0),
                z: pos[2] - ((forward[2] || 0) * 1.0),
            };
            player.position.set(
                pos[0] + ((forward[0] || 1) * 0.25),
                pos[1] + ((forward[1] || 0) * 0.25),
                pos[2] + ((forward[2] || 0) * 0.25)
            );
            return system.updatePlayerProgress(player, previousPosition, nowMs);
        };

        const stages = Array.from({ length: Math.max(0, route.totalCheckpoints || 0) }, () => []);
        for (const checkpoint of route.checkpoints || []) {
            if (!Number.isInteger(checkpoint?.routeIndex)) continue;
            stages[checkpoint.routeIndex]?.push(checkpoint);
        }

        const results = [];
        let nowMs = 1000;
        for (const stageEntries of stages) {
            const entry = Array.isArray(stageEntries) ? stageEntries[0] : null;
            if (!entry) {
                return { ok: false, error: 'empty-stage', results };
            }
            const result = triggerAt(entry, nowMs);
            results.push({ checkpointId: entry.id, type: result?.type || 'none' });
            if (result?.type !== 'checkpoint') {
                return { ok: false, error: 'checkpoint-not-triggered', results };
            }
            nowMs += 2000;
        }

        const finishResult = triggerAt(route.finish, nowMs);
        const snapshot = system.getPlayerProgressSnapshot(player.index, nowMs + 1);
        const outcome = system.getRoundOutcome?.() || null;
        return {
            ok: finishResult?.type === 'finish' && snapshot?.completed === true,
            error: '',
            routeId: route.routeId,
            totalCheckpoints: route.totalCheckpoints,
            finishType: finishResult?.type || 'none',
            completed: snapshot?.completed === true,
            outcomeRouteId: outcome?.parcours?.routeId || '',
            outcomeCheckpointCount: outcome?.parcours?.checkpointCount || 0,
            results,
        };
    });
}

for (const { mapKey, routeId } of V130_START_SMOKE_MAPS) {
    test(`V130 map-pack start smoke finishes ${mapKey}`, async ({ page }) => {
        await startArcadeMap(page, mapKey);
        const probe = await completeAuthoredRoute(page);

        expect(probe.ok, JSON.stringify(probe)).toBe(true);
        expect(probe.error).toBe('');
        expect(probe.routeId).toBe(routeId);
        expect(probe.finishType).toBe('finish');
        expect(probe.completed).toBe(true);
        expect(probe.outcomeRouteId).toBe(routeId);
        expect(probe.outcomeCheckpointCount).toBe(probe.totalCheckpoints);
    });
}
