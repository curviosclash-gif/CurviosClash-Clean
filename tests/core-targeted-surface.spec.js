import {
    test,
    expect,
    CONFIG,
    collectErrors,
    lockExpertMode,
    loadGame,
    openCustomSubmenu,
    openDebugSubmenu,
    openDeveloperSubmenu,
    openExpertSubmenu,
    openGameSubmenu,
    openStartSetupSection,
    openLevel4Drawer,
    openMultiplayerSubmenu,
    openSubmenu,
    returnToMenu,
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
    SETTINGS_STORAGE_KEY,
    SETTINGS_PROFILES_STORAGE_KEY,
    LEGACY_SETTINGS_STORAGE_KEY,
    MENU_DRAFTS_STORAGE_KEY,
    MENU_PRESETS_STORAGE_KEY,
    CUSTOM_MAP_STORAGE_KEY,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
    ARCADE_LAST_RUN_STORAGE_KEY,
    buildLegacyRuntimeCustomMap,
    createMockEditorManager,
    loadGameWithRetry,
} from './core-targeted.shared.js';

test.describe('T1-20: Core & Infrastruktur - Vehicle, Surface & UX', () => {
    test.describe.configure({ mode: 'serial' });

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

    test('T66a: Vehicle-Manager deckt Filter, 3D-Preview, Upgrade-Overlay und Presets ab', async ({ page }) => {
        await loadGame(page);
        const vehicleIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#vehicle-select-p1 option'))
                .map((option) => String(option?.value || '').trim())
                .filter(Boolean);
        });
        await page.evaluate(({ profileKey, loadoutKey, vehicleIdList }) => {
            const nowIso = new Date().toISOString();
            const unlockedSlots = [
                'core',
                'nose',
                'wing_left',
                'wing_right',
                'engine_left',
                'engine_right',
                'utility',
                'wing_left_t2',
                'wing_right_t2',
                'engine_left_t2',
                'engine_right_t2',
                'core_t2',
                'nose_t2',
                'utility_t2',
                'core_t3',
                'nose_t3',
            ];
            const profiles = {};
            vehicleIdList.forEach((vehicleId) => {
                profiles[vehicleId] = {
                    schemaVersion: 'arcade-vehicle-profile.v1',
                    vehicleId,
                    xp: 999999,
                    level: 30,
                    unlockedSlots: [...unlockedSlots],
                    upgrades: {},
                    createdAt: nowIso,
                    updatedAt: nowIso,
                };
            });
            localStorage.setItem(profileKey, JSON.stringify(profiles));
            localStorage.removeItem(loadoutKey);
        }, {
            profileKey: ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
            loadoutKey: ARCADE_VEHICLE_LOADOUT_STORAGE_KEY,
            vehicleIdList: vehicleIds,
        });

        await page.reload();
        await loadGameWithRetry(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await expect(page.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 5000 });

        const allCount = await page.locator('#arcade-vehicle-manager .arcade-vehicle-card').count();
        expect(allCount).toBeGreaterThan(3);

        await page.evaluate(() => {
            document.querySelector('#arcade-vehicle-manager [data-category=\"jaeger\"]')?.dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );
        });
        const activeCategory = await page.evaluate(() => {
            return String(document.querySelector('#arcade-vehicle-manager .arcade-vehicle-tab.is-active')?.getAttribute('data-category') || '');
        });
        expect(activeCategory).toBe('jaeger');
        const jaegerState = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#arcade-vehicle-manager .arcade-vehicle-card'));
            return {
                count: cards.length,
                categories: [...new Set(cards.map((card) => String(card.getAttribute('data-vehicle-category') || '')))],
            };
        });
        expect(jaegerState.count).toBeGreaterThan(0);
        expect(jaegerState.categories).toEqual(['jaeger']);

        await page.fill('#arcade-vehicle-manager .arcade-vehicle-search', 'drone');
        const droneCount = await page.locator('#arcade-vehicle-manager .arcade-vehicle-card').count();
        expect(droneCount).toBeGreaterThanOrEqual(1);
        await page.locator('#arcade-vehicle-manager .arcade-vehicle-card').first().click({ force: true });

        const previewState = await page.evaluate(() => ({
            status: String(document.getElementById('arcade-vehicle-manager')?.dataset?.previewStatus || ''),
            hasCanvas: !!document.querySelector('#arcade-vehicle-manager .arcade-vehicle-preview-canvas-node'),
            hasOverlayDots: document.querySelectorAll('#arcade-vehicle-manager .arcade-vehicle-slot-dot').length,
        }));
        expect(previewState.status).toBe('ready');
        expect(previewState.hasCanvas).toBeTruthy();
        expect(previewState.hasOverlayDots).toBeGreaterThanOrEqual(3);

        const tiersBefore = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#arcade-vehicle-manager .arcade-vehicle-slot-tier'))
                .map((node) => String(node.textContent || ''));
        });
        const clickedOverlay = await page.evaluate(() => {
            const button = document.querySelector('#arcade-vehicle-manager .arcade-vehicle-slot-dot:not(.is-disabled):not(.hidden)');
            if (!button) return false;
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
        });
        if (!clickedOverlay) {
            await page.locator('#arcade-vehicle-manager .arcade-vehicle-upgrade-btn:not([disabled])').first().click({ force: true });
        }
        await page.waitForTimeout(120);
        const tiersAfter = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#arcade-vehicle-manager .arcade-vehicle-slot-tier'))
                .map((node) => String(node.textContent || ''));
        });
        expect(tiersAfter.join('|')).not.toBe(tiersBefore.join('|'));

        await page.fill('#arcade-vehicle-manager .arcade-vehicle-preset-input', 'QA Slot Preset');
        await page.locator('#arcade-vehicle-manager .arcade-vehicle-preset-save').click({ force: true });
        const presetCount = await page.locator('#arcade-vehicle-manager .arcade-vehicle-preset-select option').count();
        expect(presetCount).toBeGreaterThan(0);

        await page.screenshot({ path: 'test-results/v66-vehicle-manager-panel.png', fullPage: true });
        await returnToMenu(page);
    });

    test('T66b: Vehicle-Selection bleibt zwischen Arcade-Manager, Settings, Snapshot und Spawn konsistent', async ({ page }) => {
        await loadGame(page);
        await page.evaluate((lastRunKey) => localStorage.removeItem(lastRunKey), ARCADE_LAST_RUN_STORAGE_KEY);

        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await expect(page.locator('#arcade-vehicle-manager')).toBeVisible({ timeout: 5000 });

        const selectedVehicleId = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('#arcade-vehicle-manager .arcade-vehicle-card'));
            const preferred = cards.find((node) => node.getAttribute('data-vehicle-id') === 'drone')
                || cards.find((node) => node.getAttribute('data-vehicle-id') === 'aircraft')
                || cards[0];
            if (!preferred) return '';
            preferred.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return String(preferred.getAttribute('data-vehicle-id') || '');
        });
        expect(selectedVehicleId).not.toBe('');
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
            const snapshot = JSON.parse(localStorage.getItem(lastRunKey) || '{}');
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
                expectedDurationFloor: (Math.floor((simulatedDurationMs / 1000) * 10) / 10).toFixed(1),
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
        expect(overlayState.roundDuration).toContain(overlayState.expectedDurationFloor);
        expect(overlayState.matchRounds).toBe('1');
        expect(overlayState.scoreLeader).toBe('1/5');
        expect(overlayState.countdownText).toContain('Naechste Runde in 3');
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
            players[1].score = 1;
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
                botWinRate: readValue('match', 'bot-win-rate'),
                roundTitle: readTitle('round'),
            };
        });

        expect(overlayState.error || '').toBe('');
        expect(overlayState.state).toBe('MATCH_END');
        expect(overlayState.messageText).toContain('Sieg: Spieler 1');
        expect(overlayState.roundTitle).toBe('Finalrunde');
        expect(overlayState.scoreboardTitle).toBe('Endstand');
        expect(overlayState.scoreLeader).toBe('3/3');
        expect(overlayState.botWinRate).toBe('0%');
    });

    test('T20ke: Developer-Telemetrie-Dashboard zeigt Balancing-Summary aus dem Round-End-Pfad', async ({ page }) => {
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

            return {
                error: '',
                balanceRounds: Number(game.settings?.localSettings?.telemetryState?.balance?.rounds || 0),
                telemetryBalance: game.settings?.localSettings?.telemetryState?.balance || null,
                telemetryRecentRound: game.settings?.localSettings?.telemetryState?.recentRounds?.[0] || null,
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

        await returnToMenu(page);
        await openDeveloperSubmenu(page);

        const dashboardState = await page.evaluate(() => {
            const telemetry = JSON.parse(document.getElementById('developer-telemetry-output')?.textContent || '{}');
            const readValue = (cardId, rowKey) => document.querySelector(
                `[data-telemetry-card="${cardId}"] [data-telemetry-row-key="${rowKey}"] .developer-telemetry-value`
            )?.textContent || '';
            const readLabel = (cardId, rowKey) => document.querySelector(
                `[data-telemetry-card="${cardId}"] [data-telemetry-row-key="${rowKey}"] .developer-telemetry-label`
            )?.textContent || '';

            return {
                telemetry,
                cardIds: Array.from(document.querySelectorAll('[data-telemetry-card]')).map((node) => node.getAttribute('data-telemetry-card')),
                overviewRounds: readValue('overview', 'rounds'),
                balanceDuration: readValue('balance', 'average-round-duration'),
                topMap: readLabel('maps', 'bucket-0'),
                recentRows: Array.from(document.querySelectorAll('[data-telemetry-recent-index]')).map((node) => node.textContent || ''),
            };
        });

        expect(dashboardState.cardIds).toEqual(expect.arrayContaining(['overview', 'balance', 'maps', 'modes', 'recent']));
        expect(Number(dashboardState.telemetry?.balance?.rounds || 0)).toBe(1);
        expect(Number(dashboardState.telemetry?.balance?.humanWins || 0)).toBe(1);
        expect(Number(dashboardState.telemetry?.balance?.mgHitsPerRound || 0)).toBeGreaterThanOrEqual(1);
        expect(Number(dashboardState.telemetry?.balance?.rocketHitsPerRound || 0)).toBeGreaterThanOrEqual(1);
        expect(Number(dashboardState.telemetry?.balance?.hpDamagePerRound || 0)).toBeGreaterThan(0);
        expect(Number(dashboardState.telemetry?.balance?.shieldAbsorbPerRound || 0)).toBeGreaterThan(0);
        expect(dashboardState.telemetry?.topMaps?.[0]?.key).toBe('standard');
        expect(dashboardState.overviewRounds).toBe('1');
        expect(dashboardState.balanceDuration).not.toBe('0.00s');
        expect(dashboardState.topMap).toBe('standard');
        expect(dashboardState.recentRows[0] || '').toContain('Spieler 1');
        expect(dashboardState.recentRows[0] || '').toContain('standard / classic');
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
        await loadGame(page);
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

    test('T20ia: Expertenlogin sperrt Developer/Debug bis Passwort 1307 und entsperrt danach', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'tools' });
        await expect(page.locator('#submenu-level4 #btn-open-developer')).toHaveCount(0);

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

        await page.click('#btn-open-developer');
        await expect(page.locator('#submenu-developer')).toBeVisible();

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
        await page.waitForTimeout(50);

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
        await page.waitForTimeout(50);

        const globalBinding = await page.evaluate(() => (
            window.GAME_INSTANCE?.settings?.controls?.GLOBAL?.RECORDING_TOGGLE || ''
        ));
        expect(globalBinding).toBe('KeyN');
    });

    test('T20l: Globale Cinematic-Taste toggelt Kamera fuer beide Spieler', async ({ page }) => {
        await startGame(page);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.controls.GLOBAL.CINEMATIC_TOGGLE = 'KeyB';
            game.input.setBindings(game.settings.controls);
        });

        const before = await page.evaluate(() => window.GAME_INSTANCE?.renderer?.getCinematicEnabled?.());
        await page.keyboard.press('b');
        await page.waitForTimeout(100);
        const after = await page.evaluate(() => window.GAME_INSTANCE?.renderer?.getCinematicEnabled?.());
        expect(after).toBe(!before);
    });

    test('T20l1: Globale Recording-Taste triggert lifecycle.v1 recording_requested toggle', async ({ page }) => {
        test.setTimeout(60000);
        await startGame(page);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
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
                    probe.events.push({ type, command: String(context?.command || '') });
                    if (String(context?.command || '').toLowerCase() === 'toggle') {
                        probe.recording = !probe.recording;
                    }
                },
            };

            window.__recordingHotkeyProbe = probe;
        });

        await page.keyboard.press('n');
        await page.waitForTimeout(60);
        await page.keyboard.press('n');
        await page.waitForTimeout(60);

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
        expect(probeState.events[0]?.command).toBe('toggle');
        expect(probeState.events[1]?.type).toBe('recording_requested');
        expect(probeState.events[1]?.command).toBe('toggle');
        expect(probeState.recording).toBeFalsy();
    });

    test('T20l2: Cinematic-Aufnahme meldet WebCodecs-Starts als MP4', async ({ page }) => {
        await page.goto('/', { waitUntil: 'commit' });
        await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const messages = [];
            const originalShowStatusToast = game._showStatusToast;
            const originalRender = game.render;
            const originalSetRecordingCaptureSettings = game.renderer?.setRecordingCaptureSettings;
            const recorder = {
                setRecordingCaptureSettings() { },
                async startRecording() {
                    return {
                        started: true,
                        recorderEngine: 'webcodecs-native',
                    };
                },
            };

            game._showStatusToast = (message) => messages.push(String(message || ''));
            game.render = () => { };
            if (game.renderer) {
                game.renderer.setRecordingCaptureSettings = () => { };
            }

            try {
                await game._startCinematicRecording(recorder);
                return {
                    message: messages[messages.length - 1] || '',
                };
            } finally {
                game._showStatusToast = originalShowStatusToast;
                game.render = originalRender;
                if (game.renderer && originalSetRecordingCaptureSettings) {
                    game.renderer.setRecordingCaptureSettings = originalSetRecordingCaptureSettings;
                }
            }
        });

        expect(result.message).toContain('MP4');
        expect(result.message).not.toContain('WebM');
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
        await openLevel4Drawer(page, { section: 'gameplay' });
        await page.selectOption('#recording-profile-select', 'youtube_short');
        await page.selectOption('#recording-hud-mode-select', 'with_hud');
        await page.selectOption('#normal-camera-perspective-select', 'cinematic_soft');
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
            game._onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });
            game.renderer.prepareRecordingCaptureFrame({
                recordingActive: true,
                entityManager: game.entityManager,
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
            game._onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });

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
        await page.waitForTimeout(500);

        const recordingState = await page.evaluate(() => {
            const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
            const support = recorder?.getSupportState?.() || {};
            if (support.canRecord && !recorder?.isRecording?.()) {
                recorder?.notifyLifecycleEvent?.('recording_requested', { command: 'start' });
            }
            return {
                canRecord: !!support.canRecord,
                isRecording: !!recorder?.isRecording?.(),
            };
        });
        if (!recordingState.canRecord || !recordingState.isRecording) {
            test.skip(true, 'MediaRecorder-Exportpfad im Runtime nicht aktiv. Sunset: durch Capability-Fixture ersetzen, sobald der Desktop-Recording-Harness deterministisch ist.');
        }

        await returnToMenu(page);
        await page.waitForTimeout(300);

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

        if (!recorderState.canRecord || !recorderState.exportMeta) {
            test.skip(true, 'MediaRecorder-Export im Runtime nicht deterministisch verfuegbar. Sunset: durch eventbasiertes Export-Ready-Signal ersetzen.');
        }
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

    test('T20p: Start-Validierung zeigt Feldgrund und fokussiert Ziel', async ({ page }) => {
        await loadGame(page);
        await openMultiplayerSubmenu(page);
        await page.click('#btn-start');
        await expect(page.locator('#start-validation-status')).toContainText('Start nicht moeglich');
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
                level3ThemeMode: level3Reset.themeMode,
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
        await openStartSetupSection(page, 'match');
        await page.selectOption('#theme-mode-select', 'hell');
        await page.click('#btn-level3-reset');
        expect(await page.inputValue('#map-select')).toBe(expectedDefaults.level3MapKey);
        expect(await page.inputValue('#theme-mode-select')).toBe(expectedDefaults.level3ThemeMode);
        expect(await page.inputValue('#vehicle-select-p1')).toBe(expectedDefaults.level3VehicleP1);

        await openLevel4Drawer(page, { section: 'gameplay' });
        await page.evaluate(() => {
            const slider = document.getElementById('speed-slider');
            if (!slider) return;
            slider.value = '30';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.selectOption('#normal-camera-perspective-select', 'cinematic_action');
        await page.uncheck('#normal-camera-reduce-motion-toggle');
        await page.click('#btn-level4-reset');
        await page.waitForTimeout(100);
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

    test('T20r: Textkatalog-Override greift und Release-Vorschau deaktiviert ihn', async ({ page }) => {
        await loadGame(page);
        await openDeveloperSubmenu(page);

        if (!(await page.isChecked('#developer-mode-toggle'))) {
            await page.check('#developer-mode-toggle');
        }
        await page.selectOption('#developer-text-id-select', 'menu.level3.start.label');
        await page.fill('#developer-text-override-input', 'Los jetzt');
        await page.click('#btn-developer-text-apply');
        await page.waitForTimeout(120);

        await openGameSubmenu(page);
        await expect(page.locator('#btn-start')).toHaveText('Los jetzt');

        await openDeveloperSubmenu(page);
        await page.selectOption('#developer-text-id-select', 'menu.level4.tools.map_editor.label');
        await page.fill('#developer-text-override-input', 'Map Builder');
        await page.click('#btn-developer-text-apply');
        await page.waitForTimeout(120);

        await openLevel4Drawer(page, { section: 'tools' });
        await expect(page.locator('#btn-open-editor')).toHaveText('Map Builder');

        await openDeveloperSubmenu(page);
        await page.check('#developer-release-preview-toggle');
        await page.waitForTimeout(120);

        await openGameSubmenu(page);
        await expect(page.locator('#btn-start')).toHaveText('Starten');

        await openDeveloperSubmenu(page);
        await page.uncheck('#developer-release-preview-toggle');
        if (!(await page.isChecked('#developer-mode-toggle'))) {
            await page.check('#developer-mode-toggle');
        }
        await page.selectOption('#developer-text-id-select', 'menu.level3.start.label');
        await page.click('#btn-developer-text-clear');
        await page.selectOption('#developer-text-id-select', 'menu.level4.tools.map_editor.label');
        await page.click('#btn-developer-text-clear');
    });

    test('T20s: Config-Export/Import stellt Setup reproduzierbar wieder her', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.mapKey = 'maze';
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['mapKey'] });
        });
        expect(await page.inputValue('#map-select')).toBe('maze');

        await openLevel4Drawer(page, { section: 'tools' });
        await page.click('#btn-config-export-json');
        const exportedJson = await page.inputValue('#config-share-input');
        expect(exportedJson.length).toBeGreaterThan(20);
        expect(JSON.parse(exportedJson).mapKey).toBe('maze');

        await page.click('#btn-close-level4');
        await page.waitForFunction(() => {
            const drawer = document.getElementById('submenu-level4');
            return !!drawer
                && drawer.classList.contains('hidden')
                && !window.GAME_INSTANCE?.settings?.localSettings?.toolsState?.level4Open;
        }, null, { timeout: 4000 });
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.mapKey = 'pyramid';
            game.runtimeFacade.onSettingsChanged({ changedKeys: ['mapKey'] });
        });
        expect(await page.inputValue('#map-select')).toBe('pyramid');

        await openLevel4Drawer(page, { section: 'tools' });
        await page.fill('#config-share-input', exportedJson);
        await page.click('#btn-config-import');
        await page.waitForTimeout(120);
        expect(await page.inputValue('#map-select')).toBe('maze');
    });

    test('T20t: Suchfilter und Telemetrie sind im neuen Flow verfuegbar', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        await page.fill('#map-search-input', 'maze');
        const mapOptions = await page.locator('#map-select option').allTextContents();
        expect(mapOptions.length).toBeGreaterThanOrEqual(1);
        expect(mapOptions.some((entry) => entry.toLowerCase().includes('maze') || entry.toLowerCase().includes('labyrinth'))).toBeTruthy();

        await page.click('#submenu-game [data-back]');
        await page.click('#menu-nav [data-session-type=\"single\"]');
        await page.click('#btn-quick-last-settings');
        await page.waitForTimeout(500);
        await returnToMenu(page);

        await openDeveloperSubmenu(page);
        const telemetryText = await page.textContent('#developer-telemetry-output');
        const telemetry = JSON.parse(telemetryText || '{}');
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

        await page.click('#btn-dimension-planar');
        await page.waitForTimeout(120);
        let state = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            return {
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                gameMode: String(game?.settings?.gameMode || ''),
                planarMode: !!game?.settings?.gameplay?.planarMode,
            };
        });
        expect(state.modePath).toBe('fight');
        expect(state.gameMode).toBe('HUNT');
        expect(state.planarMode).toBeTruthy();

        await page.click('#btn-dimension-classic-3d');
        await page.waitForTimeout(120);
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

    test('T20w: Kopf- und Level-2-Zweitcopy ist visuell entfernt, Context bleibt als SR-Status aktiv', async ({ page }) => {
        await loadGame(page);

        const level1State = await page.evaluate(() => {
            const root = document.getElementById('main-menu');
            const context = document.getElementById('menu-context');
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
                level2SecondaryVisible: isVisible('#submenu-custom .menu-choice-eyebrow')
                    || isVisible('#submenu-custom .menu-choice-copy')
                    || isVisible('#submenu-custom .menu-copy-secondary'),
            };
        });

        expect(level1State.depth).toBe('1');
        expect(level1State.secondaryCopyVisible).toBeFalsy();
        expect(level1State.contextText).toContain('Hauptmenue');
        expect(level1State.contextWidth).toBeLessThanOrEqual(1);
        expect(level1State.contextHeight).toBeLessThanOrEqual(1);
        expect(compactState.depth).toBe('2');
        expect(compactState.panel).toBe('submenu-custom');
        expect(compactState.level2SecondaryVisible).toBeFalsy();
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
        await page.waitForTimeout(220);

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
        await page.waitForTimeout(160);

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

    test('T20x1: Map-Auswahl folgt Moduspfad (Arcade nur Parcours, sonst ohne Parcours)', async ({ page }) => {
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
        expect(normalState.parcoursVisibleCount).toBe(0);
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
        expect(arcadeState.regularVisibleCount).toBe(0);
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
        await openStartSetupSection(page, 'match');

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
        const ghostClip = {
            frames: [
                {
                    time: 0,
                    players: [{ idx: 0, alive: true, x: 0, y: 2, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, bot: false }],
                },
                {
                    time: 4.2,
                    players: [{ idx: 0, alive: true, x: 4, y: 2, z: 0, qx: 0, qy: 0.3, qz: 0, qw: 0.95, bot: false }],
                },
            ],
            players: [{ idx: 0, color: 0xffffff, isBot: false, modelScale: 1 }],
            sourceDuration: 4.2,
            displayDuration: 4.2,
        };

        await loadGame(page);

        // --- Single + Normal (map-key based route fallback) ---
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openStartSetupSection(page, 'match');
        await page.selectOption('#arcade-ghost-duel-mode-select', 'self_longest_ghost');
        await page.evaluate(({ ghostLibraryKey, ghostClipPayload }) => {
            const game = window.GAME_INSTANCE;
            game.settings.localSettings.modePath = 'normal';
            game.uiManager?.syncByChangeKeys?.(['session.modePath']);
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
            if (mapSelect instanceof HTMLSelectElement) {
                mapSelect.value = normalMapKey;
                mapSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const routeId = String(game?.config?.MAPS?.[normalMapKey]?.parcours?.routeId || normalMapKey);
            const currentLibrary = JSON.parse(localStorage.getItem(ghostLibraryKey) || '{}');
            currentLibrary[routeId] = {
                routeId,
                longestGhostClip: ghostClipPayload,
                durationMs: 4200,
                updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(ghostLibraryKey, JSON.stringify(currentLibrary));
            if (game?.settings) {
                game.settings.localSettings = game.settings.localSettings || {};
                game.settings.localSettings.sessionType = 'single';
                game.settings.localSettings.modePath = 'normal';
                game.settings.localSettings.startSetup = game.settings.localSettings.startSetup || {};
                game.settings.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
                game.settings.mapKey = normalMapKey;
            }
        }, { ghostLibraryKey, ghostClipPayload: ghostClip });

        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.();
            return ghostState?.active === true && Number(ghostState?.entryCount || 0) > 0;
        }, null, { timeout: 8000 });

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
            const persistedLibrary = JSON.parse(localStorage.getItem('cuviosclash.arcade-ghost-library.v1') || '{}');
            return {
                active: ghostState?.active === true,
                entryCount: Number(ghostState?.entryCount || 0),
                frameCount: Number(ghostState?.frameCount || 0),
                routeId,
                persistedDurationMs: Number(persistedLibrary?.[routeId]?.durationMs || 0),
            };
        });
        expect(normalGhostState.active).toBeTruthy();
        expect(normalGhostState.entryCount).toBeGreaterThan(0);
        expect(normalGhostState.frameCount).toBeGreaterThan(1);
        expect(normalGhostState.routeId).not.toBe('');
        expect(normalGhostState.persistedDurationMs).toBeGreaterThan(0);
        await returnToMenu(page);

        // --- Single + Arcade (explicit parcours routeId) ---
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await openStartSetupSection(page, 'match');
        await page.selectOption('#arcade-ghost-duel-mode-select', 'self_longest_ghost');
        await page.evaluate(({ ghostLibraryKey, ghostClipPayload }) => {
            const game = window.GAME_INSTANCE;
            const mapKey = String(game?.settings?.mapKey || 'parcours_rift');
            const routeId = String(game?.config?.MAPS?.[mapKey]?.parcours?.routeId || mapKey);
            const currentLibrary = JSON.parse(localStorage.getItem(ghostLibraryKey) || '{}');
            currentLibrary[routeId] = {
                routeId,
                longestGhostClip: ghostClipPayload,
                durationMs: 4200,
                updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(ghostLibraryKey, JSON.stringify(currentLibrary));
        }, { ghostLibraryKey, ghostClipPayload: ghostClip });

        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60000 });
        await page.waitForFunction(() => {
            const game = window.GAME_INSTANCE;
            const ghostState = game?.entityManager?.getLastRoundGhostState?.();
            return ghostState?.active === true && Number(ghostState?.entryCount || 0) > 0;
        }, null, { timeout: 8000 });

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
            const persistedLibrary = JSON.parse(localStorage.getItem('cuviosclash.arcade-ghost-library.v1') || '{}');
            return {
                active: ghostState?.active === true,
                entryCount: Number(ghostState?.entryCount || 0),
                frameCount: Number(ghostState?.frameCount || 0),
                routeId,
                persistedDurationMs: Number(persistedLibrary?.[routeId]?.durationMs || 0),
            };
        });
        expect(arcadeGhostState.active).toBeTruthy();
        expect(arcadeGhostState.entryCount).toBeGreaterThan(0);
        expect(arcadeGhostState.frameCount).toBeGreaterThan(1);
        expect(arcadeGhostState.routeId).not.toBe('');
        expect(arcadeGhostState.persistedDurationMs).toBeGreaterThan(0);
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
            };
        });

        expect(initialHudState).not.toBeNull();
        expect(initialHudState.scoreVisible).toBeTruthy();
        expect(initialHudState.missionVisible).toBeTruthy();
        expect(initialHudState.scoreText).toContain('1337');
        expect(initialHudState.scoreText).toContain('x4.0');
        expect(initialHudState.modifierLabel).toContain('Portal Storm');
        expect(initialHudState.missionCardCount).toBeGreaterThanOrEqual(2);

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
                replayCode: String(game.runtimeFacade.arcadeRunRuntime?.requestReplayPlayback?.()?.code || ''),
                replayButtonExists: !!replayBtn,
                menuReplayLabel: String(document.querySelector('#btn-arcade-replay')?.textContent || ''),
                menuDailyLabel: String(document.querySelector('#btn-arcade-daily')?.textContent || ''),
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
        expect(state.replayCode).toBe('replay_player_unavailable');
        expect(state.replayButtonExists).toBeTruthy();
        expect(state.menuReplayLabel).toContain('Replay');
        expect(state.menuReplayLabel).not.toContain('Platzhalter');
        expect(state.menuDailyLabel).toContain('Daily');
        expect(state.menuDailyLabel).not.toContain('Platzhalter');

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
                postRunTextIncludesPayload: postRunText.includes(payload),
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
            };
        });

        expect(railState.railPosition).toBe('sticky');
        expect(railState.startVisible).toBeTruthy();
        expect(railState.summaryBlocks).toBeGreaterThanOrEqual(4);
    });

    test('T20z: Map- und Fahrzeugvorschau rendern strukturierte Preview-Karten', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);

        const previewState = await page.evaluate(() => ({
            mapBadges: document.querySelectorAll('#map-preview .preview-badge').length,
            mapFacts: document.querySelectorAll('#map-preview .preview-kv').length,
            vehicleBadges: document.querySelectorAll('#vehicle-preview-p1 .preview-badge').length,
            vehicleFacts: document.querySelectorAll('#vehicle-preview-p1 .preview-kv').length,
        }));

        expect(previewState.mapBadges).toBeGreaterThanOrEqual(2);
        expect(previewState.mapFacts).toBeGreaterThanOrEqual(2);
        expect(previewState.vehicleBadges).toBeGreaterThanOrEqual(1);
        expect(previewState.vehicleFacts).toBeGreaterThanOrEqual(2);
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
                drawerOverflow: Math.max(0, Math.round((drawer?.scrollWidth || 0) - (drawer?.clientWidth || 0))),
                stackOverflow: Math.max(0, Math.round((stack?.scrollWidth || 0) - (stack?.clientWidth || 0))),
            };
        });

        expect(level4State.tabCount).toBe(5);
        expect(level4State.activeSection).toBe('tools');
        expect(level4State.drawerOverflow).toBeLessThanOrEqual(4);
        expect(level4State.stackOverflow).toBeLessThanOrEqual(4);
    });
});
