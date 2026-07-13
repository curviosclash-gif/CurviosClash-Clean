import { test, expect } from '@playwright/test';
import { loadGame, openGameSubmenu, startGame, startGameWithBots } from './helpers.js';

async function startMazeGameWithBots(page, botCount = 3) {
    await loadGame(page);
    await openGameSubmenu(page);
    await page.selectOption('#map-select', 'maze');
    await page.evaluate((count) => {
        const slider = document.getElementById('bot-count');
        slider.value = String(count);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, botCount);
    await page.click('#submenu-game:not(.hidden) #btn-start');
    await page.waitForFunction(() => {
        const hud = document.getElementById('hud');
        const game = window.GAME_INSTANCE;
        return !!(hud && !hud.classList.contains('hidden') && game?.entityManager?.players?.length >= 4);
    }, null, { timeout: 15000 });
}

test.describe('V28 Baseline Regression Setup (28.0)', () => {
    test('T28a: Player bleibt in Controller/View Verantwortungen getrennt', async ({ page }) => {
        await startGame(page);
        const result = await page.evaluate(() => {
            const player = window.GAME_INSTANCE?.entityManager?.players?.[0];
            if (!player) return { error: 'missing-player' };

            return {
                error: null,
                hasController: typeof player.controller?.resolveControlState === 'function',
                hasViewUpdate: typeof player.view?.update === 'function',
                viewIsBoundToPlayer: player.view?.player === player,
                viewType: player.view?.viewType,
                noLegacyControlResolver: typeof player.resolveControlState === 'undefined',
            };
        });

        expect(result.error).toBeNull();
        expect(result.hasController).toBeTruthy();
        expect(result.hasViewUpdate).toBeTruthy();
        expect(result.viewIsBoundToPlayer).toBeTruthy();
        expect(result.viewType).toBe('player');
        expect(result.noLegacyControlResolver).toBeTruthy();
    });

    test('T28b: Bot-Sensing laeuft ueber BotSensorsFacade API', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const botEntry = window.GAME_INSTANCE?.entityManager?.bots?.[0] || null;
            const botAI = botEntry?.ai?._botAI
                || botEntry?.ai?._fallbackPolicy?._botAI
                || botEntry?.ai?._fallbackPolicy?._fallbackPolicy?._botAI
                || null;
            if (!botAI) return { error: 'missing-bot-ai' };

            const facade = botAI.sensorsFacade;
            if (!facade) return { error: 'missing-sensors-facade' };

            let snapshotOk = false;
            let arrayOk = false;
            try {
                snapshotOk = !!facade.getSensorSnapshot();
                const arr = facade.getSensorArray();
                arrayOk = Array.isArray(arr) && arr.length > 0;
            } catch {
                snapshotOk = false;
                arrayOk = false;
            }

            return {
                error: null,
                runtimeBound: facade.runtimeBot === botAI,
                hasMapBehavior: typeof facade.mapBehavior === 'function',
                hasProbeScore: typeof facade.scoreProbe === 'function',
                hasTrailHit: typeof facade.checkTrailHit === 'function',
                hasSensePhase: typeof facade.setSensePhase === 'function',
                snapshotOk,
                arrayOk,
            };
        });

        expect(result.error).toBeNull();
        expect(result.runtimeBound).toBeTruthy();
        expect(result.hasMapBehavior).toBeTruthy();
        expect(result.hasProbeScore).toBeTruthy();
        expect(result.hasTrailHit).toBeTruthy();
        expect(result.hasSensePhase).toBeTruthy();
        expect(result.snapshotOk).toBeTruthy();
        expect(result.arrayOk).toBeTruthy();
    });

    test('T28b2: Bot-Rendering bleibt ueber BotView vom AI-Runtimekern getrennt', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const botEntry = window.GAME_INSTANCE?.entityManager?.bots?.[0];
            const botPlayer = botEntry?.player;
            const botAI = botEntry?.ai?._botAI
                || botEntry?.ai?._fallbackPolicy?._botAI
                || botEntry?.ai?._fallbackPolicy?._fallbackPolicy?._botAI
                || null;
            if (!botPlayer || !botAI) {
                return { error: 'missing-bot-runtime' };
            }

            const visualKeys = ['group', 'vehicleMesh', 'shieldMesh', 'view'];
            return {
                error: null,
                botViewType: botPlayer.view?.viewType,
                botGroupViewType: botPlayer.group?.userData?.entityViewType,
                aiHasRenderer: typeof botAI.renderer !== 'undefined',
                aiHasVisualRefs: visualKeys.some((key) => typeof botAI[key] !== 'undefined'),
                sensorsFacadeRuntimeBound: botAI.sensorsFacade?.runtimeBot === botAI,
            };
        });

        expect(result.error).toBeNull();
        expect(result.botViewType).toBe('bot');
        expect(result.botGroupViewType).toBe('bot');
        expect(result.aiHasRenderer).toBeFalsy();
        expect(result.aiHasVisualRefs).toBeFalsy();
        expect(result.sensorsFacadeRuntimeBound).toBeTruthy();
    });

    test('T28c: Maze Draw-Calls bleiben innerhalb der Baseline-Huelle', async ({ page }) => {
        test.setTimeout(90000);
        await startMazeGameWithBots(page, 3);
        await page.waitForTimeout(800);

        const metrics = await page.evaluate(async () => {
            const renderInfo = window.GAME_INSTANCE?.renderer?.renderer?.info?.render;
            if (!renderInfo) return { error: 'missing-render-info' };

            const samples = [];
            for (let i = 0; i < 20; i += 1) {
                const calls = Number(window.GAME_INSTANCE?.renderer?.renderer?.info?.render?.calls ?? 0);
                samples.push(Number.isFinite(calls) ? calls : 0);
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            const sum = samples.reduce((acc, value) => acc + value, 0);
            const avg = samples.length > 0 ? sum / samples.length : 0;
            const max = samples.length > 0 ? Math.max(...samples) : 0;
            return {
                error: null,
                sampleCount: samples.length,
                drawCallsAverage: avg,
                drawCallsMax: max,
            };
        });

        expect(metrics.error).toBeNull();
        expect(metrics.sampleCount).toBe(20);
        expect(metrics.drawCallsAverage).toBeLessThanOrEqual(38);
        expect(metrics.drawCallsMax).toBeLessThanOrEqual(50);
    });
});
