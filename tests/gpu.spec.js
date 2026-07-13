import { test, expect } from '@playwright/test';
import { loadGame, openLevel4Drawer, startGame, startGameWithBots, returnToMenu } from './helpers.js';

test.describe('T21-40: Rendering & GPU', () => {

    test('T21: WebGL Renderer initialisiert', async ({ page }) => {
        await startGame(page);
        const ok = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return g?.renderer?.renderer?.domElement instanceof HTMLCanvasElement;
        });
        expect(ok).toBeTruthy();
    });

    test('T21a: Renderer nutzt non-recording Buffer im Standardpfad', async ({ page }) => {
        await startGame(page);
        const probe = await page.evaluate(() => {
            const renderer = window.GAME_INSTANCE?.renderer;
            const gl = renderer?.renderer?.getContext?.();
            const attrs = gl?.getContextAttributes?.() || null;
            return {
                preserveDrawingBuffer: !!attrs?.preserveDrawingBuffer,
                recordingActive: !!renderer?.getRecordingActive?.(),
            };
        });
        expect(probe.recordingActive).toBeFalsy();
        expect(probe.preserveDrawingBuffer).toBeFalsy();
    });

    test('T22: Szene hat Lichter', async ({ page }) => {
        await startGame(page);
        const hasLights = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            if (!g?.renderer?.scene) return false;
            let found = false;
            g.renderer.scene.traverse(child => { if (child.isLight) found = true; });
            return found;
        });
        expect(hasLights).toBeTruthy();
    });

    test('T23: Kamera existiert und ist PerspectiveCamera', async ({ page }) => {
        await startGame(page);
        const ok = await page.evaluate(() => {
            return window.GAME_INSTANCE?.renderer?.cameras?.[0]?.isPerspectiveCamera === true;
        });
        expect(ok).toBeTruthy();
    });

    test('T24: Kamera-FOV im gültigen Bereich (1–120)', async ({ page }) => {
        await startGame(page);
        const fov = await page.evaluate(() =>
            window.GAME_INSTANCE?.renderer?.cameras?.[0]?.fov
        );
        expect(fov).toBeGreaterThan(0);
        expect(fov).toBeLessThanOrEqual(120);
    });

    test('T25: Canvas-Größe > 0', async ({ page }) => {
        await loadGame(page);
        const size = await page.evaluate(() => {
            const c = document.getElementById('game-canvas');
            return { w: c.width, h: c.height };
        });
        expect(size.w).toBeGreaterThan(0);
        expect(size.h).toBeGreaterThan(0);
    });

    test('T26: Renderer Pixel-Ratio im Bereich (0–3)', async ({ page }) => {
        await startGame(page);
        const ratio = await page.evaluate(() =>
            window.GAME_INSTANCE?.renderer?.renderer?.getPixelRatio()
        );
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThanOrEqual(3);
    });

    test('T27: Szene hat mehr als 5 Kinder nach Spielstart', async ({ page }) => {
        await startGame(page);
        const count = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            if (!g?.renderer?.scene) return 0;
            let n = 0;
            g.renderer.scene.traverse(() => n++);
            return n;
        });
        expect(count).toBeGreaterThan(5);
    });

    test('T28: Kein WebGL-Kontextverlust beim Start', async ({ page }) => {
        const lost = [];
        await page.exposeFunction('__reportContextLost', () => lost.push(true));
        await page.addInitScript(() => {
            window.addEventListener('webglcontextlost', () => window.__reportContextLost());
        });
        await startGame(page);
        await page.waitForTimeout(2000);
        expect(lost).toHaveLength(0);
    });

    test('T29: Schatten-Maps sind für das Hauptlicht aktiviert', async ({ page }) => {
        await startGame(page);
        const lightProps = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            if (!g?.renderer?.scene) return null;
            let dirLightCastShadow = false;
            let dirLightMapSize = 0;
            g.renderer.scene.traverse(child => {
                if (child.isDirectionalLight && child.castShadow) {
                    dirLightCastShadow = true;
                    if (child.shadow && child.shadow.mapSize) {
                        dirLightMapSize = child.shadow.mapSize.width;
                    }
                }
            });
            return { castShadow: dirLightCastShadow, mapSize: dirLightMapSize };
        });
        expect(lightProps).not.toBeNull();
        expect(lightProps.castShadow).toBeTruthy();
        expect(lightProps.mapSize).toBeGreaterThanOrEqual(512); // DEFAULT_SHADOW_MAP_SIZE in Config is usually 512
    });

    test('T30: Render-Qualität LOW reduziert Features', async ({ page }) => {
        await startGame(page);
        const lowSettings = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            g.renderer.setQuality('LOW');
            return {
                shadows: g.renderer.renderer.shadowMap.enabled,
                toneMapping: g.renderer.renderer.toneMapping,
                pixelRatio: g.renderer.renderer.getPixelRatio()
            };
        });
        expect(lowSettings.shadows).toBeFalsy();
        expect(lowSettings.toneMapping).toBe(0); // THREE.NoToneMapping
        expect(lowSettings.pixelRatio).toBeLessThanOrEqual(0.8);
    });

    test('T31: Render-Qualität HIGH aktiviert Features', async ({ page }) => {
        await startGame(page);
        const highSettings = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            g.renderer.setQuality('HIGH');
            return {
                shadows: g.renderer.renderer.shadowMap.enabled,
                toneMapping: g.renderer.renderer.toneMapping,
                pixelRatio: g.renderer.renderer.getPixelRatio()
            };
        });
        expect(highSettings.shadows).toBeTruthy();
        expect(highSettings.toneMapping).not.toBe(0); // THREE.ACESFilmicToneMapping is 4
        expect(highSettings.pixelRatio).toBeGreaterThan(0.8);
    });

    test('T31a: Schattenqualitaets-Slider steuert Shadow-Maps im Menue', async ({ page }) => {
        await loadGame(page);
        await openLevel4Drawer(page, { section: 'gameplay' });

        const expectedDefaultShadowQuality = await page.evaluate(async () => {
            const mod = await import('/src/shared/contracts/ShadowQualityContract.js');
            return {
                value: String(mod.DEFAULT_SHADOW_QUALITY),
                label: mod.resolveShadowQualityLabel(mod.DEFAULT_SHADOW_QUALITY),
            };
        });

        await expect(page.locator('#shadow-quality-slider')).toHaveValue(expectedDefaultShadowQuality.value);
        await expect(page.locator('#shadow-quality-label')).toHaveText(expectedDefaultShadowQuality.label);

        await page.evaluate(() => {
            const slider = document.getElementById('shadow-quality-slider');
            slider.value = '3';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(100);

        const highState = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const readDirectionalShadowMapSize = () => {
                let mapSize = 0;
                game?.renderer?.scene?.traverse((child) => {
                    if (mapSize > 0) return;
                    if (child.isDirectionalLight && child.castShadow) {
                        mapSize = child.shadow?.mapSize?.width || 0;
                    }
                });
                return mapSize;
            };
            game.renderer.setQuality('LOW');
            game.renderer.setQuality('HIGH');
            return {
                stored: game?.settings?.localSettings?.shadowQuality,
                label: document.getElementById('shadow-quality-label')?.textContent || '',
                shadows: game?.renderer?.renderer?.shadowMap?.enabled ?? false,
                mapSize: readDirectionalShadowMapSize(),
            };
        });
        expect(highState.stored).toBe(3);
        expect(highState.label).toBe('Hoch');
        expect(highState.shadows).toBeTruthy();
        expect(highState.mapSize).toBeGreaterThanOrEqual(1024);

        await page.evaluate(() => {
            const slider = document.getElementById('shadow-quality-slider');
            slider.value = '0';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(100);

        const offState = await page.evaluate(() => ({
            stored: window.GAME_INSTANCE?.settings?.localSettings?.shadowQuality,
            label: document.getElementById('shadow-quality-label')?.textContent || '',
            shadows: window.GAME_INSTANCE?.renderer?.renderer?.shadowMap?.enabled ?? true,
        }));
        expect(offState.stored).toBe(0);
        expect(offState.label).toBe('Aus');
        expect(offState.shadows).toBeFalsy();
    });

    test('T32: Szene nutzt definierte Scene-Roots', async ({ page }) => {
        await startGame(page);
        const hasRoots = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const scene = g?.renderer?.scene;
            if (!scene) return false;

            let pRoot = false, mRoot = false, dRoot = false;
            scene.children.forEach(child => {
                if (child.name === 'persistentRoot') pRoot = true;
                if (child.name === 'matchRoot') mRoot = true;
                if (child.name === 'debugRoot') dRoot = true;
            });
            return pRoot && mRoot && dRoot;
        });
        expect(hasRoots).toBeTruthy();
    });

    test('T33: Cinematic Camera blend reagiert auf Camera-Mode-Wechsel', async ({ page }) => {
        await startGame(page);
        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const rig = g?.renderer?.cameraRigSystem;
            const cinematic = rig?.cinematicCameraSystem;
            if (!g || !rig || !cinematic || !g.entityManager) return null;

            const tickCameras = (steps) => {
                for (let i = 0; i < steps; i++) {
                    g.entityManager.updateCameras(1 / 60);
                }
            };

            const initialBlend = cinematic.getPlayerBlend?.(0) || 0;
            tickCameras(36);
            const thirdPersonBlend = cinematic.getPlayerBlend?.(0) || 0;

            g.renderer.cycleCamera(0);
            tickCameras(36);
            const firstPersonBlend = cinematic.getPlayerBlend?.(0) || 0;

            return {
                enabled: cinematic.isEnabled?.() === true,
                initialBlend,
                thirdPersonBlend,
                firstPersonBlend,
                activeMode: g.renderer.getCameraMode(0),
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.enabled).toBeTruthy();
        expect(probe.thirdPersonBlend).toBeGreaterThan(probe.initialBlend);
        expect(probe.firstPersonBlend).toBeLessThanOrEqual(probe.thirdPersonBlend);
        expect(probe.activeMode).toBe('FIRST_PERSON');
    });

    test('T33b: Cinematic Camera bleibt in Third-Person mit Cockpit aktiv', async ({ page }) => {
        await startGame(page);
        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const rig = g?.renderer?.cameraRigSystem;
            const cinematic = rig?.cinematicCameraSystem;
            const player = g?.entityManager?.players?.[0];
            if (!g || !rig || !cinematic || !player || !g.entityManager) return null;

            const tickCameras = (steps) => {
                for (let i = 0; i < steps; i++) {
                    g.entityManager.updateCameras(1 / 60);
                }
            };

            cinematic.reset?.();
            g.renderer.setCinematicEnabled(true);
            rig.cameraModes[0] = 0; // THIRD_PERSON
            player.cockpitCamera = true;
            tickCameras(36);

            return {
                mode: g.renderer.getCameraMode(0),
                cockpit: !!player.cockpitCamera,
                blend: cinematic.getPlayerBlend?.(0) || 0,
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.mode).toBe('THIRD_PERSON');
        expect(probe.cockpit).toBeTruthy();
        expect(probe.blend).toBeGreaterThan(0);
    });

    test('T33c: Recording-Only-Camera erzeugt Shorts-Shots ohne Live-Kamera-Regressionspfad', async ({ page }) => {
        await loadGame(page);
        await page.click('#menu-nav [data-session-type="splitscreen"]');
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return !!(
                hud && !hud.classList.contains('hidden')
                && g?.entityManager?.players?.length > 1
            );
        }, null, { timeout: 60000 });

        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const renderer = g?.renderer;
            const liveRig = renderer?.cameraRigSystem;
            const liveCamera = liveRig?.cameras?.[0];
            if (!g || !renderer || !liveRig || !liveCamera) return null;

            const before = {
                mode: renderer.getCameraMode(0),
                x: Number(liveCamera.position.x || 0),
                y: Number(liveCamera.position.y || 0),
                z: Number(liveCamera.position.z || 0),
                splitScreen: renderer.splitScreen === true,
            };

            g.settings.recording = { profile: 'youtube_short', hudMode: 'clean' };
            g._onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });
            renderer.prepareRecordingCaptureFrame({
                recordingActive: true,
                entityManager: g.entityManager,
                renderAlpha: 1,
                renderDelta: 1 / 60,
                splitScreen: true,
            });

            const after = {
                mode: renderer.getCameraMode(0),
                x: Number(liveCamera.position.x || 0),
                y: Number(liveCamera.position.y || 0),
                z: Number(liveCamera.position.z || 0),
                splitScreen: renderer.splitScreen === true,
            };

            const dx = after.x - before.x;
            const dy = after.y - before.y;
            const dz = after.z - before.z;
            const liveCameraDelta = Math.hypot(dx, dy, dz);
            const meta = renderer.getLastRecordingCaptureMeta?.() || null;

            return {
                before,
                after,
                liveCameraDelta,
                meta,
                recordingCaptureIsMainCanvas: renderer.getRecordingCaptureCanvas?.() === renderer.canvas,
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.before.mode).toBe('THIRD_PERSON');
        expect(probe.after.mode).toBe('THIRD_PERSON');
        expect(probe.before.splitScreen).toBeTruthy();
        expect(probe.after.splitScreen).toBeTruthy();
        expect(probe.liveCameraDelta).toBeLessThan(0.0001);
        expect(probe.meta?.layout).toBe('shorts_vertical_split');
        expect(probe.meta?.segments?.[0]?.playerIndex).toBe(0);
        expect(probe.meta?.segments?.[1]?.playerIndex).toBe(1);
        expect(probe.recordingCaptureIsMainCanvas).toBeFalsy();
    });

    test('T33d: Video-Perspektive steuert nur Shorts-Capture (classic neutral, soft/action distinct)', async ({ page }) => {
        await loadGame(page);
        await page.click('#menu-nav [data-session-type="splitscreen"]');
        await page.click('#submenu-custom:not(.hidden) [data-mode-path="normal"]');
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return !!(
                hud && !hud.classList.contains('hidden')
                && g?.entityManager?.players?.length > 1
            );
        }, null, { timeout: 60000 });

        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const renderer = g?.renderer;
            const pipeline = renderer?.recordingCapturePipeline;
            const liveCamera = renderer?.cameraRigSystem?.cameras?.[0];
            if (!g || !renderer || !pipeline || !liveCamera) return null;

            g.settings.recording = { profile: 'youtube_short', hudMode: 'clean' };
            g._onSettingsChanged({ changedKeys: ['recording.profile', 'recording.hudMode'] });

            const samplePerspective = (mode) => {
                const perspective = g.settings.cameraPerspective && typeof g.settings.cameraPerspective === 'object'
                    ? g.settings.cameraPerspective
                    : {};
                g.settings.cameraPerspective = {
                    ...perspective,
                    normal: mode,
                    reduceMotion: false,
                };
                g._onSettingsChanged({
                    changedKeys: ['cameraPerspective.normal', 'cameraPerspective.reduceMotion'],
                });

                pipeline._orbitDirector?.reset?.();
                pipeline._shortsCameraRig?.resetCameras?.();
                if (typeof pipeline._clearShortsOrbitPose === 'function') {
                    pipeline._clearShortsOrbitPose();
                }

                const before = {
                    x: Number(liveCamera.position.x || 0),
                    y: Number(liveCamera.position.y || 0),
                    z: Number(liveCamera.position.z || 0),
                };

                for (let i = 0; i < 18; i += 1) {
                    renderer.prepareRecordingCaptureFrame({
                        recordingActive: true,
                        entityManager: g.entityManager,
                        renderAlpha: 1,
                        renderDelta: 1 / 60,
                        splitScreen: true,
                    });
                }

                const after = {
                    x: Number(liveCamera.position.x || 0),
                    y: Number(liveCamera.position.y || 0),
                    z: Number(liveCamera.position.z || 0),
                };
                const styles = Array.isArray(pipeline?._orbitDirector?._slotStyleByPlayer)
                    ? pipeline._orbitDirector._slotStyleByPlayer.slice(0, 2)
                    : [];
                const blends = Array.isArray(pipeline?._orbitDirector?._blendByPlayer)
                    ? pipeline._orbitDirector._blendByPlayer.slice(0, 2)
                    : [];

                return {
                    mode,
                    slotStyles: [
                        styles[0] || null,
                        styles[1] || null,
                    ],
                    slotBlends: [
                        Number(blends[0] || 0),
                        Number(blends[1] || 0),
                    ],
                    liveDelta: Math.hypot(
                        after.x - before.x,
                        after.y - before.y,
                        after.z - before.z
                    ),
                };
            };

            return {
                classic: samplePerspective('classic'),
                soft: samplePerspective('cinematic_soft'),
                action: samplePerspective('cinematic_action'),
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.classic.slotStyles).toEqual([null, null]);
        expect(probe.classic.slotBlends[0]).toBe(0);
        expect(probe.classic.slotBlends[1]).toBe(0);
        expect(probe.soft.slotStyles).toEqual(['cinematic', 'cinematic']);
        expect(probe.action.slotStyles).toEqual(['action', 'action']);
        expect(probe.soft.slotBlends[0]).toBeGreaterThan(0.01);
        expect(probe.soft.slotBlends[1]).toBeGreaterThan(0.01);
        expect(probe.action.slotBlends[0]).toBeGreaterThan(0.01);
        expect(probe.action.slotBlends[1]).toBeGreaterThan(0.01);
        expect(probe.classic.liveDelta).toBeLessThan(0.0001);
        expect(probe.soft.liveDelta).toBeLessThan(0.0001);
        expect(probe.action.liveDelta).toBeLessThan(0.0001);
    });

    test('T21b: Portal-Szenarien nutzen InstancedMesh fuer Portal-Visuals', async ({ page }) => {
        await loadGame(page);
        await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const debugApi = g?.debugApi || window.GAME_DEBUG || null;
            const applyScenario = typeof g?.applyBotValidationScenario === 'function'
                ? g.applyBotValidationScenario.bind(g)
                : (typeof debugApi?.applyBotValidationScenario === 'function'
                    ? debugApi.applyBotValidationScenario.bind(debugApi)
                    : null);
            if (typeof applyScenario !== 'function') {
                throw new Error('applyBotValidationScenario missing');
            }
            applyScenario('V3');
            g.winsNeeded = 1;
            if (g.settings) g.settings.winsNeeded = 1;
            if (typeof g._onSettingsChanged === 'function') g._onSettingsChanged();
            g.startMatch();
        });
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 10000 });
        await page.waitForTimeout(500);

        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const instancedPortals = [];
            g?.renderer?.scene?.traverse((child) => {
                if (child?.isInstancedMesh && typeof child.name === 'string' && child.name.startsWith('portal:')) {
                    instancedPortals.push({
                        name: child.name,
                        count: child.count,
                        color: child.material?.color?.getHexString?.() || null,
                        emissive: child.material?.emissive?.getHexString?.() || null,
                    });
                }
            });
            const torusBatches = instancedPortals.filter((entry) => entry.name.startsWith('portal:torus:'));
            const discBatches = instancedPortals.filter((entry) => entry.name.startsWith('portal:disc:'));
            return {
                portalPairs: g?.arena?.portals?.length || 0,
                instancedPortals,
                torusCount: torusBatches.reduce((sum, entry) => sum + (entry.count || 0), 0),
                discCount: discBatches.reduce((sum, entry) => sum + (entry.count || 0), 0),
                torusColors: torusBatches.map((entry) => entry.color).filter(Boolean),
                torusEmissives: torusBatches.map((entry) => entry.emissive).filter(Boolean),
            };
        });

        expect(probe.portalPairs).toBe(4);
        expect(probe.torusCount).toBe(8);
        expect(probe.discCount).toBe(8);
        expect(probe.torusColors).toEqual(expect.arrayContaining(['00ff00', 'ff0000']));
        expect(probe.torusEmissives).toEqual(expect.arrayContaining(['00ff00', 'ff0000']));
    });
});
