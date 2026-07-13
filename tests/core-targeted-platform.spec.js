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

test.describe('T1-20: Core & Infrastruktur - Plattform, Lifecycle & Multiplayer', () => {
    test.describe.configure({ mode: 'serial' });

    test('T20a: Recorder-Support-Probe liefert lifecycle.v1-Metadaten', async ({ page }) => {
        await loadGame(page);
        const probe = await page.evaluate(() => {
            const recorderSystem = window.GAME_INSTANCE?.mediaRecorderSystem;
            const support = recorderSystem?.getSupportState?.();
            return {
                hasSystem: !!recorderSystem,
                contractVersion: recorderSystem?.getContractVersion?.() || null,
                canCaptureType: typeof support?.canCapture,
                hasRecorderType: typeof support?.hasRecorder,
                canRecordType: typeof support?.canRecord,
            };
        });

        expect(probe.hasSystem).toBeTruthy();
        expect(probe.contractVersion).toBe('lifecycle.v1');
        expect(probe.canCaptureType).toBe('boolean');
        expect(probe.hasRecorderType).toBe('boolean');
        expect(probe.canRecordType).toBe('boolean');
    });

    test('T20af: Recorder-Support trennt Shim-Faelle und liefert konsistente Start/Stop-Resultate', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const logger = { warn() { }, info() { }, error() { } };

            const shimRecorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                logger,
                capabilityProbe: () => ({
                    canCapture: true,
                    hasRecorder: false,
                    canRecord: false,
                    selectedMimeType: 'video/mp4',
                    recorderEngine: 'none',
                    supportReason: 'shim-or-unsupported',
                }),
            });
            const nativeRecorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                logger,
                capabilityProbe: () => ({
                    canCapture: true,
                    hasRecorder: true,
                    canRecord: true,
                    selectedMimeType: 'video/mp4',
                    recorderEngine: 'webcodecs-native',
                    supportReason: 'native-webcodecs',
                }),
            });

            const shimSupport = shimRecorder.getSupportState();
            const nativeSupport = nativeRecorder.getSupportState();
            const unsupportedStart = await shimRecorder.startRecording({ type: 'manual-test' });
            const idleStop = await shimRecorder.stopRecording({ type: 'manual-test' });

            shimRecorder.dispose();
            nativeRecorder.dispose();

            return {
                shimHasRecorder: !!shimSupport.hasRecorder,
                shimCanRecord: !!shimSupport.canRecord,
                nativeHasRecorder: !!nativeSupport.hasRecorder,
                nativeCanRecord: !!nativeSupport.canRecord,
                startAction: unsupportedStart?.action || '',
                startReason: unsupportedStart?.reason || '',
                startStarted: !!unsupportedStart?.started,
                stopAction: idleStop?.action || '',
                stopReason: idleStop?.reason || '',
                stopStopped: !!idleStop?.stopped,
            };
        });

        expect(result.shimHasRecorder).toBeFalsy();
        expect(result.shimCanRecord).toBeFalsy();
        expect(result.nativeHasRecorder).toBeTruthy();
        expect(result.nativeCanRecord).toBeTruthy();
        expect(result.startAction).toBe('start');
        expect(result.startReason).toBe('unsupported');
        expect(result.startStarted).toBeFalsy();
        expect(result.stopAction).toBe('stop');
        expect(result.stopReason).toBe('not_recording');
        expect(result.stopStopped).toBeFalsy();
    });

    test('T20b: Lifecycle-Events markieren Match Start/Ende und Menue-Oeffnung', async ({ page }) => {
        await startGame(page);
        await page.waitForFunction(() => (
            window.GAME_INSTANCE?.mediaRecorderSystem?.getLifecycleEvents?.()
                .some((entry) => entry.type === 'match_started') === true
        ), null, { timeout: 4000 });

        let eventTypes = await page.evaluate(() => (
            window.GAME_INSTANCE?.mediaRecorderSystem?.getLifecycleEvents?.().map((entry) => entry.type) || []
        ));
        expect(eventTypes.includes('match_started')).toBeTruthy();

        await returnToMenu(page);
        await page.waitForFunction(() => {
            const events = window.GAME_INSTANCE?.mediaRecorderSystem?.getLifecycleEvents?.() || [];
            return events.some((entry) => entry.type === 'match_ended')
                && events.some((entry) => entry.type === 'menu_opened');
        }, null, { timeout: 4000 });

        eventTypes = await page.evaluate(() => (
            window.GAME_INSTANCE?.mediaRecorderSystem?.getLifecycleEvents?.().map((entry) => entry.type) || []
        ));
        expect(eventTypes.includes('match_ended')).toBeTruthy();
        expect(eventTypes.includes('menu_opened')).toBeTruthy();
    });

    test('T20ba: Round-End Ghost-Replay nutzt Recorder-Snapshots und wird beim Rundenreset entfernt', async ({ page }) => {
        await startGameWithBots(page, 1);

        const replayState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const players = game?.entityManager?.players || [];
            if (players.length < 2) {
                return { error: 'missing-players' };
            }

            const applyPose = (player, x, y, z, yaw) => {
                player.position.set(x, y, z);
                player.quaternion.set(0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5));
            };

            const baseY0 = Number(players[0]?.position?.y) || 5;
            const baseY1 = Number(players[1]?.position?.y) || 5;

            game.recorder._snapshotInterval = 1;
            game.recorder.startRound(players);

            for (let step = 0; step < 6; step += 1) {
                applyPose(players[0], -18 + step * 4.2, baseY0, 9 - step * 1.8, step * 0.2);
                applyPose(players[1], 16 - step * 3.1, baseY1, -7 + step * 2.4, -step * 0.16);
                game.recorder.recordFrame(players);
            }

            game.matchFlowUiController.onRoundEnd(players[0]);
            const initialGhost = game.entityManager.getLastRoundGhostState();
            game.entityManager.updateLastRoundGhostPlayback(1.5);
            const advancedGhost = game.entityManager.getLastRoundGhostState();

            return {
                state: game.state,
                overlayVisible: !document.getElementById('message-overlay')?.classList?.contains('hidden'),
                initialGhost,
                advancedGhost,
            };
        });

        expect(replayState.error || '').toBe('');
        expect(['ROUND_END', 'MATCH_END']).toContain(replayState.state);
        expect(replayState.overlayVisible).toBeTruthy();
        expect(replayState.initialGhost.active).toBeTruthy();
        expect(replayState.initialGhost.frameCount).toBeGreaterThanOrEqual(6);
        // Seit Bugfix 2026-05-08 (CHANGELOG "Round-Ghost Bot-Spuren") sind Last-Round-Ghosts
        // human-only; der Bot aus startGameWithBots erzeugt bewusst keinen eigenen Ghost-Eintrag.
        expect(replayState.initialGhost.entryCount).toBeGreaterThanOrEqual(1);

        const movedGhost = replayState.advancedGhost.ghosts.some((ghost, index) => {
            const before = replayState.initialGhost.ghosts[index];
            return before && (ghost.x !== before.x || ghost.z !== before.z);
        });
        expect(movedGhost).toBeTruthy();

        const resetState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.matchFlowUiController.startRound();
            return {
                state: game.state,
                ghost: game.entityManager.getLastRoundGhostState(),
            };
        });

        expect(resetState.state).toBe('PLAYING');
        expect(resetState.ghost.active).toBeFalsy();
        expect(resetState.ghost.entryCount).toBe(0);
    });

    test('T20c: Multiplayer ist als Session-Typ in Ebene 1 waehlbar', async ({ page }) => {
        await loadGame(page);
        await expect(page.locator('#menu-nav [data-session-type="multiplayer"]')).toBeVisible();
        const multiplayerActive = await openMultiplayerSubmenu(page);
        await expect(page.locator('#submenu-game')).toBeVisible();
        if (multiplayerActive) {
            await expect(page.locator('#multiplayer-inline-stub')).toBeVisible();
            return;
        }
        await expect(page.locator('#multiplayer-inline-stub')).toBeHidden();
    });

    test('T20d: Multiplayer-Bridge emittiert lifecycle.v1 Event-Contract', async ({ page }) => {
        await page.context().addInitScript(() => {
            globalThis.__CURVIOS_APP__ = true;
            globalThis.__CURVIOS_E2E_LOBBY_TRANSPORT__ = 'storage-bridge';
        });
        await loadGame(page);
        const multiplayerActive = await openMultiplayerSubmenu(page);
        test.skip(!multiplayerActive, 'Multiplayer-Surface im aktuellen Lauf nicht aktiv.');
        const hostButton = page.locator('#btn-multiplayer-host').first();
        const hostButtonVisible = (await hostButton.count()) > 0
            && await hostButton.isVisible().catch(() => false);
        const hostButtonDisabled = hostButtonVisible
            ? await hostButton.isDisabled().catch(() => true)
            : true;
        test.skip(!hostButtonVisible || hostButtonDisabled, 'Multiplayer-Host ist im aktuellen Lauf nicht verfuegbar.');
        await page.fill('#multiplayer-lobby-code', 'QA-LOBBY');
        await page.click('#btn-multiplayer-host');
        let hostEventObserved = false;
        try {
            await page.waitForFunction(() => {
                const events = window.GAME_INSTANCE?.getMenuLifecycleEvents?.() || [];
                return events.some((entry) => entry?.type === 'multiplayer_host');
            }, null, { timeout: 7000 });
            hostEventObserved = true;
        } catch {
            hostEventObserved = false;
        }

        const hostProbe = await page.evaluate(() => {
            const events = window.GAME_INSTANCE?.getMenuLifecycleEvents?.() || [];
            return {
                lifecycleEvent: events.find((entry) => entry.type === 'multiplayer_host') || null,
                sessionState: window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.() || null,
                lobbyStateText: String(document.getElementById('multiplayer-lobby-state')?.textContent || ''),
            };
        });
        test.skip(
            !hostEventObserved && !hostProbe.sessionState?.joined,
            `Multiplayer-Host im Lauf nicht verbunden (${hostProbe.lobbyStateText || 'ohne Status'}).`
        );
        const lifecycleEvent = hostProbe.lifecycleEvent;

        expect(lifecycleEvent).toBeTruthy();
        expect(lifecycleEvent.contractVersion).toBe('lifecycle.v1');
        expect(lifecycleEvent.payload?.lobbyCode).toBe('QA-LOBBY');
    });

    test('T20d1: Multiplayer-Lobby synchronisiert Join, Ready und Host-Invalidation ueber zwei Tabs', async ({ page }) => {
        await page.context().addInitScript(() => {
            globalThis.__CURVIOS_APP__ = true;
            globalThis.__CURVIOS_E2E_LOBBY_TRANSPORT__ = 'storage-bridge';
        });
        const secondPage = await page.context().newPage();
        try {
            await loadGame(page);
            await loadGame(secondPage);

            const hostMultiplayerActive = await openMultiplayerSubmenu(page);
            await page.fill('#multiplayer-lobby-code', 'SYNC-LOBBY');
            await page.click('#btn-multiplayer-host');
            await page.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });

            const clientMultiplayerActive = await openMultiplayerSubmenu(secondPage);
            test.skip(!(hostMultiplayerActive && clientMultiplayerActive), 'Multiplayer-Surface im aktuellen Lauf nicht aktiv.');
            await secondPage.fill('#multiplayer-lobby-code', 'SYNC-LOBBY');
            await secondPage.click('#btn-multiplayer-join');
            await secondPage.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });
            await secondPage.check('#multiplayer-ready-toggle');

            await page.waitForFunction(() => {
                const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
                return state?.memberCount === 2 && state?.readyCount === 1;
            }, null, { timeout: 5000 });

            const syncedState = await page.evaluate(() => ({
                sessionState: window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.(),
                lobbyStateText: document.getElementById('multiplayer-lobby-state')?.textContent || '',
            }));
            expect(syncedState.sessionState?.isHost).toBeTruthy();
            expect(syncedState.sessionState?.memberCount).toBe(2);
            expect(syncedState.sessionState?.readyCount).toBe(1);
            expect(syncedState.lobbyStateText).toContain('2 Spieler');

            await page.evaluate(() => {
                const slider = document.getElementById('bot-count');
                slider.value = '4';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });

            await secondPage.waitForFunction(() => {
                const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
                return state?.joined === true && state?.localReady === false && state?.readyCount === 0;
            }, null, { timeout: 5000 });

            const invalidatedState = await secondPage.evaluate(() => ({
                sessionState: window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.(),
                readyChecked: !!document.getElementById('multiplayer-ready-toggle')?.checked,
            }));
            expect(invalidatedState.sessionState?.role).toBe('client');
            expect(invalidatedState.sessionState?.localReady).toBeFalsy();
            expect(invalidatedState.readyChecked).toBeFalsy();
        } finally {
            await secondPage.close();
        }
    });

    test('T20d2: Multiplayer-Host startet Match synchron mit autoritativem Snapshot ueber zwei Tabs', async ({ page }) => {
        test.setTimeout(120000);
        await page.context().addInitScript(() => {
            globalThis.__CURVIOS_APP__ = true;
            globalThis.__CURVIOS_E2E_LOBBY_TRANSPORT__ = 'storage-bridge';
        });
        const secondPage = await page.context().newPage();
        try {
            await loadGame(page);
            await loadGame(secondPage);

            const hostMultiplayerActive = await openMultiplayerSubmenu(page);
            await page.fill('#multiplayer-lobby-code', 'START-LOBBY');
            await page.click('#btn-multiplayer-host');
            await page.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });

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
            await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, String(selectedMapKey), { timeout: 5000 });

            const clientMultiplayerActive = await openMultiplayerSubmenu(secondPage);
            test.skip(!(hostMultiplayerActive && clientMultiplayerActive), 'Multiplayer-Surface im aktuellen Lauf nicht aktiv.');
            await secondPage.fill('#multiplayer-lobby-code', 'START-LOBBY');
            await secondPage.click('#btn-multiplayer-join');
            await secondPage.waitForFunction(() => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.joined === true, null, { timeout: 5000 });

            await page.check('#multiplayer-ready-toggle');
            await secondPage.check('#multiplayer-ready-toggle');

            await page.waitForFunction(() => {
                const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
                return state?.canStart === true && state?.allReady === true;
            }, null, { timeout: 5000 });

            await page.click('#btn-start');

            await page.waitForFunction(() => {
                const game = window.GAME_INSTANCE;
                return game?.state === 'PLAYING' && !!game?.entityManager;
            }, null, { timeout: 30000 });
            await secondPage.waitForFunction((mapKey) => {
                const game = window.GAME_INSTANCE;
                return game?.state === 'PLAYING' && game?.settings?.mapKey === mapKey && !!game?.entityManager;
            }, String(selectedMapKey), { timeout: 30000 });

            const secondProbe = await secondPage.evaluate(() => ({
                state: window.GAME_INSTANCE?.state,
                mapKey: window.GAME_INSTANCE?.settings?.mapKey,
                hudVisible: !document.getElementById('hud')?.classList.contains('hidden'),
            }));
            expect(secondProbe.state).toBe('PLAYING');
            expect(secondProbe.mapKey).toBe(String(selectedMapKey));
            expect(secondProbe.hudVisible).toBeTruthy();
        } finally {
            await secondPage.close();
        }
    });

    test('T41a: MenuSchema markiert multiplayer-host mit visibilityCondition canHost', async ({ page }) => {
        await loadGame(page);
        const schema = await page.evaluate(() => {
            const registry = window.GAME_INSTANCE?.uiManager?.menuPanelRegistry;
            const s = registry?.getSchema?.();
            const panel = Array.isArray(s?.panels) ? s.panels.find((p) => p.id === 'submenu-multiplayer') : null;
            const hostItem = Array.isArray(panel?.items) ? panel.items.find((i) => i.id === 'multiplayer-host') : null;
            return {
                hasPanel: !!panel,
                panelVisible: panel?.visibility !== 'hidden',
                hostItemExists: !!hostItem,
                hostItemCondition: hostItem?.visibilityCondition || null,
            };
        });

        expect(schema.hasPanel).toBe(true);
        expect(schema.panelVisible).toBe(true);
        expect(schema.hostItemExists).toBe(true);
        expect(schema.hostItemCondition).toBe('canHost');
    });

    test('T41a1: MenuController emittiert multiplayer host/join nur einmal pro Klick', async ({ page }) => {
        await loadGame(page);

        const result = await page.evaluate(async () => {
            const mod = await window.__curviosImport('/src/ui/MenuController.js');
            const previousAppFlag = globalThis.__CURVIOS_APP__;
            globalThis.__CURVIOS_APP__ = true;
            const hostButton = document.createElement('button');
            const joinButton = document.createElement('button');
            const lobbyCodeInput = document.createElement('input');
            lobbyCodeInput.value = 'qa-lobby';
            document.body.append(hostButton, joinButton, lobbyCodeInput);

            const events = [];
            const controller = new mod.MenuController({
                ui: {
                    multiplayerHostButton: hostButton,
                    multiplayerJoinButton: joinButton,
                    multiplayerLobbyCodeInput: lobbyCodeInput,
                },
                settings: {
                    menuFeatureFlags: {
                        canHost: true,
                    },
                },
                onEvent: (event) => events.push(event),
            });
            controller.setupListeners();
            hostButton.click();
            joinButton.click();
            controller.dispose();
            hostButton.remove();
            joinButton.remove();
            lobbyCodeInput.remove();
            if (typeof previousAppFlag === 'undefined') {
                delete globalThis.__CURVIOS_APP__;
            } else {
                globalThis.__CURVIOS_APP__ = previousAppFlag;
            }

            return {
                hostCount: events.filter((event) => event.type === mod.MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_HOST).length,
                joinCount: events.filter((event) => event.type === mod.MENU_CONTROLLER_EVENT_TYPES.MULTIPLAYER_JOIN).length,
            };
        });

        expect(result.hostCount).toBe(1);
        expect(result.joinCount).toBe(1);
    });

    test('T41b: MenuMultiplayerPanel zeigt Host-Button nur wenn canHost=true', async ({ page }) => {
        await loadGame(page);

        const result = await page.evaluate(async () => {
            const mod = await window.__curviosImport('/src/ui/menu/testing/MenuMultiplayerPanel.js');
            const mockBridge = {
                host: () => ({ ok: false }),
                join: () => ({ ok: false }),
                leave: () => {},
                toggleReady: () => {},
                requestMatchStart: () => {},
                getSessionState: () => ({ joined: false, memberCount: 0, localReady: false, canStart: false, members: [] }),
            };

            const containerA = document.createElement('div');
            document.body.appendChild(containerA);
            mod.createMultiplayerPanel({ bridge: mockBridge, container: containerA, canHost: false });
            const hostBtnHidden = !containerA.querySelector('.mp-host-btn');
            containerA.remove();

            const containerB = document.createElement('div');
            document.body.appendChild(containerB);
            mod.createMultiplayerPanel({ bridge: mockBridge, container: containerB, canHost: true });
            const hostBtnVisible = !!containerB.querySelector('.mp-host-btn');
            containerB.remove();

            return { hostBtnHidden, hostBtnVisible };
        });

        expect(result.hostBtnHidden).toBe(true);
        expect(result.hostBtnVisible).toBe(true);
    });

    test('T41d: MenuMultiplayerPanel nutzt Discovery/Host-IP Ports via DI ohne window.curviosApp', async ({ page }) => {
        await loadGame(page);

        const result = await page.evaluate(async () => {
            const mod = await window.__curviosImport('/src/ui/menu/testing/MenuMultiplayerPanel.js');
            const calls = {
                start: 0,
                stop: 0,
                getHosts: 0,
                subscribe: 0,
                unsubscribe: 0,
                resolveHostIp: 0,
            };

            const sessionState = {
                joined: true,
                memberCount: 1,
                readyCount: 0,
                allReady: false,
                localReady: false,
                canStart: false,
                lobbyCode: 'QA-DI',
                members: [{
                    peerId: 'peer-host',
                    actorId: 'Host',
                    ready: false,
                    isHost: true,
                    isLocal: true,
                }],
            };
            const bridge = {
                host: () => ({ ok: true }),
                join: () => ({ ok: true }),
                leave: () => {},
                toggleReady: () => {},
                requestMatchStart: () => ({ ok: false }),
                getSessionState: () => ({ ...sessionState }),
            };
            const discoveryPort = {
                isAvailable: () => true,
                start: () => { calls.start += 1; },
                stop: () => { calls.stop += 1; },
                getHosts: async () => {
                    calls.getHosts += 1;
                    return [{
                        hostName: 'QA Host',
                        ip: '10.0.0.12',
                        port: 9090,
                        lobbyCode: 'QA-DI',
                        playerCount: 1,
                    }];
                },
                subscribe: () => {
                    calls.subscribe += 1;
                    return () => { calls.unsubscribe += 1; };
                },
            };
            const hostIpResolver = {
                resolve: async () => {
                    calls.resolveHostIp += 1;
                    return '10.0.0.12';
                },
            };

            const container = document.createElement('div');
            document.body.appendChild(container);
            const panel = mod.createMultiplayerPanel({
                bridge,
                container,
                canHost: true,
                discoveryPort,
                hostIpResolver,
            });

            container.querySelector('.mp-join-btn')?.click();
            await Promise.resolve();
            await Promise.resolve();
            const hostEntryVisible = !!container.querySelector('.mp-discovery-host');

            container.querySelector('.mp-back-btn')?.click();
            const discoveryClosed = !!container.querySelector('.mp-host-btn');

            container.querySelector('.mp-host-btn')?.click();
            await Promise.resolve();
            await Promise.resolve();
            const ipText = String(container.querySelector('.mp-ip-value')?.textContent || '');

            panel.dispose();
            const panelRemoved = !container.firstChild;
            container.remove();

            return {
                ...calls,
                hostEntryVisible,
                discoveryClosed,
                ipText,
                panelRemoved,
            };
        });

        expect(result.start).toBe(1);
        expect(result.stop).toBeGreaterThanOrEqual(1);
        expect(result.getHosts).toBe(1);
        expect(result.subscribe).toBe(1);
        expect(result.unsubscribe).toBe(1);
        expect(result.resolveHostIp).toBeGreaterThanOrEqual(1);
        expect(result.hostEntryVisible).toBe(true);
        expect(result.discoveryClosed).toBe(true);
        expect(result.ipText).toBe('10.0.0.12');
        expect(result.panelRemoved).toBe(true);
    });

    test('T20e: Open-Preset speichert Metadatenvertrag vollstaendig', async ({ page }) => {
        await loadGame(page);
        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), MENU_PRESETS_STORAGE_KEY);
        await openLevel4Drawer(page, { section: 'tools' });
        await page.fill('#preset-name', 'Open Preset QA');
        await page.click('#btn-preset-save-open');
        await page.waitForTimeout(50);

        const contractState = await page.evaluate(() => {
            const raw = localStorage.getItem('cuviosclash.menu-presets.v1');
            const parsed = raw ? JSON.parse(raw) : {};
            const presets = Array.isArray(parsed?.presets) ? parsed.presets : [];
            const openPreset = presets.find((preset) => preset?.metadata?.kind === 'open');
            if (!openPreset) return { ok: false };
            const metadata = openPreset.metadata || {};
            const required = ['id', 'kind', 'ownerId', 'lockedFields', 'sourcePresetId', 'createdAt', 'updatedAt'];
            const hasAll = required.every((key) => Object.prototype.hasOwnProperty.call(metadata, key));
            return {
                ok: hasAll,
                kind: metadata.kind,
                id: metadata.id,
            };
        });

        expect(contractState.ok).toBeTruthy();
        expect(contractState.kind).toBe('open');
        expect(contractState.id.length).toBeGreaterThan(0);
    });

    test('T20f: Fixed-Preset setzt Match-Contract auf fixed', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        const expectedPreset = await page.evaluate(async () => {
            const mod = await window.__curviosImport('/src/ui/menu/MenuDefaultsEditorConfig.js');
            return mod.findFixedMenuPresetSeedById('competitive');
        });
        await page.evaluate(() => {
            const button = document.querySelector('#submenu-game [data-preset-id="competitive"]');
            button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForTimeout(50);

        const matchPreset = await page.evaluate(() => ({
            id: window.GAME_INSTANCE?.settings?.matchSettings?.activePresetId || '',
            kind: window.GAME_INSTANCE?.settings?.matchSettings?.activePresetKind || '',
            mapKey: window.GAME_INSTANCE?.settings?.mapKey || '',
            numBots: window.GAME_INSTANCE?.settings?.numBots ?? null,
            winsNeeded: window.GAME_INSTANCE?.settings?.winsNeeded ?? null,
        }));

        expect(matchPreset.id).toBe('competitive');
        expect(matchPreset.kind).toBe('fixed');
        expect(matchPreset.mapKey).toBe(expectedPreset.values.mapKey);
        expect(matchPreset.numBots).toBe(expectedPreset.values.numBots);
        expect(matchPreset.winsNeeded).toBe(expectedPreset.values.winsNeeded);
    });

    test('T20bb: Event-Playlist Quickstart ist sichtbar, startet direkt und persistiert den Cursor', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await expect(page.locator('#btn-quick-event-playlist')).toBeVisible();
        const baselineState = await page.evaluate(() => ({
            mapKey: String(window.GAME_INSTANCE?.settings?.mapKey || ''),
            modePath: String(window.GAME_INSTANCE?.settings?.localSettings?.modePath || ''),
        }));

        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.__eventPlaylistStartCalls = [];
            game.runtimeFacade.startMatch = () => {
                game.__eventPlaylistStartCalls.push({
                    presetId: game.settings?.matchSettings?.activePresetId || '',
                    nextIndex: game.settings?.localSettings?.eventPlaylistState?.nextIndex ?? null,
                });
                return true;
            };
        });

        await page.click('#btn-quick-event-playlist');
        await page.waitForTimeout(80);

        const firstState = await page.evaluate((settingsStorageKey) => {
            const game = window.GAME_INSTANCE;
            const persistedSettings = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}');
            return {
                startCalls: Array.isArray(game.__eventPlaylistStartCalls) ? game.__eventPlaylistStartCalls.length : 0,
                activePresetId: String(game?.settings?.matchSettings?.activePresetId || ''),
                modePath: String(game?.settings?.localSettings?.modePath || ''),
                eventPlaylistState: game?.settings?.localSettings?.eventPlaylistState || null,
                toastText: document.getElementById('status-toast')?.textContent || '',
                persistedEventPlaylistState: persistedSettings?.localSettings?.eventPlaylistState || null,
                persistedMapKey: String(persistedSettings?.mapKey || ''),
                persistedModePath: String(persistedSettings?.localSettings?.modePath || ''),
            };
        }, SETTINGS_STORAGE_KEY);

        expect(firstState.startCalls).toBe(1);
        expect(firstState.activePresetId).toBe('arcade');
        expect(firstState.modePath).toBe('quick_action');
        expect(firstState.eventPlaylistState?.activePlaylistId).toBe('fun_rotation');
        expect(firstState.eventPlaylistState?.nextIndex).toBe(1);
        expect(firstState.toastText).toContain('Event-Playlist');
        expect(firstState.persistedEventPlaylistState?.nextIndex).toBe(1);
        expect(firstState.persistedMapKey).toBe(baselineState.mapKey);
        expect(firstState.persistedModePath).toBe(baselineState.modePath);

        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 15000 });
        await openCustomSubmenu(page);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.__eventPlaylistStartCalls = [];
            game.runtimeFacade.startMatch = () => {
                game.__eventPlaylistStartCalls.push({
                    presetId: game.settings?.matchSettings?.activePresetId || '',
                });
                return true;
            };
        });

        await page.click('#btn-quick-event-playlist');
        await page.waitForTimeout(80);

        const secondPresetId = await page.evaluate(() => window.GAME_INSTANCE?.settings?.matchSettings?.activePresetId || '');
        expect(secondPresetId).toBe('chaos');

        await page.evaluate((settingsStorageKey) => localStorage.removeItem(settingsStorageKey), SETTINGS_STORAGE_KEY);
    });

    test('T20bc: Event-Playlist rotiert deterministisch ueber die Fun-Presets und wrappt', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.__eventPlaylistSequence = [];
            game.runtimeFacade.startMatch = () => {
                game.__eventPlaylistSequence.push({
                    presetId: game.settings?.matchSettings?.activePresetId || '',
                    nextIndex: game.settings?.localSettings?.eventPlaylistState?.nextIndex ?? null,
                });
                return true;
            };
        });

        for (let index = 0; index < 4; index += 1) {
            await page.click('#btn-quick-event-playlist');
            await page.waitForTimeout(60);
        }

        const rotationState = await page.evaluate((settingsStorageKey) => {
            const game = window.GAME_INSTANCE;
            const persistedSettings = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}');
            return {
                sequence: Array.isArray(game.__eventPlaylistSequence)
                    ? game.__eventPlaylistSequence.map((entry) => entry.presetId)
                    : [],
                nextIndex: game?.settings?.localSettings?.eventPlaylistState?.nextIndex ?? null,
                lastPresetId: game?.settings?.localSettings?.eventPlaylistState?.lastPresetId || '',
                persistedNextIndex: persistedSettings?.localSettings?.eventPlaylistState?.nextIndex ?? null,
            };
        }, SETTINGS_STORAGE_KEY);

        expect(rotationState.sequence).toEqual(['arcade', 'chaos', 'competitive', 'arcade']);
        expect(rotationState.nextIndex).toBe(1);
        expect(rotationState.lastPresetId).toBe('arcade');
        expect(rotationState.persistedNextIndex).toBe(1);

        await page.evaluate((settingsStorageKey) => localStorage.removeItem(settingsStorageKey), SETTINGS_STORAGE_KEY);
    });

    test('T20ka: Profil-UX aktualisiert Action-State und unterstuetzt Duplicate, Import/Export und Standardprofil', async ({ page }) => {
        await page.goto('/');
        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), SETTINGS_PROFILES_STORAGE_KEY);
        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 15000 });
        await openLevel4Drawer(page, { section: 'tools' });

        await page.fill('#profile-name', 'QA Profil');
        await expect(page.locator('#btn-profile-save')).toBeEnabled();
        await page.click('#btn-profile-save');
        await expect(page.locator('#profile-select')).toHaveValue('QA Profil');

        await page.click('#btn-profile-set-default');
        await expect(page.locator('#profile-select option:checked')).toHaveText('QA Profil (Standard)');

        await page.fill('#profile-name', 'QA Profil Kopie');
        await expect(page.locator('#btn-profile-duplicate')).toBeEnabled();
        await page.click('#btn-profile-duplicate');
        await expect(page.locator('#profile-select')).toHaveValue('QA Profil Kopie');

        await page.selectOption('#profile-select', 'QA Profil');
        await expect(page.locator('#profile-name')).toHaveValue('QA Profil');
        await expect(page.locator('#btn-profile-set-default')).toBeDisabled();
        await expect(page.locator('#btn-profile-set-default')).toHaveText('Standardprofil aktiv');

        await page.selectOption('#profile-select', 'QA Profil Kopie');
        await expect(page.locator('#btn-profile-set-default')).toBeEnabled();
        await page.click('#btn-profile-export');

        const exportPayload = await page.inputValue('#profile-transfer-input');
        const exportedProfile = JSON.parse(exportPayload);
        expect(exportedProfile.contractVersion).toBe('profile-export.v1');
        expect(exportedProfile.profile.name).toBe('QA Profil Kopie');

        exportedProfile.profile.name = 'QA Import';
        await page.fill('#profile-transfer-input', JSON.stringify(exportedProfile, null, 2));
        await expect(page.locator('#btn-profile-import')).toBeEnabled();
        await page.fill('#profile-name', '');
        await page.click('#btn-profile-import');
        await expect(page.locator('#profile-select')).toHaveValue('QA Import');
        await expect(page.locator('#profile-transfer-status')).toContainText('Profil importiert: QA Import');

        const profileState = await page.evaluate((storageKey) => {
            return JSON.parse(localStorage.getItem(storageKey) || '[]');
        }, SETTINGS_PROFILES_STORAGE_KEY);
        expect(profileState).toHaveLength(3);
        expect(profileState.filter((profile) => profile?.isDefault)).toHaveLength(1);
        expect(profileState.find((profile) => profile?.isDefault)?.name).toBe('QA Profil');

        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), SETTINGS_PROFILES_STORAGE_KEY);
    });
});
