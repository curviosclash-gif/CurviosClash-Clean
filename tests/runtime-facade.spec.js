import { test, expect } from './helpers.desktop.js';
import { loadGame, startGameWithBots, returnToMenu, waitForRenderFrames } from './helpers.js';

test.describe('V59-59.7.2: GameRuntimeFacade', () => {

    test('RuntimeFacade is available after game load', async ({ page }) => {
        await loadGame(page);
        const exists = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return !!g?.runtimeFacade;
        });
        expect(exists).toBe(true);
    });

    test('Settings apply does not throw', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const facade = g?.runtimeFacade;
            if (!facade) return { error: 'no facade' };
            try {
                facade.applySettingsToRuntime?.();
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
        expect(result.ok).toBe(true);
    });

    test('Runtime bundle groups aliases and legacy inventories', async ({ page }) => {
        await loadGame(page);
        const snapshot = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            g?.runtimeFacade?.applySettingsToRuntime?.({ schedulePrewarm: false });
            const bundle = g?.runtimeBundle || null;
            const metadata = bundle?.metadata || null;
            return {
                hasBundle: !!bundle,
                runtimeConfigAliased: g?.runtimeConfig === bundle?.state?.runtimeConfig,
                configAliased: g?.config === bundle?.state?.config,
                roundStateAliased: g?.roundStateController === bundle?.state?.roundStateController,
                wrapperKeys: Array.isArray(metadata?.legacyWrappers) ? metadata.legacyWrappers.map((entry) => entry.key) : [],
                aliasKeys: Array.isArray(metadata?.legacyAliases) ? metadata.legacyAliases.map((entry) => entry.key) : [],
                runtimeConfigAdapter: metadata?.runtimeConfigAdapter || null,
            };
        });
        expect(snapshot.hasBundle).toBe(true);
        expect(snapshot.runtimeConfigAliased).toBe(true);
        expect(snapshot.configAliased).toBe(true);
        expect(snapshot.roundStateAliased).toBe(true);
        // Menu button lists are owned by the UI layer, not aliased through the bundle.
        expect(snapshot.wrapperKeys).toEqual(expect.arrayContaining(['_applySettingsToRuntime', '_returnToMenu', 'startMatch']));
        expect(snapshot.aliasKeys).toEqual(expect.arrayContaining(['roundStateController']));
        expect(snapshot.runtimeConfigAdapter?.kind).toBe('ActiveRuntimeConfigStore');
        expect(snapshot.runtimeConfigAdapter?.ownerScope).toBe('runtimeBundle');
    });

    test('Runtime bundle exposes lifecycle and UI orchestration ports', async ({ page }) => {
        await loadGame(page);
        const snapshot = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const ports = g?.runtimeBundle?.ports || null;
            return {
                hasLifecyclePort: typeof ports?.lifecyclePort?.returnToMenu === 'function'
                    && typeof ports?.lifecyclePort?.initializeSession === 'function',
                // startMatch moved from the match UI port to the runtime intent port with the
                // runtime dependency boundaries; the match UI port keeps the projection methods.
                hasMatchUiPort: typeof ports?.runtimeIntentPort?.startMatch === 'function'
                    && typeof ports?.matchUiPort?.applyReturnToMenuUi === 'function'
                    && typeof ports?.matchUiPort?.setupPauseOverlayListeners === 'function',
                hasRuntimeFacadeComponent: g?.runtimeBundle?.components?.runtimeFacade === g?.runtimeFacade,
                hasSessionOrchestratorComponent: !!g?.runtimeBundle?.components?.matchSessionOrchestrator,
            };
        });

        expect(snapshot.hasLifecyclePort).toBe(true);
        expect(snapshot.hasMatchUiPort).toBe(true);
        expect(snapshot.hasRuntimeFacadeComponent).toBe(true);
        expect(snapshot.hasSessionOrchestratorComponent).toBe(true);
    });

    test('Owned runtime config store clears on dispose only for the owning bundle', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const runtimeConfigStore = await window.__curviosImport('/src/core/runtime/ActiveRuntimeConfigStore.js');
            const g = window.GAME_INSTANCE;
            g?.runtimeFacade?.applySettingsToRuntime?.({ schedulePrewarm: false });
            const foreignClearResult = runtimeConfigStore.clearActiveRuntimeConfig?.({ owner: { foreign: true } });
            const stillPresentAfterForeignClear = !!runtimeConfigStore.getActiveRuntimeConfig?.(null);
            const ownerBeforeDispose = runtimeConfigStore.getActiveRuntimeConfigOwner?.() === g?.runtimeBundle;
            // Game.dispose() is asynchronous; the store is only released once it settles.
            await g?.dispose?.();
            return {
                foreignClearResult,
                stillPresentAfterForeignClear,
                ownerBeforeDispose,
                clearedAfterDispose: runtimeConfigStore.getActiveRuntimeConfig?.(null) === null,
                ownerAfterDispose: runtimeConfigStore.getActiveRuntimeConfigOwner(),
            };
        });
        expect(result.foreignClearResult).toBe(false);
        expect(result.stillPresentAfterForeignClear).toBe(true);
        expect(result.ownerBeforeDispose).toBe(true);
        expect(result.clearedAfterDispose).toBe(true);
        expect(result.ownerAfterDispose).toBeNull();
    });

    test('Session switch: start match then return to menu', async ({ page }) => {
        await startGameWithBots(page, 1);
        await waitForRenderFrames(page, 120);
        await returnToMenu(page);
        const menuVisible = await page.evaluate(() => {
            const menu = document.getElementById('main-menu');
            return !!(menu && !menu.classList.contains('hidden'));
        });
        expect(menuVisible).toBe(true);
    });

    test('Pause and resume does not crash', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            try {
                if (typeof g?.pause === 'function') g.pause();
                if (typeof g?.resume === 'function') g.resume();
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        });
        expect(result.ok).toBe(true);
    });

    test('Cleanup/dispose does not leave dangling state', async ({ page }) => {
        await startGameWithBots(page, 1);
        await waitForRenderFrames(page, 60);
        await returnToMenu(page);
        const state = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return {
                gameState: String(g?.state || ''),
                hasMatchPlayers: (g?.entityManager?.players?.length || 0) > 0,
                roundStateDetached: !g?.roundStateController || g?.state !== 'PLAYING',
            };
        });
        // The loop keeps driving the menu scene; what must not linger is a match state.
        expect(state.gameState).toBe('MENU');
        expect(state.roundStateDetached).toBe(true);
    });
});
