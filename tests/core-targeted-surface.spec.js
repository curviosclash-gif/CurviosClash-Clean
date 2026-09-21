import {
    test,
    expect,
    CONFIG,
    collectErrors,
    lockExpertMode,
    loadGame,
    openCustomSubmenu,
    openDebugSubmenu,
    openExpertSubmenu,
    openGameSubmenu,
    openStartSetupSection,
    openLevel4Drawer,
    openMultiplayerSubmenu,
    openSubmenu,
    returnToMenu,
    resolveAppUrl,
    startGame,
    startGameWithBots,
    unlockExpertMode,
    createMapDocument,
    parseMapJSON,
    stringifyMapDocument,
    toArenaMapDefinition,
    generateJSONExport,
    importFromJSON,
    RoundMetricsStore,
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
    applyPlayerPowerup,
    updatePlayerEffects,
    waitForRenderFrames,
    SETTINGS_STORAGE_KEY,
    SETTINGS_PROFILES_STORAGE_KEY,
    LEGACY_SETTINGS_STORAGE_KEY,
    MENU_DRAFTS_STORAGE_KEY,
    MENU_PRESETS_STORAGE_KEY,
    CUSTOM_MAP_STORAGE_KEY,
    ARCADE_LAST_RUN_STORAGE_KEY,
    buildLegacyRuntimeCustomMap,
    createMockEditorManager,
} from './core-targeted.shared.js';

async function openMatchAdvancedSettings(page) {
    await openStartSetupSection(page, 'match');
    const details = page.locator('#submenu-game:not(.hidden) details.start-inline-advanced');
    if (!await details.evaluate((node) => node.open)) {
        await details.locator('summary').click();
    }
}

test.describe('T1-20: Core & Infrastruktur - Vehicle, Surface & UX', () => {
    test('T20kb: Map- und Flugzeugauswahl bleiben in State und Match konsistent', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        const selectedMapKey = await page.evaluate(() => {
            const select = document.getElementById('map-select');
            if (!(select instanceof HTMLSelectElement)) return null;
            const mapKeys = Array.from(select.options)
                .map((option) => String(option.value || '').trim())
                .filter((value) => value && value !== 'custom');
            return mapKeys.includes('maze') ? 'maze' : (mapKeys[0] || null);
        });
        expect(selectedMapKey).toBeTruthy();
        await page.selectOption('#map-select', String(selectedMapKey));
        await openStartSetupSection(page, 'vehicle');
        const selectedVehicleId = await page.evaluate(() => {
            const select = document.getElementById('vehicle-select-p1');
            if (!(select instanceof HTMLSelectElement)) return null;
            const vehicleIds = Array.from(select.options)
                .map((option) => String(option.value || '').trim())
                .filter(Boolean);
            return vehicleIds.includes('aircraft') ? 'aircraft' : (vehicleIds[0] || null);
        });
        expect(selectedVehicleId).toBeTruthy();
        await page.selectOption('#vehicle-select-p1', String(selectedVehicleId));

        await expect(page.locator('#map-select')).toHaveValue(String(selectedMapKey));
        await expect(page.locator('#vehicle-select-p1')).toHaveValue(String(selectedVehicleId));

        const selectionState = await page.evaluate(() => ({
            mapKey: window.GAME_INSTANCE?.settings?.mapKey ?? null,
            vehicleId: window.GAME_INSTANCE?.settings?.vehicles?.PLAYER_1 ?? null,
        }));

        expect(selectionState.mapKey).toBe(String(selectedMapKey));
        expect(selectionState.vehicleId).toBe(String(selectedVehicleId));

        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const game = window.GAME_INSTANCE;
            return !!(
                hud
                && !hud.classList.contains('hidden')
                && game?.entityManager?.humanPlayers?.length > 0
            );
        }, null, { timeout: 15000 });

        const matchState = await page.evaluate(() => ({
            mapKey: window.GAME_INSTANCE?.arena?.currentMapKey ?? null,
            humanVehicleId: window.GAME_INSTANCE?.entityManager?.humanPlayers?.[0]?.vehicleId ?? null,
        }));

        expect(matchState.mapKey).toBe(String(selectedMapKey));
        expect(matchState.humanVehicleId).toBe(String(selectedVehicleId));
    });

    test('T66a: Arcade-Menü enthält nur den Einstieg zum dedizierten Hangar', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await expect(page.locator('#arcade-vehicle-manager')).toHaveCount(0);
        await expect(page.locator('#arcade-vehicle-manager-mount')).toHaveCount(0);
        await expect(page.locator('.hangar-window-launch-card')).toHaveCount(1);
        await expect(page.locator('.hangar-window-open')).toHaveCount(1);
        await expect(page.locator('.hangar-window-launch-card .menu-info-hint')).toHaveAttribute(
            'title',
            'Öffnet den Fahrzeug-Workshop bildschirmfüllend in einem eigenen Fenster.'
        );
        await expect(page.locator('#submenu-game')).not.toContainText('Mastery-, Blueprint- und Lab-Hooks folgen');
        await returnToMenu(page);
    });

    test('T66c: Arcade-Combo-Regler erreichen Settings und sichtbare Labels', async ({ page }) => {
        await loadGame(page);
        await page.locator('#arcade-combo-window').evaluate((input) => {
            input.value = '9000';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.locator('#arcade-max-multiplier').evaluate((input) => {
            input.value = '12';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await expect(page.locator('#arcade-combo-window-label')).toHaveText('9.0 s');
        await expect(page.locator('#arcade-max-multiplier-label')).toHaveText('12x');
        const arcadeSettings = await page.evaluate(() => ({
            comboWindowMs: window.GAME_INSTANCE?.settings?.arcade?.comboWindowMs,
            maxMultiplier: window.GAME_INSTANCE?.settings?.arcade?.maxMultiplier,
        }));
        expect(arcadeSettings).toEqual({ comboWindowMs: 9000, maxMultiplier: 12 });
    });

    test('T66b: Vehicle-Selection bleibt zwischen Start-Setup, Settings, Snapshot und Spawn konsistent', async ({ page }) => {
        await loadGame(page);
        await page.evaluate((lastRunKey) => localStorage.removeItem(lastRunKey), ARCADE_LAST_RUN_STORAGE_KEY);

        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await openStartSetupSection(page, 'vehicle');
        const selectedVehicleId = await page.evaluate(() => {
            const options = Array.from(document.querySelectorAll('#vehicle-select-p1 option'))
                .map((option) => String(option.value || '').trim())
                .filter(Boolean);
            return options.includes('drone') ? 'drone' : (options.includes('aircraft') ? 'aircraft' : (options[0] || ''));
        });
        expect(selectedVehicleId).not.toBe('');
        await page.selectOption('#vehicle-select-p1', selectedVehicleId);
        await expect(page.locator('#vehicle-select-p1')).toHaveValue(selectedVehicleId);

        await page.evaluate(() => {
            document.getElementById('btn-arcade-start-inline')?.click();
        });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            return game?.state === 'PLAYING' && (game?.entityManager?.humanPlayers?.length || 0) > 0;
        }, null, { timeout: 60000 });

        const runtimeState = await page.evaluate((lastRunKey) => {
            const game = window.GAME_INSTANCE;
            // The last run lives in the active player profile (PlayerProfileStorageContract scopes the
            // legacy key per profile), so read the profile-scoped record and fall back to the legacy key.
            const lastRunSuffix = lastRunKey.replace(/^cuviosclash\./, '');
            const scopedKey = Object.keys(localStorage)
                .find((key) => key !== lastRunKey && key.startsWith('cuviosclash.player.') && key.endsWith(`.${lastRunSuffix}`));
            const snapshot = JSON.parse(localStorage.getItem(scopedKey || lastRunKey) || '{}');
            return {
                selectedVehicleId: String(document.getElementById('vehicle-select-p1')?.value || ''),
                settingsVehicleId: String(game?.settings?.vehicles?.PLAYER_1 || ''),
                snapshotVehicleId: String(snapshot?.vehicleId || ''),
                humanVehicleId: String(game?.entityManager?.humanPlayers?.[0]?.vehicleId || ''),
            };
        }, ARCADE_LAST_RUN_STORAGE_KEY);

        expect(runtimeState.settingsVehicleId).toBe(runtimeState.selectedVehicleId);
        expect(runtimeState.snapshotVehicleId).toBe(runtimeState.selectedVehicleId);
        expect(runtimeState.humanVehicleId).toBe(runtimeState.selectedVehicleId);
        await returnToMenu(page);
    });

    test('T20kc: Round-End-Overlay zeigt vertiefte Round- und Match-Stats an', async ({ page }) => {
        await startGameWithBots(page, 1);

        const overlayState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const players = game?.entityManager?.players || [];
            if (players.length < 2) return { error: 'missing-players' };
            const now = performance.now();
            const simulatedDurationMs = Math.max(100, Math.min(2500, now - 50));

            players[0].score = 0;
            players[1].score = 0;
            game.recorder.startRound(players);
            game.recorder.logEvent('ITEM_USE', players[0].index, 'rocket');
            game.recorder.logEvent('STUCK', players[1].index, 'wall');
            game.recorder.markPlayerDeath(players[1], 'TRAIL_SELF');
            game.recorder.roundStartTime = now - simulatedDurationMs;

            game.matchFlowUiController.onRoundEnd(players[0]);
            game.roundPause = 2.6;
            game.roundStateTickSystem.updateRoundEnd(0.3);
            const recordedDuration = Number(game.recorder.getLastRoundMetrics?.()?.duration || 0);

            const statsRoot = document.getElementById('message-stats');
            const readValue = (blockId, rowKey) => statsRoot?.querySelector(
                `[data-stats-block-id="${blockId}"] [data-stats-row-key="${rowKey}"] .message-stats-value`
            )?.textContent || '';

            return {
                state: game.state,
                overlayVisible: !document.getElementById('message-overlay')?.classList.contains('hidden'),
                statsVisible: !!statsRoot && !statsRoot.classList.contains('hidden'),
                blockIds: Array.from(statsRoot?.querySelectorAll('[data-stats-block-id]') || []).map((node) => node.getAttribute('data-stats-block-id')),
                roundWinner: readValue('round', 'winner'),
                roundDuration: readValue('round', 'duration'),
                recordedDuration,
                matchRounds: readValue('match', 'rounds'),
                scoreLeader: readValue('scoreboard', 'player-0'),
                countdownText: document.getElementById('message-sub')?.textContent || '',
            };
        });

        expect(overlayState.error || '').toBe('');
        expect(overlayState.state).toBe('ROUND_END');
        expect(overlayState.overlayVisible).toBeTruthy();
        expect(overlayState.statsVisible).toBeTruthy();
        expect(overlayState.blockIds).toEqual(expect.arrayContaining(['round', 'match', 'scoreboard']));
        expect(overlayState.roundWinner).toBe('Spieler 1');
        // The board writes "2,4 s" (German decimal comma, one decimal), so parse the comma and
        // allow the half-tenth the rounding may swallow.
        const shownDuration = Number.parseFloat(String(overlayState.roundDuration).replace(',', '.'));
        expect(Math.abs(shownDuration - overlayState.recordedDuration)).toBeLessThanOrEqual(0.051);
        expect(overlayState.matchRounds).toBe('1');
        expect(overlayState.scoreLeader).toBe('1/5');
        expect(overlayState.countdownText).toContain('Nächste Runde in 3');
    });

    test('T20kd: Match-End-Overlay zeigt Endstand und aggregierte Match-Stats', async ({ page }) => {
        await startGameWithBots(page, 1);

        const overlayState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const players = game?.entityManager?.players || [];
            if (players.length < 2) return { error: 'missing-players' };
            const now = performance.now();
            const simulatedDurationMs = Math.max(100, Math.min(2100, now - 50));

            game.winsNeeded = 3;
            players[0].score = 2;
            players[1].score = 2;
            game.recorder.startRound(players);
            game.recorder.logEvent('ITEM_USE', players[0].index, 'shield');
            game.recorder.roundStartTime = now - simulatedDurationMs;

            game.matchFlowUiController.onRoundEnd(players[0]);

            const statsRoot = document.getElementById('message-stats');
            const readTitle = (blockId) => statsRoot?.querySelector(
                `[data-stats-block-id="${blockId}"] .message-stats-title`
            )?.textContent || '';
            const readValue = (blockId, rowKey) => statsRoot?.querySelector(
                `[data-stats-block-id="${blockId}"] [data-stats-row-key="${rowKey}"] .message-stats-value`
            )?.textContent || '';

            return {
                state: game.state,
                messageText: document.getElementById('message-text')?.textContent || '',
                scoreboardTitle: readTitle('scoreboard'),
                scoreLeader: readValue('scoreboard', 'player-0'),
                matchDuration: readValue('match', 'duration'),
                botMatchPoint: statsRoot?.querySelector('[data-stats-row-key="player-1"]')?.textContent?.includes('Matchball') || false,
                roundTitle: readTitle('round'),
            };
        });

        expect(overlayState.error || '').toBe('');
        expect(overlayState.state).toBe('MATCH_END');
        expect(overlayState.messageText).toContain('Spieler 1 gewinnt das Match');
        expect(overlayState.roundTitle).toBe('Finalrunde');
        expect(overlayState.scoreboardTitle).toBe('Endstand');
        expect(overlayState.scoreLeader).toBe('3/3');
        expect(overlayState.matchDuration).toMatch(/s$/);
        expect(overlayState.botMatchPoint).toBe(false);
    });

    test('T20ke: SettingsManager liefert Balancing-Telemetrie aus dem Round-End-Pfad', async ({ page }) => {
        await startGameWithBots(page, 1);

        const telemetryProbe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const players = game?.entityManager?.players || [];
            if (players.length < 2) return { error: 'missing-players' };
            const now = performance.now();
            const simulatedDurationMs = Math.max(100, Math.min(1600, now - 50));

            players[0].score = 0;
            players[1].score = 0;
            game.recorder.startRound(players);
            game.recorder.logEvent('ITEM_USE', players[0].index, 'mode=shoot type=ROCKET_WEAK');
            game.recorder.logEvent('ITEM_USE', players[0].index, 'mode=mg type=MG');
            game.recorder.logEvent('STUCK', players[1].index, 'wall');
            game.recorder.markPlayerDeath(players[1], 'TRAIL_SELF');
            game.recorder.recordDamageEvent({
                cause: 'MG_BULLET',
                damageResult: {
                    applied: 9,
                    absorbedByShield: 0,
                    hpApplied: 9,
                },
            });
            game.recorder.recordDamageEvent({
                cause: 'ROCKET_WEAK',
                projectileType: 'ROCKET_WEAK',
                damageResult: {
                    applied: 20,
                    absorbedByShield: 5,
                    hpApplied: 15,
                },
            });
            game.recorder.roundStartTime = now - simulatedDurationMs;
            game.matchFlowUiController.onRoundEnd(players[0]);

            const telemetry = game.settingsManager.getMenuTelemetrySnapshot(game.settings);
            return {
                error: '',
                mapKey: String(game.arena?.currentMapKey || game.settings?.mapKey || ''),
                balanceRounds: Number(telemetry?.balance?.rounds || 0),
                telemetryBalance: telemetry?.balance || null,
                telemetryRecentRound: telemetry?.recentRounds?.[0] || null,
                topMap: telemetry?.topMaps?.[0]?.key || '',
            };
        });

        expect(telemetryProbe.error || '').toBe('');
        expect(telemetryProbe.balanceRounds).toBeGreaterThanOrEqual(1);
        expect(Number(telemetryProbe.telemetryBalance?.mgHitsPerRound || 0)).toBeGreaterThanOrEqual(1);
        expect(Number(telemetryProbe.telemetryBalance?.rocketHitsPerRound || 0)).toBeGreaterThanOrEqual(1);
        expect(Number(telemetryProbe.telemetryBalance?.hpDamagePerRound || 0)).toBeGreaterThan(0);
        expect(Number(telemetryProbe.telemetryBalance?.shieldAbsorbPerRound || 0)).toBeGreaterThan(0);
        expect(Number(telemetryProbe.telemetryRecentRound?.itemUseByMode?.shoot || 0)).toBe(1);
        expect(Number(telemetryProbe.telemetryRecentRound?.itemUseByMode?.mg || 0)).toBe(1);
        expect(Number(telemetryProbe.telemetryRecentRound?.itemUseByType?.ROCKET_WEAK || 0)).toBe(1);
        expect(Number(telemetryProbe.telemetryRecentRound?.mgHits || 0)).toBe(1);
        expect(Number(telemetryProbe.telemetryRecentRound?.rocketHits || 0)).toBe(1);
        expect(Number(telemetryProbe.telemetryRecentRound?.hpDamage || 0)).toBeGreaterThan(0);
        expect(Number(telemetryProbe.telemetryRecentRound?.shieldAbsorb || 0)).toBeGreaterThan(0);
        expect(telemetryProbe.topMap).toBe(telemetryProbe.mapKey);
    });

    test('T20g: Runtime-Guard blockiert Developer-Events fuer non-owner', async ({ page }) => {
        await loadGame(page);
        const guardResult = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.localSettings.actorId = 'player';
            game.settings.localSettings.developerModeVisibility = 'owner_only';
            const before = game.settings.localSettings.developerThemeId;
            game.runtimeFacade.handleMenuControllerEvent({
                contractVersion: 'menu-controller.v1',
                type: 'developer_theme_change',
                themeId: 'sandstorm-lab',
            });
            const after = game.settings.localSettings.developerThemeId;
            game.settings.localSettings.actorId = game.settings.localSettings.ownerId || 'owner';
            return { before, after };
        });

        expect(guardResult.after).toBe(guardResult.before);
    });

    test('T20h: Keyboard Navigation (Arrow/Escape) funktioniert im Menue', async ({ page }) => {
        await loadGame(page, { forceReload: true });
        const startupFocus = await page.evaluate(() => ({
            id: document.activeElement?.id || '',
            sessionType: document.activeElement?.getAttribute?.('data-session-type') || '',
        }));
        expect(startupFocus.id || startupFocus.sessionType).toBeTruthy();
        const focusIds = await page.evaluate(() => {
            const firstButton = document.querySelector('#menu-nav .nav-btn');
            firstButton?.focus();
            const first = document.activeElement?.getAttribute('data-session-type');
            return { first };
        });
        expect(focusIds.first).toBeTruthy();

        await page.keyboard.press('ArrowRight');
        const secondFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-session-type') || '');
        expect(secondFocused).not.toBe(focusIds.first);

        await openCustomSubmenu(page);
        await page.keyboard.press('Escape');
        const visiblePanels = await page.evaluate(() => (
            Array.from(document.querySelectorAll('.submenu-panel:not(.hidden)')).map((panel) => panel.id)
        ));
        expect(visiblePanels).toHaveLength(0);
    });

    test('T20ha: Escape schliesst Ebene 4 auch bei State-Desync', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await openLevel4Drawer(page, { section: 'gameplay' });

        await page.evaluate(() => {
            const stateMachine = window.GAME_INSTANCE?.uiManager?.menuStateMachine;
            stateMachine?.transition?.('main', { trigger: 'test_desync_escape_level4' });
        });

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => {
            const drawer = document.getElementById('submenu-level4');
            return !!drawer
                && drawer.classList.contains('hidden')
                && drawer.getAttribute('aria-hidden') === 'true';
        }, null, { timeout: 4000 });
    });

    test('T20hb: Close-Button schliesst Ebene 4 trotz Event-Desync', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await openLevel4Drawer(page, { section: 'tools' });

        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            if (game?.runtimeFacade?._menuEventHandlers instanceof Map) {
                game.runtimeFacade._menuEventHandlers.delete('level4_close');
            }
            if (game?.uiManager?.menuNavigationRuntime) {
                game.uiManager.menuNavigationRuntime.onLevel4CloseRequested = null;
            }
        });

        await page.click('#btn-close-level4');
        await page.waitForFunction(() => {
            const drawer = document.getElementById('submenu-level4');
            return !!drawer
                && drawer.classList.contains('hidden')
                && drawer.getAttribute('aria-hidden') === 'true'
                && !window.GAME_INSTANCE?.settings?.localSettings?.toolsState?.level4Open;
        }, null, { timeout: 4000 });
    });

    test('T20hc: Expertenbereich hat konsistenten State, Fokus und Escape-Navigation', async ({ page }) => {
        await loadGame(page);
        await openExpertSubmenu(page);

        const expertState = await page.evaluate(() => ({
            activeId: document.activeElement?.id || '',
            menuState: window.GAME_INSTANCE?.uiManager?.menuStateMachine?.getState?.() || '',
            visiblePanels: Array.from(document.querySelectorAll('.submenu-panel:not(.hidden)')).map((panel) => panel.id),
        }));
        expect(expertState.activeId).toBe('expert-password-input');
        expect(expertState.menuState).toBe('expert');
        expect(expertState.visiblePanels).toEqual(['submenu-expert']);

        await page.keyboard.press('Escape');
        const mainState = await page.evaluate(() => ({
            menuState: window.GAME_INSTANCE?.uiManager?.menuStateMachine?.getState?.() || '',
            visiblePanels: Array.from(document.querySelectorAll('.submenu-panel:not(.hidden)')).map((panel) => panel.id),
        }));
        expect(mainState.menuState).toBe('main');
        expect(mainState.visiblePanels).toHaveLength(0);
    });

    test('T20hd: Blockierte Menue-Transitionen veraendern das sichtbare Panel nicht', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);

        // submenu-expert carries an OPEN access policy, so only the state machine can refuse it:
        // the custom flow reaches path/start_setup/main/quickstart/multiplayer, never "expert".
        const result = await page.evaluate(() => {
            const runtime = window.GAME_INSTANCE?.uiManager?.menuNavigationRuntime;
            return {
                opened: runtime?.showPanel?.('submenu-expert', { trigger: 'blocked_transition_test' }),
                menuState: window.GAME_INSTANCE?.uiManager?.menuStateMachine?.getState?.() || '',
                visiblePanels: Array.from(document.querySelectorAll('.submenu-panel:not(.hidden)')).map((panel) => panel.id),
            };
        });

        expect(result.opened).toBeFalsy();
        expect(result.menuState).toBe('path');
        expect(result.visiblePanels).toEqual(['submenu-custom']);
    });

    test('T20he: Native Menue-Eingaben behalten Pfeiltastensteuerung und Fokus', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'gameplay' });

        const speedSlider = page.locator('#speed-slider');
        const speedBefore = Number(await speedSlider.inputValue());
        await speedSlider.focus();
        await page.keyboard.press('ArrowRight');
        expect(Number(await speedSlider.inputValue())).toBeGreaterThan(speedBefore);
        expect(await page.evaluate(() => document.activeElement?.id || '')).toBe('speed-slider');

        await page.click('#level4-tab-recording');
        const cameraSelect = page.locator('#normal-camera-perspective-select');
        await cameraSelect.selectOption('classic');
        await cameraSelect.focus();
        await page.keyboard.press('ArrowDown');
        expect(await cameraSelect.inputValue()).toBe('cinematic_soft');
        expect(await page.evaluate(() => document.activeElement?.id || '')).toBe('normal-camera-perspective-select');
    });

    test('T20hf: Level4-Close verarbeitet genau einen Panelwechsel ohne Abort-Telemetrie', async ({ page }) => {
        await loadGame(page);
        await page.click('[data-level4-return-target="main"][data-level4-section="gameplay"]');
        await expect(page.locator('#submenu-level4')).toBeVisible();

        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const navigation = game?.uiManager?.menuNavigationRuntime;
            const facade = game?.runtimeFacade;
            const originalPanelChanged = navigation?.onPanelChanged;
            const originalRecordTelemetry = facade?._recordMenuTelemetry?.bind(facade);
            window.__level4CloseAudit = {
                historyBefore: game?.uiManager?.menuStateMachine?.getHistory?.().length || 0,
                panelChanges: [],
                telemetry: [],
            };
            if (navigation) {
                navigation.onPanelChanged = (...args) => {
                    window.__level4CloseAudit.panelChanges.push(args[0] || null);
                    return originalPanelChanged?.(...args);
                };
            }
            if (facade) {
                facade._recordMenuTelemetry = (type, payload) => {
                    window.__level4CloseAudit.telemetry.push({ type, payload });
                    return originalRecordTelemetry?.(type, payload);
                };
            }
        });

        await page.click('#btn-close-level4');
        const closeAudit = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                historyDelta: (game?.uiManager?.menuStateMachine?.getHistory?.().length || 0)
                    - window.__level4CloseAudit.historyBefore,
                menuState: game?.uiManager?.menuStateMachine?.getState?.() || '',
                panelChanges: window.__level4CloseAudit.panelChanges,
                telemetry: window.__level4CloseAudit.telemetry,
            };
        });
        expect(closeAudit.historyDelta).toBe(1);
        expect(closeAudit.menuState).toBe('main');
        expect(closeAudit.panelChanges).toEqual([null]);
        expect(closeAudit.telemetry.filter((entry) => entry.type === 'abort')).toHaveLength(0);
    });

    test('T20i: ARIA-Status wird bei Panelwechsel konsistent gesetzt', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);

        const ariaState = await page.evaluate(() => ({
            panelHidden: document.getElementById('submenu-custom')?.getAttribute('aria-hidden'),
            sessionPressed: document.querySelector('[data-session-type="single"]')?.getAttribute('aria-pressed'),
            expandedStates: Array.from(document.querySelectorAll('[data-session-type]')).map((button) => ({
                sessionType: button.getAttribute('data-session-type'),
                expanded: button.getAttribute('aria-expanded'),
            })),
        }));

        expect(ariaState.panelHidden).toBe('false');
        expect(ariaState.sessionPressed).toBe('true');
        const expandedTrue = ariaState.expandedStates.filter((entry) => entry.expanded === 'true');
        expect(expandedTrue).toHaveLength(1);
        expect(expandedTrue[0].sessionType).toBe('single');

        await openGameSubmenu(page);
        const expandedOnLevel3 = await page.evaluate(() => (
            Array.from(document.querySelectorAll('[data-session-type]'))
                .map((button) => button.getAttribute('aria-expanded'))
                .filter((value) => value === 'true')
                .length
        ));
        expect(expandedOnLevel3).toBe(0);
    });

    test('T20ia: Expertenlogin sperrt Debug bis Passwort 1307; Developer-Menue bleibt entfernt', async ({ page }) => {
        await loadGame(page);
        await expect(page.locator('#btn-open-developer')).toHaveCount(0);
        await expect(page.locator('#submenu-developer')).toHaveCount(0);

        await openExpertSubmenu(page);
        await expect(page.locator('#expert-unlocked-state')).toBeHidden();
        await page.fill('#expert-password-input', '9999');
        await page.click('#btn-expert-unlock');
        await expect(page.locator('#expert-login-status')).toContainText('Passwort falsch');
        await expect(page.locator('#expert-unlocked-state')).toBeHidden();

        await page.fill('#expert-password-input', '1307');
        await page.click('#btn-expert-unlock');
        await expect(page.locator('#expert-unlocked-state')).toBeVisible();
        await expect(page.locator('#build-info')).toContainText('Build');
        await expect(page.locator('#btn-open-developer')).toHaveCount(0);
        await expect(page.locator('#submenu-developer')).toHaveCount(0);

        await openDebugSubmenu(page);
        await expect(page.locator('#submenu-debug')).toBeVisible();
    });

    test('T20ib: Logout sperrt den Expertenbereich erneut und Reload startet wieder gesperrt', async ({ page }) => {
        await loadGame(page);
        await unlockExpertMode(page);
        await expect(page.locator('#expert-unlocked-state')).toBeVisible();

        await lockExpertMode(page);
        await expect(page.locator('#expert-unlocked-state')).toBeHidden();
        await expect(page.locator('#expert-locked-state')).toBeVisible();

        const postLockState = await page.evaluate(() => ({
            unlocked: !!window.GAME_INSTANCE?.menuExpertLoginRuntime?.isUnlocked?.(),
            developerOpened: !!window.GAME_INSTANCE?.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-developer', { trigger: 'post_lock_test' }),
        }));
        expect(postLockState.unlocked).toBeFalsy();
        expect(postLockState.developerOpened).toBeFalsy();

        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 10000 });
        const postReloadUnlocked = await page.evaluate(() => !!window.GAME_INSTANCE?.menuExpertLoginRuntime?.isUnlocked?.());
        expect(postReloadUnlocked).toBeFalsy();
    });

    test('T20j: Menu-Compatibility-Rules fixen inkonsistente Fixed-Preset-States deterministisch', async ({ page }) => {
        await loadGame(page);
        const normalizedState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.matchSettings.activePresetId = 'ghost-fixed';
            game.settings.matchSettings.activePresetKind = 'fixed';
            game.settings.matchSettings.activePresetSourceId = 'ghost-fixed';
            game.settings.localSettings.fixedPresetId = 'ghost-fixed';
            game.settings.localSettings.fixedPresetLockEnabled = true;

            const result = game.settingsManager.applyMenuCompatibilityRules(game.settings, {
                accessContext: {
                    isOwner: true,
                    ownerId: 'owner',
                    actorId: 'owner',
                },
            });

            return {
                contractVersion: result.contractVersion,
                ruleIds: result.appliedRuleIds,
                changedKeys: result.changedKeys,
                activePresetId: game.settings.matchSettings.activePresetId,
                activePresetKind: game.settings.matchSettings.activePresetKind,
                activePresetSourceId: game.settings.matchSettings.activePresetSourceId,
                fixedPresetId: game.settings.localSettings.fixedPresetId,
                fixedPresetLockEnabled: game.settings.localSettings.fixedPresetLockEnabled,
            };
        });

        expect(normalizedState.contractVersion).toBe('menu-compatibility.v1');
        expect(normalizedState.ruleIds.includes('fixed_preset_exists')).toBeTruthy();
        expect(normalizedState.ruleIds.includes('fixed_preset_binding')).toBeTruthy();
        expect(normalizedState.ruleIds.includes('fixed_lock_requires_fixed_preset')).toBeTruthy();
        expect(normalizedState.changedKeys).toEqual(expect.arrayContaining([
            'preset.activeId',
            'preset.activeKind',
            'preset.status',
            'developer.fixedPresetLock',
        ]));
        expect(normalizedState.activePresetId).toBe('');
        expect(normalizedState.activePresetKind).toBe('');
        expect(normalizedState.activePresetSourceId).toBe('');
        expect(normalizedState.fixedPresetId).toBe('');
        expect(normalizedState.fixedPresetLockEnabled).toBeFalsy();
    });

    test('T20k: Globale Cinematic-Taste ist im Menue belegbar', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'controls' });

        await page.click('#keybind-global .keybind-btn[data-action="CINEMATIC_TOGGLE"]');
        await page.keyboard.press('KeyB');
        await waitForRenderFrames(page, 1);

        const globalBinding = await page.evaluate(() => (
            window.GAME_INSTANCE?.settings?.controls?.GLOBAL?.CINEMATIC_TOGGLE || ''
        ));
        expect(globalBinding).toBe('KeyB');
    });

    test('T20k1: Globale Recording-Taste ist im Menue belegbar', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'controls' });

        await page.click('#keybind-global .keybind-btn[data-action="RECORDING_TOGGLE"]');
        await page.keyboard.press('KeyN');
        await waitForRenderFrames(page, 1);

        const globalBinding = await page.evaluate(() => (
            window.GAME_INSTANCE?.settings?.controls?.GLOBAL?.RECORDING_TOGGLE || ''
        ));
        expect(globalBinding).toBe('KeyN');
    });

    test('T20k2: Belegungskonflikt tauscht erst nach Bestaetigung und Escape bricht ab', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'controls' });
        const before = await page.evaluate(() => ({
            up: window.GAME_INSTANCE.settings.controls.PLAYER_1.UP,
            down: window.GAME_INSTANCE.settings.controls.PLAYER_2.DOWN,
        }));
        await page.click('#keybind-p2 .keybind-btn[data-action="DOWN"]');
        await page.keyboard.press(before.up);
        await expect(page.locator('#keybind-warning')).toContainText('Tauschen?');
        expect(await page.evaluate(() => window.GAME_INSTANCE.settings.controls.PLAYER_2.DOWN)).toBe(before.down);
        await page.click('#keybind-warning .keybind-swap-confirm');
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.settings.controls.PLAYER_1.UP)).toBe(before.down);
        await expect.poll(() => page.evaluate(() => window.GAME_INSTANCE.settings.controls.PLAYER_2.DOWN)).toBe(before.up);

        await page.click('#keybind-p1 .keybind-btn[data-action="UP"]');
        await page.keyboard.press(before.up);
        await expect(page.locator('#keybind-warning')).toContainText('Tauschen?');
        await page.keyboard.press('Escape');
        await expect(page.locator('#keybind-warning')).toBeHidden();
        expect(await page.evaluate(() => window.GAME_INSTANCE.settings.controls.PLAYER_1.UP)).toBe(before.down);
    });

    test('T20l: F8 startet Cinematic-Aufnahme und F9 legt sie in die Renderliste', async ({ page }) => {
        await startGame(page);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.controls.GLOBAL.CINEMATIC_TOGGLE = 'KeyB';
            game.input.setBindings(game.settings.controls);
        });

        await page.keyboard.press('b');
        await page.waitForFunction(
            () => window.GAME_INSTANCE?.mediaRecorderSystem?.isCinematicReplayRecording?.() === true
        );
        expect(await page.evaluate(
            () => window.GAME_INSTANCE?.renderer?.getCinematicEnabled?.()
        )).toBeTruthy();

        await page.keyboard.press('F9');
        await page.waitForFunction(() => {
            const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
            return recorder?.isCinematicReplayRecording?.() === false
                && recorder?.listCinematicReplayRecordings?.().length === 1;
        });
    });

    test('T20l1: F8/F9 senden getrennte lifecycle.v1 Start- und Stoppbefehle', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'commit' });
        await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: 30000 });
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.controls.GLOBAL.CINEMATIC_TOGGLE = 'KeyB';
            game.settings.controls.GLOBAL.RECORDING_TOGGLE = 'KeyN';
            game.input.setBindings(game.settings.controls);

            const originalRecorder = game.mediaRecorderSystem;
            const probe = {
                events: [],
                recording: false,
                restore() {
                    game.mediaRecorderSystem = originalRecorder;
                },
            };

            game.mediaRecorderSystem = {
                getSupportState: () => ({ canRecord: true }),
                isRecording: () => probe.recording,
                notifyLifecycleEvent: (type, context) => {
                    const command = String(context?.command || '').toLowerCase();
                    probe.events.push({ type, command });
                    if (command === 'start') probe.recording = true;
                    if (command === 'stop') probe.recording = false;
                },
            };

            window.__recordingHotkeyProbe = probe;
        });

        await page.keyboard.press('b');
        await waitForRenderFrames(page, 2);
        await page.keyboard.press('n');
        await waitForRenderFrames(page, 2);

        const probeState = await page.evaluate(() => {
            const probe = window.__recordingHotkeyProbe || { events: [], recording: false };
            const events = Array.isArray(probe.events) ? probe.events.slice() : [];
            const recording = !!probe.recording;
            probe.restore?.();
            delete window.__recordingHotkeyProbe;
            return { events, recording };
        });

        expect(probeState.events).toHaveLength(2);
        expect(probeState.events[0]?.type).toBe('recording_requested');
        expect(probeState.events[0]?.command).toBe('start');
        expect(probeState.events[1]?.type).toBe('recording_requested');
        expect(probeState.events[1]?.command).toBe('stop');
        expect(probeState.recording).toBeFalsy();
    });

    test('T20l2: Cinematic-Aufnahme meldet WebCodecs-Starts als MP4', async ({ page }) => {
        await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'commit' });
        await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const messages = [];
            const originalShowStatusToast = game._showStatusToast;
            const originalRender = game.render;
            const originalRecorder = game.mediaRecorderSystem;
            const originalSetRecordingCaptureSettings = game.renderer?.setRecordingCaptureSettings;
            const recorder = {
                setRecordingCaptureSettings() { },
                getSupportState() {
                    return { canRecord: true };
                },
                isRecording() {
                    return false;
                },
                notifyLifecycleEvent() { },
                async stopRecording() {
                    return { stopped: true };
                },
                async startRecording() {
                    return {
                        started: true,
                        recorderEngine: 'webcodecs-native',
                    };
                },
            };

            game._showStatusToast = (message) => messages.push(String(message || ''));
            game.render = () => { };
            game.mediaRecorderSystem = recorder;
            if (game.renderer) {
                game.renderer.setRecordingCaptureSettings = () => { };
            }

            try {
                const toggled = game.runtimeFacade?.toggleCinematicRecordingFromHotkey?.();
                await new Promise((resolve) => setTimeout(resolve, 0));
                return {
                    toggled,
                    message: messages[messages.length - 1] || '',
                };
            } finally {
                game._showStatusToast = originalShowStatusToast;
                game.render = originalRender;
                game.mediaRecorderSystem = originalRecorder;
                if (game.renderer && originalSetRecordingCaptureSettings) {
                    game.renderer.setRecordingCaptureSettings = originalSetRecordingCaptureSettings;
                }
            }
        });

        expect(result.toggled).toBeTruthy();
        expect(result.message).toContain('MP4');
        expect(result.message).not.toContain('WebM');
    });

    test('T20l3: Cinematic-Renderliste rendert nur die ausgewaehlte Aufnahme', async ({ page }) => {
        await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'commit' });
        await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: 30000 });
        const prepared = await page.evaluate(() => {
            const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
            const library = recorder?._cinematicReplayLibrary;
            if (!recorder || !library) return null;
            const createReplay = (matchId, startedAt) => ({
                matchId,
                startedAt,
                endedAt: startedAt + 2000,
                durationMs: 2000,
                sampleFps: 30,
                metadata: {},
                snapshots: [{ timeMs: 0 }, { timeMs: 2000 }],
                snapshotCount: 2,
                estimatedBytes: 1024,
                partial: false,
                audioBlob: null,
            });
            const first = library.enqueue(createReplay('menu-first', 1000));
            const second = library.enqueue(createReplay('menu-second', 2000));
            recorder._cinematicReplayExporter.export = async (replay) => ({
                saved: true,
                fileName: `${replay.matchId}.mp4`,
                filePath: `C:\\Videos\\${replay.matchId}.mp4`,
            });
            recorder._notifyCinematicReplayLibraryChange();
            return {
                firstId: first.recording?.recordingId || '',
                secondId: second.recording?.recordingId || '',
            };
        });

        expect(prepared?.firstId).toBeTruthy();
        expect(prepared?.secondId).toBeTruthy();
        await expect(page.locator('#cinematic-replay-recording-select option')).toHaveCount(2);
        await page.evaluate((recordingId) => {
            const select = document.getElementById('cinematic-replay-recording-select');
            select.value = recordingId;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }, prepared.firstId);
        await page.evaluate(() => document.getElementById('cinematic-replay-render-button')?.click());
        await page.waitForFunction(
            () => window.GAME_INSTANCE?.mediaRecorderSystem?.listCinematicReplayRecordings?.().length === 1
        );
        await page.evaluate(() => document.getElementById('cinematic-replay-render-button')?.click());
        await page.waitForFunction(
            () => window.GAME_INSTANCE?.mediaRecorderSystem?.listCinematicReplayRecordings?.().length === 0
        );

        const result = await page.evaluate(() => ({
            remaining: window.GAME_INSTANCE?.mediaRecorderSystem
                ?.listCinematicReplayRecordings?.()
                .map((recording) => recording.recordingId) || [],
            options: Array.from(
                document.querySelectorAll('#cinematic-replay-recording-select option'),
                (option) => option.value
            ),
        }));
        expect(result.remaining).toEqual([]);
        expect(result.options).toEqual(['']);
    });

    test('T20l4: Menue-Render rekonstruiert eine Replay-Szene ohne aktive Match-Session', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto(resolveAppUrl(page, '/'), { waitUntil: 'commit' });
        await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const recorder = game?.mediaRecorderSystem;
            const renderFrame = recorder?._cinematicReplayExporter?.renderFrame;
            if (!game || typeof renderFrame !== 'function') return null;
            const initialRecordingSettings = game.renderer?.getRecordingCaptureSettings?.() || null;
            const runtimeConfig = game.settingsManager?.createRuntimeConfig?.(game.settings) || {};
            const numHumans = Math.max(1, Number(runtimeConfig?.session?.numHumans) || 1);
            const numBots = Math.max(0, Number(runtimeConfig?.session?.numBots) || 0);
            const playerCount = numHumans + numBots;
            const snapshotPlayers = Array.from({ length: playerCount }, (_, index) => ({
                index,
                isBot: index >= numHumans,
                alive: true,
                pos: [index * 3, 1, -index * 2],
                rot: [0, 0, 0, 1],
                health: 100,
                maxHealth: 100,
                score: 0,
                speed: 8,
                trailWidth: 0.6,
                trailInGap: false,
                vehicleId: index < 2 ? game.settings?.vehicles?.[`PLAYER_${index + 1}`] : '',
            }));
            const createReplay = (matchId, offset) => ({
                matchId,
                durationMs: 17,
                metadata: {
                    mapKey: runtimeConfig?.session?.mapKey || game.settings?.mapKey || 'standard',
                    numHumans,
                    numBots,
                    winsNeeded: runtimeConfig?.session?.winsNeeded || 1,
                    activeGameMode: runtimeConfig?.session?.activeGameMode || 'classic',
                    settings: game.settings,
                    runtimeConfig,
                },
                snapshots: [
                    {
                        timeMs: 0,
                        players: snapshotPlayers.map((player) => ({
                            ...player,
                            pos: [player.pos[0] + offset, player.pos[1], player.pos[2]],
                        })),
                        projectiles: [],
                    },
                    {
                        timeMs: 17,
                        players: snapshotPlayers.map((player) => ({
                            ...player,
                            pos: [player.pos[0] + offset + 0.2, player.pos[1], player.pos[2]],
                        })),
                        projectiles: [],
                    },
                ],
                audioBlob: null,
                audioWarning: 'audio_capture_unavailable',
            });
            const replays = [
                createReplay('menu-render-runtime-first', 0),
                createReplay('menu-render-runtime-second', 2),
            ];
            const hadActiveEntityManager = !!game.entityManager;
            const streamedFrames = new Map();
            const beginPayloads = [];
            let exportSequence = 0;
            const saveContract = {
                contractVersion: 'preload.save.v2',
                beginCinematicReplayExport: async (payload) => {
                    exportSequence++;
                    const exportId = `menu-render-export-${exportSequence}`;
                    beginPayloads.push(payload);
                    streamedFrames.set(exportId, []);
                    return { started: true, exportId };
                },
                appendCinematicReplayFrame: async (payload) => {
                    streamedFrames.get(payload.exportId)?.push(payload.frameIndex);
                    return { accepted: true };
                },
                finishCinematicReplayExport: async ({ exportId }) => ({
                    saved: true,
                    fileName: `${exportId}.mp4`,
                    filePath: `C:\\Videos\\${exportId}.mp4`,
                }),
                cancelCinematicReplayExport: async () => ({ cancelled: true }),
            };
            const runtimeGlobal = {
                __CURVIOS_APP__: true,
                curviosApp: {
                    contracts: { save: saveContract },
                    capabilities: {
                        save: {
                            available: true,
                            providerKind: 'electron-ipc',
                            contractVersion: 'preload.save.v2',
                        },
                    },
                },
            };
            const CinematicReplayExportController = recorder._cinematicReplayExporter.constructor;
            const controller = new CinematicReplayExportController({
                runtimeGlobal,
                renderFrame,
            });
            const firstExportResult = await controller.export(replays[0]);
            await new Promise((resolve) => setTimeout(resolve, 80));
            const secondExportResult = await controller.export(replays[1]);
            return {
                hadActiveEntityManager,
                saved: [
                    firstExportResult.saved === true,
                    secondExportResult.saved === true,
                ],
                sizes: beginPayloads.map((payload) => [
                    Number(payload?.width || 0),
                    Number(payload?.height || 0),
                ]),
                streamedFrames: Array.from(streamedFrames.values()),
                settingsRestored: JSON.stringify(game.renderer?.getRecordingCaptureSettings?.() || null)
                    === JSON.stringify(initialRecordingSettings),
            };
        });

        expect(result).toEqual({
            hadActiveEntityManager: false,
            saved: [true, true],
            sizes: [[1920, 1080], [1920, 1080]],
            streamedFrames: [[0, 1], [0, 1]],
            settingsRestored: true,
        });
    });

    test('T20m: Recording-AutoDownload ist aktiv und nutzt Videos-Ordnername', async ({ page }) => {
        await loadGame(page);
        const recorderState = await page.evaluate(() => {
            const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
            return {
                autoRecordingEnabled: !!recorder?.autoRecordingEnabled,
                autoDownload: !!recorder?.autoDownload,
                directoryName: String(recorder?.downloadDirectoryName || ''),
                captureFps: Number(recorder?.captureFps || 0),
            };
        });
        expect(recorderState.autoRecordingEnabled).toBeFalsy();
        expect(recorderState.autoDownload).toBeTruthy();
        expect(recorderState.directoryName).toBe('videos');
        expect(recorderState.captureFps).toBe(30);
    });

    test('T20m1: Recording-Profil und HUD-Modus sind im Menu persistierbar', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'recording' });
        await page.selectOption('#recording-profile-select', 'youtube_short');
        await page.selectOption('#recording-hud-mode-select', 'with_hud');
        await page.selectOption('#recording-orientation-select', 'portrait');
        await page.selectOption('#normal-camera-perspective-select', 'cinematic_soft');
        // The drawer is already open; switch its tab instead of reopening it.
        await page.click('#submenu-level4 [data-level4-section-target="graphics"]');
        await page.waitForSelector('#submenu-level4 [data-level4-section="graphics"].is-active', { timeout: 4000 });
        await page.uncheck('#normal-camera-reduce-motion-toggle');
        await page.evaluate(() => window.GAME_INSTANCE?._saveSettings?.());

        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 15000 });

        const persisted = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                settingsProfile: game?.settings?.recording?.profile || null,
                settingsHudMode: game?.settings?.recording?.hudMode || null,
                runtimeProfile: game?.mediaRecorderSystem?.getRecordingCaptureSettings?.()?.profile || null,
                runtimeHudMode: game?.mediaRecorderSystem?.getRecordingCaptureSettings?.()?.hudMode || null,
                settingsOrientation: game?.settings?.recording?.orientation || null,
                runtimeOrientation: game?.mediaRecorderSystem?.getRecordingCaptureSettings?.()?.orientation || null,
                rendererOrientation: game?.renderer?.getRecordingCaptureSettings?.()?.orientation || null,
                settingsPerspectiveNormal: game?.settings?.cameraPerspective?.normal || null,
                settingsPerspectiveReduceMotion: game?.settings?.cameraPerspective?.reduceMotion,
                runtimePerspectiveNormal: game?.renderer?.getCameraPerspectiveSettings?.()?.normal || null,
                runtimePerspectiveReduceMotion: game?.renderer?.getCameraPerspectiveSettings?.()?.reduceMotion,
            };
        });

        expect(persisted.settingsProfile).toBe('youtube_short');
        expect(persisted.settingsHudMode).toBe('with_hud');
        expect(persisted.runtimeProfile).toBe('youtube_short');
        expect(persisted.runtimeHudMode).toBe('with_hud');
        expect(persisted.settingsOrientation).toBe('portrait');
        expect(persisted.runtimeOrientation).toBe('portrait');
        expect(persisted.rendererOrientation).toBe('portrait');
        expect(persisted.settingsPerspectiveNormal).toBe('cinematic_soft');
        expect(persisted.settingsPerspectiveReduceMotion).toBeFalsy();
        expect(persisted.runtimePerspectiveNormal).toBe('cinematic_soft');
        expect(persisted.runtimePerspectiveReduceMotion).toBeFalsy();
    });

    test('T20m2: Shorts-Recording nutzt dynamische Aufloesung und feste P1/P2-Zuordnung', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page, { sessionType: 'splitscreen' });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const game = window.GAME_INSTANCE;
            return !!(
                hud && !hud.classList.contains('hidden')
                && game?.entityManager?.players?.length > 1
            );
        }, null, { timeout: 60000 });

        const probe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            if (!game?.renderer || !game?.entityManager || !game?.mediaRecorderSystem) return null;
            const makeEven = (value) => {
                const safe = Math.max(2, Math.floor(Number(value) || 0));
                return safe - (safe % 2);
            };

            game.settings.recording = { profile: 'youtube_short', hudMode: 'with_hud' };
            game.runtimeCoordinator.onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });
            game.renderer.prepareRecordingCaptureFrame({
                recordingActive: true,
                renderProjection: game.playingStateSystem?.getMatchRenderProjection?.() || null,
                renderAlpha: 1,
                renderDelta: 1 / 60,
                splitScreen: true,
            });

            const sourceCanvas = game.renderer.getRecordingCaptureCanvas?.();
            const baseCanvas = game.renderer.canvas;
            const baseHeight = makeEven(baseCanvas?.height || 0);
            const expectedHeight = makeEven(baseHeight * 2);
            const expectedWidth = makeEven((expectedHeight * 9) / 16);
            const meta = game.renderer.getLastRecordingCaptureMeta?.() || null;
            const recorderSettings = game.mediaRecorderSystem.getRecordingCaptureSettings?.() || null;
            const rendererSettings = game.renderer.getRecordingCaptureSettings?.() || null;

            return {
                captureWidth: Number(sourceCanvas?.width || 0),
                captureHeight: Number(sourceCanvas?.height || 0),
                expectedWidth,
                expectedHeight,
                recorderSettings,
                rendererSettings,
                meta,
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.recorderSettings?.profile).toBe('youtube_short');
        expect(probe.recorderSettings?.hudMode).toBe('with_hud');
        expect(probe.rendererSettings?.profile).toBe('youtube_short');
        expect(probe.rendererSettings?.hudMode).toBe('with_hud');
        expect(probe.captureWidth).toBe(probe.expectedWidth);
        expect(probe.captureHeight).toBe(probe.expectedHeight);
        expect(probe.meta?.layout).toBe('shorts_vertical_split');
        expect(probe.meta?.segments?.[0]?.playerIndex).toBe(0);
        expect(probe.meta?.segments?.[1]?.playerIndex).toBe(1);
    });

    test('T20m3: Shorts-Recording faellt bei Renderer-Ausfall auf Source-Fallback zurueck', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page, { sessionType: 'splitscreen' });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const game = window.GAME_INSTANCE;
            return !!(
                hud && !hud.classList.contains('hidden')
                && game?.entityManager?.players?.length > 1
            );
        }, null, { timeout: 60000 });

        const probe = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const renderer = game?.renderer;
            const entityManager = game?.entityManager;
            const recorder = game?.mediaRecorderSystem;
            if (!game || !renderer || !entityManager || !recorder) return null;

            game.settings.recording = { profile: 'youtube_short', hudMode: 'clean' };
            game.runtimeCoordinator.onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });

            const pipeline = renderer.recordingCapturePipeline;
            const originalEnsure = pipeline?._ensureShortsRenderer?.bind?.(pipeline);
            const originalIsRecording = recorder?.isRecording?.bind?.(recorder);
            if (typeof originalEnsure !== 'function' || typeof originalIsRecording !== 'function') return null;

            pipeline._shortsRendererUnavailable = true;
            pipeline._ensureShortsRenderer = () => null;
            recorder.isRecording = () => true;

            // Let the normal render loop run a couple of frames so the fallback
            // is exercised under real recording timing.
            await new Promise((resolve) => setTimeout(resolve, 800));

            pipeline._ensureShortsRenderer = originalEnsure;
            pipeline._shortsRendererUnavailable = false;
            recorder.isRecording = originalIsRecording;

            const captureCanvas = renderer.getRecordingCaptureCanvas?.() || null;
            const captureCtx = captureCanvas?.getContext?.('2d', { willReadFrequently: true }) || null;
            const width = Math.max(0, Math.floor(Number(captureCanvas?.width || 0)));
            const height = Math.max(0, Math.floor(Number(captureCanvas?.height || 0)));
            let maxLuma = 0;
            let averageLuma = 0;
            let sampleCount = 0;

            if (captureCtx && width > 1 && height > 1) {
                const frame = captureCtx.getImageData(0, 0, width, height).data;
                const step = Math.max(4, Math.floor(Math.min(width, height) / 96));
                let lumaSum = 0;
                for (let y = 0; y < height; y += step) {
                    for (let x = 0; x < width; x += step) {
                        const idx = ((y * width) + x) * 4;
                        const r = Number(frame[idx] || 0);
                        const g = Number(frame[idx + 1] || 0);
                        const b = Number(frame[idx + 2] || 0);
                        const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
                        sampleCount += 1;
                        lumaSum += luma;
                        if (luma > maxLuma) maxLuma = luma;
                    }
                }
                averageLuma = sampleCount > 0 ? (lumaSum / sampleCount) : 0;
            }

            return {
                width,
                height,
                maxLuma,
                averageLuma,
                sampleCount,
                meta: renderer.getLastRecordingCaptureMeta?.() || null,
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.width).toBeGreaterThan(100);
        expect(probe.height).toBeGreaterThan(100);
        expect(probe.sampleCount).toBeGreaterThan(0);
        expect(probe.maxLuma).toBeGreaterThan(8);
        expect(probe.averageLuma).toBeGreaterThan(2);
        expect(probe.meta?.layout).toBe('shorts_vertical_split');
    });

    test('T20n: Escape-Return finalisiert Recording-Export trotz doppeltem Lifecycle-Stop', async ({ page }) => {
        await startGame(page);
        await waitForRenderFrames(page, 30);

        const recordingState = await page.evaluate(async () => {
            const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
            const support = recorder?.getSupportState?.() || {};
            let startResult = null;
            if (support.canRecord && !recorder?.isRecording?.()) {
                startResult = await recorder?.startRecording?.({ type: 'e2e_recording_start' });
            }
            return {
                canRecord: !!support.canRecord,
                isRecording: !!recorder?.isRecording?.(),
                startResult,
            };
        });
        expect(recordingState.canRecord, 'Desktop-Recording-Capability muss im E2E-Harness aktiv sein.').toBe(true);
        expect(recordingState.isRecording, JSON.stringify(recordingState.startResult)).toBe(true);

        await returnToMenu(page);
        await waitForRenderFrames(page, 18);

        const recorderState = await page.evaluate(async () => {
            const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
            const support = recorder?.getSupportState?.() || {};
            if (!support.canRecord) {
                return {
                    canRecord: false,
                    exportMeta: null,
                };
            }

            const deadline = Date.now() + 4500;
            let exportMeta = recorder?.getLastExportMeta?.() || null;
            while (!exportMeta && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 80));
                exportMeta = recorder?.getLastExportMeta?.() || null;
            }
            return {
                canRecord: true,
                exportMeta,
            };
        });

        expect(recorderState.canRecord, 'Desktop-Recording-Capability muss bis zum Export aktiv bleiben.').toBe(true);
        expect(recorderState.exportMeta).toBeTruthy();
        expect(String(recorderState.exportMeta.fileName || '')).toMatch(/\.(webm|mp4|video)$/);
    });

    test('T20o: Session-Drafts bleiben pro Session-Typ getrennt', async ({ page }) => {
        await loadGame(page);
        const draftState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.localSettings.sessionType = 'single';
            game.settings.mapKey = 'maze';
            const saveSingle = game.settingsManager.saveSessionDraft(game.settings, 'single');

            game.settings.localSettings.sessionType = 'splitscreen';
            game.settings.mapKey = 'pyramid';
            const saveSplit = game.settingsManager.saveSessionDraft(game.settings, 'splitscreen');

            game.settings.mapKey = 'standard';
            const loadSingle = game.settingsManager.applySessionDraft(game.settings, 'single');
            const mapAfterSingle = game.settings.mapKey;
            const loadSplit = game.settingsManager.applySessionDraft(game.settings, 'splitscreen');
            const mapAfterSplit = game.settings.mapKey;
            return {
                saveSingle: saveSingle.success,
                saveSplit: saveSplit.success,
                loadSingle: loadSingle.success,
                loadSplit: loadSplit.success,
                mapAfterSingle,
                mapAfterSplit,
            };
        });
        expect(draftState.saveSingle).toBeTruthy();
        expect(draftState.saveSplit).toBeTruthy();
        expect(draftState.loadSingle).toBeTruthy();
        expect(draftState.loadSplit).toBeTruthy();
        expect(draftState.mapAfterSingle).toBe('maze');
        expect(draftState.mapAfterSplit).toBe('pyramid');
    });

    test('T20o1: sanitizeSettings haelt Session-, Clamp- und Kompatibilitaetsvertrag stabil', async ({ page }) => {
        await loadGame(page);
        const sanitized = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const defaults = game.settingsManager.createDefaultSettings();
            const settingsVersion = Number(defaults?.settingsVersion || game.settings?.settingsVersion || 1);
            const snapshot = game.settingsManager.sanitizeSettings({
                settingsVersion,
                mode: '1p',
                gameMode: 'CLASSIC',
                mapKey: 'unknown_map',
                numBots: 999,
                botDifficulty: 'UNSUPPORTED',
                winsNeeded: -5,
                hunt: { respawnEnabled: true },
                gameplay: {
                    speed: 999,
                    portalCount: -3,
                    planarMode: 'invalid',
                    portalBeams: true,
                },
                botBridge: {
                    enabled: true,
                    url: '  ws://localhost:8765/test  ',
                    timeoutMs: -1,
                    maxRetries: 999,
                    retryDelayMs: -99,
                    resumeCheckpoint: '  cp-01  ',
                    resumeStrict: true,
                },
                localSettings: {
                    sessionType: 'splitscreen',
                    modePath: 'unsupported_path',
                },
            });
            return {
                defaultsMapKey: String(defaults?.mapKey || ''),
                mapKey: String(snapshot?.mapKey || ''),
                mode: String(snapshot?.mode || ''),
                sessionType: String(snapshot?.localSettings?.sessionType || ''),
                modePath: String(snapshot?.localSettings?.modePath || ''),
                huntRespawnEnabled: !!snapshot?.hunt?.respawnEnabled,
                portalBeams: snapshot?.gameplay?.portalBeams,
                botBridgeUrl: String(snapshot?.botBridge?.url || ''),
                botBridgeResumeCheckpoint: String(snapshot?.botBridge?.resumeCheckpoint || ''),
                botBridgeResumeStrict: !!snapshot?.botBridge?.resumeStrict,
            };
        });

        expect(sanitized.mapKey).toBe(sanitized.defaultsMapKey);
        expect(sanitized.mode).toBe('2p');
        expect(sanitized.sessionType).toBe('splitscreen');
        expect(sanitized.modePath).toBe('fight');
        expect(sanitized.huntRespawnEnabled).toBeTruthy();
        expect(sanitized.portalBeams).toBe(false);
        expect(sanitized.botBridgeUrl).toBe('ws://localhost:8765/test');
        expect(sanitized.botBridgeResumeCheckpoint).toBe('cp-01');
        expect(sanitized.botBridgeResumeStrict).toBeTruthy();
    });

    test('T20p: Multiplayer-Join zeigt Feldgrund und fokussiert den Lobby-Code', async ({ page }) => {
        await loadGame(page);
        await openMultiplayerSubmenu(page, { requireActive: true });
        await expect(page.locator('#btn-start')).toBeHidden();
        // The lobby surface is a div since 879e9ac4, so "open" no longer exists on it.
        await expect(page.locator('#multiplayer-inline-stub')).toBeVisible();
        await expect(page.locator('#multiplayer-connection-controls')).toBeVisible();
        await page.click('#btn-multiplayer-join');
        await expect(page.locator('#multiplayer-status')).toContainText('Lobby-Code fehlt');
        await expect(page.locator('#multiplayer-lobby-code')).toHaveAttribute('aria-invalid', 'true');
        const focusedElementId = await page.evaluate(() => document.activeElement?.id || '');
        expect(focusedElementId).toBe('multiplayer-lobby-code');
    });

    test('T20q: Ebene-3- und Ebene-4-Reset greifen auf Defaults', async ({ page }) => {
        await loadGame(page);
        const expectedDefaults = await page.evaluate(async () => {
            const mod = await window.__curviosImport('/src/ui/menu/MenuDefaultsEditorConfig.js');
            const level3Reset = mod.createMenuLevel3ResetDefaults();
            const baseSettings = mod.createMenuBaseSettingsDefaults();
            return {
                level3MapKey: level3Reset.mapKey,
                level3VehicleP1: level3Reset.vehicles.PLAYER_1,
                level4Speed: String(baseSettings.gameplay.speed),
                level4PerspectiveNormal: String(baseSettings.cameraPerspective?.normal || 'classic'),
                level4PerspectiveReduceMotion: !!baseSettings.cameraPerspective?.reduceMotion,
            };
        });
        await openGameSubmenu(page);
        await page.selectOption('#map-select', 'complex');
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.vehicles.PLAYER_1 = 'ship8';
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['vehicles.player1'] });
        });
        await page.click('#btn-level3-reset');
        expect(await page.inputValue('#map-select')).toBe(expectedDefaults.level3MapKey);
        expect(await page.inputValue('#vehicle-select-p1')).toBe(expectedDefaults.level3VehicleP1);

        await openLevel4Drawer(page, { section: 'gameplay' });
        await page.evaluate(() => {
            const slider = document.getElementById('speed-slider');
            if (!slider) return;
            slider.value = '33';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        // Reset = defaults plus the style preset of the current game style (fresh profile values).
        expectedDefaults.level4Speed = await page.evaluate(async () => {
            const mod = await window.__curviosImport('/src/ui/menu/MenuDefaultsEditorConfig.js');
            const modePath = window.GAME_INSTANCE.settings.localSettings.modePath;
            const presetId = { fight: 'fight-standard', arcade: 'arcade', normal: 'normal-standard' }[modePath];
            const presetSpeed = mod.findFixedMenuPresetSeedById(presetId)?.values?.['gameplay.speed'];
            return String(presetSpeed ?? mod.createMenuBaseSettingsDefaults().gameplay.speed);
        });
        // The video perspective lives with the recording options; calmer camera stays in graphics.
        await page.click('#level4-tab-recording');
        await page.selectOption('#normal-camera-perspective-select', 'cinematic_action');
        await page.click('#level4-tab-graphics');
        await page.uncheck('#normal-camera-reduce-motion-toggle');
        await page.click('#level4-tab-gameplay');
        await page.click('#btn-level4-reset');
        await expect(page.locator('#btn-level4-reset')).toHaveAttribute('data-reset-armed', 'true');
        await page.click('#btn-level4-reset');
        await waitForRenderFrames(page, 2);
        expect(await page.inputValue('#speed-slider')).toBe(expectedDefaults.level4Speed);
        expect(await page.inputValue('#normal-camera-perspective-select')).toBe(expectedDefaults.level4PerspectiveNormal);
        await expect(page.locator('#normal-camera-reduce-motion-toggle')).toHaveJSProperty(
            'checked',
            expectedDefaults.level4PerspectiveReduceMotion
        );
    });

    test('T20qa: Start-Setup zeigt Fallback im UI ohne stille Vehicle-Reparatur im Settings-State', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        const repairedState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.vehicles.PLAYER_1 = 'missing_vehicle';
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['vehicles.player1'] });
            return {
                domValue: document.getElementById('vehicle-select-p1')?.value ?? '',
                settingsValue: game.settings?.vehicles?.PLAYER_1 ?? '',
                validationField: game.runtimeFacade?._resolveStartValidationIssue?.()?.fieldKey ?? '',
            };
        });

        expect(repairedState.domValue).toBeTruthy();
        expect(repairedState.domValue).not.toBe('missing_vehicle');
        expect(repairedState.settingsValue).toBe('missing_vehicle');
        expect(repairedState.validationField).toBe('');
    });

    test('T20r: SettingsManager steuert Text-Overrides und Release-Vorschau ohne Developer-Menue', async ({ page }) => {
        await loadGame(page);
        const configured = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const accessContext = {
                isOwner: true,
                developerModeVisibility: 'owner_only',
                expertModeUnlocked: true,
            };
            const modeResult = game.settingsManager.setDeveloperMode(game.settings, true, accessContext);
            const startResult = game.settingsManager.setMenuTextOverride('menu.level3.start.label', 'Los jetzt');
            const editorResult = game.settingsManager.setMenuTextOverride('menu.level4.tools.map_editor.label', 'Map Builder');
            game.runtimeFacade.onSettingsChanged({
                changedKeys: ['developer.modeEnabled', 'developer.textOverrides'],
            });
            return modeResult.success && startResult.success && editorResult.success;
        });
        expect(configured).toBeTruthy();

        await openGameSubmenu(page);
        await expect(page.locator('#btn-start')).toHaveText('Los jetzt');

        await openLevel4Drawer(page, { section: 'tools' });
        await expect(page.locator('#btn-open-editor')).toHaveText('Map Builder');

        const previewEnabled = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const result = game.settingsManager.setDeveloperReleasePreview(game.settings, true, {
                isOwner: true,
                developerModeVisibility: 'owner_only',
                expertModeUnlocked: true,
            });
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['developer.releasePreview'] });
            return result.success;
        });
        expect(previewEnabled).toBeTruthy();

        await page.click('#btn-close-level4');
        await expect(page.locator('#submenu-game')).toBeVisible();
        await expect(page.locator('#btn-start')).toHaveText('Spiel starten');

        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const accessContext = {
                isOwner: true,
                developerModeVisibility: 'owner_only',
                expertModeUnlocked: true,
            };
            game.settingsManager.setDeveloperReleasePreview(game.settings, false, accessContext);
            game.settingsManager.clearMenuTextOverride('menu.level3.start.label');
            game.settingsManager.clearMenuTextOverride('menu.level4.tools.map_editor.label');
            game.runtimeFacade.onSettingsChanged({
                changedKeys: ['developer.releasePreview', 'developer.textOverrides'],
            });
        });
    });

    test('T20s: Config-Export/Import stellt Setup reproduzierbar wieder her', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await page.selectOption('#map-select', 'maze');
        expect(await page.inputValue('#map-select')).toBe('maze');

        await openLevel4Drawer(page, { section: 'tools' });
        await page.click('#btn-config-export-json');
        const exportedJson = await page.inputValue('#config-share-input');
        expect(exportedJson.length).toBeGreaterThan(20);
        expect(JSON.parse(exportedJson).payload?.mapKey).toBe('maze');

        await page.click('#btn-close-level4');
        await page.waitForFunction(() => {
            const drawer = document.getElementById('submenu-level4');
            return !!drawer
                && drawer.classList.contains('hidden')
                && !window.GAME_INSTANCE?.settings?.localSettings?.toolsState?.level4Open;
        }, null, { timeout: 4000 });
        await page.selectOption('#map-select', 'pyramid');
        expect(await page.inputValue('#map-select')).toBe('pyramid');

        await openLevel4Drawer(page, { section: 'tools' });
        await page.fill('#config-share-input', exportedJson);
        await page.click('#btn-config-import');
        await waitForRenderFrames(page, 3);
        expect(await page.inputValue('#map-select')).toBe('maze');
    });

    test('T20t: Suchfilter und Telemetrie sind im neuen Flow verfuegbar', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        await page.fill('#map-search-input', 'maze');
        const mapOptions = await page.locator('#map-select option').allTextContents();
        expect(mapOptions.length).toBeGreaterThanOrEqual(1);
        expect(mapOptions.some((entry) => entry.toLowerCase().includes('maze') || entry.toLowerCase().includes('labyrinth'))).toBeTruthy();

        await page.evaluate(() => window.GAME_INSTANCE?.uiManager?.showMainNav?.());
        await expect(page.locator('#btn-quick-last-settings')).toBeVisible();
        await page.click('#btn-quick-last-settings');
        await waitForRenderFrames(page, 30);
        await returnToMenu(page);

        const telemetry = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return game.settingsManager.getMenuTelemetrySnapshot(game.settings);
        });
        expect(Number(telemetry.quickStartCount || 0)).toBeGreaterThanOrEqual(1);
        expect(Number(telemetry.startAttempts || 0)).toBeGreaterThanOrEqual(1);
    });

    test('T20u: Enter/Escape Navigation funktioniert ueber Ebene 1 bis 3', async ({ page }) => {
        await loadGame(page);
        await page.focus('#menu-nav [data-session-type=\"single\"]');
        await page.keyboard.press('Enter');
        await expect(page.locator('#submenu-custom')).toBeVisible();

        await page.focus('#submenu-custom [data-mode-path=\"normal\"]');
        await page.keyboard.press('Enter');
        await expect(page.locator('#submenu-game')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#submenu-custom')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#menu-nav')).toBeVisible();
    });

    test('T20v: Ebene 3 schaltet nur Classic 3D/Planar und aendert nicht Fight-Auswahl aus Ebene 2', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path=\"fight\"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openStartSetupSection(page, 'match');
        await page.evaluate(() => {
            const toggle = document.getElementById('portals-toggle');
            if (!toggle) return;
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await page.click('#btn-dimension-planar');
        await waitForRenderFrames(page, 3);
        let state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                gameMode: String(game?.settings?.gameMode || ''),
                planarMode: !!game?.settings?.gameplay?.planarMode,
                portalsEnabled: game?.settings?.portalsEnabled === true,
            };
        });
        expect(state.modePath).toBe('fight');
        expect(state.gameMode).toBe('HUNT');
        expect(state.planarMode).toBeTruthy();
        expect(state.portalsEnabled).toBeTruthy();

        await page.click('#btn-dimension-classic-3d');
        await waitForRenderFrames(page, 3);
        state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                gameMode: String(game?.settings?.gameMode || ''),
                planarMode: !!game?.settings?.gameplay?.planarMode,
            };
        });
        expect(state.modePath).toBe('fight');
        expect(state.gameMode).toBe('HUNT');
        expect(state.planarMode).toBeFalsy();
    });

    test('T20w: Hauptaktion fuehrt den Fokus und Unterseiten zeigen kompakten Pfad plus Moduscopy', async ({ page }) => {
        await loadGame(page);

        const level1State = await page.evaluate(() => {
            const root = document.getElementById('main-menu');
            const context = document.getElementById('menu-context');
            const primaryAction = document.getElementById('btn-quick-last-settings');
            const isVisible = (selector) => Array.from(document.querySelectorAll(selector)).some((element) => {
                const style = window.getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
            });
            const contextRect = context?.getBoundingClientRect?.() || { width: 0, height: 0 };
            return {
                depth: root?.getAttribute('data-menu-depth') || '',
                secondaryCopyVisible: isVisible('.subtitle') || isVisible('.nav-btn-meta') || isVisible('.nav-help-card'),
                contextText: String(context?.textContent || '').trim(),
                contextWidth: Math.round(contextRect.width || 0),
                contextHeight: Math.round(contextRect.height || 0),
                primaryVisible: !!primaryAction?.offsetParent,
                primarySummary: String(document.getElementById('quick-last-summary')?.textContent || '').trim(),
                sessionLabels: Array.from(document.querySelectorAll('#menu-nav [data-session-type] .nav-btn-label'))
                    .map((label) => String(label.textContent || '').trim()),
                primaryFocused: document.activeElement === primaryAction,
            };
        });

        await openCustomSubmenu(page);

        const compactState = await page.evaluate(() => {
            const root = document.getElementById('main-menu');
            const isVisible = (selector) => Array.from(document.querySelectorAll(selector)).some((element) => {
                const style = window.getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
            });
            return {
                depth: root?.getAttribute('data-menu-depth') || '',
                panel: root?.getAttribute('data-menu-panel') || '',
                modeCopyVisible: isVisible('#submenu-custom .level2-mode-grid .menu-choice-copy'),
                mainNavigationVisible: isVisible('#menu-nav'),
                mainPrimaryVisible: isVisible('.menu-primary-action'),
                breadcrumbVisible: isVisible('#menu-breadcrumb'),
                breadcrumbText: String(document.getElementById('menu-breadcrumb')?.textContent || '').trim(),
            };
        });

        expect(level1State.depth).toBe('1');
        expect(level1State.secondaryCopyVisible).toBeFalsy();
        expect(level1State.contextText).toContain('Hauptmenü');
        expect(level1State.contextWidth).toBeLessThanOrEqual(1);
        expect(level1State.contextHeight).toBeLessThanOrEqual(1);
        expect(level1State.primaryVisible).toBeTruthy();
        expect(level1State.primarySummary).toContain('·');
        expect(level1State.sessionLabels).toEqual(['Einzelspieler', 'Mehrspieler', 'Geteilter Bildschirm']);
        expect(level1State.primaryFocused).toBeTruthy();
        expect(compactState.depth).toBe('2');
        expect(compactState.panel).toBe('submenu-custom');
        expect(compactState.modeCopyVisible).toBeTruthy();
        expect(compactState.mainNavigationVisible).toBeFalsy();
        expect(compactState.mainPrimaryVisible).toBeFalsy();
        expect(compactState.breadcrumbVisible).toBeTruthy();
        expect(compactState.breadcrumbText).toContain('Spielstil');
    });

    test('T20w1: Modusbeschreibungen liegen nur als Hover-Info am I', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);

        const modeInfos = page.locator('#submenu-custom .level2-mode-grid .menu-choice-copy');
        await expect(modeInfos).toHaveCount(3);
        await expect(modeInfos).toHaveText(['i', 'i', 'i']);
        await expect(modeInfos.first()).toHaveAttribute(
            'title',
            'Schneller Einstieg mit lockerer Balance und kurzer Lernkurve.'
        );
        await expect(page.locator('#submenu-custom .level2-mode-grid')).not.toContainText(
            'Schneller Einstieg mit lockerer Balance und kurzer Lernkurve.'
        );
    });

    test('T20w2: Statische Menühilfen liegen am I und Statusfelder bleiben bestehen', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);

        await expect(page.locator('#submenu-custom .level2-config-section > .section-title .menu-info-hint'))
            .toHaveAttribute('title', 'Wähle einen Spielstil. Karte, Flugzeug und Regeln kannst du danach noch anpassen.');
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await expect(page.locator('.start-map-preview-hint')).toHaveAttribute('title', 'Ziehen: drehen · Mausrad: zoomen');
        await expect(page.locator('.start-vehicle-preview-hint')).toHaveAttribute('title', 'Ziehen: drehen · Mausrad: zoomen');

        await openLevel4Drawer(page, { section: 'tools' });
        await expect(page.locator('#level4-section-tools .section-title .menu-info-hint')).toHaveAttribute(
            'title',
            'Speichere den aktuellen Stand aller Einstellungen unter einem Namen.'
        );
        await expect(page.locator('#level4-section-presets .section-title .menu-info-hint')).toHaveAttribute(
            'title',
            'Wende vorbereitete Match-Konfigurationen an oder speichere eine neue Vorlage.'
        );
        await expect(page.locator('#level4-section-utilities .section-title .menu-info-hint')).toHaveAttribute(
            'title',
            'Öffne die Desktop-Editoren oder übertrage eine vollständige Konfiguration.'
        );
        await expect(page.locator('#profile-transfer-status')).toHaveAttribute('role', 'status');
    });

    test('T20x: Moduskarte fuehrt direkt in Ebene 3', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await expect(page.locator('#submenu-game')).toBeVisible();

        const menuState = await page.evaluate(() => {
            const root = document.getElementById('main-menu');
            return {
                depth: root?.getAttribute('data-menu-depth') || '',
                panel: root?.getAttribute('data-menu-panel') || '',
                modePath: String(window.GAME_INSTANCE?.settings?.localSettings?.modePath || ''),
            };
        });

        expect(menuState.depth).toBe('3');
        expect(menuState.panel).toBe('submenu-game');
        expect(menuState.modePath).toBe('arcade');
    });

    test('T20x00: Ebene 2 ist bereinigt und der Fight-Hangar liegt nur im Kampf-Setup', async ({ page }) => {
        await page.addInitScript(() => {
            globalThis.__CURVIOS_HANGAR_WINDOW__ = {
                contractVersion: 'preload.hangar-window.v1',
                openWindow: async () => ({ ok: true }),
            };
        });
        await loadGame(page);
        await openCustomSubmenu(page);

        await expect(page.getByRole('button', { name: 'Ohne Vorgabe konfigurieren' })).toHaveCount(0);
        await expect(page.locator('#btn-quick-event-playlist')).toHaveCount(0);
        await expect(page.locator('#submenu-custom #btn-open-fight-hangar')).toHaveCount(0);

        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await expect(page.locator('#submenu-game #btn-open-fight-hangar')).toBeHidden();
        await page.click('#submenu-game [data-back]');
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await expect(page.locator('#submenu-game #btn-open-fight-hangar')).toBeVisible();
    });

    test('T20x0: Ebene-4 Fight-HP/MG-Regler sind nur im Fight-Modus aktiv', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openLevel4Drawer(page, { section: 'gameplay' });

        const normalState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const hpSetting = document.getElementById('fight-player-hp-setting');
            const damageSetting = document.getElementById('fight-mg-damage-setting');
            const hint = document.getElementById('fight-tuning-hint');
            const hpSlider = document.getElementById('fight-player-hp-slider');
            const damageSlider = document.getElementById('fight-mg-damage-slider');

            const beforeHp = Number(game?.settings?.gameplay?.fightPlayerHp || 0);
            const beforeDamage = Number(game?.settings?.gameplay?.fightMgDamage || 0);
            const runtimeHp = Number(game?.config?.HUNT?.PLAYER_MAX_HP || 0);
            const runtimeDamage = Number(game?.config?.HUNT?.MG?.DAMAGE || 0);

            if (hpSlider) {
                hpSlider.value = '220';
                hpSlider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (damageSlider) {
                damageSlider.value = '15.50';
                damageSlider.dispatchEvent(new Event('input', { bubbles: true }));
            }

            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                hpHidden: !!hpSetting?.classList?.contains('hidden'),
                damageHidden: !!damageSetting?.classList?.contains('hidden'),
                hpDisabled: !!hpSlider?.disabled,
                damageDisabled: !!damageSlider?.disabled,
                hintHidden: !!hint?.classList?.contains('hidden'),
                beforeHp,
                afterHp: Number(game?.settings?.gameplay?.fightPlayerHp || 0),
                beforeDamage,
                afterDamage: Number(game?.settings?.gameplay?.fightMgDamage || 0),
                runtimeHp,
                runtimeDamage,
            };
        });

        expect(normalState.modePath).toBe('normal');
        expect(normalState.hpHidden).toBeTruthy();
        expect(normalState.damageHidden).toBeTruthy();
        expect(normalState.hpDisabled).toBeTruthy();
        expect(normalState.damageDisabled).toBeTruthy();
        expect(normalState.hintHidden).toBeFalsy();
        expect(normalState.afterHp).toBe(normalState.beforeHp);
        expect(normalState.afterDamage).toBe(normalState.beforeDamage);

        await page.click('#btn-close-level4');
        await page.click('#submenu-game:not(.hidden) [data-back]');
        await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openLevel4Drawer(page, { section: 'gameplay' });

        await page.evaluate(() => {
            const hpSlider = document.getElementById('fight-player-hp-slider');
            const damageSlider = document.getElementById('fight-mg-damage-slider');
            if (hpSlider) {
                hpSlider.value = '170';
                hpSlider.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (damageSlider) {
                damageSlider.value = '12.50';
                damageSlider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await waitForRenderFrames(page, 14);

        const fightState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const hpSetting = document.getElementById('fight-player-hp-setting');
            const damageSetting = document.getElementById('fight-mg-damage-setting');
            const hint = document.getElementById('fight-tuning-hint');
            const hpSlider = document.getElementById('fight-player-hp-slider');
            const damageSlider = document.getElementById('fight-mg-damage-slider');
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                hpHidden: !!hpSetting?.classList?.contains('hidden'),
                damageHidden: !!damageSetting?.classList?.contains('hidden'),
                hpDisabled: !!hpSlider?.disabled,
                damageDisabled: !!damageSlider?.disabled,
                hintHidden: !!hint?.classList?.contains('hidden'),
                settingsHp: Number(game?.settings?.gameplay?.fightPlayerHp || 0),
                settingsDamage: Number(game?.settings?.gameplay?.fightMgDamage || 0),
                runtimeHp: Number(game?.config?.HUNT?.PLAYER_MAX_HP || 0),
                runtimeDamage: Number(game?.config?.HUNT?.MG?.DAMAGE || 0),
            };
        });

        expect(fightState.modePath).toBe('fight');
        expect(fightState.hpHidden).toBeFalsy();
        expect(fightState.damageHidden).toBeFalsy();
        expect(fightState.hpDisabled).toBeFalsy();
        expect(fightState.damageDisabled).toBeFalsy();
        expect(fightState.hintHidden).toBeTruthy();
        expect(fightState.settingsHp).toBe(170);
        expect(fightState.settingsDamage).toBeCloseTo(12.5, 2);
        expect(fightState.runtimeHp).toBe(170);
        expect(fightState.runtimeDamage).toBeCloseTo(12.5, 2);

        await page.click('#btn-close-level4');
        await page.click('#submenu-game:not(.hidden) [data-back]');
        await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await waitForRenderFrames(page, 10);

        const revertedState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                runtimeHp: Number(game?.config?.HUNT?.PLAYER_MAX_HP || 0),
                runtimeDamage: Number(game?.config?.HUNT?.MG?.DAMAGE || 0),
            };
        });

        expect(revertedState.modePath).toBe('normal');
        expect(revertedState.runtimeHp).toBe(normalState.runtimeHp);
        expect(revertedState.runtimeDamage).toBeCloseTo(normalState.runtimeDamage, 2);
    });

    test('T20x1: Map-Auswahl bleibt in Normal und Arcade vollstaendig verfuegbar', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

        const normalState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const maps = game?.config?.MAPS || {};
            const options = Array.from(document.querySelectorAll('#map-select option')).map((option) => option.value);
            const parcoursVisible = options.filter((mapKey) => maps?.[mapKey]?.parcours?.enabled === true);
            const regularVisible = options.filter((mapKey) => maps?.[mapKey]?.parcours?.enabled !== true);
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                parcoursVisibleCount: parcoursVisible.length,
                regularVisibleCount: regularVisible.length,
            };
        });

        expect(normalState.modePath).toBe('normal');
        expect(normalState.parcoursVisibleCount).toBeGreaterThan(0);
        expect(normalState.regularVisibleCount).toBeGreaterThan(0);

        await page.click('#submenu-game:not(.hidden) [data-back]');
        await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

        const arcadeState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const maps = game?.config?.MAPS || {};
            const options = Array.from(document.querySelectorAll('#map-select option')).map((option) => option.value);
            const parcoursVisible = options.filter((mapKey) => maps?.[mapKey]?.parcours?.enabled === true);
            const regularVisible = options.filter((mapKey) => maps?.[mapKey]?.parcours?.enabled !== true);
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                selectedMapKey: String(game?.settings?.mapKey || ''),
                parcoursVisibleCount: parcoursVisible.length,
                regularVisibleCount: regularVisible.length,
            };
        });

        expect(arcadeState.modePath).toBe('arcade');
        expect(arcadeState.parcoursVisibleCount).toBeGreaterThan(0);
        expect(arcadeState.regularVisibleCount).toBeGreaterThan(0);
        expect(arcadeState.selectedMapKey).toBe('parcours_rift');
    });

    test('T20x2: Arcade-Selbstduell-Option ist in Single-Normal/Fight aktiv und bleibt persistent', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openStartSetupSection(page, 'match');
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            if (!game?.settings?.localSettings) return;
            game.settings.localSettings.modePath = 'normal';
            game.uiManager?.syncByChangeKeys?.(['session.modePath']);
        });
        await openMatchAdvancedSettings(page);

        const normalInitialState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const select = document.getElementById('arcade-ghost-duel-mode-select');
            const summaryEntries = Array.from(
                document.querySelectorAll('#menu-selection-summary .start-summary-block')
            ).map((node) => ({
                label: String(node.querySelector('.start-summary-label')?.textContent || '').trim(),
                value: String(node.querySelector('.start-summary-value')?.textContent || '').trim(),
            }));
            const ghostSummary = summaryEntries.find((entry) => entry.label === 'Ghost');
            return {
                sessionType: String(game?.settings?.localSettings?.sessionType || ''),
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                disabled: select instanceof HTMLSelectElement ? select.disabled : null,
                value: select instanceof HTMLSelectElement ? select.value : null,
                ghostSummary: ghostSummary?.value || '',
            };
        });

        expect(normalInitialState.sessionType).toBe('single');
        expect(normalInitialState.modePath).toBe('normal');
        expect(normalInitialState.disabled).toBeFalsy();
        expect(normalInitialState.value).toBe('off');
        await page.selectOption('#arcade-ghost-duel-mode-select', 'self_longest_ghost');

        const normalState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const select = document.getElementById('arcade-ghost-duel-mode-select');
            const summaryEntries = Array.from(
                document.querySelectorAll('#menu-selection-summary .start-summary-block')
            ).map((node) => ({
                label: String(node.querySelector('.start-summary-label')?.textContent || '').trim(),
                value: String(node.querySelector('.start-summary-value')?.textContent || '').trim(),
            }));
            const ghostSummary = summaryEntries.find((entry) => entry.label === 'Ghost');
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                disabled: select instanceof HTMLSelectElement ? select.disabled : null,
                selectValue: select instanceof HTMLSelectElement ? select.value : null,
                storedValue: String(game?.settings?.localSettings?.startSetup?.arcadeGhostDuelMode || ''),
                ghostSummary: ghostSummary?.value || '',
            };
        });

        expect(normalState.modePath).toBe('normal');
        expect(normalState.disabled).toBeFalsy();
        expect(normalState.selectValue).toBe('self_longest_ghost');
        expect(normalState.storedValue).toBe('self_longest_ghost');
        expect(normalState.ghostSummary).toContain('Selbstduell');

        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            if (!game?.settings?.localSettings) return;
            game.settings.localSettings.modePath = 'fight';
            game.uiManager?.syncByChangeKeys?.(['session.modePath']);
        });
        await openStartSetupSection(page, 'match');

        const fightState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const select = document.getElementById('arcade-ghost-duel-mode-select');
            const summaryEntries = Array.from(
                document.querySelectorAll('#menu-selection-summary .start-summary-block')
            ).map((node) => ({
                label: String(node.querySelector('.start-summary-label')?.textContent || '').trim(),
                value: String(node.querySelector('.start-summary-value')?.textContent || '').trim(),
            }));
            const ghostSummary = summaryEntries.find((entry) => entry.label === 'Ghost');
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                disabled: select instanceof HTMLSelectElement ? select.disabled : null,
                selectValue: select instanceof HTMLSelectElement ? select.value : null,
                storedValue: String(game?.settings?.localSettings?.startSetup?.arcadeGhostDuelMode || ''),
                ghostSummary: ghostSummary?.value || '',
            };
        });

        expect(fightState.modePath).toBe('fight');
        expect(fightState.disabled).toBeFalsy();
        expect(fightState.selectValue).toBe('self_longest_ghost');
        expect(fightState.storedValue).toBe('self_longest_ghost');
        expect(fightState.ghostSummary).toContain('Selbstduell');
    });

test('T20x3: Ghost-Selbstduell spielt in Single-Normal und Single-Arcade und persistiert pro Map/Route', async ({ page }) => {
        const ghostLibraryKey = 'cuviosclash.arcade-ghost-library.v1';
        const ghostLibrarySchemaVersion = 'arcade-ghost-library.v2';
        // The library only replaces a route entry with a longer run. The seeded ghost is kept
        // far shorter than any round played here, so a larger stored duration afterwards
        // can only come from the game writing its own round.
        const seededDurationMs = 100;
        const ghostClip = {
            frames: [
                {
                    time: 0,
                    players: [{ idx: 0, alive: true, x: 0, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, bot: false }],
                },
                {
                    time: seededDurationMs / 1000,
                    players: [{ idx: 0, alive: true, x: 4, y: 2, z: 0, qx: 0, qy: 0.3, qz: 0, qw: 0.95, bot: false }],
                },
            ],
            players: [{ idx: 0, color: 0xffffff, isBot: false, modelScale: 1 }],
            sourceDuration: seededDurationMs / 1000,
            displayDuration: seededDurationMs / 1000,
        };

        await loadGame(page);

        const seedGhostForMap = (mapKey) => page.evaluate(({
            mapKey: selectedMapKey,
            ghostLibraryStorageKey,
            schemaVersion,
            ghostClipPayload,
            durationMs,
        }) => {
            const game = window.GAME_INSTANCE;
            game?.runtimeCoordinator?.getRuntimeFacade?.()?.arcadeRunRuntime?.flushGhostLibrarySaves?.();
            const routeId = String(
                game?.config?.MAPS?.[selectedMapKey]?.parcours?.routeId
                || selectedMapKey
            ).trim();
            // Player profiles moved every arcade record behind a profile-scoped storage key
            // (PlayerProfileStorageContract), so the library has to be seeded through the same
            // record store the runtime reads from - a raw localStorage write never arrives.
            const recordStore = game?.settingsManager?.getPlayerRecordStorePort?.() || null;
            const rawLibrary = recordStore?.loadJsonRecord?.(ghostLibraryStorageKey, {}) || {};
            const nextLibrary = rawLibrary?.schemaVersion === schemaVersion && rawLibrary?.routes
                ? rawLibrary
                : {
                    schemaVersion,
                    lastTouchSeq: 0,
                    aliasIndex: {},
                    routes: {},
                };
            nextLibrary.aliasIndex = nextLibrary.aliasIndex && typeof nextLibrary.aliasIndex === 'object'
                ? nextLibrary.aliasIndex
                : {};
            nextLibrary.routes = nextLibrary.routes && typeof nextLibrary.routes === 'object'
                ? nextLibrary.routes
                : {};
            nextLibrary.lastTouchSeq = Number(nextLibrary.lastTouchSeq || 0) + 1;
            nextLibrary.routes[routeId] = {
                routeId,
                canonicalRouteId: routeId,
                routeAliases: routeId === selectedMapKey ? [] : [selectedMapKey],
                longestGhostClip: ghostClipPayload,
                durationMs,
                updatedAt: new Date().toISOString(),
                lastTouchSeq: nextLibrary.lastTouchSeq,
            };
            nextLibrary.aliasIndex[routeId] = routeId;
            nextLibrary.aliasIndex[selectedMapKey] = routeId;
            recordStore?.saveJsonRecord?.(ghostLibraryStorageKey, nextLibrary);
            return { mapKey: selectedMapKey, routeId, seeded: !!recordStore };
        }, {
            mapKey,
            ghostLibraryStorageKey: ghostLibraryKey,
            schemaVersion: ghostLibrarySchemaVersion,
            ghostClipPayload: ghostClip,
            durationMs: seededDurationMs,
        });

        // --- Single + Normal (map-key based route fallback) ---
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openMatchAdvancedSettings(page);
        await page.selectOption('#arcade-ghost-duel-mode-select', 'self_longest_ghost');
        const normalMapKey = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const mapSelect = document.getElementById('map-select');
            const mapOptionValues = mapSelect instanceof HTMLSelectElement
                ? Array.from(mapSelect.options).map((entry) => String(entry.value || ''))
                : [];
            const maps = game?.config?.MAPS || {};
            const normalMapKey = mapOptionValues.find((entry) => (
                entry
                && entry !== 'custom'
                && maps?.[entry]?.parcours?.enabled !== true
            )) || (mapOptionValues.includes('maze') ? 'maze' : (mapOptionValues[0] || 'standard'));
            return normalMapKey;
        });
        await openStartSetupSection(page, 'map');
        await page.selectOption('#map-select', normalMapKey);
        const normalSeed = await seedGhostForMap(normalMapKey);
        expect(normalSeed.seeded).toBe(true);

        await page.click('#submenu-game:not(.hidden) #btn-start', { force: true });
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 20000 });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.();
            return ghostState?.active === true && Number(ghostState?.entryCount || 0) > 0;
        }, null, { timeout: 12000 });

        const normalGhostState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.() || null;
            const routeId = String(game?.arena?.currentMapDefinition?.parcours?.routeId || game?.arena?.currentMapKey || game?.settings?.mapKey || '');
            game.recorder?.recordFrame?.(game?.entityManager?.players || []);
            game.recorder?.recordFrame?.(game?.entityManager?.players || []);
            const players = game?.entityManager?.players || [];
            if (players.length > 0) {
                game.matchFlowUiController?.onRoundEnd?.(players[0]);
            }
            const arcadeRuntime = game?.runtimeCoordinator?.getRuntimeFacade?.()?.arcadeRunRuntime || null;
            arcadeRuntime?.flushGhostLibrarySaves?.();
            const recordStore = game?.settingsManager?.getPlayerRecordStorePort?.() || null;
            const persistedLibrary = recordStore?.loadJsonRecord?.('cuviosclash.arcade-ghost-library.v1', {}) || {};
            const persistedRoute = persistedLibrary?.routes?.[routeId] || persistedLibrary?.[routeId] || null;
            return {
                active: ghostState?.active === true,
                entryCount: Number(ghostState?.entryCount || 0),
                frameCount: Number(ghostState?.frameCount || 0),
                routeId,
                persistedDurationMs: Number(persistedRoute?.durationMs || 0),
            };
        });
        expect(normalGhostState.active).toBeTruthy();
        expect(normalGhostState.entryCount).toBeGreaterThan(0);
        expect(normalGhostState.frameCount).toBeGreaterThan(1);
        expect(normalGhostState.routeId).toBe(normalSeed.routeId);
        expect(normalGhostState.persistedDurationMs).toBeGreaterThan(seededDurationMs);
        await returnToMenu(page);

        // --- Single + Arcade (explicit parcours routeId) ---
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openMatchAdvancedSettings(page);
        await page.selectOption('#arcade-ghost-duel-mode-select', 'self_longest_ghost');
        const arcadeMapKey = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const mapSelect = document.getElementById('map-select');
            const optionValues = mapSelect instanceof HTMLSelectElement
                ? Array.from(mapSelect.options).map((entry) => String(entry.value || ''))
                : [];
            return optionValues.find((mapKey) => game?.config?.MAPS?.[mapKey]?.parcours?.enabled === true)
                || (optionValues.includes('parcours_rift') ? 'parcours_rift' : optionValues[0]);
        });
        await openStartSetupSection(page, 'map');
        await page.selectOption('#map-select', arcadeMapKey);
        const arcadeSeed = await seedGhostForMap(arcadeMapKey);
        expect(arcadeSeed.seeded).toBe(true);

        await page.click('#submenu-game:not(.hidden) #btn-start', { force: true });
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 20000 });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.();
            return ghostState?.active === true && Number(ghostState?.entryCount || 0) > 0;
        }, null, { timeout: 12000 });

        const arcadeGhostState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.() || null;
            const routeId = String(game?.arena?.currentMapDefinition?.parcours?.routeId || '');
            game.recorder?.recordFrame?.(game?.entityManager?.players || []);
            game.recorder?.recordFrame?.(game?.entityManager?.players || []);
            const players = game?.entityManager?.players || [];
            if (players.length > 0) {
                game.matchFlowUiController?.onRoundEnd?.(players[0], {
                    reason: 'PARCOURS_COMPLETE',
                    parcours: { routeId, completionTimeMs: 4200, checkpointCount: 3 },
                });
            }
            const arcadeRuntime = game?.runtimeCoordinator?.getRuntimeFacade?.()?.arcadeRunRuntime || null;
            arcadeRuntime?.flushGhostLibrarySaves?.();
            const recordStore = game?.settingsManager?.getPlayerRecordStorePort?.() || null;
            const persistedLibrary = recordStore?.loadJsonRecord?.('cuviosclash.arcade-ghost-library.v1', {}) || {};
            const persistedRoute = persistedLibrary?.routes?.[routeId] || persistedLibrary?.[routeId] || null;
            return {
                active: ghostState?.active === true,
                entryCount: Number(ghostState?.entryCount || 0),
                frameCount: Number(ghostState?.frameCount || 0),
                routeId,
                persistedDurationMs: Number(persistedRoute?.durationMs || 0),
            };
        });
        expect(arcadeGhostState.active).toBeTruthy();
        expect(arcadeGhostState.entryCount).toBeGreaterThan(0);
        expect(arcadeGhostState.frameCount).toBeGreaterThan(1);
        expect(arcadeGhostState.routeId).toBe(arcadeSeed.routeId);
        expect(arcadeGhostState.persistedDurationMs).toBeGreaterThan(seededDurationMs);
    });

    test('T70a: syncAll/syncByChangeKeys mutieren map/vehicle ohne Input nicht still', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.localSettings.modePath = 'normal';
            game.settings.mapKey = 'parcours_rift';
            game.settings.vehicles.PLAYER_1 = 'ghost_ship_1';
            game.settings.vehicles.PLAYER_2 = 'ghost_ship_2';
            const before = {
                mapKey: String(game.settings.mapKey || ''),
                vehicleP1: String(game.settings?.vehicles?.PLAYER_1 || ''),
                vehicleP2: String(game.settings?.vehicles?.PLAYER_2 || ''),
            };

            game.uiManager.syncAll();
            const afterSyncAll = {
                mapKey: String(game.settings.mapKey || ''),
                vehicleP1: String(game.settings?.vehicles?.PLAYER_1 || ''),
                vehicleP2: String(game.settings?.vehicles?.PLAYER_2 || ''),
            };

            game.uiManager.syncByChangeKeys(['session.modePath']);
            const afterSyncByKeys = {
                mapKey: String(game.settings.mapKey || ''),
                vehicleP1: String(game.settings?.vehicles?.PLAYER_1 || ''),
                vehicleP2: String(game.settings?.vehicles?.PLAYER_2 || ''),
            };

            return {
                before,
                afterSyncAll,
                afterSyncByKeys,
                uiMapValue: String(document.getElementById('map-select')?.value || ''),
                uiVehicleP1Value: String(document.getElementById('vehicle-p1')?.value || ''),
                uiVehicleP2Value: String(document.getElementById('vehicle-p2')?.value || ''),
            };
        });

        expect(state.afterSyncAll.mapKey).toBe(state.before.mapKey);
        expect(state.afterSyncAll.vehicleP1).toBe(state.before.vehicleP1);
        expect(state.afterSyncAll.vehicleP2).toBe(state.before.vehicleP2);
        expect(state.afterSyncByKeys.mapKey).toBe(state.before.mapKey);
        expect(state.afterSyncByKeys.vehicleP1).toBe(state.before.vehicleP1);
        expect(state.afterSyncByKeys.vehicleP2).toBe(state.before.vehicleP2);
        expect(state.uiMapValue).not.toBe(state.before.mapKey);
        expect(state.uiVehicleP1Value).not.toBe(state.before.vehicleP1);
        expect(state.uiVehicleP2Value).not.toBe(state.before.vehicleP2);
    });

    test('T70b: Legacy-Migration plus Session-Drafts behalten modePath/Preset stabil ueber Reload', async ({ page }) => {
        await loadGame(page);
        const versionState = await page.evaluate(({ settingsStorageKey, menuDraftsStorageKey }) => {
            const game = window.GAME_INSTANCE;
            const defaults = game.settingsManager.createDefaultSettings();
            const targetVersion = Number(defaults?.settingsVersion || 1);
            const legacyVersion = Math.max(0, targetVersion - 1);
            const legacySnapshot = {
                ...defaults,
                settingsVersion: legacyVersion,
                mode: '1p',
                mapKey: 'maze',
                vehicles: {
                    ...(defaults?.vehicles || {}),
                    PLAYER_1: 'ship5',
                    PLAYER_2: 'ship8',
                },
                localSettings: {
                    ...(defaults?.localSettings || {}),
                    sessionType: 'single',
                    modePath: 'normal',
                },
            };
            localStorage.removeItem(menuDraftsStorageKey);
            localStorage.setItem(settingsStorageKey, JSON.stringify(legacySnapshot));
            return { targetVersion, legacyVersion };
        }, {
            settingsStorageKey: SETTINGS_STORAGE_KEY,
            menuDraftsStorageKey: MENU_DRAFTS_STORAGE_KEY,
        });

        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 15000 });

        const migratedState = await page.evaluate((settingsStorageKey) => {
            const game = window.GAME_INSTANCE;
            const persisted = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}');
            return {
                runtimeVersion: Number(game?.settings?.settingsVersion || 0),
                runtimeMapKey: String(game?.settings?.mapKey || ''),
                persistedVersion: Number(persisted?.settingsVersion || 0),
                persistedMapKey: String(persisted?.mapKey || ''),
            };
        }, SETTINGS_STORAGE_KEY);
        expect(migratedState.runtimeVersion).toBe(versionState.targetVersion);
        expect(migratedState.persistedVersion).toBe(versionState.targetVersion);
        expect(migratedState.runtimeMapKey).toBe('maze');
        expect(migratedState.persistedMapKey).toBe('maze');

        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

        const switchState = await page.evaluate(({ menuDraftsStorageKey }) => {
            const game = window.GAME_INSTANCE;
            localStorage.removeItem(menuDraftsStorageKey);
            const resultToSplit = game.settingsManager.switchSessionType(game.settings, 'splitscreen');
            const afterSplit = {
                success: !!resultToSplit?.success,
                loadedDraft: !!resultToSplit?.loadedDraft,
                sessionType: String(game?.settings?.localSettings?.sessionType || ''),
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                activePresetId: String(game?.settings?.matchSettings?.activePresetId || ''),
                mapKey: String(game?.settings?.mapKey || ''),
            };
            const resultBackSingle = game.settingsManager.switchSessionType(game.settings, 'single');
            const afterSingle = {
                success: !!resultBackSingle?.success,
                loadedDraft: !!resultBackSingle?.loadedDraft,
                sessionType: String(game?.settings?.localSettings?.sessionType || ''),
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                activePresetId: String(game?.settings?.matchSettings?.activePresetId || ''),
                mapKey: String(game?.settings?.mapKey || ''),
            };
            return { afterSplit, afterSingle };
        }, {
            menuDraftsStorageKey: MENU_DRAFTS_STORAGE_KEY,
        });

        expect(switchState.afterSplit.success).toBeTruthy();
        expect(switchState.afterSplit.loadedDraft).toBeFalsy();
        expect(switchState.afterSplit.sessionType).toBe('splitscreen');
        expect(switchState.afterSplit.modePath).toBe('arcade');
        expect(switchState.afterSplit.activePresetId).toBe('arcade');
        expect(switchState.afterSplit.mapKey).toBe('parcours_rift');

        expect(switchState.afterSingle.success).toBeTruthy();
        expect(switchState.afterSingle.loadedDraft).toBeTruthy();
        expect(switchState.afterSingle.sessionType).toBe('single');
        expect(switchState.afterSingle.modePath).toBe('arcade');
        expect(switchState.afterSingle.activePresetId).toBe('arcade');
        expect(switchState.afterSingle.mapKey).toBe('parcours_rift');
    });

    test('T68a: Arcade-HUD zeigt Score-Breakdown und Modifier-Update live im Run', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });

        const initialHudState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?.arcadeRunRuntime;
            if (!runtime || !runtime._state) return null;

            runtime._activeModifierId = 'portal_storm';
            runtime._missionState = {
                missions: [
                    { type: 'KILL_COUNT', completed: false, progress: { kills: 2, target: 5 } },
                    { type: 'COLLECT_ITEMS', completed: false, progress: { collected: 1, target: 3 } },
                ],
                allCompleted: false,
                completedCount: 0,
            };
            const objectiveState = {
                objectiveId: 'bounty_hunt',
                label: 'Bounty Hunt',
                targetLabel: 'Bot 2',
                progressText: 'Ziel: Bot 2',
                progressFraction: 0,
                completed: false,
                failed: false,
            };

            const previousScore = runtime._state.score && typeof runtime._state.score === 'object'
                ? runtime._state.score
                : {};
            const previousBreakdown = previousScore.breakdown && typeof previousScore.breakdown === 'object'
                ? previousScore.breakdown
                : {};
            runtime._state = {
                ...runtime._state,
                phase: 'sector_active',
                sectorIndex: 3,
                completedSectors: 2,
                missions: runtime._missionState,
                objectiveState,
                score: {
                    ...previousScore,
                    total: 1337,
                    combo: 9,
                    multiplier: 4,
                    breakdown: {
                        ...previousBreakdown,
                        base: 250,
                        survival: 420,
                        kills: 350,
                        cleanSector: 120,
                        risk: 90,
                        penalty: 40,
                        total: 1337,
                    },
                },
            };

            game?.hudRuntimeSystem?.updatePlayingHudTick?.(0.06);
            const scoreRoot = document.getElementById('arcade-score-hud');
            const missionRoot = document.getElementById('arcade-mission-hud');
            return {
                scoreVisible: !!scoreRoot && window.getComputedStyle(scoreRoot).display !== 'none',
                missionVisible: !!missionRoot && window.getComputedStyle(missionRoot).display !== 'none',
                scoreText: String(scoreRoot?.textContent || ''),
                modifierLabel: String(scoreRoot?.querySelector('.arcade-score-hud-modifier-label')?.textContent || ''),
                missionCardCount: missionRoot?.querySelectorAll('.arcade-mission-card').length || 0,
                objectiveText: String(missionRoot?.querySelector('.arcade-mission-card')?.textContent || ''),
            };
        });

        expect(initialHudState).not.toBeNull();
        expect(initialHudState.scoreVisible).toBeTruthy();
        expect(initialHudState.missionVisible).toBeTruthy();
        expect(initialHudState.scoreText).toContain('1337');
        expect(initialHudState.scoreText).toContain('x4.0');
        expect(initialHudState.modifierLabel).toContain('Item-Regen');
        expect(initialHudState.missionCardCount).toBeGreaterThanOrEqual(3);
        expect(initialHudState.objectiveText).toContain('Bot 2');

        const modifierSwitchLabel = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?.arcadeRunRuntime;
            if (!runtime || !runtime._state) return '';
            runtime._activeModifierId = 'boost_tax';
            game?.hudRuntimeSystem?.updatePlayingHudTick?.(0.06);
            return String(document.querySelector('#arcade-score-hud .arcade-score-hud-modifier-label')?.textContent || '');
        });
        expect(modifierSwitchLabel).toContain('Boost Tax');

        await returnToMenu(page);
    });

    test('T68b: Arcade-HUD zeigt Combo-Decay, Sudden-Death-Overlay und Sektor-Transition', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });

        const visualState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?.arcadeRunRuntime;
            if (!runtime || !runtime._state) return null;
            const nowMs = Date.now();
            runtime._state = {
                ...runtime._state,
                phase: 'sudden_death',
                sectorIndex: 5,
                completedSectors: 4,
                currentMapKey: 'maze',
                suddenDeathStartedAtMs: nowMs - 12000,
                score: {
                    ...(runtime._state.score || {}),
                    total: 4200,
                    combo: 7,
                    multiplier: 3.5,
                    lastComboAtMs: nowMs - 7200,
                    breakdown: {
                        ...((runtime._state.score && runtime._state.score.breakdown) || {}),
                        base: 420,
                        survival: 700,
                        kills: 590,
                        cleanSector: 120,
                        risk: 70,
                        penalty: 80,
                        total: 1820,
                    },
                },
            };
            game.hudRuntimeSystem._lastArcadeSectorIndex = 4;
            game.hudRuntimeSystem.updatePlayingHudTick(0.06);
            const scoreRoot = document.getElementById('arcade-score-hud');
            const comboMetric = scoreRoot?.querySelector('.arcade-score-hud-metric');
            const sdOverlay = document.getElementById('arcade-sudden-death-overlay');
            const transitionOverlay = document.getElementById('arcade-sector-transition-overlay');
            return {
                hudVisible: !!scoreRoot && window.getComputedStyle(scoreRoot).display !== 'none',
                edgeGlow: scoreRoot?.classList.contains('is-edge-glow') || false,
                suddenDeathHud: scoreRoot?.classList.contains('is-sudden-death') || false,
                comboDecaying: comboMetric?.classList.contains('is-decaying') || false,
                suddenDeathOverlayVisible: !!sdOverlay && !sdOverlay.classList.contains('hidden'),
                transitionVisible: !!transitionOverlay && !transitionOverlay.classList.contains('hidden'),
                transitionText: String(transitionOverlay?.textContent || ''),
            };
        });

        expect(visualState).not.toBeNull();
        expect(visualState.hudVisible).toBeTruthy();
        expect(visualState.edgeGlow).toBeTruthy();
        expect(visualState.suddenDeathHud).toBeTruthy();
        expect(visualState.comboDecaying).toBeTruthy();
        expect(visualState.suddenDeathOverlayVisible).toBeTruthy();
        expect(visualState.transitionVisible).toBeTruthy();
        expect(visualState.transitionText).toContain('Sektor 5');

        await returnToMenu(page);
    });

    test('T68c: Arcade-Intermission/Post-Run-Panel mit Reward-Choice und Replay-Fallback', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });

        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const runtime = game?.runtimeFacade?.arcadeRunRuntime;
            if (!game || !runtime || !runtime._state) return null;
            runtime.setStrategy?.({
                applyIntermissionHealing: (player) => {
                    const before = Math.max(0, Number(player?.hp) || 0);
                    const maxHp = Math.max(1, Number(player?.maxHp) || 100);
                    const nextHp = Math.min(maxHp, before + 24);
                    player.hp = nextHp;
                    return { healed: Math.max(0, nextHp - before), shieldGranted: 0, requestedHeal: 24 };
                },
            });
            const nowMs = Date.now();
            runtime._state.mapSequence = ['parcours_rift', 'maze', 'trench'];
            runtime._state.encounterSequence = [
                { templateId: 'sector_intro', objectiveId: 'survive_window', squadId: 'scout_duo', modifierId: 'tight_turns', scoreBonus: 0.08 },
                { templateId: 'sector_pressure', objectiveId: 'bounty_hunt', squadId: 'striker_tri', modifierId: 'heat_stress', scoreBonus: 0.12 },
                { templateId: 'sector_hazard', objectiveId: 'hazard_lane', squadId: 'hunter_pack', modifierId: 'portal_storm', scoreBonus: 0.15 },
            ];
            runtime._state.lastSectorSummary = {
                sectorIndex: 2,
                awardedPoints: 1440,
                multiplierApplied: 3,
                comboAtSectorEnd: 8,
                breakdown: { base: 220, survival: 410, kills: 300, cleanSector: 0, risk: 80, penalty: 20, total: 990 },
            };
            runtime._state.lastSectorXp = { earned: 180 };
            runtime._state.completedSectors = 2;
            runtime._state.sectorIndex = 2;
            runtime._state.phase = 'intermission';
            runtime._missionState = {
                missions: [{ completed: true }, { completed: false }, { completed: true }],
                completedCount: 2,
                allCompleted: false,
            };
            runtime._prepareIntermission(nowMs);

            game.state = 'ROUND_END';
            game.ui.messageOverlay.classList.remove('hidden');
            game.matchFlowUiController.applyMatchUiState({ visibility: { messageOverlayHidden: false }, overlayStats: null });
            const intermissionPanel = document.getElementById('arcade-overlay-panel');
            const choiceButtons = Array.from(document.querySelectorAll('[data-arcade-choice-id]'));
            const rewardButtons = Array.from(document.querySelectorAll('[data-arcade-reward-id]'));
            if (choiceButtons[1]) choiceButtons[1].click();
            if (rewardButtons[1]) rewardButtons[1].click();
            const selectedChoiceId = String(runtime._state?.intermission?.selectedChoiceId || '');
            const selectedRewardId = String(runtime._state?.intermission?.selectedRewardId || '');

            runtime.beginNextSector();
            const syntheticPlayer = {
                isBot: false,
                alive: true,
                maxHp: 120,
                hp: 40,
                maxShieldHp: 40,
                shieldHP: 0,
                hasShield: false,
            };
            const beforeHp = syntheticPlayer.hp;
            const healResult = runtime.applyPendingIntermissionEffects({ players: [syntheticPlayer] }) || null;
            const afterHp = syntheticPlayer.hp;

            runtime._latestReplaySnapshot = {
                matchId: 'arcade-run-replay',
                initialState: { seed: 42 },
                actions: [],
            };
            runtime._state.postRunSummary = {
                isDailyChallenge: true,
                score: 4820,
                bestCombo: 11,
                missionCompletionRate: 0.67,
                xpEarned: 240,
                peakMultiplier: 4,
                xpAnimation: { durationMs: 260 },
                scorePerSector: [
                    { sectorIndex: 1, mapKey: 'parcours_rift', awardedPoints: 1200 },
                    { sectorIndex: 2, mapKey: 'maze', awardedPoints: 1440 },
                ],
                dailyResult: {
                    seed: 20260817,
                    attempt: 2,
                    score: 4820,
                    previousBestScore: 4100,
                    bestScore: 4820,
                    isNewBest: true,
                    tiedBest: false,
                    succeeded: true,
                },
            };
            runtime._state.replay = { runReplayId: 'arcade-run-replay', playbackEnabled: true };
            game.state = 'MATCH_END';
            game.matchFlowUiController.applyMatchUiState({ visibility: { messageOverlayHidden: false }, overlayStats: null });

            const postRunPanel = document.getElementById('arcade-overlay-panel');
            const replayBtn = document.getElementById('btn-arcade-overlay-replay');
            if (replayBtn) replayBtn.click();
            return {
                intermissionVisible: !!intermissionPanel && !intermissionPanel.classList.contains('hidden'),
                intermissionChoiceCount: choiceButtons.length,
                intermissionRewardCount: rewardButtons.length,
                selectedChoiceId,
                selectedRewardId,
                healedDelta: Math.max(0, afterHp - beforeHp),
                healedPlayers: Math.max(0, Number(healResult?.playersAffected) || 0),
                postRunVisible: !!postRunPanel && !postRunPanel.classList.contains('hidden'),
                postRunText: String(postRunPanel?.textContent || ''),
                replayCode: String(game.runtimeFacade.arcadeRunRuntime?.requestReplayPlayback?.()?.code || ''),
                replayButtonExists: !!replayBtn,
                menuReplayLabel: String(document.querySelector('#btn-arcade-replay')?.textContent || ''),
                menuDailyLabel: String(document.querySelector('#btn-arcade-daily')?.textContent || ''),
                menuDailyStatus: String(document.querySelector('#arcade-daily-line')?.textContent || ''),
            };
        });

        expect(state).not.toBeNull();
        expect(state.intermissionVisible).toBeTruthy();
        expect(state.intermissionChoiceCount).toBeGreaterThanOrEqual(2);
        expect(state.intermissionRewardCount).toBeGreaterThanOrEqual(2);
        expect(state.selectedChoiceId).not.toBe('');
        expect(state.selectedRewardId).not.toBe('');
        expect(state.healedDelta).toBeGreaterThan(0);
        expect(state.healedPlayers).toBeGreaterThan(0);
        expect(state.postRunVisible).toBeTruthy();
        expect(state.postRunText).toContain('Daily geschafft');
        expect(state.postRunText).toContain('Neuer Tagesbestwert');
        expect(state.postRunText).toContain('Tagesbestwert 4820');
        expect(state.replayCode).toBe('replay_export_ready');
        expect(state.replayButtonExists).toBeTruthy();
        expect(state.menuReplayLabel).toContain('Replay');
        expect(state.menuReplayLabel).not.toContain('Platzhalter');
        expect(state.menuDailyLabel).toContain('Daily');
        expect(state.menuDailyLabel).not.toContain('Platzhalter');
        expect(state.menuDailyStatus).toContain('Heute');

        await returnToMenu(page);
    });

    test('T20an: Start-Setup und Arcade-Overlay behandeln datennahe Markup-Werte als Text', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        const result = await page.evaluate(() => {
            const payload = '<img src=x onerror="window.__v112Injected=true"><script>window.__v112Script=true</script>';
            window.__v112Injected = false;
            window.__v112Script = false;

            const game = window.GAME_INSTANCE;
            const startSync = game?.uiManager?._startSync;
            const settings = game?.settings;
            if (!game || !startSync || !settings?.localSettings) {
                return { missingRuntime: true };
            }

            settings.mapKey = payload;
            settings.vehicles = {
                ...(settings.vehicles || {}),
                PLAYER_1: payload,
                PLAYER_2: payload,
            };
            settings.localSettings.startSetup = {
                ...(settings.localSettings.startSetup || {}),
                favoriteMaps: [payload],
                recentMaps: [payload],
                favoriteVehicles: [payload],
                recentVehicles: [payload],
                mapSearch: '',
                mapFilter: 'all',
                vehicleSearch: '',
                vehicleFilter: 'all',
                arcadeGhostDuelMode: 'off',
                arcadeGhostTrailCollisionEnabled: false,
                modeSelections: {
                    normal: {
                        mapKey: payload,
                        vehicles: {
                            PLAYER_1: payload,
                            PLAYER_2: payload,
                        },
                    },
                },
            };
            startSync._getRuntimeMaps = () => ({
                [payload]: {
                    name: payload,
                    size: [80, 30, 80],
                    obstacles: [],
                    portals: [],
                    gates: [],
                    items: [],
                    aircraft: [],
                },
            });
            startSync._mapPreviewEntries = [{
                key: payload,
                name: payload,
                sizeText: payload,
                obstacleCount: 0,
                portalCount: 0,
                gateCount: 0,
                tunnelCount: 0,
                spawnCount: 0,
                itemAnchorCount: 0,
                aircraftCount: 0,
                portalLevelCount: 0,
                category: payload,
                hasGlbModel: false,
                usesFallbackColliders: false,
                renderMode: payload,
            }];
            startSync._vehiclePreviewEntries = [{
                id: payload,
                label: payload,
                hitboxRadius: 1.1,
                category: payload,
            }];
            game.uiManager.syncStartSetupState(settings, {
                surfacePolicy: { productSurfaceId: 'desktop-app' },
                surfaceMenuState: {
                    sessionType: 'single',
                    modePath: 'normal',
                    mapKey: payload,
                },
                multiplayerSessionState: {
                    joined: false,
                    connected: false,
                    readyCount: 0,
                    memberCount: 0,
                },
            });

            const controller = game?.matchFlowUiController?.arcadeOverlayController;
            if (!controller || typeof controller._renderArcadeIntermissionPanel !== 'function') {
                return { missingOverlayController: true };
            }

            controller._renderArcadeIntermissionPanel({
                intermission: {
                    nextSectorIndex: 2,
                    lastSectorPoints: 1300,
                    lastSectorXp: 240,
                    missionsCompleted: 1,
                    missionsTotal: 3,
                    selectedChoiceId: payload,
                    selectedRewardId: payload,
                    nextSectorPreview: {
                        mapLabel: payload,
                        modifierLabel: payload,
                        modifierEffect: payload,
                    },
                    choices: [{
                        id: payload,
                        mapLabel: payload,
                        modifierLabel: payload,
                        modifierEffect: payload,
                    }],
                    rewardChoices: [{
                        id: payload,
                        label: payload,
                        effectText: payload,
                    }],
                },
            });
            const overlayRoot = document.getElementById('arcade-overlay-panel');
            const intermissionText = overlayRoot.textContent || '';
            const intermissionHtml = overlayRoot.innerHTML || '';

            controller._renderArcadePostRunPanel({
                postRunSummary: {
                    score: 1800,
                    bestCombo: 5,
                    missionCompletionRate: 0.5,
                    xpEarned: 120,
                    peakMultiplier: 2,
                    xpAnimation: { durationMs: 260 },
                    scorePerSector: [{
                        sectorIndex: 1,
                        mapKey: payload,
                        awardedPoints: 900,
                    }],
                },
                replay: {
                    playbackAvailable: false,
                    payloadAvailable: true,
                },
            });
            const postRunText = overlayRoot.textContent || '';
            const postRunHtml = overlayRoot.innerHTML || '';

            const startRoots = [
                document.getElementById('menu-selection-summary'),
                document.getElementById('map-preview'),
                document.getElementById('vehicle-preview-p1'),
                document.getElementById('vehicle-preview-p2'),
                document.getElementById('map-favorites-list'),
                document.getElementById('map-recent-list'),
                document.getElementById('vehicle-favorites-list'),
                document.getElementById('vehicle-recent-list'),
            ].filter(Boolean);
            const dangerousSelector = 'img,script,svg,iframe,object';
            const renderedNodes = [
                ...startRoots.flatMap((root) => Array.from(root.querySelectorAll('*'))),
                ...Array.from(overlayRoot.querySelectorAll('*')),
            ];
            const eventHandlerAttributeCount = renderedNodes.reduce((count, node) => {
                return count + Array.from(node.attributes || [])
                    .filter((attribute) => /^on/i.test(attribute.name))
                    .length;
            }, 0);
            const quickButton = document.querySelector('#map-favorites-list button');
            const startText = startRoots.map((root) => root.textContent || '').join('\n');
            const startHtml = startRoots.map((root) => root.innerHTML || '').join('\n');

            const evidence = {
                dangerousNodeCount:
                    startRoots.reduce((count, root) => count + root.querySelectorAll(dangerousSelector).length, 0)
                    + overlayRoot.querySelectorAll(dangerousSelector).length,
                eventHandlerAttributeCount,
                startTextIncludesPayload: startText.includes(payload),
                intermissionTextIncludesPayload: intermissionText.includes(payload),
                // The post-run cards go through the post-match stats contract, which caps a row
                // label at 80 characters; the probe is longer, so the text check reads its head.
                postRunTextIncludesPayload: postRunText.includes(payload.slice(0, 40)),
                startHtmlEscaped: startHtml.includes('&lt;img'),
                intermissionHtmlEscaped: intermissionHtml.includes('&lt;img'),
                postRunHtmlEscaped: postRunHtml.includes('&lt;img'),
                quickDatasetPreserved: quickButton?.dataset?.mapKey === payload,
                scriptExecuted: window.__v112Injected === true || window.__v112Script === true,
            };

            controller.dispose();
            delete window.__v112Injected;
            delete window.__v112Script;
            return evidence;
        });

        expect(result.missingRuntime).toBeFalsy();
        expect(result.missingOverlayController).toBeFalsy();
        expect(result.dangerousNodeCount).toBe(0);
        expect(result.eventHandlerAttributeCount).toBe(0);
        expect(result.startTextIncludesPayload).toBeTruthy();
        expect(result.intermissionTextIncludesPayload).toBeTruthy();
        expect(result.postRunTextIncludesPayload).toBeTruthy();
        expect(result.startHtmlEscaped).toBeTruthy();
        expect(result.intermissionHtmlEscaped).toBeTruthy();
        expect(result.postRunHtmlEscaped).toBeTruthy();
        expect(result.quickDatasetPreserved).toBeTruthy();
        expect(result.scriptExecuted).toBeFalsy();
    });

    test('T20y: Sticky Startleiste bleibt sichtbar und nutzt strukturierte Summary-Bloecke', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        const railState = await page.evaluate(() => {
            const rail = document.querySelector('.start-rail');
            const startButton = document.getElementById('btn-start');
            return {
                railPosition: rail ? window.getComputedStyle(rail).position : '',
                startVisible: !!(startButton && startButton.offsetParent),
                summaryBlocks: document.querySelectorAll('#menu-selection-summary .start-summary-block').length,
                summaryWhiteSpace: window.getComputedStyle(document.querySelector('.start-summary-value')).whiteSpace,
                visibleSummaryBlocks: Array.from(document.querySelectorAll('#menu-selection-summary .start-summary-block'))
                    .filter((block) => window.getComputedStyle(block).display !== 'none')
                    .map((block) => String(block.querySelector('.start-summary-label')?.textContent || '').trim()),
            };
        });

        expect(railState.railPosition).toBe('sticky');
        expect(railState.startVisible).toBeTruthy();
        expect(railState.summaryBlocks).toBeGreaterThanOrEqual(4);
        expect(railState.summaryWhiteSpace).toBe('normal');
        expect(railState.visibleSummaryBlocks).toEqual(['Spielstil', 'Karte', 'Flugzeug']);

        await page.click('.start-step-tab[data-start-section-target="vehicle"]');
        await expect(page.locator('#btn-start')).toBeInViewport();
        await expect(page.locator('#start-vehicle-section > summary')).toBeInViewport();
    });

    test('T20z2a: Start-Setup fuehrt exklusiv durch Karte, Flugzeug und kompakte Regeln', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        await expect(page.locator('#start-map-section')).toHaveJSProperty('open', true);
        await expect(page.locator('#start-vehicle-section')).toHaveJSProperty('open', false);
        await expect(page.locator('#start-match-section')).toHaveJSProperty('open', false);
        await expect(page.locator('.start-step-tab[data-start-section-target="map"]')).toHaveAttribute('aria-current', 'step');
        await expect(page.locator('#map-favorites-list').locator('..')).toHaveClass(/hidden/);
        await expect(page.locator('#map-recent-list').locator('..')).toHaveClass(/hidden/);

        await page.click('.start-step-tab[data-start-section-target="vehicle"]');
        await expect(page.locator('#start-map-section')).toHaveJSProperty('open', false);
        await expect(page.locator('#start-vehicle-section')).toHaveJSProperty('open', true);
        await expect(page.locator('.start-step-tab[data-start-section-target="vehicle"]')).toHaveAttribute('aria-current', 'step');
        await expect(page.locator('#start-vehicle-section > summary')).toBeFocused();

        await page.click('.start-step-tab[data-start-section-target="match"]');
        await expect(page.locator('#start-vehicle-section')).toHaveJSProperty('open', false);
        await expect(page.locator('#start-match-section')).toHaveJSProperty('open', true);
        await expect(page.locator('#bot-count')).toBeVisible();
        await expect(page.locator('#bot-policy-strategy')).not.toBeVisible();
        await page.click('.start-inline-advanced > summary');
        await expect(page.locator('#bot-policy-strategy')).toBeVisible();

        await page.click('.start-step-tab[data-start-section-target="map"]');
        const initialMapKey = await page.inputValue('#map-select');
        const activeMapChoice = page.locator('#start-map-choice-strip [aria-selected="true"]');
        await activeMapChoice.focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#map-select')).not.toHaveValue(initialMapKey);
        await expect(page.locator('#start-map-choice-strip [aria-selected="true"]')).toBeFocused();
    });

    test('T20z2c: Zuletzt benutzte Karten bleiben kompakt über der Kartenliste', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await loadGame(page);
        await openGameSubmenu(page);

        const layout = await page.evaluate(() => {
            const recent = document.getElementById('map-recent-list');
            recent.closest('.setup-chip-group')?.classList.remove('hidden');
            recent.closest('.setup-chip-grid')?.classList.remove('hidden');
            recent.replaceChildren(...['Standard', 'Komplex', 'Labyrinth', 'Leer', 'Eiffelturm', 'Magma-Labyrinth'].map((name) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'secondary-btn quick-pill';
                button.textContent = name;
                return button;
            }));
            const firstGroup = document.querySelector('#start-map-choice-strip .start-map-choice-group');
            return {
                recentHeight: recent.getBoundingClientRect().height,
                firstGroupY: firstGroup?.getBoundingClientRect().top ?? Infinity,
            };
        });

        expect(layout.recentHeight).toBeLessThanOrEqual(80);
        expect(layout.firstGroupY).toBeLessThan(1080);
    });

    test('T20z: Map-Vorschau und Fahrzeug-Mini-Hangar rendern ihre Auswahl strukturiert', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await openStartSetupSection(page, 'vehicle');

        const previewState = await page.evaluate(() => ({
            mapBadges: document.querySelectorAll('#map-preview .preview-badge').length,
            mapFacts: document.querySelectorAll('#map-preview .preview-kv').length,
            mapChoices: document.querySelectorAll('#start-map-choice-strip [data-map-key]').length,
            mapCanvasCount: document.querySelectorAll('#start-map-preview-mount canvas').length,
            mapPreviewStatus: document.getElementById('start-map-preview-mount')?.dataset?.previewStatus || '',
            mapPreviewKey: document.getElementById('start-map-preview-mount')?.dataset?.previewMapKey || '',
            vehicleBadges: document.querySelectorAll('#vehicle-preview-p1 .preview-badge').length,
            vehicleStats: document.querySelectorAll('#vehicle-preview-p1 .start-vehicle-stat progress').length,
            vehicleChoices: document.querySelectorAll('#start-vehicle-choice-strip [data-vehicle-id]').length,
            previewStatus: document.getElementById('start-vehicle-preview-mount')?.dataset?.previewStatus || '',
            previewGrid: document.getElementById('start-vehicle-preview-mount')?.dataset?.previewGrid || '',
            previewMotion: document.getElementById('start-vehicle-preview-mount')?.dataset?.previewMotion || '',
        }));

        expect(previewState.mapBadges).toBeGreaterThanOrEqual(2);
        expect(previewState.mapFacts).toBeGreaterThanOrEqual(2);
        expect(previewState.mapChoices).toBeGreaterThan(1);
        expect(previewState.mapCanvasCount).toBeLessThanOrEqual(1);
        expect(['ready', 'fallback']).toContain(previewState.mapPreviewStatus);
        expect(previewState.mapPreviewKey).toBe(await page.inputValue('#map-select'));
        expect(previewState.vehicleBadges).toBe(2);
        expect(previewState.vehicleStats).toBe(3);
        expect(previewState.vehicleChoices).toBeGreaterThan(1);
        expect(['ready', 'fallback']).toContain(previewState.previewStatus);
        expect(previewState.previewGrid).toBe('hangar');
        expect(previewState.previewMotion).toBe(previewState.previewStatus === 'ready' ? 'idle-spin' : '');

        if (previewState.previewStatus === 'ready') {
            const previewMount = page.locator('#start-vehicle-preview-mount');
            await previewMount.dispatchEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse' });
            await expect(previewMount).toHaveAttribute('data-preview-motion', 'manual');
            await previewMount.dispatchEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse' });
            await expect(previewMount).toHaveAttribute('data-preview-motion', 'idle-spin');
        }
    });

    test('T20z3: Karten-Miniatur nutzt bestehenden Writeback und pausiert bei geschlossenem Bereich', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await openStartSetupSection(page, 'map');

        const initialMapKey = await page.inputValue('#map-select');
        await page.click('#btn-map-next');
        await expect(page.locator('#map-select')).not.toHaveValue(initialMapKey);

        const selectedState = await page.evaluate(() => {
            const select = document.getElementById('map-select');
            const selectedMapKey = String(select?.value || '');
            const selectedLabel = String(select?.selectedOptions?.[0]?.textContent || '')
                .replace(/\s*\[GLB\]\s*$/, '')
                .trim();
            const summary = Array.from(document.querySelectorAll('#menu-selection-summary .start-summary-block'))
                .find((block) => String(block.querySelector('.start-summary-label')?.textContent || '').trim() === 'Karte');
            return {
                selectedMapKey,
                selectedLabel,
                settingsMapKey: String(window.GAME_INSTANCE?.settings?.mapKey || ''),
                previewMapKey: String(document.getElementById('start-map-preview-mount')?.dataset?.previewMapKey || ''),
                previewTitle: String(document.querySelector('#map-preview .preview-card-title')?.textContent || '').trim(),
                summary: String(summary?.querySelector('.start-summary-value')?.textContent || '').trim(),
                activeChoiceKey: document.querySelector('#start-map-choice-strip .start-map-choice.active')?.dataset?.mapKey || '',
                canvasCount: document.querySelectorAll('#start-map-preview-mount canvas').length,
                previewStatus: String(document.getElementById('start-map-preview-mount')?.dataset?.previewStatus || ''),
            };
        });

        expect(selectedState.settingsMapKey).toBe(selectedState.selectedMapKey);
        expect(selectedState.previewMapKey).toBe(selectedState.selectedMapKey);
        expect(selectedState.previewTitle).toBe(selectedState.selectedLabel);
        expect(selectedState.summary).toBe(selectedState.selectedLabel);
        expect(selectedState.activeChoiceKey).toBe(selectedState.selectedMapKey);
        expect(selectedState.canvasCount).toBeLessThanOrEqual(1);

        if (selectedState.previewStatus === 'ready') {
            const previewMount = page.locator('#start-map-preview-mount');
            await previewMount.dispatchEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse' });
            await expect(previewMount).toHaveAttribute('data-preview-motion', 'manual');
            await previewMount.dispatchEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse' });
            await expect(previewMount).toHaveAttribute('data-preview-motion', 'idle-spin');
        }

        await page.click('#start-map-section > summary');
        await expect(page.locator('#start-map-preview-mount')).toHaveAttribute('data-preview-active', 'false');
        await openStartSetupSection(page, 'map');
        await expect(page.locator('#start-map-preview-mount')).toHaveAttribute('data-preview-active', 'true');

        await page.evaluate(() => {
            const controller = window.GAME_INSTANCE?.uiManager?._startSync;
            controller?.setupStartSetupControls?.();
            controller?.syncStartSetupState?.(window.GAME_INSTANCE?.settings);
        });
        await expect(page.locator('#start-map-preview-mount canvas')).toHaveCount(selectedState.canvasCount);
    });

    test('T20z4: Mini-Hangar wechselt Fahrzeuge ueber den bestehenden Writeback und pausiert geschlossen', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await openStartSetupSection(page, 'vehicle');

        const initialVehicleId = await page.inputValue('#vehicle-select-p1');
        await page.click('#btn-vehicle-next');
        await expect(page.locator('#vehicle-select-p1')).not.toHaveValue(initialVehicleId);

        const selectedState = await page.evaluate(() => {
            const select = document.getElementById('vehicle-select-p1');
            const selectedId = String(select?.value || '');
            const selectedLabel = String(select?.selectedOptions?.[0]?.textContent || '').trim();
            const summary = Array.from(document.querySelectorAll('#menu-selection-summary .start-summary-block'))
                .find((block) => String(block.querySelector('.start-summary-label')?.textContent || '').trim() === 'Flugzeug');
            return {
                selectedId,
                selectedLabel,
                settingsVehicleId: String(window.GAME_INSTANCE?.settings?.vehicles?.PLAYER_1 || ''),
                title: String(document.getElementById('start-vehicle-title')?.textContent || '').trim(),
                summary: String(summary?.querySelector('.start-summary-value')?.textContent || '').trim(),
                activeChoiceId: document.querySelector('#start-vehicle-choice-strip .start-vehicle-choice.active')?.dataset?.vehicleId || '',
                canvasCount: document.querySelectorAll('#start-vehicle-preview-mount canvas').length,
                statValues: Array.from(document.querySelectorAll('.start-vehicle-stat progress')).map((node) => Number(node.value)),
            };
        });

        expect(selectedState.selectedId).toBe(selectedState.settingsVehicleId);
        expect(selectedState.title).toBe(selectedState.selectedLabel);
        expect(selectedState.summary).toBe(selectedState.selectedLabel);
        expect(selectedState.activeChoiceId).toBe(selectedState.selectedId);
        expect(selectedState.canvasCount).toBeLessThanOrEqual(1);
        expect(selectedState.statValues).toHaveLength(3);
        selectedState.statValues.forEach((value) => expect(value).toBeGreaterThanOrEqual(1));

        await page.click('#start-vehicle-section > summary');
        await expect(page.locator('#start-vehicle-preview-mount')).toHaveAttribute('data-preview-active', 'false');
        await openStartSetupSection(page, 'vehicle');
        await expect(page.locator('#start-vehicle-preview-mount')).toHaveAttribute('data-preview-active', 'true');

        await page.evaluate(() => document.getElementById('main-menu')?.classList.add('hidden'));
        await expect(page.locator('#start-vehicle-preview-mount')).toHaveAttribute('data-preview-active', 'false');
        await page.evaluate(() => document.getElementById('main-menu')?.classList.remove('hidden'));
        await expect(page.locator('#start-vehicle-preview-mount')).toHaveAttribute('data-preview-active', 'true');

        await page.evaluate(() => {
            const controller = window.GAME_INSTANCE?.uiManager?._startSync;
            controller?.setupStartSetupControls?.();
            controller?.syncStartSetupState?.(window.GAME_INSTANCE?.settings);
        });
        await expect(page.locator('#start-vehicle-preview-mount canvas')).toHaveCount(selectedState.canvasCount);
    });

    test('T20z5: Splitscreen nutzt einen Renderer und getrennte Fahrzeugauswahl fuer Pilot 1 und 2', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page, { sessionType: 'splitscreen' });
        await openStartSetupSection(page, 'vehicle');

        await expect(page.locator('#vehicle-p2-container')).toBeVisible();
        const player1VehicleId = await page.inputValue('#vehicle-select-p1');
        const initialPlayer2VehicleId = await page.inputValue('#vehicle-select-p2');
        await page.click('#vehicle-p2-container');
        await expect(page.locator('#vehicle-select-p2-panel')).toBeVisible();
        await page.click('#btn-vehicle-next');
        await expect(page.locator('#vehicle-select-p2')).not.toHaveValue(initialPlayer2VehicleId);

        const splitscreenState = await page.evaluate(() => ({
            player1VehicleId: String(window.GAME_INSTANCE?.settings?.vehicles?.PLAYER_1 || ''),
            player2VehicleId: String(window.GAME_INSTANCE?.settings?.vehicles?.PLAYER_2 || ''),
            selectedPlayer2Id: String(document.getElementById('vehicle-select-p2')?.value || ''),
            selectedPlayer2Label: String(document.getElementById('vehicle-select-p2')?.selectedOptions?.[0]?.textContent || '').trim(),
            title: String(document.getElementById('start-vehicle-title')?.textContent || '').trim(),
            canvasCount: document.querySelectorAll('#start-vehicle-preview-mount canvas').length,
        }));

        expect(splitscreenState.player1VehicleId).toBe(player1VehicleId);
        expect(splitscreenState.player2VehicleId).toBe(splitscreenState.selectedPlayer2Id);
        expect(splitscreenState.title).toBe(splitscreenState.selectedPlayer2Label);
        expect(splitscreenState.canvasCount).toBeLessThanOrEqual(1);
    });

    test('T20z6: Mehrspieler erlaubt getrennte Fahrzeugauswahl fuer Pilot 1 und 2', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page, { sessionType: 'multiplayer' });
        await openStartSetupSection(page, 'vehicle');

        await expect(page.locator('#vehicle-p2-container')).toBeVisible();
        const player1VehicleId = await page.inputValue('#vehicle-select-p1');
        const initialPlayer2VehicleId = await page.inputValue('#vehicle-select-p2');
        await page.click('#vehicle-p2-container');
        await expect(page.locator('#vehicle-select-p2-panel')).toBeVisible();
        await page.click('#btn-vehicle-next');
        await expect(page.locator('#vehicle-select-p2')).not.toHaveValue(initialPlayer2VehicleId);

        const multiplayerState = await page.evaluate(() => {
            const player2Summary = Array.from(document.querySelectorAll('#menu-selection-summary .start-summary-block'))
                .find((block) => String(block.querySelector('.start-summary-label')?.textContent || '').trim() === 'Flugzeug P2');
            return {
                player1VehicleId: String(window.GAME_INSTANCE?.settings?.vehicles?.PLAYER_1 || ''),
                player2VehicleId: String(window.GAME_INSTANCE?.settings?.vehicles?.PLAYER_2 || ''),
                selectedPlayer2Id: String(document.getElementById('vehicle-select-p2')?.value || ''),
                selectedPlayer2Label: String(document.getElementById('vehicle-select-p2')?.selectedOptions?.[0]?.textContent || '').trim(),
                title: String(document.getElementById('start-vehicle-title')?.textContent || '').trim(),
                summary: String(player2Summary?.querySelector('.start-summary-value')?.textContent || '').trim(),
                canvasCount: document.querySelectorAll('#start-vehicle-preview-mount canvas').length,
            };
        });

        expect(multiplayerState.player1VehicleId).toBe(player1VehicleId);
        expect(multiplayerState.player2VehicleId).toBe(multiplayerState.selectedPlayer2Id);
        expect(multiplayerState.title).toBe(multiplayerState.selectedPlayer2Label);
        expect(multiplayerState.summary).toBe(multiplayerState.selectedPlayer2Label);
        expect(multiplayerState.canvasCount).toBeLessThanOrEqual(1);
    });

    test('T20z1: Kartenfeld, Zusammenfassung, Vorschau und Runtime verwenden dieselbe Auswahl', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

        const state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const select = document.getElementById('map-select');
            const summaryEntries = Array.from(document.querySelectorAll('#menu-selection-summary .start-summary-block'))
                .map((block) => ({
                    label: String(block.querySelector('.start-summary-label')?.textContent || '').trim(),
                    value: String(block.querySelector('.start-summary-value')?.textContent || '').trim(),
                }));
            return {
                selectValue: String(select?.value || ''),
                selectLabel: String(select?.selectedOptions?.[0]?.textContent || '').replace(/\s*\[GLB\]\s*$/, '').trim(),
                previewTitle: String(document.querySelector('#map-preview .preview-card-title')?.textContent || '').trim(),
                summaryValue: summaryEntries.find((entry) => entry.label === 'Karte')?.value || '',
                runtimeMapKey: String(game?.settings?.mapKey || ''),
                modeMapKey: String(game?.settings?.localSettings?.startSetup?.modeSelections?.fight?.mapKey || ''),
            };
        });

        expect(state.selectValue).toBeTruthy();
        expect(state.selectValue).toBe(state.runtimeMapKey);
        expect(state.selectValue).toBe(state.modeMapKey);
        expect(state.selectLabel).toBe(state.previewTitle);
        expect(state.summaryValue).toBe(state.previewTitle);
    });

    test('T20z2b: Erweiterte Optionen starten oben, sperren den Hintergrund und fokussieren Schliessen', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page);

        const state = await page.evaluate(() => {
            const menu = document.querySelector('.menu-content');
            const drawer = document.getElementById('submenu-level4');
            const background = document.getElementById('submenu-game');
            const menuRect = menu?.getBoundingClientRect?.();
            const drawerRect = drawer?.getBoundingClientRect?.();
            return {
                activeId: document.activeElement?.id || '',
                menuScrollTop: Math.round(menu?.scrollTop || 0),
                drawerOffsetTop: Math.round((drawerRect?.top || 0) - (menuRect?.top || 0)),
                backgroundInert: background?.hasAttribute('inert') || background?.inert === true,
                backgroundAriaHidden: background?.getAttribute('aria-hidden'),
                fireRateText: String(document.getElementById('fire-rate-label')?.textContent || '').trim(),
                lockOnText: String(document.getElementById('lockon-label')?.textContent || '').trim(),
            };
        });

        expect(state.activeId).toBe('btn-close-level4');
        expect(state.menuScrollTop).toBe(0);
        expect(Math.abs(state.drawerOffsetTop)).toBeLessThanOrEqual(2);
        expect(state.backgroundInert).toBeTruthy();
        expect(state.backgroundAriaHidden).toBe('true');
        expect(state.fireRateText).toMatch(/^\d+(?:\.\d+)?s$/);
        expect(state.lockOnText).toMatch(/^\d+°$/);
        await page.locator('#btn-level4-reset').focus();
        await page.keyboard.press('Shift+Tab');
        const wrappedFocus = await page.evaluate(() => {
            const drawer = document.getElementById('submenu-level4');
            return {
                insideDrawer: !!drawer?.contains(document.activeElement),
                activeId: document.activeElement?.id || '',
            };
        });
        expect(wrappedFocus.insideDrawer).toBeTruthy();
        expect(wrappedFocus.activeId).not.toBe('btn-level4-reset');
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.id || '')).toBe('btn-level4-reset');
    });

    test('T20z3: Einstellungen aus dem Hauptmenue kehren beim Schliessen dorthin zurueck', async ({ page }) => {
        await loadGame(page);
        await page.click('[data-level4-return-target="main"][data-level4-section="gameplay"]');
        await expect(page.locator('#submenu-level4')).toBeVisible();
        await expect(page.locator('#submenu-level4')).toHaveAttribute('data-level4-return-target', 'main');

        await page.click('#btn-close-level4');
        await expect(page.locator('#submenu-level4')).toBeHidden();
        await expect(page.locator('#btn-quick-last-settings')).toBeVisible();
        await expect(page.locator('#main-menu')).toHaveAttribute('data-menu-panel', 'main');
        await expect(page.locator('#main-menu')).toHaveAttribute('data-menu-depth', '1');
    });

    test('T20aa: Ebene 4 nutzt Bereichstabs ohne horizontalen Overflow auf Mobil', async ({ page }) => {
        await page.setViewportSize({ width: 430, height: 932 });
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'tools' });

        const level4State = await page.evaluate(() => {
            const drawer = document.getElementById('submenu-level4');
            const stack = drawer?.querySelector('.level4-section-stack');
            const activePanel = drawer?.querySelector('.level4-section-panel.is-active');
            return {
                tabCount: drawer?.querySelectorAll('[data-level4-section-target]').length || 0,
                activeSection: String(activePanel?.dataset?.level4Section || ''),
                profileContainsPresetActions: !!document.querySelector('#level4-section-tools #btn-preset-apply'),
                profileContainsEditorActions: !!document.querySelector('#level4-section-tools #btn-open-editor'),
                presetsContainPresetActions: !!document.querySelector('#level4-section-presets #btn-preset-apply'),
                utilitiesContainEditorActions: !!document.querySelector('#level4-section-utilities #btn-open-editor'),
                drawerOverflow: Math.max(0, Math.round((drawer?.scrollWidth || 0) - (drawer?.clientWidth || 0))),
                stackOverflow: Math.max(0, Math.round((stack?.scrollWidth || 0) - (stack?.clientWidth || 0))),
            };
        });

        expect(level4State.tabCount).toBe(7);
        expect(level4State.activeSection).toBe('tools');
        expect(level4State.profileContainsPresetActions).toBeFalsy();
        expect(level4State.profileContainsEditorActions).toBeFalsy();
        expect(level4State.presetsContainPresetActions).toBeTruthy();
        expect(level4State.utilitiesContainEditorActions).toBeTruthy();
        expect(level4State.drawerOverflow).toBeLessThanOrEqual(4);
        expect(level4State.stackOverflow).toBeLessThanOrEqual(4);
    });
});
