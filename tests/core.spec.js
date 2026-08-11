import { expect, test } from './helpers.desktop.js';
import {
    collectErrors,
    returnToMenu,
    startGameFromMenu,
    waitForLoadedGame,
    waitForRenderFrames,
} from './helpers.js';

test.describe('Desktop Smoke', () => {
    test('boots the desktop app to menu with preload bridge and GAME_INSTANCE', async ({ page, desktopHarness }) => {
        const errors = collectErrors(page);
        await waitForLoadedGame(page);

        const runtimeState = await page.evaluate(() => ({
            mainMenuVisible: !!document.getElementById('main-menu')
                && !document.getElementById('main-menu')?.classList.contains('hidden'),
            canvasVisible: !!document.getElementById('game-canvas')
                && !document.getElementById('game-canvas')?.classList.contains('hidden'),
            hasGameInstance: !!window.GAME_INSTANCE,
            preloadBridgeReady: globalThis.__CURVIOS_APP__ === true && globalThis.curviosApp?.isApp === true,
            runtimeKind: window.curviosApp?.capabilities?.runtimeKind || null,
            productSurfaceId: window.GAME_INSTANCE?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || null,
            externalFontResources: performance.getEntriesByType('resource')
                .map((entry) => String(entry.name || ''))
                .filter((url) => /fonts\.(googleapis|gstatic)\.com/i.test(url)),
            buildInfoFontFamily: window.getComputedStyle(document.querySelector('.build-info')).fontFamily,
        }));

        expect(runtimeState.mainMenuVisible).toBeTruthy();
        expect(runtimeState.canvasVisible).toBeTruthy();
        expect(runtimeState.hasGameInstance).toBeTruthy();
        expect(runtimeState.preloadBridgeReady).toBeTruthy();
        expect(runtimeState.runtimeKind).toBe('electron');
        expect(runtimeState.productSurfaceId).toBe('desktop-app');
        expect(runtimeState.externalFontResources).toEqual([]);
        expect(runtimeState.buildInfoFontFamily).not.toMatch(/Orbitron|Inter/i);
        expect(errors).toHaveLength(0);
        expect(desktopHarness.diagnosticsPath.endsWith('desktop-startup-diagnostics.json')).toBeTruthy();
        expect(desktopHarness.artifacts.mainProcessLogPath.endsWith('desktop-main-process.log')).toBeTruthy();
        expect(desktopHarness.artifacts.rendererConsoleLogPath.endsWith('desktop-renderer-console.log')).toBeTruthy();
        expect(desktopHarness.artifacts.rendererErrorsLogPath.endsWith('desktop-renderer-errors.log')).toBeTruthy();
        expect(desktopHarness.artifacts.readyScreenshotPath.endsWith('desktop-renderer-ready.png')).toBeTruthy();
        expect(desktopHarness.artifacts.failureScreenshotPath.endsWith('desktop-renderer-failure.png')).toBeTruthy();
    });

    test('starts a match, receives desktop input, and returns to menu', async ({ page }) => {
        const errors = collectErrors(page);
        await startGameFromMenu(page);

        const inputProbe = await page.evaluate(() => ({
            upCode: String(window.GAME_INSTANCE?.input?.bindings?.PLAYER_1?.UP || 'KeyW'),
            modeType: window.GAME_INSTANCE?.entityManager?.gameModeStrategy?.modeType || null,
            playerCount: window.GAME_INSTANCE?.entityManager?.players?.length || 0,
            hudVisible: !document.getElementById('hud')?.classList.contains('hidden'),
        }));

        await page.keyboard.down(inputProbe.upCode);
        await page.waitForFunction((keyCode) => {
            const input = window.GAME_INSTANCE?.input;
            const currentInput = input?.getKeyboardInput?.(0, { includeSecondaryBindings: true });
            return !!(input?.keys?.[keyCode] && currentInput?.pitchUp);
        }, inputProbe.upCode, { timeout: 4000 });
        await page.keyboard.up(inputProbe.upCode);

        const inputArrived = await page.evaluate((keyCode) => {
            const input = window.GAME_INSTANCE?.input;
            const currentInput = input?.getKeyboardInput?.(0, { includeSecondaryBindings: true });
            return {
                keyReleased: input?.keys?.[keyCode] === false,
                playerPitchUp: currentInput?.pitchUp === false,
            };
        }, inputProbe.upCode);

        expect(inputProbe.hudVisible).toBeTruthy();
        expect(inputProbe.playerCount).toBeGreaterThan(0);
        expect(typeof inputProbe.modeType).toBe('string');
        expect(inputProbe.modeType.length).toBeGreaterThan(0);
        expect(inputArrived.keyReleased).toBeTruthy();
        expect(inputArrived.playerPitchUp).toBeTruthy();

        await returnToMenu(page);

        await expect(page.locator('#main-menu')).toBeVisible();
        await expect(page.locator('#submenu-game:not(.hidden)')).toHaveCount(1);
        expect(errors).toHaveLength(0);
    });

    test('split-screen fight renders a complete HUD for each local player', async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await page.locator('#menu-nav [data-session-type="splitscreen"]').click({ force: true });
        await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
        await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            const huntHud = document.getElementById('hunt-hud');
            return globalThis.curviosApp?.capabilities?.runtimeKind === 'electron'
                && game?.entityManager?.players?.length >= 2
                && huntHud
                && !huntHud.classList.contains('hidden');
        }, null, { timeout: 60000 });
        await waitForRenderFrames(page, 12);

        const layout = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const players = game.entityManager.players;
            players[0].hp = Math.min(players[0].maxHp, 73);
            players[1].hp = Math.min(players[1].maxHp, 41);
            game.huntHud._playerPanelTickTimer = 9999;
            game.huntHud.update(0.001);

            const rect = (selector) => {
                const element = document.querySelector(selector);
                const value = element?.getBoundingClientRect();
                return value ? {
                    left: value.left,
                    top: value.top,
                    right: value.right,
                    bottom: value.bottom,
                    width: value.width,
                    height: value.height,
                } : null;
            };
            const inspectPlayer = (playerNumber) => {
                const prefix = `#hunt-p${playerNumber}-panel`;
                const boostFill = document.querySelector(`${prefix} .hunt-arc-boost .hunt-fill`);
                const overheatFill = document.querySelector(`${prefix} .hunt-arc-overheat .hunt-fill`);
                return {
                    panel: rect(prefix),
                    summary: rect(`#p${playerNumber}-hud .player-hud-summary`),
                    vitals: rect(`${prefix} .hunt-vitals`),
                    boost: rect(`${prefix} .hunt-arc-boost`),
                    overheat: rect(`${prefix} .hunt-arc-overheat`),
                    items: rect(`#p${playerNumber}-items`),
                    itemDisplay: getComputedStyle(document.querySelector(`#p${playerNumber}-items`)).display,
                    hpText: document.querySelector(`#hunt-p${playerNumber}-hp-text`)?.textContent || '',
                    arcSegmentCounts: [boostFill, overheatFill].map((fill) => (
                        [...(fill?.querySelectorAll('.hunt-segmented-arc path') || [])]
                            .map((path) => (path.getAttribute('d').match(/M/g) || []).length)
                    )),
                };
            };
            return {
                runtimeKind: globalThis.curviosApp?.capabilities?.runtimeKind,
                viewport: { width: innerWidth, height: innerHeight },
                killFeed: rect('.hunt-kill-feed'),
                p1: inspectPlayer(1),
                p2: inspectPlayer(2),
            };
        });

        const overlaps = (a, b) => !(
            a.right <= b.left || a.left >= b.right
            || a.bottom <= b.top || a.top >= b.bottom
        );
        const half = layout.viewport.width / 2;
        expect(layout.runtimeKind).toBe('electron');
        expect(layout.p1.panel).toMatchObject({ left: 0, right: half });
        expect(layout.p2.panel).toMatchObject({ left: half, right: layout.viewport.width });

        for (const [playerIndex, playerHud] of [layout.p1, layout.p2].entries()) {
            const minX = playerIndex === 0 ? 0 : half;
            const maxX = playerIndex === 0 ? half : layout.viewport.width;
            for (const [name, elementRect] of Object.entries({
                summary: playerHud.summary,
                vitals: playerHud.vitals,
                boost: playerHud.boost,
                overheat: playerHud.overheat,
                items: playerHud.items,
            })) {
                expect(elementRect, `P${playerIndex + 1} ${name} exists`).not.toBeNull();
                expect(elementRect.left, `P${playerIndex + 1} ${name} starts in its viewport`).toBeGreaterThanOrEqual(minX - 1);
                expect(elementRect.right, `P${playerIndex + 1} ${name} stays in its viewport`).toBeLessThanOrEqual(maxX + 1);
            }
            expect(playerHud.itemDisplay).toBe('grid');
            expect(playerHud.arcSegmentCounts).toEqual([[100, 100], [100, 100]]);
            expect(overlaps(playerHud.vitals, playerHud.items)).toBe(false);
            expect(overlaps(playerHud.vitals, playerHud.boost)).toBe(false);
            expect(overlaps(playerHud.vitals, playerHud.overheat)).toBe(false);
        }
        expect(layout.p1.hpText).toMatch(/^73 \/ /);
        expect(layout.p2.hpText).toMatch(/^41 \/ /);
        expect(overlaps(layout.killFeed, layout.p1.summary)).toBe(false);
        expect(overlaps(layout.killFeed, layout.p2.summary)).toBe(false);

        await page.screenshot({ path: testInfo.outputPath('splitscreen-fight-hud.png') });
        expect(errors).toHaveLength(0);
    });

    test('graceful-close IPC reaches only the current runtime after an AppInitializer remount', async ({ page, electronApp }) => {
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await page.evaluate(() => {
            globalThis.__curviosImport = async (moduleSpecifier) => {
                const normalizedSpecifier = String(moduleSpecifier || '').trim();
                const api = globalThis?.CURVIOS_TEST_API;
                if (typeof api?.importCurviosTestModule === 'function') {
                    return api.importCurviosTestModule(normalizedSpecifier);
                }
                return import(normalizedSpecifier);
            };
        });

        const setupResult = await page.evaluate(async () => {
            const first = window.GAME_INSTANCE;
            if (!first?.constructor || !window.curviosApp?.contracts?.lifecycle) {
                return { error: 'missing-runtime-lifecycle' };
            }

            const hooks = await window.__curviosImport('/src/core/AppInitializerTestHooks.js');
            const probe = {
                firstDisposeCalls: 0,
                secondDisposeCalls: 0,
            };
            const lifecycle = window.curviosApp.contracts.lifecycle;
            const originalFirstDispose = typeof first.dispose === 'function'
                ? first.dispose.bind(first)
                : null;

            first.dispose = async () => {
                probe.firstDisposeCalls += 1;
            };

            await hooks.mountGameInstanceForTests(() => {
                const second = new first.constructor();
                const originalSecondDispose = typeof second.dispose === 'function'
                    ? second.dispose.bind(second)
                    : null;
                second.dispose = async () => {
                    probe.secondDisposeCalls += 1;
                };
                window.__gracefulCloseProbe = probe;
                window.__gracefulCloseProbe.restore = () => {
                    first.dispose = originalFirstDispose;
                    second.dispose = originalSecondDispose;
                };
                return second;
            });

            return {
                error: null,
                remounted: window.GAME_INSTANCE !== first,
                firstDisposeCallsAfterRemount: probe.firstDisposeCalls,
            };
        });

        expect(setupResult.error).toBeNull();
        expect(setupResult.remounted).toBeTruthy();
        expect(setupResult.firstDisposeCallsAfterRemount).toBe(1);

        await electronApp.evaluate(({ BrowserWindow }) => {
            const browserWindow = BrowserWindow.getAllWindows()[0];
            browserWindow?.webContents?.send?.('request-graceful-close');
            return !!browserWindow;
        });

        await waitForRenderFrames(page, 45);

        const probeResult = await page.evaluate(() => {
            const probe = window.__gracefulCloseProbe || null;
            try {
                probe?.restore?.();
            } finally {
                delete window.__gracefulCloseProbe;
            }
            return probe
                ? {
                    firstDisposeCalls: probe.firstDisposeCalls,
                    secondDisposeCalls: probe.secondDisposeCalls,
                }
                : null;
        });

        expect(probeResult).toEqual({
            firstDisposeCalls: 1,
            secondDisposeCalls: 1,
        });
        expect(errors).toHaveLength(0);
    });
});
