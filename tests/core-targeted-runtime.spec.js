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

test.describe('T1-20: Core & Infrastruktur - Runtime Loop, Recording & Prewarm', () => {
    test.describe.configure({ mode: 'serial' });

    test('T20ab: GameLoop akkumuliert Sub-Step-Frames ohne Doppel-Simulation', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameLoop } = await window.__curviosImport('/src/core/GameLoop.js');
            const originalRaf = window.requestAnimationFrame;
            const originalCancel = window.cancelAnimationFrame;
            const updates = [];
            try {
                window.requestAnimationFrame = () => 1;
                window.cancelAnimationFrame = () => { };
                const loop = new GameLoop((dt) => updates.push(dt), () => { });
                loop.running = true;
                loop.lastTime = 0;
                loop._loop(10);
                loop._loop(20);
                loop._loop(30);
                return {
                    updateCount: updates.length,
                    totalDt: updates.reduce((sum, dt) => sum + dt, 0),
                    accumulator: loop.accumulator,
                    fixedStep: loop.fixedStep,
                };
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancel;
            }
        });

        expect(result.updateCount).toBe(1);
        expect(result.totalDt).toBeGreaterThanOrEqual(result.fixedStep - 0.000001);
        expect(result.totalDt).toBeLessThanOrEqual(result.fixedStep + 0.000001);
        expect(result.accumulator).toBeLessThan(result.fixedStep);
    });

    test('T20ac: GameLoop klemmt grosse Delta-Spruenge auf maximal drei Fixed-Steps', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameLoop } = await window.__curviosImport('/src/core/GameLoop.js');
            const originalRaf = window.requestAnimationFrame;
            const originalCancel = window.cancelAnimationFrame;
            const updates = [];
            try {
                window.requestAnimationFrame = () => 1;
                window.cancelAnimationFrame = () => { };
                const loop = new GameLoop((dt) => updates.push(dt), () => { });
                loop.running = true;
                loop.lastTime = 0;
                loop._loop(200);
                return {
                    updateCount: updates.length,
                    totalDt: updates.reduce((sum, dt) => sum + dt, 0),
                    accumulator: loop.accumulator,
                    fixedStep: loop.fixedStep,
                };
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancel;
            }
        });

        expect(result.updateCount).toBe(3);
        expect(result.totalDt).toBeGreaterThanOrEqual(result.fixedStep * 3 - 0.000001);
        expect(result.totalDt).toBeLessThanOrEqual(result.fixedStep * 3 + 0.000001);
        expect(result.accumulator).toBeLessThan(0.000001);
    });

    test('T20ad: GameLoop wendet timeScale nur einmal auf akkumulierte Simulationszeit an', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameLoop } = await window.__curviosImport('/src/core/GameLoop.js');
            const originalRaf = window.requestAnimationFrame;
            const originalCancel = window.cancelAnimationFrame;
            const updates = [];
            try {
                window.requestAnimationFrame = () => 1;
                window.cancelAnimationFrame = () => { };
                const loop = new GameLoop((dt) => updates.push(dt), () => { });
                loop.running = true;
                loop.lastTime = 0;
                loop.setTimeScale(0.5);
                loop._loop(10);
                loop._loop(20);
                loop._loop(30);
                loop._loop(40);
                return {
                    updateCount: updates.length,
                    totalDt: updates.reduce((sum, dt) => sum + dt, 0),
                    accumulator: loop.accumulator,
                    fixedStep: loop.fixedStep,
                };
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancel;
            }
        });

        expect(result.updateCount).toBe(1);
        expect(result.totalDt).toBeGreaterThanOrEqual(result.fixedStep - 0.000001);
        expect(result.totalDt).toBeLessThanOrEqual(result.fixedStep + 0.000001);
        expect(result.totalDt).toBeLessThan(0.02);
        expect(result.accumulator).toBeLessThan(result.fixedStep);
    });

    test('T20af: GameLoop uebergibt Render-Alpha aus accumulator/fixedStep', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameLoop } = await window.__curviosImport('/src/core/GameLoop.js');
            const originalRaf = window.requestAnimationFrame;
            const originalCancel = window.cancelAnimationFrame;
            const renderAlphas = [];
            try {
                window.requestAnimationFrame = () => 1;
                window.cancelAnimationFrame = () => { };
                const loop = new GameLoop(() => { }, (alpha) => {
                    renderAlphas.push(alpha);
                });
                loop.running = true;
                loop.lastTime = 0;
                loop._loop(10);
                loop._loop(20);
                loop._loop(30);
                const expectedAlpha = loop.fixedStep > 0 ? (loop.accumulator / loop.fixedStep) : 0;
                return {
                    renderCallCount: renderAlphas.length,
                    latestRenderAlpha: Number(renderAlphas[renderAlphas.length - 1] ?? -1),
                    cachedRenderAlpha: Number(loop.renderAlpha),
                    expectedAlpha: Number(expectedAlpha),
                };
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancel;
            }
        });

        expect(result.renderCallCount).toBe(3);
        expect(result.latestRenderAlpha).toBeGreaterThanOrEqual(0);
        expect(result.latestRenderAlpha).toBeLessThanOrEqual(1);
        expect(Math.abs(result.cachedRenderAlpha - result.latestRenderAlpha)).toBeLessThan(0.000001);
        expect(Math.abs(result.expectedAlpha - result.latestRenderAlpha)).toBeLessThan(0.000001);
    });

    test('T20ag: GameLoop neutralisiert extreme Delta-Spruenge mit Jump-Guard', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameLoop } = await window.__curviosImport('/src/core/GameLoop.js');
            const originalRaf = window.requestAnimationFrame;
            const originalCancel = window.cancelAnimationFrame;
            const updates = [];
            try {
                window.requestAnimationFrame = () => 1;
                window.cancelAnimationFrame = () => { };
                const loop = new GameLoop((dt) => updates.push(dt), () => { });
                loop.running = true;
                loop.lastTime = 0;
                loop._loop(1200);
                return {
                    updateCount: updates.length,
                    totalDt: updates.reduce((sum, dt) => sum + dt, 0),
                    accumulator: loop.accumulator,
                    fixedStep: loop.fixedStep,
                };
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancel;
            }
        });

        expect(result.updateCount).toBe(1);
        expect(result.totalDt).toBeGreaterThanOrEqual(result.fixedStep - 0.000001);
        expect(result.totalDt).toBeLessThanOrEqual(result.fixedStep + 0.000001);
        expect(result.accumulator).toBeLessThan(0.000001);
    });

    test('T20ah: Debug-API liefert Runtime-Perf-Snapshot inkl. Subsystem-Werten', async ({ page }) => {
        await loadGame(page);
        const probe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const profiler = game?.runtimePerfProfiler;
            const now = performance.now();
            profiler?.beginFrame?.(16.7, now);
            profiler?.recordSubsystemDuration?.('update', 2.4);
            profiler?.recordSubsystemDuration?.('camera', 1.2);
            profiler?.endFrame?.(16.7, now + 16.7);
            const snapshot = game?.debugApi?.getRuntimePerformanceSnapshot?.({
                windowSize: 1,
                spikeEventsLimit: 0,
            }) || null;
            return {
                hasSnapshot: !!snapshot,
                frameP95: Number(snapshot?.performance?.frameMs?.p95 || 0),
                updateAvg: Number(snapshot?.performance?.subsystems?.update?.avg || 0),
                cameraAvg: Number(snapshot?.performance?.subsystems?.camera?.avg || 0),
                hasRecorderDiagnostics: !!snapshot?.recorder,
            };
        });

        expect(probe.hasSnapshot).toBeTruthy();
        expect(probe.frameP95).toBeGreaterThan(0);
        expect(probe.updateAvg).toBeGreaterThan(0);
        expect(probe.cameraAvg).toBeGreaterThan(0);
        expect(probe.hasRecorderDiagnostics).toBeTruthy();
    });

    test('T20ah1: RuntimePerfProfiler sammelt Spikes ohne Console-Warnstorm per Default', async ({ page }) => {
        await loadGame(page);
        const probe = await page.evaluate(async () => {
            const { RuntimePerfProfiler } = await window.__curviosImport('/src/core/perf/RuntimePerfProfiler.js');
            const warnings = [];
            const originalWarn = console.warn;
            console.warn = (...args) => warnings.push(args.map((entry) => String(entry)).join(' '));
            try {
                const profiler = new RuntimePerfProfiler({
                    spikeThresholdMs: 30,
                    spikeLogLimit: 8,
                });
                profiler.beginFrame(42, 1000);
                profiler.recordSubsystemDuration('render', 3.5);
                profiler.endFrame(42, 1042);
                profiler.beginFrame(46, 1060);
                profiler.recordSubsystemDuration('update', 1.8);
                profiler.endFrame(46, 1106);
                const snapshot = profiler.getSnapshot({ windowSize: 2 });
                return {
                    warningCount: warnings.length,
                    spikeTotal: Number(snapshot?.spikes?.total || 0),
                    recentSpikeCount: Number(snapshot?.spikes?.recent || 0),
                    frameP99: Number(snapshot?.frameMs?.p99 || snapshot?.performance?.frameMs?.p99 || 0),
                };
            } finally {
                console.warn = originalWarn;
            }
        });

        expect(probe.warningCount).toBe(0);
        expect(probe.spikeTotal).toBe(2);
        expect(probe.recentSpikeCount).toBe(2);
        expect(probe.frameP99).toBeGreaterThanOrEqual(42);
    });

    test('T20ai: GameLoop resettet den gemeinsamen Render-Delta-Pfad bei Fokuswechsel sauber', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { GameLoop } = await window.__curviosImport('/src/core/GameLoop.js');
            const originalRaf = window.requestAnimationFrame;
            const originalCancel = window.cancelAnimationFrame;
            const updates = [];
            try {
                window.requestAnimationFrame = () => 1;
                window.cancelAnimationFrame = () => { };
                const loop = new GameLoop((dt) => updates.push(dt), () => { });
                loop.running = true;
                loop.lastTime = 100;
                loop.requestDeltaReset('window-focus');
                loop._loop(110);
                const firstTiming = { ...loop.getRenderTiming() };
                const updatesAfterReset = updates.length;
                loop._loop(120);
                const secondTiming = { ...loop.getRenderTiming() };
                return {
                    fixedStep: loop.fixedStep,
                    updatesAfterReset,
                    totalUpdates: updates.length,
                    firstTiming,
                    secondTiming,
                };
            } finally {
                window.requestAnimationFrame = originalRaf;
                window.cancelAnimationFrame = originalCancel;
            }
        });

        expect(result.updatesAfterReset).toBe(1);
        expect(result.totalUpdates).toBe(1);
        expect(result.firstTiming.reset).toBeTruthy();
        expect(String(result.firstTiming.resetReason || '')).toContain('window-focus');
        expect(Math.abs(result.firstTiming.stabilizedDt - result.fixedStep)).toBeLessThan(0.000001);
        expect(result.secondTiming.reset).toBeFalsy();
    });

    test('T20ai1: Cinematic-Toggle resettet Kamera-Smoothing und fordert Delta-Reset an', async ({ page }) => {
        await startGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const rig = game?.renderer?.cameraRigSystem;
            if (!game || !rig) {
                return { error: 'missing-runtime' };
            }

            rig.cameraDtSmoothing[0] = 0.05;
            rig.cameraBoostBlend[0] = 0.75;
            rig.cinematicCameraSystem._blendByPlayer[0] = 0.8;
            rig.cinematicCameraSystem._timeByPlayer[0] = 3.2;

            const beforeEnabled = game.renderer.getCinematicEnabled();
            game._toggleCinematicCameraFromGlobalHotkey();

            return {
                error: null,
                beforeEnabled,
                afterEnabled: game.renderer.getCinematicEnabled(),
                pendingDeltaReset: game.gameLoop?._pendingDeltaReset === true,
                pendingDeltaResetReason: String(game.gameLoop?._pendingDeltaResetReason || ''),
                smoothedDt: Number(rig.cameraDtSmoothing[0] || 0),
                boostBlend: Number(rig.cameraBoostBlend[0] || 0),
                cinematicBlend: Number(rig.cinematicCameraSystem.getPlayerBlend(0) || 0),
                cinematicTime: Number(rig.cinematicCameraSystem._timeByPlayer[0] || 0),
                frameTimingReset: rig._frameTiming?.reset === true,
                frameTimingReason: String(rig._frameTiming?.reason || ''),
            };
        });

        expect(result.error).toBeNull();
        expect(result.afterEnabled).toBe(!result.beforeEnabled);
        expect(result.pendingDeltaReset).toBeTruthy();
        expect(result.pendingDeltaResetReason).toContain('cinematic-toggle');
        expect(Math.abs(result.smoothedDt - (1 / 60))).toBeLessThan(0.000001);
        expect(result.boostBlend).toBe(0);
        expect(result.cinematicBlend).toBe(0);
        expect(result.cinematicTime).toBe(0);
        expect(result.frameTimingReset).toBeTruthy();
        expect(result.frameTimingReason).toBe('cinematic-toggle');
    });

    test('T20ai2: Kamera-Update nutzt gerenderte Transforms und spart Anchor-Arbeit ausserhalb First-Person', async ({ page }) => {
        await startGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.humanPlayers?.[0];
            if (!game || !entityManager || !player) {
                return { error: 'missing-runtime' };
            }

            const modes = Array.isArray(game?.config?.CAMERA?.MODES)
                ? game.config.CAMERA.MODES
                : ['THIRD_PERSON', 'FIRST_PERSON', 'TOP_DOWN'];
            const thirdPersonIndex = Math.max(0, modes.indexOf('THIRD_PERSON'));
            const firstPersonIndex = Math.max(0, modes.indexOf('FIRST_PERSON'));

            const originalResolve = player.resolveRenderTransform.bind(player);
            const originalAnchor = player.getFirstPersonCameraAnchor.bind(player);
            let resolveCalls = 0;
            let anchorCalls = 0;

            player.resolveRenderTransform = (...args) => {
                resolveCalls += 1;
                return originalResolve(...args);
            };
            player.getFirstPersonCameraAnchor = (...args) => {
                anchorCalls += 1;
                return originalAnchor(...args);
            };

            try {
                entityManager.renderInterpolatedTransforms(0.35);
                const resolveAfterRender = resolveCalls;

                game.renderer.cameraModes[player.index] = thirdPersonIndex;
                entityManager.updateCameras(1 / 60, 0.35, true);
                const thirdPersonResolveDelta = resolveCalls - resolveAfterRender;
                const thirdPersonAnchorDelta = anchorCalls;

                entityManager.renderInterpolatedTransforms(0.6);
                const resolveBeforeFirstPersonCamera = resolveCalls;
                const anchorBeforeFirstPersonCamera = anchorCalls;
                game.renderer.cameraModes[player.index] = firstPersonIndex;
                entityManager.updateCameras(1 / 60, 0.6, true);

                return {
                    error: null,
                    resolveAfterRender,
                    thirdPersonResolveDelta,
                    thirdPersonAnchorDelta,
                    firstPersonResolveDelta: resolveCalls - resolveBeforeFirstPersonCamera,
                    firstPersonAnchorDelta: anchorCalls - anchorBeforeFirstPersonCamera,
                };
            } finally {
                player.resolveRenderTransform = originalResolve;
                player.getFirstPersonCameraAnchor = originalAnchor;
            }
        });

        expect(result.error).toBeNull();
        expect(result.resolveAfterRender).toBeGreaterThan(0);
        expect(result.thirdPersonResolveDelta).toBe(0);
        expect(result.thirdPersonAnchorDelta).toBeLessThanOrEqual(1);
        expect(result.firstPersonResolveDelta).toBe(0);
        expect(result.firstPersonAnchorDelta).toBeGreaterThanOrEqual(1);
    });

    test('T20ai4: Third-Person-Cinematic nutzt smoothes Boost-Blend und speed-basierten Sway', async ({ page }) => {
        await startGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const rig = game?.renderer?.cameraRigSystem;
            const cinematic = rig?.cinematicCameraSystem;
            const target = rig?.cameraTargets?.[0];
            if (!game || !rig || !cinematic || !target?.position || !target?.lookAt) {
                return { error: 'missing-runtime' };
            }

            const previousLivePerspectiveEnabled = rig.livePerspectiveEnabled;
            const modes = Array.isArray(game?.config?.CAMERA?.MODES)
                ? game.config.CAMERA.MODES
                : ['THIRD_PERSON', 'FIRST_PERSON', 'TOP_DOWN'];
            const thirdPersonIndex = Math.max(0, modes.indexOf('THIRD_PERSON'));
            const playerPosition = target.position.clone().set(0, 0, 0);
            const playerDirection = target.lookAt.clone().set(0, 0, -1);

            const runScenario = ({ speed, isBoosting }) => {
                cinematic.reset();
                rig.cameraBoostBlend[0] = 0;
                target.position.set(0, 0, 0);
                target.lookAt.set(0, 0, -1);

                let maxSway = 0;
                let maxBoostBlend = 0;
                let finalLookAhead = 0;

                for (let i = 0; i < 90; i++) {
                    rig.updateCamera(
                        0,
                        playerPosition,
                        playerDirection,
                        1 / 60,
                        null,
                        false,
                        isBoosting,
                        null,
                        null,
                        { playerState: { speed } }
                    );
                    maxSway = Math.max(maxSway, Math.abs(Number(target.position.x) || 0));
                    maxBoostBlend = Math.max(maxBoostBlend, Number(rig.cameraBoostBlend[0] || 0));
                    finalLookAhead = target.lookAt.distanceTo(playerPosition);
                }

                return {
                    maxSway,
                    maxBoostBlend,
                    finalLookAhead,
                };
            };

            try {
                rig.livePerspectiveEnabled = false;
                rig.cameraModes[0] = thirdPersonIndex;

                const lowSpeed = runScenario({ speed: 0, isBoosting: false });
                const cruiseSpeed = runScenario({ speed: cinematic.referenceSpeed || 18, isBoosting: false });
                const boosted = runScenario({ speed: cinematic.referenceSpeed || 18, isBoosting: true });

                return {
                    error: null,
                    lowSpeed,
                    cruiseSpeed,
                    boosted,
                };
            } finally {
                rig.livePerspectiveEnabled = previousLivePerspectiveEnabled;
            }
        });

        expect(result.error).toBeNull();
        expect(result.cruiseSpeed.maxSway).toBeGreaterThan(result.lowSpeed.maxSway * 4);
        expect(result.boosted.maxBoostBlend).toBeGreaterThan(0.5);
        expect(result.boosted.maxSway).toBeLessThan(result.cruiseSpeed.maxSway * 0.7);
        expect(result.boosted.finalLookAhead).toBeGreaterThan(result.cruiseSpeed.finalLookAhead);
    });

    test('T20ai3: Third-Person-Fadenkreuz bleibt nach Match-Neustart sichtbar', async ({ page }) => {
        await startGame(page);
        await returnToMenu(page);
        await openGameSubmenu(page);
        await page.evaluate(() => {
            window.GAME_INSTANCE?.startMatch?.();
        });
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const game = window.GAME_INSTANCE;
            return !!(
                hud && !hud.classList.contains('hidden')
                && game?.entityManager?.players?.length > 0
            );
        }, null, { timeout: 60000 });

        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const player = game?.entityManager?.players?.[0];
            const crosshair = document.getElementById('crosshair-p1');
            if (!game || !player || !crosshair) {
                return { error: 'missing-runtime' };
            }
            const shouldShow = game?.crosshairSystem?._shouldShowScreenCrosshair?.(player, game?.config) ?? null;
            return {
                error: null,
                rendererMode: game.renderer.getCameraMode?.(0),
                playerMode: game.config?.CAMERA?.MODES?.[player.cameraMode] || null,
                display: getComputedStyle(crosshair).display,
                shouldShow: typeof shouldShow === 'boolean' ? shouldShow : null,
            };
        });

        expect(result.error).toBeNull();
        expect(['THIRD_PERSON', 'FIRST_PERSON']).toContain(String(result.rendererMode || ''));
        expect(['THIRD_PERSON', 'FIRST_PERSON']).toContain(String(result.playerMode || ''));
        expect(result.shouldShow).not.toBeNull();
        expect(result.display === 'block').toBe(result.shouldShow);
    });

    test('T20aj: Recorder-Backpressure trimmt Capture-Backlog und blockiert den Loop nicht', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            let now = 0;
            const recorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                autoDownload: false,
                globalScope: {},
            });
            recorder._perfNow = () => now;
            recorder._isRecording = true;
            recorder._activeRecorderEngine = 'mediarecorder-native';
            recorder._mediaRecorderSupportsRequestFrame = false;
            recorder._captureLevelIndex = 1;

            const capturedSteps = [];
            recorder._captureMediaRecorderFrame = (stepIntervalMs) => {
                recorder._captureTimestampUs += Math.max(1, Math.round(stepIntervalMs * 1000));
                recorder._frameCount += 1;
                recorder._captureEncodedFrames += 1;
                recorder._recordCaptureTimestampUs(recorder._captureTimestampUs);
                capturedSteps.push(stepIntervalMs);
            };

            const renderDeltasMs = [34, 34, 34, 90, 34, 34, 90, 34, 34, 90, 34, 34];
            for (let i = 0; i < renderDeltasMs.length; i++) {
                now += renderDeltasMs[i];
                recorder.captureRenderedFrame(renderDeltasMs[i] / 1000);
            }

            return {
                capturedCount: capturedSteps.length,
                diagnostics: recorder.getRecordingDiagnostics(),
                accumulatorMs: recorder._captureAccumulatorMs,
            };
        });

        expect(result.capturedCount).toBeGreaterThan(0);
        expect(result.capturedCount).toBeLessThan(12);
        expect(result.diagnostics.backpressureEvents).toBeGreaterThan(0);
        expect(result.diagnostics.captureLevel).toBeGreaterThan(1);
        expect(result.diagnostics.droppedFrames).toBeGreaterThan(0);
        expect(result.accumulatorMs).toBeLessThan(150);
    });

    test('T20aj1: Recorder berechnet Frame-Interval-Stats lazy und cached sie zwischen Diagnostics-Aufrufen', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            let now = 0;
            const recorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                autoDownload: false,
                globalScope: {},
            });
            recorder._perfNow = () => now;
            recorder._isRecording = true;
            recorder._activeRecorderEngine = 'mediarecorder-native';
            recorder._mediaRecorderSupportsRequestFrame = true;
            recorder._mediaRecorderVideoTrack = { requestFrame() { } };

            let computeCalls = 0;
            const originalCompute = recorder._computeFrameIntervalStats.bind(recorder);
            recorder._computeFrameIntervalStats = () => {
                computeCalls += 1;
                return originalCompute();
            };
            recorder._captureMediaRecorderFrame = (stepIntervalMs) => {
                recorder._captureTimestampUs += Math.max(1, Math.round(stepIntervalMs * 1000));
                recorder._frameCount += 1;
                recorder._captureEncodedFrames += 1;
                recorder._recordCaptureTimestampUs(recorder._captureTimestampUs);
            };

            for (let i = 0; i < 5; i++) {
                now += 20;
                recorder.captureRenderedFrame(0.02);
            }

            const callsBeforeDiagnostics = computeCalls;
            const firstDiagnostics = recorder.getRecordingDiagnostics();
            const callsAfterFirstDiagnostics = computeCalls;
            const secondDiagnostics = recorder.getRecordingDiagnostics();
            const callsAfterSecondDiagnostics = computeCalls;

            return {
                callsBeforeDiagnostics,
                callsAfterFirstDiagnostics,
                callsAfterSecondDiagnostics,
                firstSampleCount: Number(firstDiagnostics?.frameIntervalStats?.sampleCount || 0),
                secondSampleCount: Number(secondDiagnostics?.frameIntervalStats?.sampleCount || 0),
            };
        });

        expect(result.callsBeforeDiagnostics).toBe(0);
        expect(result.callsAfterFirstDiagnostics).toBe(1);
        expect(result.callsAfterSecondDiagnostics).toBe(1);
        expect(result.firstSampleCount).toBeGreaterThan(0);
        expect(result.secondSampleCount).toBe(result.firstSampleCount);
    });

    test('T20aj1a: Recorder behaelt reale Dauer trotz Backlog-Trim bei langen Render-Luecken', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            let now = 0;
            const recorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                autoDownload: false,
                captureFps: 30,
                globalScope: {},
            });
            recorder._perfNow = () => now;
            recorder._isRecording = true;
            recorder._activeRecorderEngine = 'mediarecorder-native';
            recorder._mediaRecorderSupportsRequestFrame = true;
            recorder._mediaRecorderVideoTrack = {
                requestFrame() { },
            };

            const renderDeltasMs = [1000, 1000, 1000, 1000];
            for (let i = 0; i < renderDeltasMs.length; i++) {
                now += renderDeltasMs[i];
                recorder.captureRenderedFrame(renderDeltasMs[i] / 1000);
            }

            return {
                captureTimestampUs: recorder._captureTimestampUs,
                encodedFrames: recorder._captureEncodedFrames,
                diagnostics: recorder.getRecordingDiagnostics(),
            };
        });

        expect(result.encodedFrames).toBeGreaterThanOrEqual(3);
        expect(result.captureTimestampUs).toBeGreaterThanOrEqual(2_900_000);
        expect(result.diagnostics.frameIntervalStats?.mean || 0).toBeGreaterThan(900);
    });

    test('T20aj1b: Cinematic-WebCodecs nutzt Capture-Aufloesung statt festem 720p-Downscale', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const { RECORDING_CINEMATIC_QUALITY_PROFILE } = await window.__curviosImport('/src/shared/contracts/RecordingCaptureContract.js');
            const captureCanvas = { width: 1920, height: 1080 };
            const recorder = new MediaRecorderSystem({
                canvas: captureCanvas,
                autoDownload: false,
                captureSourceResolver: () => captureCanvas,
                recordingCaptureSettings: {
                    profile: 'cinematic',
                    hudMode: 'clean',
                },
                globalScope: {},
            });

            const dimensions = recorder._resolveRecordingDimensions();
            const bitrate = recorder._resolveRecordingBitrate(dimensions.width, dimensions.height);
            recorder.dispose();
            return {
                dimensions,
                bitrate,
                expectedBitrate1080p: Number(RECORDING_CINEMATIC_QUALITY_PROFILE?.bitrate1080p || 0),
            };
        });

        expect(result.dimensions).toEqual({ width: 1920, height: 1080 });
        expect(result.bitrate).toBe(result.expectedBitrate1080p);
    });

    test('T20aj1c: Cinematic-Recording behaelt volle Capture-Aufloesung auch unter Lastregelung', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const captureCanvas = { width: 1920, height: 1080 };
            const recorder = new MediaRecorderSystem({
                canvas: captureCanvas,
                autoDownload: false,
                captureSourceResolver: () => captureCanvas,
                recordingCaptureSettings: {
                    profile: 'cinematic',
                    hudMode: 'clean',
                },
                globalScope: {},
            });
            recorder._isRecording = true;
            recorder._activeRecorderEngine = 'webcodecs-native';
            recorder._captureLevelIndex = 5;
            const diagnostics = recorder.getRecordingDiagnostics();
            recorder.dispose();
            return diagnostics;
        });

        expect(result.captureLevel).toBe(5);
        expect(result.captureResolutionScale).toBe(1);
        expect(result.captureSourceWidth).toBe(1920);
        expect(result.captureSourceHeight).toBe(1080);
    });

    test('T20aj1d: Cinematic-Capture orientiert sich an der sichtbaren Viewport-Groesse statt am gedrosselten Backbuffer', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { RecordingCapturePipeline } = await window.__curviosImport('/src/core/renderer/RecordingCapturePipeline.js');
            const { RECORDING_CINEMATIC_QUALITY_PROFILE } = await window.__curviosImport('/src/shared/contracts/RecordingCaptureContract.js');
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = 640;
            sourceCanvas.height = 360;
            sourceCanvas.style.width = '1280px';
            sourceCanvas.style.height = '720px';
            sourceCanvas.style.position = 'fixed';
            sourceCanvas.style.left = '-9999px';
            sourceCanvas.style.top = '0';
            document.body.appendChild(sourceCanvas);

            const pipeline = new RecordingCapturePipeline({
                sourceCanvas,
                sourceRenderer: null,
                scene: null,
            });
            pipeline.setSettings({
                profile: 'cinematic',
                hudMode: 'clean',
            });
            const captureCanvas = pipeline.getCaptureCanvas();
            const supersampleScale = Number(RECORDING_CINEMATIC_QUALITY_PROFILE?.supersampleScale || 1);
            const maxWidth = Math.max(2, Math.floor(Number(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxWidth || 1920)));
            const maxHeight = Math.max(2, Math.floor(Number(RECORDING_CINEMATIC_QUALITY_PROFILE?.maxHeight || 1080)));
            const expectedWidth = Math.max(2, Math.floor(Math.min(maxWidth, sourceCanvas.clientWidth * supersampleScale)));
            const expectedHeight = Math.max(2, Math.floor(Math.min(maxHeight, sourceCanvas.clientHeight * supersampleScale)));
            const snapshot = {
                sourceWidth: sourceCanvas.width,
                sourceHeight: sourceCanvas.height,
                clientWidth: sourceCanvas.clientWidth,
                clientHeight: sourceCanvas.clientHeight,
                captureWidth: captureCanvas?.width || 0,
                captureHeight: captureCanvas?.height || 0,
                expectedWidth: expectedWidth - (expectedWidth % 2),
                expectedHeight: expectedHeight - (expectedHeight % 2),
            };
            pipeline.dispose();
            sourceCanvas.remove();
            return snapshot;
        });

        expect(result.sourceWidth).toBe(640);
        expect(result.sourceHeight).toBe(360);
        expect(result.clientWidth).toBe(1280);
        expect(result.clientHeight).toBe(720);
        expect(result.captureWidth).toBe(result.expectedWidth);
        expect(result.captureHeight).toBe(result.expectedHeight);
    });

    test('T20aj1d1: Render-Quality-Lock haelt Cinematic-Aufnahme auf HIGH trotz LOW-Anforderung', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(() => {
            const renderer = window.GAME_INSTANCE?.renderer;
            if (
                !renderer
                || typeof renderer.setQuality !== 'function'
                || typeof renderer.setRecordingQualityLock !== 'function'
                || typeof renderer.getQualityState !== 'function'
            ) {
                return null;
            }

            renderer.setQuality('LOW');
            const beforeLock = renderer.getQualityState();

            renderer.setRecordingQualityLock(true, 'cinematic-recording-test');
            renderer.setQuality('LOW');
            const duringLock = renderer.getQualityState();

            renderer.setRecordingQualityLock(false, 'cinematic-recording-test');
            const afterUnlock = renderer.getQualityState();

            renderer.setQuality('HIGH');

            return {
                beforeLock,
                duringLock,
                afterUnlock,
            };
        });

        expect(result).not.toBeNull();
        expect(result.beforeLock.effectiveQuality).toBe('LOW');
        expect(result.duringLock.effectiveQuality).toBe('HIGH');
        expect(result.duringLock.qualityLockActive).toBeTruthy();
        expect(result.afterUnlock.effectiveQuality).toBe('LOW');
    });

    test('T20aj1e: Cinematic-Orbit-Shots weichen vor Arena-Kollisionen zurueck', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { RecordingOrbitCameraDirector } = await window.__curviosImport('/src/core/renderer/camera/RecordingOrbitCameraDirector.js');
            const game = window.GAME_INSTANCE;
            const baseCamera = game?.renderer?.cameras?.[0] || null;
            const Vector3 = baseCamera?.position?.constructor || null;
            if (!baseCamera?.clone || !Vector3) {
                return null;
            }

            const camera = baseCamera.clone();
            camera.position.set(0, 0, 0);
            camera.fov = 75;
            const director = new RecordingOrbitCameraDirector();
            const playerPosition = new Vector3(0, 0, 0);
            const playerDirection = new Vector3(0, 0, -1);
            const arena = {
                bounds: {
                    min: new Vector3(-50, -50, -50),
                    max: new Vector3(50, 50, 50),
                },
                checkCollision(position, radius = 0) {
                    return position.z >= (3 - radius);
                },
            };

            director.apply({
                playerIndex: 0,
                camera,
                fallbackTarget: { lookAt: new Vector3(0, 0, -6) },
                playerPosition,
                playerDirection,
                dt: 1,
                arena,
                slotStyle: 'cinematic',
                baseFov: 75,
            });

            return {
                z: Number(camera.position.z || 0),
            };
        });

        expect(result).not.toBeNull();
        expect(result.z).toBeLessThan(3.1);
    });

    test('T20aj1f: Desktop-App bevorzugt fuer Recording MediaRecorder mit WebM statt WebCodecs-MP4', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const MediaRecorderCtor = function MediaRecorder() {};
            MediaRecorderCtor.isTypeSupported = (mimeType) => String(mimeType || '').includes('webm');
            const recorder = new MediaRecorderSystem({
                canvas: {
                    width: 1280,
                    height: 720,
                    captureStream() {
                        return {};
                    },
                },
                autoDownload: false,
                globalScope: {
                    __CURVIOS_APP__: true,
                    curviosApp: { isApp: true },
                    VideoEncoder: class VideoEncoder {
                        static async isConfigSupported() {
                            return { supported: true };
                        }
                    },
                    VideoFrame: class VideoFrame {},
                    MediaRecorder: MediaRecorderCtor,
                },
            });
            const support = recorder.getSupportState();
            recorder.dispose();
            return support;
        });

        expect(result.recorderEngine).toBe('mediarecorder-native');
        expect(result.selectedMimeType).toContain('webm');
        expect(result.supportReason).toBe('desktop-prefer-mediarecorder');
    });

    test('T20aj1g: Desktop-App speichert Recording-Blobs direkt ueber die App-Bridge', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { attemptAutoDownload } = await window.__curviosImport('/src/core/recording/DownloadService.js');
            const originalApp = globalThis.curviosApp;
            const originalFetch = globalThis.fetch;
            let appSaveCalls = 0;
            globalThis.curviosApp = {
                saveVideo: async (videoBytes, defaultName, mimeType) => {
                    appSaveCalls += 1;
                    return {
                        saved: videoBytes instanceof Uint8Array
                            && videoBytes.length === 4
                            && defaultName === 'clip.webm'
                            && mimeType === 'video/webm',
                    };
                },
            };
            globalThis.fetch = async () => {
                throw new Error('fetch should not run when app save succeeds');
            };

            try {
                const status = await attemptAutoDownload({
                    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/webm' }),
                    fileName: 'recordings/clip.webm',
                    mimeType: 'video/webm',
                    autoDownload: true,
                    downloadHandler: () => {
                        throw new Error('browser download fallback should not run');
                    },
                    logger: null,
                });
                return {
                    appSaveCalls,
                    status,
                };
            } finally {
                globalThis.curviosApp = originalApp;
                globalThis.fetch = originalFetch;
            }
        });

        expect(result.appSaveCalls).toBe(1);
        expect(result.status.transport).toBe('app');
        expect(result.status.status).toBe('saved_via_app');
        expect(result.status.message).toContain('Desktop-App');
    });

    test('T20aj2: Recorder priorisiert unter harter Last Downscale vor FPS-Kollaps', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            let now = 0;
            const recorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                autoDownload: false,
                captureFps: 30,
                globalScope: {},
            });
            recorder._perfNow = () => now;
            recorder._isRecording = true;
            recorder._activeRecorderEngine = 'mediarecorder-native';
            recorder._mediaRecorderSupportsRequestFrame = false;
            recorder._captureLevelIndex = 1;

            const renderDeltasMs = [34, 34, 90, 90, 90, 90, 90];
            for (let i = 0; i < renderDeltasMs.length; i++) {
                now += renderDeltasMs[i];
                recorder.captureRenderedFrame(renderDeltasMs[i] / 1000);
            }

            return recorder.getRecordingDiagnostics();
        });

        expect(result.captureLevel).toBeGreaterThan(1);
        expect(result.captureResolutionScale).toBeLessThanOrEqual(0.5);
        expect(result.effectiveCaptureFps).toBeGreaterThanOrEqual(18);
    });

    test('T20aj3: MediaRecorder-Stop erzwingt finalen Flush und exportiert keinen leeren Clip', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = 320;
            sourceCanvas.height = 180;
            const sourceCtx = sourceCanvas.getContext('2d');
            sourceCtx.fillStyle = '#ffffff';
            sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

            const captureFpsCalls = [];
            const fakeTrack = {
                requestFrameCalls: 0,
                stopCalls: 0,
                requestFrame() {
                    this.requestFrameCalls += 1;
                },
                stop() {
                    this.stopCalls += 1;
                },
            };
            const fakeStream = {
                getVideoTracks() {
                    return [fakeTrack];
                },
                getTracks() {
                    return [fakeTrack];
                },
            };
            const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;

            class FakeMediaRecorder {
                static lastInstance = null;
                static isTypeSupported() {
                    return true;
                }
                constructor(stream, options = undefined) {
                    this.stream = stream;
                    this.options = options;
                    this.state = 'inactive';
                    this.ondataavailable = null;
                    this.onerror = null;
                    this.onstop = null;
                    this.requestDataCalls = 0;
                    this.stopCalls = 0;
                    this.startTimeslice = null;
                    FakeMediaRecorder.lastInstance = this;
                }
                start(timeslice = 0) {
                    this.startTimeslice = timeslice;
                    this.state = 'recording';
                }
                requestData() {
                    this.requestDataCalls += 1;
                    const mimeType = this.options?.mimeType || 'video/webm';
                    this.ondataavailable?.({
                        data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: mimeType }),
                    });
                }
                stop() {
                    this.stopCalls += 1;
                    this.state = 'inactive';
                    Promise.resolve().then(() => {
                        this.onstop?.();
                    });
                }
            }

            HTMLCanvasElement.prototype.captureStream = function captureStreamStub(fps = 0) {
                captureFpsCalls.push(Number(fps));
                return fakeStream;
            };

            try {
                const recorder = new MediaRecorderSystem({
                    canvas: sourceCanvas,
                    autoDownload: false,
                    captureFps: 30,
                    globalScope: { MediaRecorder: FakeMediaRecorder },
                    capabilityProbe: () => ({
                        canCapture: true,
                        hasRecorder: true,
                        canRecord: true,
                        selectedMimeType: 'video/webm;codecs=vp9',
                        recorderEngine: 'mediarecorder-native',
                        supportReason: 'native-mediarecorder',
                    }),
                });

                const started = await recorder.startRecording({ type: 'manual-test' });
                const stopped = await recorder.stopRecording({ type: 'manual-test' });
                const exportMeta = recorder.getLastExportMeta();
                const recorderInstance = FakeMediaRecorder.lastInstance;
                recorder.dispose();

                return {
                    startStarted: !!started?.started,
                    stopStopped: !!stopped?.stopped,
                    captureFpsCalls,
                    requestDataCalls: Number(recorderInstance?.requestDataCalls || 0),
                    stopCalls: Number(recorderInstance?.stopCalls || 0),
                    requestFrameCalls: Number(fakeTrack.requestFrameCalls || 0),
                    exportSizeBytes: Number(exportMeta?.sizeBytes || 0),
                };
            } finally {
                HTMLCanvasElement.prototype.captureStream = originalCaptureStream;
            }
        });

        expect(result.startStarted).toBeTruthy();
        expect(result.stopStopped).toBeTruthy();
        expect(result.captureFpsCalls.length).toBeGreaterThan(0);
        expect(result.captureFpsCalls.includes(0)).toBeFalsy();
        expect(result.captureFpsCalls.every((fps) => fps === 30)).toBeTruthy();
        expect(result.requestDataCalls).toBe(1);
        expect(result.stopCalls).toBe(1);
        expect(result.requestFrameCalls).toBeGreaterThan(0);
        expect(result.exportSizeBytes).toBeGreaterThan(0);
    });

    test('T20aj4: Recorder nutzt NativeMediaRecorderEngine als Strategie und spiegelt Runtime-State', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = 320;
            sourceCanvas.height = 180;

            const fakeTrack = {
                requestFrame() { },
                stop() { },
            };
            const fakeStream = {
                getVideoTracks() {
                    return [fakeTrack];
                },
                getTracks() {
                    return [fakeTrack];
                },
            };
            const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;

            class FakeMediaRecorder {
                static isTypeSupported() {
                    return true;
                }
                constructor(stream, options = undefined) {
                    this.stream = stream;
                    this.options = options;
                    this.state = 'inactive';
                    this.ondataavailable = null;
                    this.onerror = null;
                    this.onstop = null;
                }
                start() {
                    this.state = 'recording';
                }
                requestData() {
                    const mimeType = this.options?.mimeType || 'video/webm';
                    this.ondataavailable?.({
                        data: new Blob([new Uint8Array([9, 8, 7])], { type: mimeType }),
                    });
                }
                stop() {
                    this.state = 'inactive';
                    Promise.resolve().then(() => {
                        this.onstop?.();
                    });
                }
            }

            HTMLCanvasElement.prototype.captureStream = function captureStreamStub() {
                return fakeStream;
            };

            try {
                const recorder = new MediaRecorderSystem({
                    canvas: sourceCanvas,
                    autoDownload: false,
                    captureFps: 30,
                    globalScope: { MediaRecorder: FakeMediaRecorder },
                    capabilityProbe: () => ({
                        canCapture: true,
                        hasRecorder: true,
                        canRecord: true,
                        mediaRecorderMimeType: 'video/webm;codecs=vp9',
                        selectedMimeType: 'video/webm;codecs=vp9',
                        recorderEngine: 'mediarecorder-native',
                        supportReason: 'native-mediarecorder',
                    }),
                });

                const started = await recorder.startRecording({ type: 'strategy-test' });
                const runtimeState = recorder._activeRecorderStrategy?.getRuntimeState?.() || null;
                const strategySnapshot = {
                    started: !!started?.started,
                    strategyName: recorder._activeRecorderStrategy?.constructor?.name || null,
                    mirroredRecorder: recorder._mediaRecorder === runtimeState?.mediaRecorder,
                    mirroredTrack: recorder._mediaRecorderVideoTrack === runtimeState?.mediaRecorderVideoTrack,
                    requestFrameSupported: recorder._mediaRecorderSupportsRequestFrame,
                };
                const stopped = await recorder.stopRecording({ type: 'strategy-stop' });
                recorder.dispose();
                return {
                    ...strategySnapshot,
                    stopped: !!stopped?.stopped,
                };
            } finally {
                HTMLCanvasElement.prototype.captureStream = originalCaptureStream;
            }
        });

        expect(result.started).toBeTruthy();
        expect(result.strategyName).toBe('NativeMediaRecorderEngine');
        expect(result.mirroredRecorder).toBeTruthy();
        expect(result.mirroredTrack).toBeTruthy();
        expect(result.requestFrameSupported).toBeTruthy();
        expect(result.stopped).toBeTruthy();
    });

    test('T20aj4a: Recorder settleRecording teilt Pending-Stop mit Dispose und orphaned keinen Stop-Promise', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = 320;
            sourceCanvas.height = 180;

            const fakeTrack = {
                requestFrame() { },
                stop() { },
            };
            const fakeStream = {
                getVideoTracks() {
                    return [fakeTrack];
                },
                getTracks() {
                    return [fakeTrack];
                },
            };
            const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;

            class FakeMediaRecorder {
                static lastInstance = null;
                static isTypeSupported() {
                    return true;
                }
                constructor(stream, options = undefined) {
                    this.stream = stream;
                    this.options = options;
                    this.state = 'inactive';
                    this.ondataavailable = null;
                    this.onerror = null;
                    this.onstop = null;
                    this.requestDataCalls = 0;
                    this.stopCalls = 0;
                    FakeMediaRecorder.lastInstance = this;
                }
                start() {
                    this.state = 'recording';
                }
                requestData() {
                    this.requestDataCalls += 1;
                    const mimeType = this.options?.mimeType || 'video/webm';
                    this.ondataavailable?.({
                        data: new Blob([new Uint8Array([4, 5, 6])], { type: mimeType }),
                    });
                }
                stop() {
                    this.stopCalls += 1;
                    this.state = 'inactive';
                    Promise.resolve().then(() => {
                        this.onstop?.();
                    });
                }
            }

            HTMLCanvasElement.prototype.captureStream = function captureStreamStub() {
                return fakeStream;
            };

            try {
                const recorder = new MediaRecorderSystem({
                    canvas: sourceCanvas,
                    autoDownload: false,
                    captureFps: 30,
                    globalScope: { MediaRecorder: FakeMediaRecorder },
                    capabilityProbe: () => ({
                        canCapture: true,
                        hasRecorder: true,
                        canRecord: true,
                        selectedMimeType: 'video/webm;codecs=vp9',
                        recorderEngine: 'mediarecorder-native',
                        supportReason: 'native-mediarecorder',
                    }),
                });

                const started = await recorder.startRecording({ type: 'settle-test' });
                const stopPromise = recorder.stopRecording({ type: 'settle-stop' });
                const settlePromise = recorder.settleRecording({ type: 'settle-recording' });
                recorder.dispose();

                const [stopped, settled] = await Promise.all([stopPromise, settlePromise]);
                await new Promise((resolve) => setTimeout(resolve, 0));

                return {
                    started: !!started?.started,
                    stopStopped: !!stopped?.stopped,
                    settleStopped: !!settled?.stopped,
                    sameStopReason: stopped?.reason === settled?.reason,
                    stopCalls: Number(FakeMediaRecorder.lastInstance?.stopCalls || 0),
                    requestDataCalls: Number(FakeMediaRecorder.lastInstance?.requestDataCalls || 0),
                    pendingStopCleared: recorder._pendingStop === null,
                    stillRecording: recorder.isRecording(),
                };
            } finally {
                HTMLCanvasElement.prototype.captureStream = originalCaptureStream;
            }
        });

        expect(result.started).toBeTruthy();
        expect(result.stopStopped).toBeTruthy();
        expect(result.settleStopped).toBeTruthy();
        expect(result.sameStopReason).toBeTruthy();
        expect(result.stopCalls).toBe(1);
        expect(result.requestDataCalls).toBe(1);
        expect(result.pendingStopCleared).toBeTruthy();
        expect(result.stillRecording).toBeFalsy();
    });

    test('T20aj5: WebCodecs-Stop finalisiert Partial-Buffer wenn flush haengt', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(async () => {
            const { WebCodecsRecorderEngine } = await window.__curviosImport('/src/core/recording/engines/WebCodecsRecorderEngine.js');
            const engine = new WebCodecsRecorderEngine({ globalScope: {} });
            let resetCalls = 0;
            let closeCalls = 0;
            let finalizeCalls = 0;

            engine._muxer = {
                finalize() {
                    finalizeCalls += 1;
                },
                target: {
                    buffer: new ArrayBuffer(8),
                },
            };
            engine._videoEncoder = {
                state: 'configured',
                encodeQueueSize: 9,
                flush() {
                    return new Promise(() => { });
                },
                reset() {
                    resetCalls += 1;
                    this.state = 'unconfigured';
                },
                close() {
                    closeCalls += 1;
                    this.state = 'closed';
                },
            };

            const startedAt = performance.now();
            const stopResult = await engine.stop();
            const elapsedMs = performance.now() - startedAt;

            return {
                elapsedMs,
                resetCalls,
                closeCalls,
                finalizeCalls,
                stopResult: {
                    ok: !!stopResult?.ok,
                    mimeType: stopResult?.mimeType || null,
                    bufferSize: Number(stopResult?.bufferSize || 0),
                    blobSize: stopResult?.blob instanceof Blob ? stopResult.blob.size : 0,
                    partial: stopResult?.partial === true,
                    partialReason: stopResult?.partialReason || null,
                },
            };
        });

        expect(result.elapsedMs).toBeLessThan(5000);
        expect(result.resetCalls).toBe(1);
        expect(result.finalizeCalls).toBe(1);
        expect(result.closeCalls).toBeLessThanOrEqual(1);
        expect(result.stopResult.ok).toBeTruthy();
        expect(result.stopResult.mimeType).toBe('video/mp4');
        expect(result.stopResult.bufferSize).toBe(8);
        expect(result.stopResult.blobSize).toBe(8);
        expect(result.stopResult.partial).toBeTruthy();
        expect(result.stopResult.partialReason).toBe('flush_timeout');
    });

    test('T20aj5b: WebCodecs-Stop liest Muxer-Buffer aus getBuffer-Fallback', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { WebCodecsRecorderEngine } = await window.__curviosImport('/src/core/recording/engines/WebCodecsRecorderEngine.js');
            const engine = new WebCodecsRecorderEngine({ globalScope: {} });
            let finalizeCalls = 0;
            let getBufferCalls = 0;

            engine._muxer = {
                finalize() {
                    finalizeCalls += 1;
                },
                target: {
                    getBuffer() {
                        getBufferCalls += 1;
                        return new ArrayBuffer(12);
                    },
                },
            };

            const stopResult = await engine.stop();
            return {
                ok: !!stopResult?.ok,
                bufferSize: Number(stopResult?.bufferSize || 0),
                blobSize: stopResult?.blob instanceof Blob ? stopResult.blob.size : 0,
                finalizeCalls,
                getBufferCalls,
            };
        });

        expect(result.ok).toBeTruthy();
        expect(result.bufferSize).toBe(12);
        expect(result.blobSize).toBe(12);
        expect(result.finalizeCalls).toBe(1);
        expect(result.getBufferCalls).toBe(1);
    });

    test('T20ak: Recorder normalisiert Export-Zeitstempel bei fehlerhafter Stop-Reihenfolge', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            let now = 4900;
            const recorder = new MediaRecorderSystem({
                canvas: { width: 320, height: 180 },
                autoDownload: false,
                now: () => now,
                globalScope: {},
            });
            recorder._isRecording = true;
            recorder._activeMimeType = 'video/webm';
            recorder._activeRecorderEngine = 'mediarecorder-native';
            recorder._activeRecording = {
                startedAt: 5000,
                trigger: {
                    context: {
                        activeGameMode: 'classic',
                        sessionId: 'phase9',
                    },
                },
                stopResolve: () => { },
            };
            recorder._lastFrameIntervalStats = {
                sampleCount: 3,
                mean: 40,
                p95: 45,
                p99: 48,
                max: 48,
            };
            await recorder._finalizeBlobExport(new Blob(['clip'], { type: 'video/webm' }), 'video/webm');
            const exportMeta = recorder.getLastExportMeta();
            recorder.dispose();
            return exportMeta;
        });

        expect(result).toBeTruthy();
        expect(result.endedAt).toBeGreaterThanOrEqual(result.startedAt);
        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.timestampValidation?.adjusted).toBeTruthy();
        expect(String(result.fileName || '')).not.toContain('invalid-date');
    });

    test('T20ak1: Recorder-Export blockiert Browser-Demo-Fallbacks ohne echten Demo-Wert frueh', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { MediaRecorderSystem } = await window.__curviosImport('/src/core/MediaRecorderSystem.js');
            const originalFetch = globalThis.fetch;
            let fetchCalls = 0;
            let downloadCalls = 0;
            let stopResolveAt = 0;
            let stopResult = null;

            globalThis.fetch = async () => {
                fetchCalls += 1;
                await new Promise((resolve) => setTimeout(resolve, 15));
                return {
                    ok: false,
                    status: 500,
                };
            };

            try {
                const recorder = new MediaRecorderSystem({
                    canvas: { width: 320, height: 180 },
                    autoDownload: true,
                    now: () => Date.now(),
                    globalScope: {},
                    downloadHandler: () => {
                        downloadCalls += 1;
                    },
                });
                recorder._isRecording = true;
                recorder._activeMimeType = 'video/webm';
                recorder._activeRecorderEngine = 'mediarecorder-native';
                recorder._activeRecording = {
                    startedAt: Date.now() - 120,
                    trigger: { type: 'qa' },
                    stopResolve: (result) => {
                        stopResolveAt = Date.now();
                        stopResult = result;
                    },
                };

                const startedAt = Date.now();
                await recorder._finalizeBlobExport(new Blob(['clip'], { type: 'video/webm' }), 'video/webm');
                const elapsedUntilResolve = Math.max(0, stopResolveAt - startedAt);
                const exportMeta = recorder.getLastExportMeta();
                recorder.dispose();

                return {
                    fetchCalls,
                    downloadCalls,
                    elapsedUntilResolve,
                    exportStatus: exportMeta?.exportStatus || null,
                    stopResultExportStatus: stopResult?.exportStatus || null,
                    stopResultTransport: stopResult?.exportTransport || null,
                };
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        expect(result.fetchCalls).toBe(0);
        expect(result.downloadCalls).toBe(0);
        expect(result.elapsedUntilResolve).toBeGreaterThanOrEqual(0);
        expect(result.exportStatus?.status).toBe('surface_policy_blocked');
        expect(result.stopResultExportStatus?.status).toBe('surface_policy_blocked');
        expect(result.stopResultTransport).toBe('blocked');
        expect(result.exportStatus?.message).toContain('Video-Export ist in dieser Demo nicht verfuegbar');
        expect(result.exportStatus?.surfaceClassification).toBe('future opt-in');
        expect(result.exportStatus?.warnings?.[0]).toContain('echten Demo-Mehrwert');
    });

    test('T20ae: Runtime-Dispose entfernt globale und Menue-Listener vor Reinit', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        const result = await page.evaluate(() => {
            const first = window.GAME_INSTANCE;
            if (!first?.dispose || typeof first.constructor !== 'function') {
                return { error: 'missing-game-runtime' };
            }

            let firstStartCalls = 0;
            let secondStartCalls = 0;
            let secondKeyCaptureCalls = 0;
            let firstResizeCalls = 0;
            let secondResizeCalls = 0;

            first.runtimeFacade.startMatch = () => {
                firstStartCalls += 1;
                return false;
            };
            first.dispose();

            const second = new first.constructor();
            window.GAME_INSTANCE = second;
            window.GAME_RUNTIME = second.runtimeFacade;
            window.GAME_DEBUG = second.debugApi;
            second.runtimeFacade.startMatch = () => {
                secondStartCalls += 1;
                return false;
            };

            second.keyCapture = { playerKey: 'PLAYER_1', actionKey: 'UP' };
            second.keybindEditorController.handleKeyCapture = () => {
                if (!second.keyCapture) {
                    return false;
                }
                secondKeyCaptureCalls += 1;
                return true;
            };
            window.dispatchEvent(new KeyboardEvent('keydown', {
                code: 'KeyZ',
                bubbles: true,
                cancelable: true,
            }));

            second.keyCapture = null;
            first.renderer._onResize = () => {
                firstResizeCalls += 1;
            };
            second.renderer._onResize = () => {
                secondResizeCalls += 1;
            };
            window.dispatchEvent(new Event('resize'));

            window.dispatchEvent(new KeyboardEvent('keydown', {
                code: 'KeyQ',
                bubbles: true,
                cancelable: true,
            }));
            const firstInputUpdated = !!first.input?.keys?.KeyQ;
            const secondInputUpdated = !!second.input?.keys?.KeyQ;

            document.getElementById('btn-start')?.click();
            second.dispose();

            return {
                error: null,
                firstStartCalls,
                secondStartCalls,
                secondKeyCaptureCalls,
                firstResizeCalls,
                secondResizeCalls,
                firstInputUpdated,
                secondInputUpdated,
            };
        });

        expect(result.error).toBeNull();
        expect(result.firstStartCalls).toBe(0);
        expect(result.secondStartCalls).toBe(1);
        expect(result.secondKeyCaptureCalls).toBe(1);
        expect(result.firstResizeCalls).toBe(0);
        expect(result.secondResizeCalls).toBe(1);
        expect(result.firstInputUpdated).toBeFalsy();
        expect(result.secondInputUpdated).toBeTruthy();
        expect(errors).toHaveLength(0);
    });

    test('T20al: InputManager loest Sticky-Input bei Textfokus und Fokusverlust', async ({ page }) => {
        const errors = collectErrors(page);
        await loadGame(page);
        const result = await page.evaluate(() => {
            const input = window.GAME_INSTANCE?.input;
            const upCode = String(input?.bindings?.PLAYER_1?.UP || 'KeyW');
            if (!input) {
                return { error: 'missing-input-manager' };
            }

            const textInput = document.createElement('input');
            textInput.type = 'text';
            document.body.appendChild(textInput);

            const dispatchKey = (type) => {
                window.dispatchEvent(new KeyboardEvent(type, {
                    code: upCode,
                    key: 'w',
                    bubbles: true,
                    cancelable: true,
                }));
            };
            const readPitchUp = () => input.getKeyboardInput(0, { includeSecondaryBindings: true })?.pitchUp === true;

            try {
                dispatchKey('keydown');
                const downBeforeTextFocus = input.keys?.[upCode] === true && readPitchUp();
                textInput.focus();
                dispatchKey('keyup');
                const releasedWhileTextFocused = input.keys?.[upCode] !== true && !readPitchUp();

                textInput.blur();
                dispatchKey('keydown');
                const downBeforeWindowBlur = input.keys?.[upCode] === true && readPitchUp();
                window.dispatchEvent(new Event('blur'));
                const clearedAfterWindowBlur = input.keys?.[upCode] !== true && !readPitchUp();

                dispatchKey('keydown');
                const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
                Object.defineProperty(document, 'hidden', {
                    configurable: true,
                    value: true,
                });
                document.dispatchEvent(new Event('visibilitychange'));
                const clearedAfterHidden = input.keys?.[upCode] !== true && !readPitchUp();
                if (hiddenDescriptor) {
                    Object.defineProperty(document, 'hidden', hiddenDescriptor);
                } else {
                    delete document.hidden;
                }

                return {
                    error: null,
                    downBeforeTextFocus,
                    releasedWhileTextFocused,
                    downBeforeWindowBlur,
                    clearedAfterWindowBlur,
                    clearedAfterHidden,
                };
            } finally {
                textInput.remove();
                input.clearInputState?.('test-cleanup');
            }
        });

        expect(result.error).toBeNull();
        expect(result.downBeforeTextFocus).toBeTruthy();
        expect(result.releasedWhileTextFocused).toBeTruthy();
        expect(result.downBeforeWindowBlur).toBeTruthy();
        expect(result.clearedAfterWindowBlur).toBeTruthy();
        expect(result.clearedAfterHidden).toBeTruthy();
        expect(errors).toHaveLength(0);
    });

    test('T20am: Collision-Bounce nutzt Runtime-RNG statt unseeded Math.random', async () => {
        const { CollisionResponseSystem } = await import('../src/entities/systems/CollisionResponseSystem.js');
        const { Vector3, Quaternion } = await import('three');
        const originalRandom = Math.random;
        let mathRandomCalls = 0;
        Math.random = () => {
            mathRandomCalls += 1;
            throw new Error('unseeded-random-called');
        };

        const runBounce = (samples) => {
            let sampleIndex = 0;
            let forcedGap = 0;
            const owner = {
                arena: {
                    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 },
                    checkCollision: () => false,
                },
                checkGlobalCollision: () => null,
                _tmpVec: new Vector3(),
                _tmpVec2: new Vector3(),
                _tmpDir: new Vector3(),
                botByPlayer: new Map(),
                runtimeRng: {
                    next() {
                        const value = samples[sampleIndex];
                        sampleIndex += 1;
                        return value ?? 0.5;
                    },
                },
                recorder: { logEvent() {} },
            };
            const player = {
                index: 0,
                position: new Vector3(0, 0, 0),
                quaternion: new Quaternion(),
                hitboxRadius: 1,
                spawnProtectionTimer: 0,
                trail: {
                    forceGap(value) {
                        forcedGap = value;
                    },
                },
                getDirection(out) {
                    return out.set(0, 0, -1);
                },
            };

            new CollisionResponseSystem(owner).bounceBot(player, new Vector3(1, 0, 0), 'WALL', {
                normalBias: 0,
                randomScale: 0.45,
                preRotateShove: 0,
                extraPush: 0,
                trailGap: 0.31,
                spawnProtection: 0.12,
            });

            const forward = new Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
            return {
                x: Number(forward.x.toFixed(6)),
                y: Number(forward.y.toFixed(6)),
                z: Number(forward.z.toFixed(6)),
                consumedSamples: sampleIndex,
                forcedGap: Number(forcedGap.toFixed(2)),
                spawnProtectionTimer: Number(player.spawnProtectionTimer.toFixed(2)),
            };
        };

        try {
            const first = runBounce([0.12, 0.74, 0.36]);
            const second = runBounce([0.12, 0.74, 0.36]);
            const third = runBounce([0.88, 0.24, 0.64]);

            expect(mathRandomCalls).toBe(0);
            expect(first).toEqual(second);
            expect(first).not.toEqual(third);
            expect(first.consumedSamples).toBe(3);
            expect(first.forcedGap).toBe(0.31);
            expect(first.spawnProtectionTimer).toBe(0.12);
        } finally {
            Math.random = originalRandom;
        }
    });

    test('T20am1: Arcade-Map- und Missionsfolge folgen dem aktiven Run-Seed', async () => {
        const { ArcadeRunRuntime } = await import('../src/core/arcade/ArcadeRunRuntime.js');
        const { resolveMapSequence } = await import('../src/state/arcade/ArcadeMapProgression.js');
        const { assignSectorMissions } = await import('../src/state/arcade/ArcadeMissionState.js');
        const {
            getRuntimeMapCatalog,
            getRuntimeMapDefinition,
            registerMapCatalogConfigSource,
        } = await import('../src/shared/contracts/RuntimeMapCatalogContract.js');
        const mapKeys = [
            'standard',
            'foam_forest',
            'crossfire',
            'maze',
            'vertical_maze',
            'trench',
            'neon_abyss',
            'complex',
            'pyramid',
            'crystal_ruins',
            'expert_gauntlet',
            'portal_madness',
            'parcours_rift',
            'parcours_rift_sprint',
            'parcours_rift_precision',
        ];
        const maps = Object.fromEntries(mapKeys.map((key) => [key, {
            name: key,
            size: [80, 30, 80],
            obstacles: [],
            portals: [],
        }]));
        const encounterPlan = {
            sequence: [
                { templateId: 'sector_intro' },
                { templateId: 'sector_pressure' },
                { templateId: 'sector_hazard' },
            ],
        };

        registerMapCatalogConfigSource({ MAPS: maps });
        try {
            const configSeed = 1;
            const runSeed = 2;
            const runtime = new ArcadeRunRuntime({ now: () => 1234567890 });
            runtime._enabled = true;
            runtime._config = { ...runtime._config, seed: configSeed };
            const state = runtime.startRun({ seed: runSeed, encounterPlan });
            const catalog = getRuntimeMapCatalog();
            const expectedRunMaps = resolveMapSequence(encounterPlan, runSeed, catalog);
            const expectedConfigMaps = resolveMapSequence(encounterPlan, configSeed, catalog);
            const mapDefinition = getRuntimeMapDefinition(state?.currentMapKey, catalog);
            const mapMissions = Array.isArray(mapDefinition?.missions) && mapDefinition.missions.length > 0
                ? mapDefinition.missions
                : null;
            const actualMissions = Array.isArray(state?.missions?.missions)
                ? state.missions.missions.map((mission) => mission.type)
                : [];
            const expectedRunMissions = assignSectorMissions(
                { id: 'sector_intro' },
                mapMissions,
                `${runSeed}-${state?.runId || ''}`,
                0
            ).map((mission) => mission.type);
            const expectedConfigMissions = assignSectorMissions(
                { id: 'sector_intro' },
                mapMissions,
                `${configSeed}-${state?.runId || ''}`,
                0
            ).map((mission) => mission.type);

            expect(state?.config?.seed).toBe(2);
            expect(state?.mapSequence || []).toEqual(expectedRunMaps);
            expect(state?.mapSequence || []).not.toEqual(expectedConfigMaps);
            expect(actualMissions).toEqual(expectedRunMissions);
            expect(actualMissions).not.toEqual(expectedConfigMissions);
        } finally {
            registerMapCatalogConfigSource(null);
        }
    });

    test('T20am2: Arcade-Strategy-Cleanup resettet Sudden-Death-Runstate', async () => {
        const { ArcadeModeStrategy, ARCADE_SECTOR_TYPES } = await import('../src/modes/ArcadeModeStrategy.js');
        const strategy = new ArcadeModeStrategy();
        strategy.recordScore(0, 42);
        strategy.setActiveModifier('tight_turns');
        strategy.setSectorType(ARCADE_SECTOR_TYPES.PARCOURS);
        strategy.applyVehicleUpgrades({ turningBonusPct: 25, speedBonusPct: 20, maxHpBonus: 20 });
        strategy.enterSuddenDeath();
        strategy.tickSuddenDeath(65);

        const before = {
            suddenDeathActive: strategy.isSuddenDeathActive(),
            stackedModifiers: strategy.getSuddenDeathState().stackedModifiers.length,
            turnRate: Number(strategy.getTurnRateMultiplier().toFixed(3)),
            speed: Number(strategy.getSpeedMultiplier().toFixed(3)),
            sectorType: strategy.getSectorType(),
            score: strategy.computeRoundResult([{ playerIndex: 0, alive: true, hp: 100 }], {})?.scores?.[0]?.accumulatedScore,
        };

        strategy.cleanup();

        const after = {
            suddenDeathActive: strategy.isSuddenDeathActive(),
            stackedModifiers: strategy.getSuddenDeathState().stackedModifiers.length,
            damageMultiplier: strategy.getSuddenDeathState().damageMultiplier,
            turnRate: strategy.getTurnRateMultiplier(),
            speed: strategy.getSpeedMultiplier(),
            activeModifier: strategy.getActiveModifier(),
            sectorType: strategy.getSectorType(),
            score: strategy.computeRoundResult([{ playerIndex: 0, alive: true, hp: 100 }], {})?.scores?.[0]?.accumulatedScore,
        };

        expect(before.suddenDeathActive).toBeTruthy();
        expect(before.stackedModifiers).toBeGreaterThan(0);
        expect(before.turnRate).not.toBe(1);
        expect(before.speed).not.toBe(1);
        expect(before.sectorType).toBe('sector_parcours');
        expect(before.score).toBe(42);
        expect(after.suddenDeathActive).toBeFalsy();
        expect(after.stackedModifiers).toBe(0);
        expect(after.damageMultiplier).toBe(1);
        expect(after.turnRate).toBe(1);
        expect(after.speed).toBe(1);
        expect(after.activeModifier).toBeNull();
        expect(after.sectorType).toBeNull();
        expect(after.score).toBe(0);
    });

    test('T20ae1: PauseOverlayController setup/dispose bleibt idempotent ohne doppelte Handler', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { PauseOverlayController } = await window.__curviosImport('/src/ui/PauseOverlayController.js');

            const makeButton = () => document.createElement('button');
            const makeCheckbox = () => {
                const input = document.createElement('input');
                input.type = 'checkbox';
                return input;
            };

            const keybindP1 = document.createElement('div');
            const keybindButton = document.createElement('button');
            keybindButton.className = 'keybind-btn';
            keybindButton.dataset.action = 'THRUST';
            keybindP1.appendChild(keybindButton);

            const keybindP2 = document.createElement('div');
            const pauseOverlay = document.createElement('div');
            const pauseSettingsPanel = document.createElement('div');
            pauseSettingsPanel.classList.add('hidden');

            const ui = {
                pauseOverlay,
                pauseResumeButton: makeButton(),
                pauseSettingsButton: makeButton(),
                pauseSettingsBackButton: makeButton(),
                pauseMenuButton: makeButton(),
                pauseSettingsPanel,
                pauseKeybindP1: keybindP1,
                pauseKeybindP2: keybindP2,
                pauseAutoRollToggle: makeCheckbox(),
                pauseInvertP1: makeCheckbox(),
                pauseInvertP2: makeCheckbox(),
            };

            let keyCaptureCalls = 0;
            const game = {
                state: 'PAUSED',
                ui,
                settings: {
                    autoRoll: false,
                    invertPitch: { PLAYER_1: false, PLAYER_2: false },
                },
                entityManager: { players: [] },
                keybindEditorController: { renderPauseEditor() { } },
                gameLoop: { requestDeltaReset() { } },
                runtimeFacade: {
                    isNetworkSession: () => false,
                    isHost: () => true,
                    teardownRuntimeSession() { },
                },
                hudRuntimeSystem: { clearNetworkScoreboard() { } },
                _showMainNav() { },
                keyCapture: null,
            };

            const matchFlowUiController = {
                game,
                applyLifecycleTransition() { },
                applyMatchUiState() { },
                resetCrosshairUi() { },
            };
            const ports = {
                inputPort: {
                    clearJustPressed() { },
                    startKeyCapture() { keyCaptureCalls += 1; },
                },
                settingsPort: { applyAutoRoll() { } },
                sessionPort: {
                    clearLastRoundGhost() { },
                    teardownMatchSession() { },
                },
                uiFeedbackPort: {
                    showMenuPanel() { },
                    syncAll() { },
                },
            };

            const controller = new PauseOverlayController({
                matchFlowUiController,
                game,
                ports,
            });

            let resumeCalls = 0;
            let menuCalls = 0;
            controller.resumeFromPause = () => {
                resumeCalls += 1;
            };
            controller.returnToMenuFromPause = () => {
                menuCalls += 1;
            };

            controller.setupListeners();
            controller.setupListeners();

            ui.pauseResumeButton.click();
            ui.pauseMenuButton.click();
            keybindButton.click();

            const beforeDispose = {
                resumeCalls,
                menuCalls,
                keyCaptureCalls,
            };

            controller.dispose();
            ui.pauseResumeButton.click();
            ui.pauseMenuButton.click();
            keybindButton.click();

            const afterDispose = {
                resumeCalls,
                menuCalls,
                keyCaptureCalls,
            };

            controller.setupListeners();
            ui.pauseResumeButton.click();
            ui.pauseMenuButton.click();
            keybindButton.click();

            const afterRebind = {
                resumeCalls,
                menuCalls,
                keyCaptureCalls,
            };

            controller.dispose();

            return {
                beforeDispose,
                afterDispose,
                afterRebind,
            };
        });

        expect(result.beforeDispose.resumeCalls).toBe(1);
        expect(result.beforeDispose.menuCalls).toBe(1);
        expect(result.beforeDispose.keyCaptureCalls).toBe(1);
        expect(result.afterDispose.resumeCalls).toBe(result.beforeDispose.resumeCalls);
        expect(result.afterDispose.menuCalls).toBe(result.beforeDispose.menuCalls);
        expect(result.afterDispose.keyCaptureCalls).toBe(result.beforeDispose.keyCaptureCalls);
        expect(result.afterRebind.resumeCalls).toBe(2);
        expect(result.afterRebind.menuCalls).toBe(2);
        expect(result.afterRebind.keyCaptureCalls).toBe(2);
    });

    test('T20ae2: PauseOverlayController delegiert Return-to-Menu an den Lifecycle-Port', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { PauseOverlayController } = await window.__curviosImport('/src/ui/PauseOverlayController.js');

            const makeButton = () => document.createElement('button');
            const makeCheckbox = () => {
                const input = document.createElement('input');
                input.type = 'checkbox';
                return input;
            };

            let lifecycleReturnCalls = 0;
            let sessionTeardownCalls = 0;
            let runtimeTeardownCalls = 0;

            const game = {
                state: 'PAUSED',
                ui: {
                    pauseOverlay: document.createElement('div'),
                    pauseResumeButton: makeButton(),
                    pauseSettingsButton: makeButton(),
                    pauseSettingsBackButton: makeButton(),
                    pauseMenuButton: makeButton(),
                    pauseSettingsPanel: document.createElement('div'),
                    pauseKeybindP1: document.createElement('div'),
                    pauseKeybindP2: document.createElement('div'),
                    pauseAutoRollToggle: makeCheckbox(),
                    pauseInvertP1: makeCheckbox(),
                    pauseInvertP2: makeCheckbox(),
                },
                settings: {
                    autoRoll: false,
                    invertPitch: { PLAYER_1: false, PLAYER_2: false },
                },
                entityManager: { players: [] },
                keybindEditorController: { renderPauseEditor() { } },
                gameLoop: { requestDeltaReset() { } },
                runtimeFacade: {
                    isNetworkSession: () => false,
                    isHost: () => true,
                    teardownRuntimeSession() { runtimeTeardownCalls += 1; },
                },
            };

            const controller = new PauseOverlayController({
                matchFlowUiController: {
                    game,
                    returnToMenu() {
                        throw new Error('matchFlow fallback should not run while lifecyclePort exists');
                    },
                },
                game,
                ports: {
                    lifecyclePort: {
                        returnToMenu() {
                            lifecycleReturnCalls += 1;
                        },
                    },
                    sessionPort: {
                        teardownMatchSession() {
                            sessionTeardownCalls += 1;
                        },
                    },
                },
            });

            controller.returnToMenuFromPause();

            return {
                lifecycleReturnCalls,
                sessionTeardownCalls,
                runtimeTeardownCalls,
            };
        });

        expect(result.lifecycleReturnCalls).toBe(1);
        expect(result.sessionTeardownCalls).toBe(0);
        expect(result.runtimeTeardownCalls).toBe(0);
    });

    test('T20ae3: RuntimeSessionLifecycle puffert fruehe stateUpdate-Pakete und wartet als Client auf Host-Startsignal', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const lifecycleModule = await window.__curviosImport('/src/core/runtime/RuntimeSessionLifecycleService.js');
            const {
                setupRuntimeClientStateReceiver,
                waitForRuntimePlayersLoaded,
            } = lifecycleModule;

            const createEventBusSession = ({ isHost, localPlayerId, players }) => {
                const listeners = new Map();
                const sentInputs = [];
                return {
                    isHost,
                    localPlayerId,
                    getPlayers() {
                        return players;
                    },
                    sendInput(payload) {
                        sentInputs.push(payload);
                    },
                    on(event, handler) {
                        const entries = listeners.get(event) || [];
                        entries.push(handler);
                        listeners.set(event, entries);
                    },
                    off(event, handler) {
                        const entries = listeners.get(event) || [];
                        listeners.set(event, entries.filter((entry) => entry !== handler));
                    },
                    emit(event, payload) {
                        const entries = listeners.get(event) || [];
                        for (const handler of entries) {
                            handler(payload);
                        }
                    },
                    listenerCount(event) {
                        return (listeners.get(event) || []).length;
                    },
                    sentInputs,
                };
            };

            const hostSession = createEventBusSession({
                isHost: true,
                localPlayerId: 'host',
                players: [{ peerId: 'host' }, { peerId: 'client' }],
            });
            const hostFacade = {
                session: hostSession,
                _arenaLoadedPeers: new Set(),
                _onPlayerLoadedHandler: null,
            };

            const hostWaitPromise = waitForRuntimePlayersLoaded(hostFacade);
            hostSession.emit('playerLoaded', { playerId: 'client' });
            await hostWaitPromise;

            const clientSession = createEventBusSession({
                isHost: false,
                localPlayerId: 'client',
                players: [{ peerId: 'host' }, { peerId: 'client' }],
            });
            const clientFacade = {
                session: clientSession,
                _arenaLoadedPeers: new Set(),
                _onArenaStartSignalHandler: null,
            };

            const clientWaitPromise = waitForRuntimePlayersLoaded(clientFacade);
            await new Promise((resolve) => setTimeout(resolve, 0));
            clientSession.emit('remoteInput', { input: { type: 'arena_start' } });
            await clientWaitPromise;

            let resolveReconcilerFactory = null;
            const receiveCalls = [];
            let reconcileCalls = 0;
            const delayedReconciler = new Promise((resolve) => {
                resolveReconcilerFactory = resolve;
            });

            const receiverSession = createEventBusSession({
                isHost: false,
                localPlayerId: 'client',
                players: [{ peerId: 'host' }, { peerId: 'client' }],
            });
            const receiverFacade = {
                session: receiverSession,
                game: {
                    entityManager: {
                        players: [{ index: 0, position: { x: 0, y: 0, z: 0 } }],
                    },
                },
                _pendingStateUpdates: [],
                _loadStateReconciler: () => delayedReconciler,
            };

            setupRuntimeClientStateReceiver(receiverFacade);
            receiverSession.emit('stateUpdate', { id: 1, state: { players: [] } });
            receiverSession.emit('stateUpdate', { id: 2, state: { players: [] } });

            const bufferedBeforeResolve = receiverFacade._pendingStateUpdates.length;
            resolveReconcilerFactory({
                receiveServerState(serverState) {
                    receiveCalls.push(serverState?.id || 0);
                },
                reconcile() {
                    reconcileCalls += 1;
                },
                reset() { },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));

            receiverSession.emit('stateUpdate', { id: 3, state: { players: [] } });

            return {
                hostStartSignalType: hostSession.sentInputs[0]?.type || null,
                hostStartSignalPeers: hostSession.sentInputs[0]?.expectedPeerIds || [],
                clientLoadedSignalType: clientSession.sentInputs[0]?.type || null,
                clientRemoteInputListenersAfterResolve: clientSession.listenerCount('remoteInput'),
                bufferedBeforeResolve,
                bufferedAfterResolve: receiverFacade._pendingStateUpdates.length,
                receiveCalls,
                reconcileCalls,
            };
        });

        expect(result.hostStartSignalType).toBe('arena_start');
        expect(Array.isArray(result.hostStartSignalPeers)).toBeTruthy();
        expect(result.hostStartSignalPeers.includes('host')).toBeTruthy();
        expect(result.hostStartSignalPeers.includes('client')).toBeTruthy();
        expect(result.clientLoadedSignalType).toBe('arena_loaded');
        expect(result.clientRemoteInputListenersAfterResolve).toBe(0);
        expect(result.bufferedBeforeResolve).toBe(2);
        expect(result.bufferedAfterResolve).toBe(0);
        expect(result.receiveCalls).toEqual([1, 2, 3]);
        expect(result.reconcileCalls).toBeGreaterThanOrEqual(2);
    });

    test('T20ae4: MatchStartValidation scoped Lobby-Regeln nur auf Menu-Storage-Bridge', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const { resolveMatchStartValidationIssue } = await window.__curviosImport('/src/core/runtime/MatchStartValidationService.js');

            const baseSettings = JSON.parse(JSON.stringify(game?.settings || {}));
            baseSettings.mapKey = String(baseSettings.mapKey || 'standard');
            baseSettings.gameMode = 'CLASSIC';
            baseSettings.localSettings = {
                ...(baseSettings.localSettings || {}),
                modePath: 'normal',
                themeMode: 'dunkel',
            };
            baseSettings.vehicles = {
                ...(baseSettings.vehicles || {}),
                PLAYER_1: baseSettings?.vehicles?.PLAYER_1 || 'ship5',
            };

            const storageBridgeSettings = {
                ...baseSettings,
                localSettings: {
                    ...baseSettings.localSettings,
                    sessionType: 'multiplayer',
                    multiplayerTransport: 'storage-bridge',
                },
            };
            const lanSettings = {
                ...baseSettings,
                localSettings: {
                    ...baseSettings.localSettings,
                    sessionType: 'lan',
                    multiplayerTransport: 'lan',
                },
            };

            const maps = game?.config?.MAPS || { standard: { key: 'standard' } };
            const storageBridgeIssue = resolveMatchStartValidationIssue({
                settings: storageBridgeSettings,
                maps,
                classicModeType: 'CLASSIC',
                huntModeType: 'HUNT',
            });
            const lanIssue = resolveMatchStartValidationIssue({
                settings: lanSettings,
                maps,
                classicModeType: 'CLASSIC',
                huntModeType: 'HUNT',
            });

            return {
                storageBridgeField: storageBridgeIssue?.fieldKey || null,
                lanField: lanIssue?.fieldKey || null,
            };
        });

        expect(result.storageBridgeField).toBe('multiplayer');
        expect(result.lanField).not.toBe('multiplayer');
    });

    test('T20ae5: Browser-Demo Validation markiert Multiplayer als Join-only statt Host-CTA', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const { resolveMatchStartValidationIssue } = await window.__curviosImport('/src/core/runtime/MatchStartValidationService.js');

            const browserDemoSettings = JSON.parse(JSON.stringify(game?.settings || {}));
            browserDemoSettings.mapKey = String(browserDemoSettings.mapKey || 'standard');
            browserDemoSettings.gameMode = 'CLASSIC';
            browserDemoSettings.localSettings = {
                ...(browserDemoSettings.localSettings || {}),
                sessionType: 'multiplayer',
                multiplayerTransport: 'storage-bridge',
                modePath: 'normal',
                themeMode: 'dunkel',
            };
            browserDemoSettings.vehicles = {
                ...(browserDemoSettings.vehicles || {}),
                PLAYER_1: browserDemoSettings?.vehicles?.PLAYER_1 || 'ship5',
            };

            const issue = resolveMatchStartValidationIssue({
                settings: browserDemoSettings,
                maps: game?.config?.MAPS || { standard: { key: 'standard' } },
                classicModeType: 'CLASSIC',
                huntModeType: 'HUNT',
                productSurfaceId: 'browser-demo',
            });

            return {
                message: issue?.message || '',
                fieldMessage: issue?.fieldMessage || '',
            };
        });

        expect(result.message).toContain('Desktop-Lobby');
        expect(result.fieldMessage).toContain('Join only');
    });

    test('T20ae6: Browser-Demo Startpfad migriert Surface-Fallbacks explizit statt sie im UI-Sync zu speichern', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const facade = game?.runtimeCoordinator?.getRuntimeFacade?.();
            if (!game?.settings || !facade?.settingsHandler?.applySurfacePolicyStartDefaults) {
                return null;
            }

            game.settings.mapKey = 'custom';
            game.settings.localSettings = {
                ...(game.settings.localSettings || {}),
                sessionType: 'splitscreen',
                modePath: 'quick_action',
            };
            const before = {
                sessionType: game.settings.localSettings.sessionType,
                modePath: game.settings.localSettings.modePath,
                mapKey: game.settings.mapKey,
            };
            const migration = facade.settingsHandler.applySurfacePolicyStartDefaults();

            return {
                before,
                after: {
                    sessionType: game.settings.localSettings.sessionType,
                    modePath: game.settings.localSettings.modePath,
                    mapKey: game.settings.mapKey,
                },
                changedKeys: migration?.changedKeys || [],
            };
        });

        expect(result.before.sessionType).toBe('splitscreen');
        expect(result.before.modePath).toBe('quick_action');
        expect(result.before.mapKey).toBe('custom');
        expect(result.after.sessionType).toBe('single');
        expect(result.after.modePath).toBe('normal');
        expect(result.after.mapKey).toBe('standard');
        expect(result.changedKeys).toEqual(expect.arrayContaining(['sessionType', 'modePath', 'mapKey']));
    });

    test('T20ae3: TelemetryHistoryStore wiederholt temporaere DB-Fehler und oeffnet Verbindung neu', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { TelemetryHistoryStore } = await window.__curviosImport('/src/state/TelemetryHistoryStore.js');

            const store = new TelemetryHistoryStore();
            let getDbCalls = 0;
            let invalidateCalls = 0;
            let operationCalls = 0;
            store._getDb = async () => {
                getDbCalls += 1;
                return { id: `db-${getDbCalls}` };
            };
            store._invalidateDb = () => {
                invalidateCalls += 1;
            };

            const retryResult = await store._runWithDbRetry(async () => {
                operationCalls += 1;
                if (operationCalls === 1) {
                    const transientError = new Error('temporary');
                    transientError.name = 'AbortError';
                    throw transientError;
                }
                return 'ok-after-retry';
            }, 'fallback');

            const terminalResult = await store._runWithDbRetry(async () => {
                const terminalError = new Error('terminal');
                terminalError.name = 'TypeError';
                throw terminalError;
            }, 'fallback-terminal');

            return {
                retryResult,
                terminalResult,
                getDbCalls,
                invalidateCalls,
                operationCalls,
            };
        });

        expect(result.retryResult).toBe('ok-after-retry');
        expect(result.terminalResult).toBe('fallback-terminal');
        expect(result.operationCalls).toBe(2);
        expect(result.getDbCalls).toBeGreaterThanOrEqual(3);
        expect(result.invalidateCalls).toBeGreaterThanOrEqual(2);
    });

    test('T10b: Portal-Runtime bleibt im Validierungsszenario funktionsfaehig', async ({ page }) => {
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

        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            const portal = g?.arena?.portals?.[0];
            if (!portal) return null;

            const hit = g.arena.checkPortal(portal.posA.clone(), 0.1, 'qa-portal');
            return {
                portalPairs: g.arena.portals.length,
                hit: !!hit,
                targetDistance: hit ? hit.target.distanceTo(portal.posB) : null,
                cooldown: portal.cooldowns.get('qa-portal') || 0,
            };
        });

        expect(probe).not.toBeNull();
        expect(probe.portalPairs).toBe(4);
        expect(probe.hit).toBeTruthy();
        expect(probe.targetDistance).toBeLessThan(0.001);
        expect(probe.cooldown).toBeGreaterThan(0);
    });

    test('T10c: Prewarmed Match behaelt Arena-Visuals beim Start', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await page.waitForTimeout(250);
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return hud && !hud.classList.contains('hidden') && g?.entityManager?.players?.length > 0;
        }, null, { timeout: 15000 });

        const probe = await page.evaluate(() => {
            const g = window.GAME_INSTANCE;
            return {
                floorParent: g?.arena?._floorMesh?.parent?.name ?? null,
                wallParent: g?.arena?._mergedWallMesh?.parent?.name ?? null,
                obstacleParent: g?.arena?._mergedObstacleMesh?.parent?.name ?? null,
                nonWallObstacleCount: Array.isArray(g?.arena?.obstacles)
                    ? g.arena.obstacles.filter((entry) => !entry?.isWall).length
                    : 0,
            };
        });

        expect(probe.floorParent).toBe('matchRoot');
        expect(probe.wallParent).toBe('matchRoot');
        expect(probe.obstacleParent).toBe('matchRoot');
        expect(probe.nonWallObstacleCount).toBeGreaterThan(0);
    });

    test('T10d: Portal-Layout folgt geaenderter Portal-Anzahl im Prewarm-Pfad', async ({ page }) => {
        await loadGame(page);
        await openGameSubmenu(page);
        await page.evaluate(() => {
            const toggle = document.getElementById('portals-toggle');
            const slider = document.getElementById('portal-count-slider');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                toggle.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (slider) {
                slider.value = '4';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.waitForTimeout(250);
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return hud && !hud.classList.contains('hidden') && g?.entityManager?.players?.length > 0;
        }, null, { timeout: 15000 });

        const portalCount = await page.evaluate(() => window.GAME_INSTANCE?.arena?.portals?.length ?? 0);
        expect(portalCount).toBe(4);
    });

    test('T10e: Custom-Map-Aenderungen mit gleichem Key laden neues Layout', async ({ page }) => {
        const mapA = buildLegacyRuntimeCustomMap([
            { pos: [0, 5, 0], size: [6, 6, 6] },
        ]);
        const mapB = buildLegacyRuntimeCustomMap([
            { pos: [0, 5, 0], size: [6, 6, 6] },
            { pos: [12, 5, 0], size: [6, 6, 6] },
            { pos: [-12, 5, 0], size: [6, 6, 6] },
        ]);

        await loadGame(page);
        await openGameSubmenu(page);
        await page.evaluate(({ storageKey, mapJson }) => {
            localStorage.setItem(storageKey, mapJson);
            const g = window.GAME_INSTANCE;
            if (g?.settings) {
                g.settings.mapKey = 'custom';
            }
            g?.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['mapKey'] });
        }, { storageKey: CUSTOM_MAP_STORAGE_KEY, mapJson: mapA });
        await page.waitForTimeout(250);
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return hud && !hud.classList.contains('hidden') && g?.entityManager?.players?.length > 0;
        }, null, { timeout: 15000 });

        const firstObstacleCount = await page.evaluate(() =>
            window.GAME_INSTANCE?.arena?.obstacles?.filter((entry) => !entry?.isWall)?.length ?? 0
        );
        expect(firstObstacleCount).toBe(1);

        await returnToMenu(page);
        await page.evaluate(({ storageKey, mapJson }) => {
            localStorage.setItem(storageKey, mapJson);
            const g = window.GAME_INSTANCE;
            if (g?.settings) {
                g.settings.mapKey = 'custom';
            }
            g?.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['mapKey'] });
        }, { storageKey: CUSTOM_MAP_STORAGE_KEY, mapJson: mapB });

        await page.waitForTimeout(250);
        const reopened = await page.evaluate(() => {
            const runtime = window.GAME_INSTANCE?.uiManager?.menuNavigationRuntime;
            return !!runtime?.showPanel?.('submenu-game', { trigger: 'test_custom_map_reopen' });
        });
        expect(reopened).toBeTruthy();
        await page.waitForFunction(() => {
            const panel = document.getElementById('submenu-game');
            const game = window.GAME_INSTANCE;
            return !!(
                panel
                && !panel.classList.contains('hidden')
                && game?.settings?.mapKey === 'custom'
            );
        }, null, { timeout: 5000 });
        await page.locator('#submenu-game:not(.hidden) #btn-start').waitFor({ state: 'visible', timeout: 5000 });
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return hud && !hud.classList.contains('hidden') && g?.entityManager?.players?.length > 0;
        }, null, { timeout: 15000 });

        const secondProbe = await page.evaluate(() => ({
            mapKey: window.GAME_INSTANCE?.arena?.currentMapKey ?? null,
            obstacleCount: window.GAME_INSTANCE?.arena?.obstacles?.filter((entry) => !entry?.isWall)?.length ?? 0,
            floorParent: window.GAME_INSTANCE?.arena?._floorMesh?.parent?.name ?? null,
        }));

        expect(secondProbe.mapKey).toBe('custom');
        expect(secondProbe.obstacleCount).toBe(3);
        expect(secondProbe.floorParent).toBe('matchRoot');
    });

    test('T10f: UIManager coalesct Start-Setup-Sync bei kombinierten Change-Keys auf einen Snapshot pro Runde', async ({ page }) => {
        await loadGame(page);

        const probe = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const uiManager = game?.uiManager;
            const startSync = uiManager?._startSync;
            if (!game || !uiManager || !startSync || typeof uiManager.syncByChangeKeys !== 'function') {
                return { ok: false, reason: 'missing_runtime' };
            }

            const originalSyncStartSetupState = startSync.syncStartSetupState.bind(startSync);
            const snapshots = [];
            let syncCalls = 0;
            startSync.syncStartSetupState = (settings, snapshot = null) => {
                syncCalls += 1;
                snapshots.push({
                    sessionType: String(snapshot?.surfaceMenuState?.sessionType || ''),
                    modePath: String(snapshot?.surfaceMenuState?.modePath || ''),
                    hasMultiplayerSessionState: !!snapshot?.multiplayerSessionState,
                });
                return originalSyncStartSetupState(settings, snapshot);
            };

            try {
                if (!game.settings?.localSettings || typeof game.settings.localSettings !== 'object') {
                    game.settings.localSettings = {};
                }
                game.settings.localSettings.sessionType = 'single';
                game.settings.localSettings.modePath = 'normal';
                game.uiManager.syncByChangeKeys([
                    'session.type',
                    'mapKey',
                    'vehicles.player1',
                ]);
                return {
                    ok: true,
                    syncCalls,
                    snapshots,
                };
            } finally {
                startSync.syncStartSetupState = originalSyncStartSetupState;
            }
        });

        expect(probe.ok).toBeTruthy();
        expect(probe.syncCalls).toBe(1);
        expect(probe.snapshots.length).toBe(1);
        expect(probe.snapshots[0].sessionType).toBe('single');
        expect(probe.snapshots[0].modePath).toBe('normal');
        expect(probe.snapshots[0].hasMultiplayerSessionState).toBeTruthy();
    });

    test.skip('T10g: Editor-Disk-Maps erscheinen im Runtime-Menue und laden im Match (Sunset: aktivieren, sobald der desktop-e2e-Harness Editor-Disk-Map-Seeding stabil bereitstellt)', async ({ page }) => {
        await loadGameWithRetry(page);
        await openGameSubmenu(page);

        const selectionState = await page.evaluate(() => {
            const options = Array.from(document.querySelectorAll('#map-select option')).map((option) => ({
                value: String(option.value || ''),
                text: String(option.textContent || ''),
            }));
            const matching = options.find((entry) => entry.value.startsWith('editor_')) || null;
            return {
                matching,
                optionCount: options.length,
            };
        });

        if (!selectionState.matching) {
            test.skip(true, 'Sunset: Skip entfernen, sobald der Harness deterministisch mindestens eine editor_ Runtime-Map seedet.');
            return;
        }

        const selectedEditorMapKey = String(selectionState.matching.value || '');
        expect(selectionState.optionCount).toBeGreaterThan(0);
        expect(selectedEditorMapKey.startsWith('editor_')).toBeTruthy();

        await page.evaluate((mapKey) => {
            const game = window.GAME_INSTANCE;
            if (!game?.settings) return;
            game.settings.mapKey = mapKey;
            game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['mapKey'] });
        }, selectedEditorMapKey);
        await page.waitForTimeout(200);

        const runtimeSelection = await page.evaluate(() => ({
            domValue: document.getElementById('map-select')?.value ?? null,
            settingsMapKey: window.GAME_INSTANCE?.settings?.mapKey ?? null,
        }));

        expect(runtimeSelection.domValue).toBe(selectedEditorMapKey);
        expect(runtimeSelection.settingsMapKey).toBe(selectedEditorMapKey);
        await page.click('#submenu-game:not(.hidden) #btn-start');
        await page.waitForFunction(() => {
            const hud = document.getElementById('hud');
            const g = window.GAME_INSTANCE;
            return hud && !hud.classList.contains('hidden') && g?.entityManager?.players?.length > 0;
        }, null, { timeout: 15000 });

        const matchProbe = await page.evaluate(() => ({
            mapKey: window.GAME_INSTANCE?.arena?.currentMapKey ?? null,
            obstacleCount: window.GAME_INSTANCE?.arena?.obstacles?.filter((entry) => !entry?.isWall)?.length ?? 0,
        }));

        expect(matchProbe.mapKey).toBe(selectedEditorMapKey);
        expect(matchProbe.obstacleCount).toBeGreaterThanOrEqual(1);
    });
});
