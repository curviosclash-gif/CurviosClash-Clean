import { test, expect } from '@playwright/test';
import { loadGame, startGameWithBots, returnToMenu } from './helpers.js';

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
                navButtonsAliased: g?._navButtons === bundle?.state?._navButtons,
                menuButtonMapAliased: g?._menuButtonByPanel === bundle?.state?._menuButtonByPanel,
                wrapperKeys: Array.isArray(metadata?.legacyWrappers) ? metadata.legacyWrappers.map((entry) => entry.key) : [],
                aliasKeys: Array.isArray(metadata?.legacyAliases) ? metadata.legacyAliases.map((entry) => entry.key) : [],
                runtimeConfigAdapter: metadata?.runtimeConfigAdapter || null,
            };
        });
        expect(snapshot.hasBundle).toBe(true);
        expect(snapshot.runtimeConfigAliased).toBe(true);
        expect(snapshot.configAliased).toBe(true);
        expect(snapshot.roundStateAliased).toBe(true);
        expect(snapshot.navButtonsAliased).toBe(true);
        expect(snapshot.menuButtonMapAliased).toBe(true);
        expect(snapshot.wrapperKeys).toEqual(expect.arrayContaining(['_applySettingsToRuntime', '_returnToMenu', 'startMatch']));
        expect(snapshot.aliasKeys).toEqual(expect.arrayContaining(['roundStateController', '_navButtons', '_menuButtonByPanel']));
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
                hasMatchUiPort: typeof ports?.matchUiPort?.startMatch === 'function'
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
            const runtimeConfigStore = await import('/src/core/runtime/ActiveRuntimeConfigStore.js');
            const g = window.GAME_INSTANCE;
            g?.runtimeFacade?.applySettingsToRuntime?.({ schedulePrewarm: false });
            const foreignClearResult = runtimeConfigStore.clearActiveRuntimeConfig?.({ owner: { foreign: true } });
            const stillPresentAfterForeignClear = !!runtimeConfigStore.getActiveRuntimeConfig?.(null);
            const ownerBeforeDispose = runtimeConfigStore.getActiveRuntimeConfigOwner?.() === g?.runtimeBundle;
            g?.dispose?.();
            return {
                foreignClearResult,
                stillPresentAfterForeignClear,
                ownerBeforeDispose,
                clearedAfterDispose: runtimeConfigStore.getActiveRuntimeConfig?.(null) === null,
                ownerAfterDispose: runtimeConfigStore.getActiveRuntimeConfigOwner?.() ?? 'missing',
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
        await page.waitForTimeout(2000);
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
        await page.waitForTimeout(1000);
        await returnToMenu(page);
        const state = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return {
                hasPlayers: g?.entityManager?.players?.length > 0,
                gameLoop: !!g?.gameLoop?.running,
            };
        });
        // After returning to menu, game loop should not be running
        expect(state.gameLoop).toBe(false);
    });
});
