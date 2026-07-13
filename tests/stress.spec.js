import { test, expect } from '@playwright/test';
import {
    collectErrors,
    loadGame,
    openDeveloperSubmenu,
    openGameSubmenu,
    openLevel4Drawer,
    openMultiplayerSubmenu,
    selectSessionType,
    returnToMenu,
    startGame,
} from './helpers.js';

const SETTINGS_STORAGE_KEY = 'cuviosclash.settings.v1';
const SETTINGS_PROFILES_STORAGE_KEY = 'cuviosclash.settings-profiles.v1';

test.describe('T61-125: Stress, I/O & Sicherheit', () => {
    test.describe.configure({ mode: 'serial' });

    test('T61: Keine JS-Fehler nach 5s Spielzeit', async ({ page }) => {
        test.setTimeout(30000);
        const errors = collectErrors(page);
        await startGame(page);
        await page.waitForTimeout(2000);
        expect(errors).toHaveLength(0);
    });

    test('T62: DOM-Knoten-Anzahl stabil nach 5s', async ({ page }) => {
        test.setTimeout(60000);
        await startGame(page);
        const before = await page.evaluate(() => document.querySelectorAll('*').length);
        await page.waitForTimeout(2000);
        const after = await page.evaluate(() => document.querySelectorAll('*').length);
        expect(after - before).toBeLessThan(100);
    });

    test('T63: ESC waehrend Spiel oeffnet Menue', async ({ page }) => {
        test.setTimeout(60000);
        await startGame(page);
        await page.waitForTimeout(400);
        await returnToMenu(page);
        await expect(page.locator('#main-menu')).toBeVisible();
    });

    test('T64: Korrupte localStorage-Daten -> kein Crash', async ({ page }) => {
        test.setTimeout(60000);
        await loadGame(page);
        await page.evaluate(() => {
            localStorage.setItem('cuviosclash.settings.v1', 'NICHT_JSON{{{');
        });
        const errors = collectErrors(page);
        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 15000 });
        expect(errors).toHaveLength(0);
        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), SETTINGS_STORAGE_KEY);
    });

    test('T65: XSS in Profilname wird nicht ausgefuehrt', async ({ page }) => {
        await loadGame(page);
        const dialogs = [];
        page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
        await openLevel4Drawer(page, { section: 'tools' });
        await page.fill('#profile-name', '<img src=x onerror=alert(1)>');
        const isDisabled = await page.isDisabled('#btn-profile-save');
        if (!isDisabled) {
            await page.click('#btn-profile-save');
        }
        await page.waitForTimeout(400);
        expect(dialogs).toHaveLength(0);
        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), SETTINGS_PROFILES_STORAGE_KEY);
    });

    test('T66: Ungueltige Settings-Werte -> kein Crash', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.setItem('cuviosclash.settings.v1', JSON.stringify({
                speed: -999,
                turnSpeed: 'abc',
                botCount: null,
            }));
        });
        const errors = collectErrors(page);
        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 10000 });
        expect(errors).toHaveLength(0);
        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), SETTINGS_STORAGE_KEY);
    });

    test('T67: 3x Spiel starten/stoppen ohne Fehler', async ({ page }) => {
        test.setTimeout(120000);
        const errors = collectErrors(page);
        await loadGame(page);
        for (let i = 0; i < 3; i += 1) {
            await openGameSubmenu(page);
            await page.click('#btn-start');
            await page.waitForFunction(() => {
                const hud = document.getElementById('hud');
                return hud && !hud.classList.contains('hidden');
            }, null, { timeout: 15000 });
            await page.waitForTimeout(1000);
            await returnToMenu(page);
        }
        expect(errors).toHaveLength(0);
    });

    test('T68: visibilitychange verursacht keinen Crash', async ({ page }) => {
        const errors = collectErrors(page);
        await startGame(page);
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForTimeout(1000);
        expect(errors).toHaveLength(0);
    });

    test('T69: p1-hud Element vorhanden nach Start', async ({ page }) => {
        await startGame(page);
        const exists = await page.evaluate(() => document.getElementById('p1-hud') !== null);
        expect(exists).toBeTruthy();
    });

    test('T70: Keine Memory-Warnungen in Console', async ({ page }) => {
        const warnings = [];
        page.on('console', msg => {
            if (msg.type() === 'warning' && msg.text().toLowerCase().includes('memory')) {
                warnings.push(msg.text());
            }
        });
        await startGame(page);
        await page.waitForTimeout(2000);
        expect(warnings).toHaveLength(0);
    });

    test('T71: Schnelles Starten und Beenden verursacht keine Fehler', async ({ page }) => {
        test.setTimeout(120000);
        const errors = collectErrors(page);
        await loadGame(page);
        for (let i = 0; i < 10; i += 1) {
            await openGameSubmenu(page);
            await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
            await page.waitForFunction(() => {
                const hud = document.getElementById('hud');
                return hud && !hud.classList.contains('hidden');
            }, null, { timeout: 15000 });
            await page.waitForTimeout(200);
            await returnToMenu(page);
            await page.waitForTimeout(200);
        }
        expect(errors).toHaveLength(0);
    });

    test('T71b: Showcase-Nexus startet mehrfach ohne Aircraft-Deko-Leaks', async ({ page }) => {
        test.setTimeout(120000);
        const errors = collectErrors(page);
        await loadGame(page);

        for (let i = 0; i < 3; i += 1) {
            await openGameSubmenu(page);
            await page.selectOption('#map-select', 'showcase_nexus');
            await page.evaluate(() => {
                const slider = document.getElementById('bot-count');
                slider.value = '2';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
            await page.waitForFunction(() => {
                const hud = document.getElementById('hud');
                return hud && !hud.classList.contains('hidden');
            }, null, { timeout: 20000 });

            const activeDecorationCount = await page.evaluate(() => (
                window.GAME_INSTANCE?.arena?._aircraftDecorations?.length ?? 0
            ));
            expect(activeDecorationCount).toBe(3);

            await returnToMenu(page);
            const leakedAircraftNodes = await page.evaluate(() => {
                const scene = window.GAME_INSTANCE?.renderer?.scene;
                let leaked = 0;
                scene?.traverse?.((node) => {
                    if (String(node?.name || '').startsWith('map-aircraft-')) {
                        leaked += 1;
                    }
                });
                return leaked;
            });
            expect(leakedAircraftNodes).toBe(0);
        }

        expect(errors).toHaveLength(0);
    });

    test('T72: Resize-Spam im Menue verursacht keinen Absturz', async ({ page }) => {
        test.setTimeout(30000);
        const errors = collectErrors(page);
        await loadGame(page);
        for (let i = 0; i < 20; i += 1) {
            await page.setViewportSize({
                width: Math.floor(800 + (Math.random() * 400)),
                height: Math.floor(600 + (Math.random() * 400)),
            });
            await page.waitForTimeout(50);
        }
        expect(errors).toHaveLength(0);
    });

    test('T73: Extreme Settings (100 Bots) stuerzen nicht direkt ab', async ({ page }) => {
        test.setTimeout(60000);
        await loadGame(page);
        await page.evaluate((storageKey) => {
            const s = JSON.parse(localStorage.getItem(storageKey) || '{}');
            s.botCount = 100;
            localStorage.setItem(storageKey, JSON.stringify(s));
        }, SETTINGS_STORAGE_KEY);
        const errors = collectErrors(page);
        await page.reload();
        await page.waitForSelector('#main-menu', { state: 'visible', timeout: 15000 });
        await openGameSubmenu(page);
        await page.click('#btn-start');
        await page.waitForTimeout(1500);
        expect(errors).toHaveLength(0);
        await page.evaluate((storageKey) => localStorage.removeItem(storageKey), SETTINGS_STORAGE_KEY);
    });

    test('T74: Preset-Apply Burst bleibt stabil', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        await openGameSubmenu(page);
        const presetIds = ['arcade', 'competitive', 'chaos'];

        for (let i = 0; i < 18; i += 1) {
            const presetId = presetIds[i % presetIds.length];
            await page.evaluate((targetPresetId) => {
                const button = document.querySelector(`#submenu-game [data-preset-id="${targetPresetId}"]`);
                button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }, presetId);
            await page.waitForTimeout(30);
        }

        const activePresetId = await page.evaluate(() => window.GAME_INSTANCE?.settings?.matchSettings?.activePresetId || '');
        expect(presetIds.includes(activePresetId)).toBeTruthy();
        expect(errors).toHaveLength(0);
    });

    test('T75: Host-Settings invalidieren Ready-Status per Event-Contract', async ({ page }) => {
        await page.context().addInitScript(() => {
            globalThis.__CURVIOS_APP__ = true;
        });
        await loadGame(page);
        await openMultiplayerSubmenu(page);
        await page.fill('#multiplayer-lobby-code', 'STRESS-T75');
        await page.click('#btn-multiplayer-host');
        await page.waitForFunction(() => {
            const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.();
            return state?.joined === true && state?.isHost === true;
        }, null, { timeout: 5000 });
        await page.check('#multiplayer-ready-toggle');
        await page.waitForTimeout(80);

        await openGameSubmenu(page);
        await page.evaluate(() => {
            const slider = document.getElementById('bot-count');
            slider.value = '4';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(150);

        const hasInvalidationEvent = await page.evaluate(() => {
            const events = window.GAME_INSTANCE?.getMenuLifecycleEvents?.() || [];
            return events.some((entry) =>
                entry.contractVersion === 'lifecycle.v1' && entry.type === 'multiplayer_ready_invalidated'
            );
        });
        expect(hasInvalidationEvent).toBeTruthy();
    });

    test('T76: Owner-Only Guard bleibt unter Actor-Wechsel stabil', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            game.settings.localSettings.developerModeVisibility = 'owner_only';
            game.settings.localSettings.actorId = 'player';
            game.uiManager.updateContext();
            const opened = !!game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-developer', { trigger: 'stress_test' });
            const before = game.settings.localSettings.developerModeEnabled;
            game.runtimeFacade.handleMenuControllerEvent({
                contractVersion: 'menu-controller.v1',
                type: 'developer_mode_toggle',
                enabled: !before,
            });
            const after = game.settings.localSettings.developerModeEnabled;
            game.settings.localSettings.actorId = game.settings.localSettings.ownerId || 'owner';
            game.uiManager.updateContext();
            return { opened, before, after };
        });

        expect(result.opened).toBeFalsy();
        expect(result.after).toBe(result.before);
    });

    test('T77: Quickstart-Burst mit Rueckspruengen bleibt fehlerfrei', async ({ page }) => {
        test.setTimeout(120000);
        const errors = collectErrors(page);
        await loadGame(page);
        await selectSessionType(page, 'single');

        for (let i = 0; i < 6; i += 1) {
            await page.click('#btn-quick-random-map');
            await page.waitForFunction(() => {
                const hud = document.getElementById('hud');
                return hud && !hud.classList.contains('hidden');
            }, null, { timeout: 15000 });
            await page.waitForTimeout(200);
            await returnToMenu(page);
            await page.click('#menu-nav [data-session-type=\"single\"]');
        }

        expect(errors).toHaveLength(0);
    });

    test('T77b: Event-Playlist Quickstart startet und kehrt mehrfach fehlerfrei ins Menue zurueck', async ({ page }) => {
        test.setTimeout(120000);
        const errors = collectErrors(page);
        await loadGame(page);
        await selectSessionType(page, 'single');

        for (let index = 0; index < 4; index += 1) {
            await page.click('#btn-quick-event-playlist');
            await page.waitForFunction(() => {
                const hud = document.getElementById('hud');
                const game = window.GAME_INSTANCE;
                return !!(
                    hud
                    && !hud.classList.contains('hidden')
                    && game?.entityManager?.players?.length > 0
                );
            }, null, { timeout: 15000 });
            await page.waitForTimeout(200);
            await returnToMenu(page);
            await page.click('#menu-nav [data-session-type="single"]');
            await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: 5000 });
        }

        const playlistState = await page.evaluate(() => window.GAME_INSTANCE?.settings?.localSettings?.eventPlaylistState || null);
        expect(playlistState?.nextIndex).toBe(1);
        expect(errors).toHaveLength(0);
    });

    test('T78: Developer Release-Vorschau Toggle-Burst bleibt stabil', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        await openDeveloperSubmenu(page);

        if (!(await page.isChecked('#developer-mode-toggle'))) {
            await page.check('#developer-mode-toggle');
        }
        await page.selectOption('#developer-text-id-select', 'menu.level3.start.label');
        await page.fill('#developer-text-override-input', 'BurstStart');
        await page.click('#btn-developer-text-apply');
        await page.waitForTimeout(80);

        for (let i = 0; i < 8; i += 1) {
            if (i % 2 === 0) {
                await page.check('#developer-release-preview-toggle');
            } else {
                await page.uncheck('#developer-release-preview-toggle');
            }
            await page.waitForTimeout(60);
        }

        await openGameSubmenu(page);
        const startLabel = (await page.textContent('#btn-start')).trim();
        expect(['Starten', 'BurstStart']).toContain(startLabel);
        expect(errors).toHaveLength(0);
    });

    test('T79: Session- und Ebenenwechsel zwischen 2, 3 und 4 bleiben unter Burst stabil', async ({ page }) => {
        test.setTimeout(90000);
        const errors = collectErrors(page);
        const sessionTypes = ['single', 'multiplayer', 'splitscreen'];
        const level4Sections = ['gameplay', 'controls', 'tools'];

        await loadGame(page);

        for (let i = 0; i < 6; i += 1) {
            const sessionType = sessionTypes[i % sessionTypes.length];
            const sectionId = level4Sections[i % level4Sections.length];

            await selectSessionType(page, sessionType);
            await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
            await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });

            await page.click('#btn-open-level4');
            await page.waitForSelector('#submenu-level4:not(.hidden)', { timeout: 4000 });
            await page.click(`#submenu-level4 [data-level4-section-target="${sectionId}"]`);
            await page.waitForSelector(`#submenu-level4 [data-level4-section="${sectionId}"].is-active`, { timeout: 4000 });

            await page.keyboard.press('Escape');
            await page.waitForFunction(() => {
                const drawer = document.getElementById('submenu-level4');
                return !!drawer && drawer.classList.contains('hidden');
            }, null, { timeout: 4000 });

            await page.keyboard.press('Escape');
            await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: 4000 });

            await page.keyboard.press('Escape');
            await expect(page.locator('#menu-nav')).toBeVisible();
        }

        expect(errors).toHaveLength(0);
    });

    test('T80: Shorts-Recording-Layout mit HUD/clean bleibt unter Burst stabil', async ({ page }) => {
        test.setTimeout(90000);
        const errors = collectErrors(page);
        await loadGame(page);
        await selectSessionType(page, 'splitscreen');
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
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
            const renderer = game?.renderer;
            const recorder = game?.mediaRecorderSystem;
            if (!game || !renderer || !recorder) return null;

            const variants = [
                { profile: 'youtube_short', hudMode: 'clean' },
                { profile: 'youtube_short', hudMode: 'with_hud' },
            ];

            for (let i = 0; i < 12; i += 1) {
                const variant = variants[i % variants.length];
                game.settings.recording = { ...variant };
                game._onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });
                renderer.prepareRecordingCaptureFrame({
                    recordingActive: true,
                    entityManager: game.entityManager,
                    renderAlpha: 1,
                    renderDelta: 1 / 60,
                    splitScreen: true,
                });
            }

            const meta = renderer.getLastRecordingCaptureMeta?.() || null;
            const hudVisible = !document.getElementById('hud')?.classList?.contains('hidden');
            return {
                meta,
                hudVisible,
                splitScreen: renderer.splitScreen === true,
                recorderProfile: recorder.getRecordingCaptureSettings?.()?.profile || '',
                recorderHudMode: recorder.getRecordingCaptureSettings?.()?.hudMode || '',
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.hudVisible).toBeTruthy();
        expect(probe.splitScreen).toBeTruthy();
        expect(probe.meta?.layout).toBe('shorts_vertical_split');
        expect(probe.meta?.segments?.[0]?.playerIndex).toBe(0);
        expect(probe.meta?.segments?.[1]?.playerIndex).toBe(1);
        expect(probe.recorderProfile).toBe('youtube_short');
        expect(['clean', 'with_hud']).toContain(probe.recorderHudMode);
        expect(errors).toHaveLength(0);
    });

    test('T81: Parcours Wrong-Order-Spam fuehrt nicht zu Completion und bleibt stabil', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        await page.click('#menu-nav [data-session-type="single"]');
        await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.selectOption('#map-select', 'parcours_rift');
        await page.evaluate(() => {
            const botSlider = document.getElementById('bot-count');
            if (botSlider) {
                botSlider.value = '0';
                botSlider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            return !!(hud && !hud.classList.contains('hidden') && window.GAME_INSTANCE?.entityManager?.players?.length > 0);
        }, null, { timeout: 20000 });

        const probe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const system = entityManager?._parcoursProgressSystem;
            const route = system?.getRouteSnapshot?.();
            const player = entityManager?.players?.find((entry) => !entry?.isBot) || null;
            if (!route || !player) return { error: 'missing-runtime' };

            const cp02 = route.checkpoints.find((entry) => entry.routeIndex === 1) || route.checkpoints[0];
            if (!cp02) return { error: 'missing-checkpoint' };

            const setPlayerPosition = (x, y, z) => {
                if (player.position?.set) {
                    player.position.set(x, y, z);
                    return;
                }
                player.position.x = x;
                player.position.y = y;
                player.position.z = z;
            };

            let nowMs = 1000;
            for (let i = 0; i < 48; i += 1) {
                const forward = Array.isArray(cp02.forward) ? cp02.forward : [1, 0, 0];
                const previousPosition = {
                    x: cp02.pos[0] - (forward[0] * 0.7),
                    y: cp02.pos[1] - (forward[1] * 0.7),
                    z: cp02.pos[2] - (forward[2] * 0.7),
                };
                setPlayerPosition(
                    cp02.pos[0] + (forward[0] * 0.35),
                    cp02.pos[1] + (forward[1] * 0.35),
                    cp02.pos[2] + (forward[2] * 0.35)
                );
                system.updatePlayerProgress(player, previousPosition, nowMs);
                nowMs += 55;
            }

            const snapshot = system.getPlayerProgressSnapshot(player.index, nowMs);
            const outcome = system.getRoundOutcome();
            return {
                error: '',
                nextCheckpointIndex: snapshot?.nextCheckpointIndex ?? -1,
                wrongOrderCount: snapshot?.wrongOrderCount ?? -1,
                completed: !!snapshot?.completed,
                outcomeShouldEnd: !!outcome?.shouldEnd,
            };
        });

        expect(probe.error || '').toBe('');
        expect(probe.nextCheckpointIndex).toBe(0);
        expect(probe.completed).toBeFalsy();
        expect(probe.outcomeShouldEnd).toBeFalsy();
        expect(probe.wrongOrderCount).toBeGreaterThanOrEqual(1);
        expect(probe.wrongOrderCount).toBeLessThan(12);
        expect(errors).toHaveLength(0);
    });
});
