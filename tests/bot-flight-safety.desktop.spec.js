import { test, expect } from './helpers.desktop.js';
import { loadGame } from './helpers.js';

test('shared flight safety runs on real desktop maps in 2D, 3D and combat', async ({ page }) => {
    test.setTimeout(180_000);
    await loadGame(page);
    const results = await page.evaluate(async () => {
        const game = window.GAME_INSTANCE;
        const scenarios = [
            { mode: 'CLASSIC', mapKey: 'standard', planar: false },
            { mode: 'CLASSIC', mapKey: 'standard', planar: true },
            { mode: 'HUNT', mapKey: 'core_fusion', planar: false },
            { mode: 'HUNT', mapKey: 'pillar_hall', planar: true },
            { mode: 'ARCADE', mapKey: 'eiffel_tower_arena', planar: false },
            { mode: 'CLASSIC', mapKey: 'standard', planar: true, strategy: 'rule-based' },
            { mode: 'HUNT', mapKey: 'standard', planar: false, strategy: 'heuristic' },
            { mode: 'HUNT', mapKey: 'standard', planar: false, bots: 8, ticks: 300 },
        ];
        for (const mode of ['CLASSIC', 'HUNT']) {
            for (const planar of [false, true]) {
                for (const seed of [101, 202, 303]) {
                    scenarios.push({ mode, mapKey: 'standard', planar, bots: 1, solo: true, seed, ticks: 1950 });
                }
            }
        }
        scenarios.push({ mode: 'CLASSIC', mapKey: 'standard', planar: false,
            bots: 1, solo: true, seed: 303, ticks: 3900, hz: 60 });
        const results = [];
        for (const scenario of scenarios) {
            game.settings.mode = '1p';
            game.settings.numBots = scenario.bots || 2;
            game.settings.gameMode = scenario.mode;
            game.settings.mapKey = scenario.mapKey;
            game.settings.botPolicyStrategy = scenario.strategy || 'auto';
            game.settings.arcade.seed = scenario.seed || 0;
            game.settings.gameplay.planarMode = scenario.planar;
            game.settings.localSettings = game.settings.localSettings || {};
            game.settings.localSettings.sessionType = 'single';
            game.settings.localSettings.modePath = scenario.mode === 'HUNT' ? 'fight'
                : scenario.mode === 'ARCADE' ? 'arcade' : 'normal';
            game.runtimeCoordinator.onSettingsChanged();
            await Promise.resolve(game.startMatch());
            const manager = game.entityManager;
            const debug = game.debugApi;
            const bots = manager.bots.map(({ player }) => player);
            const safety = debug.getBotFlightSafety();
            if (!safety) throw new Error(`no bot flight-safety filter in ${scenario.mode} ${scenario.mapKey}`);
            const originalOnPlayerDied = manager.onPlayerDied;
            const deaths = [];
            const originalSafetyApply = safety.apply;
            let flightSafetyMs = 0;
            safety.apply = function (...args) {
                const startedAt = performance.now();
                try {
                    return originalSafetyApply.apply(this, args);
                } finally {
                    flightSafetyMs += performance.now() - startedAt;
                }
            };
            if (!debug.setRoundEndHold(true)) throw new Error('round-end hold unavailable');
            manager.onPlayerDied = function (victim, cause) {
                if (victim?.isBot) deaths.push({ cause, at: debug.getSimulationClockMs() / 1000,
                    position: victim.position.toArray() });
                return originalOnPlayerDied?.call(this, victim, cause);
            };
            if (scenario.solo) manager.humanPlayers[0].alive = false;
            const initialSimulationMs = debug.getSimulationClockMs();
            const positions = bots.map((bot) => bot.position.clone());
            let distance = 0;
            let finite = true;
            let controlled = false;
            let firstDeathSeconds = null;
            const startedAt = performance.now();
            try {
                const hz = scenario.hz || 30;
                for (let tick = 0; tick < (scenario.ticks || 900); tick += 1) {
                    game.arena.update(1 / hz);
                    manager.update(1 / hz, game.input, tick + 1);
                    if (firstDeathSeconds === null && bots.some((bot) => !bot.alive)) {
                        firstDeathSeconds = (tick + 1) / hz;
                    }
                    if (tick % hz !== 0) continue;
                    finite &&= bots.every((bot) => Number.isFinite(bot.position.x + bot.position.y + bot.position.z));
                    controlled ||= safety.byPlayer.size > 0;
                    bots.forEach((bot, index) => {
                        distance += positions[index].distanceTo(bot.position);
                        positions[index].copy(bot.position);
                    });
                }
            } finally {
                debug.setRoundEndHold(false);
                manager.onPlayerDied = originalOnPlayerDied;
                safety.apply = originalSafetyApply;
            }
            results.push({
                requested: scenario,
                mode: game.runtimeConfig?.session?.activeGameMode,
                mapKey: game.arena.currentMapKey,
                planar: game.runtimeConfig?.gameplay?.planarMode,
                botCount: bots.length,
                finite,
                controlled,
                simulationSeconds: (debug.getSimulationClockMs() - initialSimulationMs) / 1000,
                distance: Math.round(distance),
                alive: bots.filter((bot) => bot.alive).length,
                firstDeathSeconds,
                deaths,
                flightSafetyMs,
                flightSafetyMsPerTick: flightSafetyMs / (scenario.ticks || 900),
                elapsedMs: performance.now() - startedAt,
            });
            await Promise.resolve(game.runtimeCoordinator.returnToMenu());
        }
        return results;
    });

    console.log('flight safety desktop matrix:', JSON.stringify(results));
    for (const result of results) {
        expect(result.mode).toBe(result.requested.mode);
        expect(result.mapKey).toBe(result.requested.mapKey);
        expect(result.planar).toBe(result.requested.planar);
        expect(result.botCount).toBe(result.requested.bots || 2);
        expect(result.finite).toBe(true);
        expect(result.controlled).toBe(true);
        expect(result.simulationSeconds).toBeGreaterThan((result.requested.ticks || 900) / (result.requested.hz || 30) - 1);
        expect(result.distance).toBeGreaterThan(10);
        if (result.requested.bots === 8) {
            expect(result.flightSafetyMsPerTick).toBeLessThan(6,
                `8-bot flight safety used ${result.flightSafetyMsPerTick.toFixed(2)} ms per 30 Hz tick`);
        }
        if (result.requested.solo && !result.requested.planar) {
            expect(result.firstDeathSeconds).toBeNull();
            expect(result.alive).toBe(1);
        }
    }
});
