import { test, expect } from './helpers.desktop.js';
import { loadGame, openGameSubmenu, startGame, startGameWithBots, waitForRenderFrames } from './helpers.js';

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
        await waitForRenderFrames(page, 48);

        // Every draw call of 20 whole frames, split into the ships and everything else (maze world,
        // portals, effects, shadow pass). The arena keeps the original V28 envelope. Since the
        // factory ships got fixed part mounts (ddd374d6, 2026-10-06) each ship draws its parts
        // separately (~32 calls, measured 2026-10-13) so parts can be restyled and hit one by one;
        // that is a deliberate per-ship budget, not arena growth, and has its own limit.
        const metrics = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const renderer = game?.renderer?.renderer;
            if (!renderer?.renderBufferDirect) return { error: 'missing-renderer' };
            const shipRoots = new Set(game.entityManager.players.map((player) => player.view?.group).filter(Boolean));
            const isShip = (object) => {
                for (let node = object; node; node = node.parent) if (shipRoots.has(node)) return true;
                return false;
            };
            const frames = new Map();
            const original = renderer.renderBufferDirect;
            renderer.renderBufferDirect = function (camera, scene, geometry, material, object) {
                const frameId = game.gameLoop.renderFrameId;
                const frame = frames.get(frameId) || { world: 0, ships: 0 };
                if (isShip(object)) frame.ships += 1; else frame.world += 1;
                frames.set(frameId, frame);
                return original.apply(this, arguments);
            };
            try {
                for (let i = 0; i < 22; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
            } finally {
                renderer.renderBufferDirect = original;
            }
            // The first and last frame may be cut by the hook; only whole frames count.
            const whole = [...frames.values()].slice(1, -1).slice(0, 20);
            const average = (key) => whole.reduce((sum, frame) => sum + frame[key], 0) / Math.max(1, whole.length);
            return {
                error: null,
                sampleCount: whole.length,
                shipCount: shipRoots.size,
                worldDrawCallsAverage: average('world'),
                worldDrawCallsMax: Math.max(...whole.map((frame) => frame.world)),
                shipDrawCallsPerShip: average('ships') / Math.max(1, shipRoots.size),
            };
        });

        console.log(`[T28c] ${JSON.stringify(metrics)}`);
        expect(metrics.error).toBeNull();
        expect(metrics.sampleCount).toBe(20);
        expect(metrics.shipCount).toBe(4);
        // The authored maze world adds meshes beyond the original V28 primitive arena.
        expect(metrics.worldDrawCallsAverage).toBeLessThanOrEqual(100);
        expect(metrics.worldDrawCallsMax).toBeLessThanOrEqual(120);
        expect(metrics.shipDrawCallsPerShip).toBeLessThanOrEqual(40);
    });
});
