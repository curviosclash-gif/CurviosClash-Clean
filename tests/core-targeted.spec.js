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
    createMatchRuntimeProjection,
    applyPlayerPowerup,
    updatePlayerEffects,
    waitForRenderFrames,
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
import { resolveMapPreview } from '../src/ui/menu/MenuPreviewCatalog.js';

test.describe('T1-20: Core & Infrastruktur - Shell & Setup', () => {
    test.describe.configure({ mode: 'serial' });

    test('T1: Seite lädt ohne JS-Fehler', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        expect(errors).toHaveLength(0);
    });

    test('T2: Canvas existiert und ist sichtbar', async ({ page }) => {
        await loadGame(page);
        await expect(page.locator('#game-canvas')).toBeVisible();
    });

    test('T3: WebGL-Kontext verfügbar', async ({ page }) => {
        await loadGame(page);
        const hasWebGL = await page.evaluate(() => {
            const c = document.getElementById('game-canvas');
            return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
        });
        expect(hasWebGL).toBeTruthy();
    });

    test('T4: Hauptmenü sichtbar beim Start', async ({ page }) => {
        await loadGame(page);
        await expect(page.locator('#main-menu')).toBeVisible();
    });

    test('T5: Menü-Navigation Buttons vorhanden', async ({ page }) => {
        await loadGame(page);
        const count = await page.locator('#menu-nav .nav-btn').count();
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('T6: GAME_INSTANCE mit Renderer und Settings verfügbar', async ({ page }) => {
        await loadGame(page);
        const ok = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return !!(g && g.settings && g.renderer);
        });
        expect(ok).toBeTruthy();
    });

    test('T7: Spiel startet – HUD sichtbar', async ({ page }) => {
        await startGame(page);
        const hudVisible = await page.evaluate(() => {
            const hud = document.getElementById('hud');
            return hud && !hud.classList.contains('hidden');
        });
        expect(hudVisible).toBeTruthy();
    });

    test('T8: Spieler existiert nach Start', async ({ page }) => {
        await startGame(page);
        const hasPlayers = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return g?.entityManager?.players?.length > 0;
        });
        expect(hasPlayers).toBeTruthy();
    });

    test('T9: GameLoop läuft nach Start', async ({ page }) => {
        await startGame(page);
        const running = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return g?.gameLoop?.running === true;
        });
        expect(running).toBeTruthy();
    });

    test('T10: Arena ist gebaut', async ({ page }) => {
        await startGame(page);
        const hasArena = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return g?.arena && Array.isArray(g.arena.obstacles);
        });
        expect(hasArena).toBeTruthy();
    });

    test('T11: ESC bringt zurück ins Menü', async ({ page }) => {
        await startGame(page);
        await returnToMenu(page);
        await expect(page.locator('#main-menu')).toBeVisible();
    });

    test('T12: localStorage Settings speichern/laden', async ({ page }) => {
        await loadGame(page);
        const roundTrip = await page.evaluate(() => {
            try {
                const key = 'cuviosclash.settings.v1';
                const data = { test: true, ts: Date.now() };
                localStorage.setItem(key, JSON.stringify(data));
                const loaded = JSON.parse(localStorage.getItem(key));
                localStorage.removeItem(key);
                return loaded?.test === true;
            } catch { return false; }
        });
        expect(roundTrip).toBeTruthy();
    });

    test('T12b: Legacy localStorage Settings-Key wird nach CuviosClash migriert', async ({ page }) => {
        await page.addInitScript(({ currentKey, legacyKey }) => {
            localStorage.removeItem(currentKey);
            localStorage.setItem(legacyKey, JSON.stringify({
                mapKey: 'maze',
                winsNeeded: 5,
            }));
        }, {
            currentKey: SETTINGS_STORAGE_KEY,
            legacyKey: LEGACY_SETTINGS_STORAGE_KEY,
        });

        await loadGame(page);

        const migratedState = await page.evaluate(({ currentKey }) => ({
            mapKey: window.GAME_INSTANCE?.settings?.mapKey,
            winsNeeded: window.GAME_INSTANCE?.settings?.winsNeeded,
            hasNewKey: !!localStorage.getItem(currentKey),
        }), { currentKey: SETTINGS_STORAGE_KEY });

        expect(migratedState.mapKey).toBe('maze');
        expect(migratedState.winsNeeded).toBe(5);
        expect(migratedState.hasNewKey).toBeTruthy();

        await page.evaluate(({ currentKey, legacyKey }) => {
            localStorage.removeItem(currentKey);
            localStorage.removeItem(legacyKey);
        }, {
            currentKey: SETTINGS_STORAGE_KEY,
            legacyKey: LEGACY_SETTINGS_STORAGE_KEY,
        });
    });

    test('T13: Keine Fehler 2s nach Laden', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        await waitForRenderFrames(page, 48);
        expect(errors).toHaveLength(0);
    });

    test('T14: Alle Maps ladbar', async ({ page }) => {
        test.setTimeout(180000);
        const errors = collectErrors(page);
        await loadGame(page);
        await openGameSubmenu(page);

        const mapKeys = await page.evaluate(() => {
            const select = document.getElementById('map-select');
            if (!(select instanceof HTMLSelectElement)) return [];
            return Array.from(select.options)
                .map((option) => String(option.value || '').trim())
                .filter((value) => value && value !== 'custom');
        });
        expect(mapKeys.length).toBeGreaterThan(0);

        for (const mapKey of mapKeys) {
            await openGameSubmenu(page);
            await page.selectOption('#map-select', mapKey);
            await page.click('#btn-start');
            await page.waitForFunction(() => {
                const hud = document.getElementById('hud');
                return hud && !hud.classList.contains('hidden');
            }, null, { timeout: 15000 });
            await waitForRenderFrames(page, 30);
            await returnToMenu(page);
        }
        expect(errors).toHaveLength(0);
    });

    test('T14b: GLB-Maps markieren UI und starten mit Loader-Overlay und Szene-Collidern', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        // Fight lists the GLB test hangar only behind the showcase collection filter.
        await page.selectOption('#map-filter-select', 'showcase');
        const mapSelection = await page.evaluate(() => {
            const select = document.getElementById('map-select');
            const options = select instanceof HTMLSelectElement
                ? Array.from(select.options).map((option) => ({
                    value: String(option.value || '').trim(),
                    label: String(option.textContent || '').trim(),
                }))
                : [];
            const visibleGlbOption = options.find((entry) => entry.value === 'glb_hangar')
                || options.find((entry) => entry.value.startsWith('glb_') || /\bGLB\b/i.test(entry.label))
                || null;
            const mapPresets = window.GAME_INSTANCE?.mapPresets && typeof window.GAME_INSTANCE.mapPresets === 'object'
                ? window.GAME_INSTANCE.mapPresets
                : {};
            const runtimeGlbKey = Object.keys(mapPresets).find((key) => key.startsWith('glb_')) || null;
            return {
                visibleGlbKey: visibleGlbOption?.value || null,
                visibleGlbLabel: visibleGlbOption?.label || '',
                runtimeGlbKey,
            };
        });
        const glbMapKey = mapSelection.visibleGlbKey || mapSelection.runtimeGlbKey || null;
        expect(glbMapKey, 'GLB-Map muss im Desktop-Runtime-Katalog verfuegbar sein.').toBeTruthy();

        if (mapSelection.visibleGlbKey) {
            await page.selectOption('#map-select', glbMapKey);
            await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, glbMapKey, { timeout: 5000 });
            await page.selectOption('#map-filter-select', 'all');
            await page.waitForFunction(() => {
                const previewText = document.getElementById('map-preview')?.textContent || '';
                return /\bGLB\b/i.test(previewText);
            }, null, { timeout: 5000 });
        } else {
            const applied = await page.evaluate((mapKey) => {
                const game = window.GAME_INSTANCE;
                if (!game?.settings || !mapKey) return false;
                game.settings.mapKey = mapKey;
                return game.settings.mapKey === mapKey;
            }, glbMapKey);
            expect(applied).toBeTruthy();
        }

        if (mapSelection.visibleGlbLabel) {
            expect(mapSelection.visibleGlbLabel).toContain('GLB');
        }
        expect(resolveMapPreview(glbMapKey)).toMatchObject({
            hasGlbModel: true,
            glbSourceKind: 'embedded',
            glbFallbackMode: 'box-obstacles-on-load-error',
        });

        const probe = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            game.runtimeFacade?._clearMatchPrewarmTimer?.();
            const startPromise = game.matchFlowUiController.startMatch();
            const overlay = document.getElementById('message-overlay');
            const messageText = document.getElementById('message-text');
            const messageSub = document.getElementById('message-sub');
            const overlayVisibleDuringStart = !!overlay && !overlay.classList.contains('hidden');
            const loadingText = messageText?.textContent || '';
            const loadingSub = messageSub?.textContent || '';

            await startPromise;

            const nonWallObstacles = Array.isArray(game.arena?.obstacles)
                ? game.arena.obstacles.filter((entry) => !entry?.isWall)
                : [];
            return {
                state: game.state,
                currentMapKey: game.arena?.currentMapKey || null,
                overlayVisibleDuringStart,
                loadingText,
                loadingSub,
                glbScenePresent: !!game.arena?._glbScene,
                glbChildCount: game.arena?._glbScene?.children?.length || 0,
                glbError: game.arena?._glbLoadError || '',
                glbFootprint: game.arena?._glbFootprint || null,
                nonWallObstacleCount: nonWallObstacles.length,
                obstacleKinds: nonWallObstacles.map((entry) => entry.kind || 'hard'),
                floorParent: game.arena?._floorMesh?.parent?.name || null,
            };
        });

        expect(probe.state).toBe('PLAYING');
        expect(probe.currentMapKey).toBe(glbMapKey);
        expect(probe.overlayVisibleDuringStart).toBeTruthy();
        expect(probe.loadingText).toContain('GLB');
        expect(probe.loadingSub).toContain('GLB');
        expect(probe.glbScenePresent).toBeTruthy();
        expect(probe.glbChildCount).toBeGreaterThanOrEqual(1);
        expect(probe.glbError).toBe('');
        expect(probe.glbFootprint).toMatchObject({
            sourceKind: 'embedded',
            colliderMode: 'scene',
            fallbackMode: 'box-obstacles-on-load-error',
        });
        expect(probe.nonWallObstacleCount).toBeGreaterThan(0);
        expect(probe.floorParent).toBe('matchRoot');
    });

    test('T14c: Ungueltige GLB-Maps fallen auf Box-Hindernisse und Warn-Toast zurueck', async ({ page }) => {
        const brokenRuntimeMap = stringifyMapDocument({
            arenaSize: { width: 240, height: 90, depth: 240 },
            hardBlocks: [
                { id: 'glb_fallback_hard', x: -24, y: 12, z: 0, width: 6, height: 24, depth: 24 },
            ],
            foamBlocks: [
                { id: 'glb_fallback_foam', x: 24, y: 12, z: 0, width: 6, height: 24, depth: 24 },
            ],
            glbModel: 'data:model/gltf-binary;base64,broken',
        });

        await loadGame(page);
        await openGameSubmenu(page);
        await page.evaluate(({ storageKey, mapJson }) => {
            localStorage.setItem(storageKey, mapJson);
        }, {
            storageKey: CUSTOM_MAP_STORAGE_KEY,
            mapJson: brokenRuntimeMap,
        });
        const customMapAvailable = await page.evaluate(() => {
            const select = document.getElementById('map-select');
            if (!(select instanceof HTMLSelectElement)) return false;
            return Array.from(select.options).some((option) => String(option.value || '').trim() === 'custom');
        });
        expect(customMapAvailable, 'Custom-Map muss im Desktop-Surface verfuegbar sein.').toBe(true);
        const customApplied = await page.evaluate(() => {
            const select = document.getElementById('map-select');
            const game = window.GAME_INSTANCE;
            if (!(select instanceof HTMLSelectElement) || !game?.settings) return false;
            select.value = 'custom';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            game.settings.mapKey = 'custom';
            game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['mapKey'] });
            return game.settings.mapKey === 'custom';
        });
        expect(customApplied).toBeTruthy();

        const probe = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            if (game?.settings) {
                game.settings.mapKey = 'custom';
                game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['mapKey'] });
            }
            game.runtimeFacade?._clearMatchPrewarmTimer?.();
            const startPromise = game.matchFlowUiController.startMatch();
            const loadingVisibleDuringStart = !document.getElementById('message-overlay')?.classList.contains('hidden');

            await startPromise;

            const nonWallObstacles = Array.isArray(game.arena?.obstacles)
                ? game.arena.obstacles.filter((entry) => !entry?.isWall)
                : [];
            const toast = document.getElementById('status-toast');
            return {
                state: game.state,
                currentMapKey: game.arena?.currentMapKey || null,
                loadingVisibleDuringStart,
                glbScenePresent: !!game.arena?._glbScene,
                glbError: game.arena?._glbLoadError || '',
                glbWarnings: Array.isArray(game.arena?._glbLoadWarnings) ? game.arena._glbLoadWarnings : [],
                nonWallObstacleCount: nonWallObstacles.length,
                obstacleKinds: nonWallObstacles.map((entry) => entry.kind || 'hard'),
                toastText: toast?.textContent || '',
                toastVisible: !!toast && !toast.classList.contains('hidden'),
            };
        });

        expect(probe.state).toBe('PLAYING');
        expect(probe.currentMapKey).toBe('custom');
        expect(probe.loadingVisibleDuringStart).toBeTruthy();
        expect(probe.glbScenePresent).toBeFalsy();
        expect(probe.glbError).not.toBe('');
        expect(probe.glbWarnings.length).toBeGreaterThan(0);
        expect(probe.nonWallObstacleCount).toBe(2);
        expect(probe.obstacleKinds).toEqual(expect.arrayContaining(['hard', 'foam']));
        expect(probe.toastVisible).toBeTruthy();
        expect(probe.toastText).toContain('Box-Fallback aktiv');
    });

    test('T14d: Showcase-Preset zeigt Preview-Signale und laedt authored Runtime-Features', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        await openGameSubmenu(page);
        // Fight lists the model showcases only behind their own collection filter.
        await page.selectOption('#map-filter-select', 'showcase');
        await page.selectOption('#map-select', 'showcase_nexus');
        await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'showcase_nexus', null, { timeout: 5000 });
        // The filter is saved in the profile; later specs expect the full list again.
        await page.selectOption('#map-filter-select', 'all');
        await page.evaluate(() => {
            const slider = document.getElementById('bot-count');
            slider.value = '3';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });

        const previewState = await page.evaluate(() => {
            const badges = Array.from(document.querySelectorAll('#map-preview .preview-badge')).map((node) => node.textContent || '');
            const facts = Array.from(document.querySelectorAll('#map-preview .preview-kv')).map((node) => ({
                label: node.querySelector('.preview-kv-label')?.textContent || '',
                value: node.querySelector('.preview-kv-value')?.textContent || '',
            }));
            return { badges, facts };
        });

        expect(previewState.badges).toEqual(expect.arrayContaining(['GLB+FALLBACK', '3 Ebenen']));
        expect(resolveMapPreview('showcase_nexus')).toMatchObject({
            glbSourceKind: 'embedded',
            glbColliderMode: 'fallbackOnly',
            glbFallbackMode: 'box-obstacles-on-load-error',
        });
        expect(previewState.facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Tunnel', value: '4' }),
            expect.objectContaining({ label: 'Tore', value: '3' }),
            expect.objectContaining({ label: 'Startpunkte', value: '5' }),
            expect.objectContaining({ label: 'Items', value: '4' }),
            expect.objectContaining({ label: 'Deko-Flieger', value: '3' }),
        ]));

        const probe = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            game.runtimeFacade?._clearMatchPrewarmTimer?.();
            await game.matchFlowUiController.startMatch();

            const arena = game.arena;
            const human = game.entityManager?.players?.find((player) => !player?.isBot) || null;
            const authoredSpawn = arena?.getAuthoredPlayerSpawn?.() || null;
            const playerSpawnDistance = human && authoredSpawn
                ? Math.hypot(
                    human.position.x - authoredSpawn.x,
                    human.position.y - authoredSpawn.y,
                    human.position.z - authoredSpawn.z,
                )
                : null;

            return {
                currentMapKey: arena?.currentMapKey || '',
                glbScenePresent: !!arena?._glbScene,
                glbError: arena?._glbLoadError || '',
                gateCount: Array.isArray(arena?.specialGates) ? arena.specialGates.length : 0,
                portalCount: Array.isArray(arena?.portals) ? arena.portals.length : 0,
                tubeObstacleCount: Array.isArray(arena?.obstacles) ? arena.obstacles.filter((entry) => !!entry?.tube).length : 0,
                aircraftDecorationCount: Array.isArray(arena?._aircraftDecorations) ? arena._aircraftDecorations.length : 0,
                authoredItemAnchorCount: Array.isArray(arena?.getAuthoredItemAnchors?.()) ? arena.getAuthoredItemAnchors().length : 0,
                playerSpawnDistance,
            };
        });

        expect(probe.currentMapKey).toBe('showcase_nexus');
        expect(probe.glbScenePresent).toBeTruthy();
        expect(probe.glbError).toBe('');
        expect(probe.gateCount).toBe(3);
        expect(probe.portalCount).toBe(2);
        expect(probe.tubeObstacleCount).toBe(2);
        expect(probe.aircraftDecorationCount).toBe(3);
        expect(probe.authoredItemAnchorCount).toBe(4);
        expect(probe.playerSpawnDistance).not.toBeNull();
        expect(probe.playerSpawnDistance).toBeLessThan(4);
        expect(errors).toHaveLength(0);
    });

    // SPEED_UP and SLOW_DOWN share effectCategory 'speed' with stackPolicy 'replace-category'
    // (PickupRegistryContract.js:56-57, 83-84), so applyPlayerPowerup drops the older one
    // ("latest-wins", PlayerEffectOps.js:72, 244-255). When the winner expires the player
    // falls back to the plain base speed, not to the replaced effect.
    test('T14ed: Speed-Effekte ersetzen sich und geben nach Ablauf die Grundgeschwindigkeit zurueck', async () => {
        const player = {
            entityRuntimeConfig: {
                ...CONFIG,
                HUNT: { ...CONFIG.HUNT, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC', ENABLED: true },
            },
            activeEffects: [],
            baseSpeed: CONFIG.PLAYER.SPEED,
            speed: CONFIG.PLAYER.SPEED,
            hasShield: false,
            shieldHP: 0,
            shieldHitFeedback: 0,
            trail: {
                width: CONFIG.TRAIL.WIDTH,
                setWidth(value) { this.width = value; },
                resetWidth() { this.width = CONFIG.TRAIL.WIDTH; },
            },
        };

        applyPlayerPowerup(player, 'SPEED_UP');
        expect(player.baseSpeed).toBeGreaterThan(CONFIG.PLAYER.SPEED);

        applyPlayerPowerup(player, 'SLOW_DOWN');
        expect(player.activeEffects.some((entry) => entry.type === 'SPEED_UP')).toBeFalsy();
        expect(player.activeEffects.some((entry) => entry.type === 'SLOW_DOWN')).toBeTruthy();
        expect(player.baseSpeed).toBeLessThan(CONFIG.PLAYER.SPEED);

        const slowDown = player.activeEffects.find((entry) => entry.type === 'SLOW_DOWN');
        slowDown.remaining = 0.01;

        updatePlayerEffects(player, 0.02);

        expect(player.activeEffects.some((entry) => entry.type === 'SLOW_DOWN')).toBeFalsy();
        expect(player.activeEffects.some((entry) => entry.type === 'SPEED_UP')).toBeFalsy();
        expect(player.baseSpeed).toBe(CONFIG.PLAYER.SPEED);
        expect(player.speed).toBe(CONFIG.PLAYER.SPEED);
    });

    // SLOW_TIME is allowed in every mode and even carries a HUNT spawn weight
    // (PickupRegistryContract.js:254,258), so HUNT keeps it. PURGE is the retired type
    // (playable: false, PickupExpansionDefinitionsContract.js:41-48) that the mode filter
    // in PlayerEffectOps.js:157-159 must still strip out of a legacy effect list.
    test('T14ee: Hunt-Shields und Zeitlupe bleiben, waehrend nicht spielbare Legacy-Effekte entfernt werden', async () => {
        const player = {
            entityRuntimeConfig: {
                ...CONFIG,
                HUNT: { ...CONFIG.HUNT, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT', ENABLED: true },
            },
            activeEffects: [
                { type: 'SLOW_TIME', remaining: 10 },
                { type: 'PURGE', remaining: 10 },
            ],
            baseSpeed: CONFIG.PLAYER.SPEED,
            speed: CONFIG.PLAYER.SPEED,
            hasShield: false,
            shieldHP: 0,
            maxShieldHp: 1,
            shieldHitFeedback: 0,
            trail: {
                width: CONFIG.TRAIL.WIDTH,
                setWidth(value) { this.width = value; },
                resetWidth() { this.width = CONFIG.TRAIL.WIDTH; },
            },
        };

        applyPlayerPowerup(player, 'SHIELD');
        const shieldEffect = player.activeEffects.find((entry) => entry.type === 'SHIELD');
        shieldEffect.remaining = 0.01;

        updatePlayerEffects(player, 0.5);

        expect(player.activeEffects.some((entry) => entry.type === 'PURGE')).toBeFalsy();
        expect(player.activeEffects.some((entry) => entry.type === 'SLOW_TIME')).toBeTruthy();
        expect(player.hasSlowTime).toBeTruthy();
        expect(player.activeEffects.some((entry) => entry.type === 'SHIELD')).toBeTruthy();
        expect(player.hasShield).toBeTruthy();
        expect(player.shieldHP).toBeGreaterThan(0);
    });

    test('T14f: Parcours-Rift erzwingt Reihenfolge und beendet Match mit Objective-Overlay', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForFunction(() => String(window.GAME_INSTANCE?.settings?.localSettings?.modePath || '') === 'arcade', null, { timeout: 5000 });
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.selectOption('#map-select', 'parcours_rift');
        await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'parcours_rift', null, { timeout: 5000 });
        await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            if (!game?.settings) return;
            game.settings.winsNeeded = 1;
            game.settings.numBots = 1;
            const winsSlider = document.getElementById('win-count');
            if (winsSlider) winsSlider.value = '1';
            const botSlider = document.getElementById('bot-count');
            if (botSlider) botSlider.value = '1';
            game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['rules.winsNeeded', 'bots.count'] });
        });
        await page.waitForFunction(() => {
            const settings = window.GAME_INSTANCE?.settings;
            return Number(settings?.winsNeeded) === 1 && Number(settings?.numBots) === 1;
        }, null, { timeout: 5000 });
        await page.click('#btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            return !!(hud && !hud.classList.contains('hidden'));
        }, null, { timeout: 20000 });

        const probe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const system = entityManager?._parcoursProgressSystem;
            const route = system?.getRouteSnapshot?.();
            const player = entityManager?.players?.find((entry) => !entry?.isBot) || entityManager?.players?.[0] || null;
            if (!route || !player) return { error: 'missing-route-or-player' };

            const setPlayerPosition = (x, y, z) => {
                if (player.position?.set) {
                    player.position.set(x, y, z);
                    return;
                }
                player.position.x = x;
                player.position.y = y;
                player.position.z = z;
            };

            const cross = (entry, nowMs) => {
                const pos = Array.isArray(entry?.pos) ? entry.pos : [0, 0, 0];
                const forward = Array.isArray(entry?.forward) ? entry.forward : [1, 0, 0];
                const previousPosition = {
                    x: pos[0] - (forward[0] * 0.65),
                    y: pos[1] - (forward[1] * 0.65),
                    z: pos[2] - (forward[2] * 0.65),
                };
                setPlayerPosition(
                    pos[0] + (forward[0] * 0.35),
                    pos[1] + (forward[1] * 0.35),
                    pos[2] + (forward[2] * 0.35)
                );
                return system.updatePlayerProgress(player, previousPosition, nowMs);
            };

            let nowMs = 800;
            const hitTypes = [];
            for (let checkpointIndex = 0; checkpointIndex < route.totalCheckpoints; checkpointIndex += 1) {
                const entry = route.checkpoints.find((candidate) => candidate.routeIndex === checkpointIndex);
                if (!entry) return { error: `missing-checkpoint-${checkpointIndex}` };
                const hit = cross(entry, nowMs);
                hitTypes.push(hit?.type || 'none');
                nowMs += 450;
            }
            const finishHit = cross(route.finish, nowMs + 400);
            game.hudRuntimeSystem?.updatePlayingHudTick?.(0.2);
            const winsNeeded = Number(game?.winsNeeded || game?.settings?.winsNeeded || 1);
            if (Number.isFinite(winsNeeded) && winsNeeded > 0) {
                player.score = Math.max(0, Math.trunc(winsNeeded) - 1);
            }

            const outcome = entityManager?._roundOutcomeSystem?.resolve?.() || null;
            if (outcome?.shouldEnd) {
                entityManager?._eventBus?.emitRoundEnd?.(outcome.winner, outcome);
            }

            return {
                error: '',
                hitTypes,
                finishType: finishHit?.type || '',
                outcomeReason: outcome?.reason || '',
                state: game.state,
                messageText: document.getElementById('message-text')?.textContent || '',
                messageSub: document.getElementById('message-sub')?.textContent || '',
                parcoursProgress: document.getElementById('parcours-progress')?.textContent || '',
                parcoursTimer: document.getElementById('parcours-timer')?.textContent || '',
                parcoursStatus: document.getElementById('parcours-status')?.textContent || '',
                roundMetrics: game.recorder?.getLastRoundMetrics?.() || null,
                telemetryRecentRound: game.settings?.localSettings?.telemetryState?.recentRounds?.[0] || null,
            };
        });

        expect(probe.error || '').toBe('');
        expect(probe.hitTypes).toEqual(['checkpoint', 'checkpoint', 'checkpoint', 'checkpoint', 'checkpoint', 'checkpoint', 'checkpoint', 'checkpoint', 'checkpoint']);
        expect(probe.finishType).toBe('finish');
        expect(probe.outcomeReason).toBe('PARCOURS_COMPLETE');
        expect(['ROUND_END', 'MATCH_END']).toContain(probe.state);
        expect(probe.parcoursProgress).toContain('CP 9/9');
        expect(probe.parcoursTimer).toContain('Finish');
        expect(probe.parcoursStatus).toContain('Parcours abgeschlossen');
        expect(probe.roundMetrics?.reason).toBe('PARCOURS_COMPLETE');
        expect(probe.roundMetrics?.parcoursCompleted).toBeTruthy();
        expect(probe.roundMetrics?.parcoursRouteId).toBe('rift_gauntlet_v1');
        expect(probe.roundMetrics?.parcoursCompletionTimeMs).toBeGreaterThan(0);
        expect(probe.telemetryRecentRound?.parcoursCompleted).toBeTruthy();
        expect(probe.telemetryRecentRound?.parcoursRouteId).toBe('rift_gauntlet_v1');
    });

    test('T14h: Parcours-CP01 und Finish feuern eigene Audio-Debug-Events', async ({ page }) => {
        await loadGame(page);
        await openCustomSubmenu(page);
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
        await page.waitForFunction(() => String(window.GAME_INSTANCE?.settings?.localSettings?.modePath || '') === 'arcade', null, { timeout: 5000 });
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.selectOption('#map-select', 'parcours_rift');
        await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'parcours_rift', null, { timeout: 5000 });
        await page.click('#btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            return !!(hud && !hud.classList.contains('hidden'));
        }, null, { timeout: 20000 });

        const probe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const system = entityManager?._parcoursProgressSystem;
            const route = system?.getRouteSnapshot?.();
            const player = entityManager?.players?.find((entry) => !entry?.isBot) || entityManager?.players?.[0] || null;
            if (!route || !player) return { error: 'missing-route-or-player' };
            if (
                typeof game?.audio?.clearDebugEvents !== 'function'
                || typeof game?.audio?.getRecentEvents !== 'function'
            ) {
                return { error: 'missing-audio-debug-hooks' };
            }

            game.audio.enabled = true;
            game.audio.ctx = game.audio.ctx || {
                state: 'running',
                destination: {},
                resume() {},
                close() { return Promise.resolve(); },
            };
            game.audio._playParcoursCheckpoint = () => {};
            game.audio._playParcoursBranch = () => {};
            game.audio._playParcoursFinish = () => {};

            const setPlayerPosition = (x, y, z) => {
                if (player.position?.set) {
                    player.position.set(x, y, z);
                    return;
                }
                player.position.x = x;
                player.position.y = y;
                player.position.z = z;
            };

            const cross = (entry, nowMs) => {
                const pos = Array.isArray(entry?.pos) ? entry.pos : [0, 0, 0];
                const forward = Array.isArray(entry?.forward) ? entry.forward : [1, 0, 0];
                const previousPosition = {
                    x: pos[0] - (forward[0] * 0.65),
                    y: pos[1] - (forward[1] * 0.65),
                    z: pos[2] - (forward[2] * 0.65),
                };
                setPlayerPosition(
                    pos[0] + (forward[0] * 0.35),
                    pos[1] + (forward[1] * 0.35),
                    pos[2] + (forward[2] * 0.35)
                );
                return system.updatePlayerProgress(player, previousPosition, nowMs);
            };

            const cp01 = route.checkpoints.find((entry) => entry.routeIndex === 0);
            if (!cp01) return { error: 'missing-cp01' };

            let nowMs = 800;
            game.audio.clearDebugEvents();
            const cp01Hit = cross(cp01, nowMs);
            const afterCp01 = system.getPlayerProgressSnapshot(player.index, nowMs);
            const cp01Audio = game.audio.getRecentEvents(6).map((entry) => entry.type);

            game.audio.clearDebugEvents();
            for (let checkpointIndex = 1; checkpointIndex < route.totalCheckpoints; checkpointIndex += 1) {
                nowMs += 450;
                const entry = route.checkpoints.find((candidate) => candidate.routeIndex === checkpointIndex);
                if (!entry) return { error: `missing-checkpoint-${checkpointIndex}` };
                cross(entry, nowMs);
            }
            nowMs += 500;
            const finishHit = cross(route.finish, nowMs);
            const afterFinish = system.getPlayerProgressSnapshot(player.index, nowMs);
            const finishAudio = game.audio.getRecentEvents(6).map((entry) => entry.type);

            return {
                error: '',
                cp01Hit: cp01Hit?.type || '',
                cp01Audio,
                afterCp01: {
                    nextCheckpointIndex: afterCp01?.nextCheckpointIndex ?? -1,
                    startedAtMs: afterCp01?.startedAtMs ?? 0,
                    passedCheckpointIds: afterCp01?.passedCheckpointIds || [],
                },
                finishHit: finishHit?.type || '',
                finishAudio,
                afterFinish: {
                    completed: afterFinish?.completed === true,
                    completionTimeMs: afterFinish?.completionTimeMs ?? 0,
                },
            };
        });

        expect(probe.error || '').toBe('');
        expect(probe.cp01Hit).toBe('checkpoint');
        expect(probe.cp01Audio).toContain('PARCOURS_CP');
        expect(probe.afterCp01.nextCheckpointIndex).toBe(1);
        expect(probe.afterCp01.startedAtMs).toBeGreaterThan(0);
        expect(probe.afterCp01.passedCheckpointIds).toEqual(['CP01']);
        expect(probe.finishHit).toBe('finish');
        expect(probe.finishAudio).toContain('PARCOURS_FINISH');
        expect(probe.afterFinish.completed).toBeTruthy();
        expect(probe.afterFinish.completionTimeMs).toBeGreaterThan(0);
    });

    test('T15: Bot-Count Slider aktualisiert Label', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await page.evaluate(() => {
            const slider = document.getElementById('bot-count');
            slider.value = '4';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const label = await page.textContent('#bot-count-label');
        expect(label).toBe('4');
    });

    test('T16: Schwierigkeitsstufen auswählbar', async ({ page }) => {
        await loadGame(page);
        await openStartSetupSection(page, 'match');
        for (const diff of ['EASY', 'NORMAL', 'HARD']) {
            await page.selectOption('#bot-difficulty', diff);
            expect(await page.inputValue('#bot-difficulty')).toBe(diff);
        }
    });

    test('T17: Vehicle-Select hat mindestens 1 Option', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        const count = await page.evaluate(() =>
            document.querySelectorAll('#vehicle-select-p1 option').length
        );
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('T18: Power-Up-Typen definiert (mind. 1)', async ({ page }) => {
        await loadGame(page);
        const count = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const types = g?.config?.POWERUP?.TYPES;
            if (!types) return 0;
            return Object.keys(types).length;
        });
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('T19: Keine doppelten Element-IDs', async ({ page }) => {
        await loadGame(page);
        const dupes = await page.evaluate(() => {
            const seen = {};
            const dupes = [];
            document.querySelectorAll('[id]').forEach(el => {
                const isVisible = !!(el.offsetParent || (el.getClientRects && el.getClientRects().length));
                if (!isVisible) return;
                if (seen[el.id]) dupes.push(el.id);
                seen[el.id] = true;
            });
            return dupes;
        });
        expect(dupes.length).toBe(0);
    });

    test('T20: Submenu Settings öffnet und schließt', async ({ page }) => {
        await loadGame(page);
        await openSubmenu(page, 'submenu-settings');
        await expect(page.locator('#submenu-settings')).toBeVisible();
        await page.click('#submenu-settings [data-back]');
        await waitForRenderFrames(page, 3);
        await expect(page.locator('#menu-nav')).toBeVisible();
    });
});
