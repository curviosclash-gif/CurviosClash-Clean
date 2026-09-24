import { expect, test } from './helpers.desktop.js';
import {
    collectErrors,
    ensureTestModuleImportBridge,
    returnToMenu,
    startGameFromMenu,
    waitForLoadedGame,
    waitForRenderFrames,
} from './helpers.js';

test.describe('Desktop Smoke', () => {
    test('boots the desktop app to menu with preload bridge and GAME_INSTANCE', async ({ page, desktopHarness, electronApp }) => {
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        expect(await electronApp.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio'))).toBe(true);

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

    test('starts the Endlosjagd Arcade preset with streamed Hunt combat HUD', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        await page.setViewportSize({ width: 1280, height: 720 });
        const errors = collectErrors(page);
        await waitForLoadedGame(page);
        await page.locator('#menu-nav [data-session-type="single"]').click({ force: true });
        await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ force: true });
        await page.locator('#submenu-game:not(.hidden) [data-start-section-target="arcade"]')
            .evaluate((button) => button.click());
        await page.locator('.arcade-start-mode-options > summary').click();
        await page.locator('.arcade-advanced-options > summary').click();
        await expect(page.locator('#btn-arcade-endless-start-inline')).toBeVisible();
        // Ein gesetzter Seed erzeugt dieselbe Strecke erneut, damit sich Laeufe teilen lassen.
        await expect(page.locator('#arcade-endless-records-line')).toContainText('Endlosjagd');
        await page.locator('#input-arcade-seed').fill('4242');
        await page.locator('#btn-arcade-seed-apply').click({ force: true });
        await expect(page.locator('#arcade-seed-line')).toContainText('4242');
        await page.locator('#btn-arcade-endless-start-inline').click({ force: true });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            const endless = game?.entityManager?.endlessParcoursRuntime;
            const hud = document.getElementById('arcade-score-hud');
            return game?.entityManager?.gameModeStrategy?.modeType === 'ARCADE'
                && game?.runtimeConfig?.arcade?.runType === 'endless_parcours'
                && game?.runtimeConfig?.arcade?.combatProfile === 'hunt'
                && endless
                && hud
                && getComputedStyle(hud).display !== 'none';
        }, null, { timeout: 60000 });
        await waitForRenderFrames(page, 12);

        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const endless = manager.endlessParcoursRuntime;
            return {
                modeType: manager.gameModeStrategy.modeType,
                combatModeType: manager.gameModeStrategy.getPickupModeType(),
                playerCount: manager.players.length,
                botSlots: manager.bots.length,
                inactiveBots: manager.bots.filter((entry) => entry.player.entitySlotActive === false).length,
                activeModules: endless.getDebugSnapshot().activeModules,
                hudText: document.getElementById('arcade-score-hud')?.textContent || '',
            };
        });

        expect(state).toMatchObject({
            modeType: 'ARCADE',
            combatModeType: 'HUNT',
            playerCount: 13,
            botSlots: 12,
            inactiveBots: 12,
        });
        expect(state.activeModules).toBeLessThanOrEqual(5);
        expect(state.hudText).toContain('Distanz');
        expect(state.hudText).toContain('Gefahr');
        expect(state.hudText).toContain('Bestwert');
        expect(state.hudText).toContain('Serie');
        expect(state.hudText).toContain('Tore');
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.entityManager.humanPlayers[0].position.z = 121;
            // Desktop-GPU-Last darf die verbindlichen 1,2s Atempause, 1s Warnung
            // und 1,5s Aktivierungsabstand nicht in einen Wallclock-Flake verwandeln.
            for (let step = 0; step < 40; step += 1) {
                game.entityManager.endlessParcoursRuntime.update(0.1);
            }
        });
        await page.waitForFunction(() => {
            const endless = window.GAME_INSTANCE?.entityManager?.endlessParcoursRuntime;
            return endless?.combatStarted === true && endless?.getHudState?.().activeBots >= 2;
        }, null, { timeout: 5000 });

        // Das Tor am Ende des Intros muss wirken: Punkte, Serie und Rettungsfenster.
        const afterFirstGate = await page.evaluate(
            () => window.GAME_INSTANCE.entityManager.endlessParcoursRuntime.getHudState()
        );
        expect(afterFirstGate.seed).toBe(4242);
        expect(afterFirstGate.checkpointsPassed).toBeGreaterThanOrEqual(1);
        expect(afterFirstGate.streak).toBeGreaterThanOrEqual(1);
        expect(afterFirstGate.bonusScore).toBeGreaterThan(0);
        expect(afterFirstGate.reviveArmed).toBe(true);
        expect(afterFirstGate.area).toBe('industrial');
        await expect(page.locator('#arcade-endless-overlay')).toHaveCount(1);
        const revive = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const endless = game.entityManager.endlessParcoursRuntime;
            const human = game.entityManager.humanPlayers[0];
            const speed = human.baseSpeed;
            const maxHp = human.maxHp;
            human.alive = false;
            endless.handlePlayerDeath(human, 'PROJECTILE');
            return {
                alive: human.alive,
                speed: human.baseSpeed,
                maxHp: human.maxHp,
                speedBefore: speed,
                maxHpBefore: maxHp,
                reviveCount: endless.reviveCount,
                respiteActive: endless.respiteUntilSeconds > endless.elapsedCombatSeconds,
            };
        });
        expect(revive).toMatchObject({ alive: true, reviveCount: 1, respiteActive: true });
        expect(revive.speed).toBe(revive.speedBefore);
        expect(revive.maxHp).toBe(revive.maxHpBefore);
        await page.screenshot({ path: testInfo.outputPath('endless-flight-combat-1280.png') });

        // Weiter die Strecke entlang: die Anschluesse duerfen nicht alle gerade sein.
        const connectors = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const endless = game.entityManager.endlessParcoursRuntime;
            const seen = new Set();
            const human = game.entityManager.humanPlayers[0];
            // The jumps land inside module geometry. The revived vehicle is still protected,
            // and protection now separates it from walls, which would push it sideways out of
            // the gates. The walk only checks the track, so the arena response sits it out.
            const graceBefore = human.arenaCollisionGraceTimer;
            human.arenaCollisionGraceTimer = 999;
            for (let step = 2; step < 26; step += 1) {
                human.position.z = step * 120 + 10;
                await new Promise((resolve) => requestAnimationFrame(() => resolve()));
                for (const id of endless.getDebugSnapshot().connectors) seen.add(id);
            }
            human.arenaCollisionGraceTimer = graceBefore;
            return [...seen];
        });
        expect(connectors.length).toBeGreaterThan(1);
        expect(connectors.some((id) => id !== 'straight')).toBe(true);

        const laterState = await page.evaluate(
            () => window.GAME_INSTANCE.entityManager.endlessParcoursRuntime.getHudState()
        );
        expect(laterState.checkpointsPassed).toBeGreaterThan(afterFirstGate.checkpointsPassed);
        expect(laterState.maxProgressMeters).toBeGreaterThan(2000);
        // Mehrere Tore in Folge muessen die Serie ueber den Grundwert heben.
        expect(laterState.streakMultiplier).toBeGreaterThan(1);
        expect(laterState.bonusScore).toBeGreaterThan(afterFirstGate.bonusScore);

        const waveEleven = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const endless = manager.endlessParcoursRuntime;
            const human = manager.humanPlayers[0];
            endless._botSlots.forEach((slot, index) => {
                const position = human.position.clone();
                position.set((index % 4) * 6 - 9, 8 + Math.floor(index / 4) * 4, human.position.z - 40 - index * 3);
                if (slot.player.entitySlotActive !== true) {
                    manager.activateBotSlot({ slot: slot.slot, position, role: 'pursuer', difficulty: 'HARD' });
                }
                slot.state = 'active';
                slot.activatedOrder = index + 1;
                slot.player.alive = true;
                slot.player.entitySlotActive = true;
                slot.player.isEndlessElite = false;
            });
            endless.waveNumber = 10;
            endless.wavePhase = 'resupply';
            endless.wavePhaseElapsedSeconds = 9.99;
            const resupply = endless.getHudState().wave.phase;
            endless.update(0.02);
            return {
                resupply,
                wave: endless.waveNumber,
                phase: endless.wavePhase,
                occupied: endless.getDebugSnapshot().occupiedBots,
                exchanges: endless._botSlots.filter((slot) => slot.state === 'exchange_retreat').length,
            };
        });
        expect(waveEleven).toEqual({ resupply: 'resupply', wave: 11, phase: 'attack', occupied: 12, exchanges: 1 });

        const pauses = await page.evaluate(() => {
            const endless = window.GAME_INSTANCE.entityManager.endlessParcoursRuntime;
            endless.wavePhaseElapsedSeconds = 29.99;
            endless.update(0.02);
            const retreat = endless.wavePhase;
            endless._botSlots.forEach((slot) => {
                if (slot.state === 'retreating' || slot.state === 'exchange_retreat') {
                    slot.retreatUntilSeconds = endless.elapsedCombatSeconds + 0.01;
                }
            });
            endless.wavePhaseElapsedSeconds = 3.99;
            endless.update(0.02);
            return { retreat, rest: endless.wavePhase, lastCompleted: endless.lastCompletedWave };
        });
        expect(pauses).toEqual({ retreat: 'retreat', rest: 'rest', lastCompleted: 11 });
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.screenshot({ path: testInfo.outputPath('endless-wave11-rest-1920.png') });

        const completedRunId = await page.evaluate(() => {
            const endless = window.GAME_INSTANCE.entityManager.endlessParcoursRuntime;
            endless.finalize('ENDLESS_PLAYER_DEATH');
            return endless.runId;
        });
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'MATCH_END');
        await expect(page.locator('#message-stats')).toContainText('Speicherung');
        // The result board drops every key for 1.5 s after a match end; continue only once
        // its button says the lock is over.
        await expect(page.locator('[data-postmatch-action="continue"]')).not.toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Enter');
        await page.waitForFunction((previousRunId) => {
            const game = window.GAME_INSTANCE;
            const endless = game?.entityManager?.endlessParcoursRuntime;
            return game?.state === 'PLAYING' && endless?.runId && endless.runId !== previousRunId;
        }, completedRunId, { timeout: 60000 });
        expect(errors).toHaveLength(0);

        await returnToMenu(page);
        await expect(page.locator('.hangar-window-open')).toBeVisible();
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
                    hp: rect(`${prefix} .hunt-meter-hp`),
                    shield: rect(`${prefix} .hunt-meter-shield`),
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
                boost: playerHud.boost,
                overheat: playerHud.overheat,
                items: playerHud.items,
            })) {
                expect(elementRect, `P${playerIndex + 1} ${name} exists`).not.toBeNull();
                expect(elementRect.left, `P${playerIndex + 1} ${name} starts in its viewport`).toBeGreaterThanOrEqual(minX - 1);
                expect(elementRect.right, `P${playerIndex + 1} ${name} stays in its viewport`).toBeLessThanOrEqual(maxX + 1);
            }
            expect(playerHud.itemDisplay).toBe('grid');
            expect(playerHud.arcSegmentCounts).toEqual([[10, 10], [10, 10]]);
            expect(playerHud.shield, `P${playerIndex + 1} shield exists`).not.toBeNull();
            expect(playerHud.hp, `P${playerIndex + 1} life exists`).not.toBeNull();
            expect(playerHud.shield.left).toBeLessThan(minX);
            expect(playerHud.hp.right).toBeGreaterThan(maxX);
            for (const vital of [playerHud.hp, playerHud.shield]) {
                expect(overlaps(vital, playerHud.boost)).toBe(false);
                expect(overlaps(vital, playerHud.overheat)).toBe(false);
            }
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
        await ensureTestModuleImportBridge(page);

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
