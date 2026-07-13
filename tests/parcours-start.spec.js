import { test, expect } from '@playwright/test';
import { loadGame, openCustomSubmenu } from './helpers.js';

test('T60e: sichtbarer Parcours-Start-Ring triggert den ersten Checkpoint', async ({ page }) => {
    await loadGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForFunction(() => String(window.GAME_INSTANCE?.settings?.localSettings?.modePath || '') === 'arcade', null, { timeout: 5000 });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'parcours_rift');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'parcours_rift', null, { timeout: 5000 });
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

    const probe = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const entityManager = game?.entityManager;
        const system = entityManager?._parcoursProgressSystem;
        const route = system?.getRouteSnapshot?.();
        const player = entityManager?.players?.find((entry) => !entry?.isBot) || entityManager?.players?.[0] || null;
        const ring = game?.arena?.checkpointRings?.find((entry) => entry?.checkpointId === 'CP01') || null;
        const authored = game?.arena?.currentMapDefinition?.parcours?.checkpoints?.find((entry) => entry?.id === 'CP01') || null;
        if (!system || !route || !player || !ring || !authored) {
            return { error: 'missing-runtime-state' };
        }

        const playerSpawn = [player.position.x, player.position.y, player.position.z];
        const snapshotBefore = system.getPlayerProgressSnapshot(player.index);
        const cp01 = route.checkpoints.find((entry) => entry.id === 'CP01') || null;
        const triggerAt = (pos, forward, nowMs) => {
            const prev = {
                x: pos[0] - ((forward?.[0] || 1) * 1.0),
                y: pos[1] - ((forward?.[1] || 0) * 1.0),
                z: pos[2] - ((forward?.[2] || 0) * 1.0),
            };
            player.position.set(
                pos[0] + ((forward?.[0] || 1) * 0.25),
                pos[1] + ((forward?.[1] || 0) * 0.25),
                pos[2] + ((forward?.[2] || 0) * 0.25)
            );
            return system.updatePlayerProgress(player, prev, nowMs);
        };

        const visibleRingPos = [ring.pos.x, ring.pos.y, ring.pos.z];
        const routePos = Array.isArray(cp01?.pos) ? cp01.pos : null;
        const authoredPos = Array.isArray(authored?.pos) ? authored.pos : null;

        const visibleHit = triggerAt(visibleRingPos, cp01?.forward, 1000);
        const afterVisible = system.getPlayerProgressSnapshot(player.index);

        system.onPlayerSpawn(player, { reason: 'round_start' });
        const state = system._playerStates?.get?.(player.index);
        if (state) {
            state.insideCheckpointById?.clear?.();
        }

        const routeHit = routePos ? triggerAt(routePos, cp01?.forward, 2000) : null;
        const afterRoute = system.getPlayerProgressSnapshot(player.index);

        const distance = (a, b) => {
            if (!Array.isArray(a) || !Array.isArray(b)) return null;
            const dx = (a[0] || 0) - (b[0] || 0);
            const dy = (a[1] || 0) - (b[1] || 0);
            const dz = (a[2] || 0) - (b[2] || 0);
            return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
        };

        return {
            error: '',
            playerSpawn,
            snapshotBefore,
            visibleRingPos,
            routePos,
            authoredPos,
            distanceVisibleToRoute: distance(visibleRingPos, routePos),
            distanceAuthoredToRoute: distance(authoredPos, routePos),
            distanceSpawnToRoute: distance(authoredPos ? [player.position.x, player.position.y, player.position.z] : null, routePos),
            visibleHitType: visibleHit?.type || 'none',
            visibleNextIndex: afterVisible?.nextCheckpointIndex ?? null,
            routeHitType: routeHit?.type || 'none',
            routeNextIndex: afterRoute?.nextCheckpointIndex ?? null,
        };
    });

    expect(probe.error).toBe('');
    expect(probe.snapshotBefore?.nextCheckpointIndex).toBe(0);
    expect(probe.distanceVisibleToRoute).toBeLessThan(0.001);
    expect(probe.visibleHitType).toBe('checkpoint');
    expect(probe.visibleNextIndex).toBe(1);
    expect(probe.routeHitType).toBe('checkpoint');
    expect(probe.routeNextIndex).toBe(1);
});
