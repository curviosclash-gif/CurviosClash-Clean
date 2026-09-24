import {
    collectPlaywrightStageDiagnostics,
    formatPlaywrightReadinessContract,
    waitForServerReadiness,
    waitForRuntimeReady,
    waitForShellOrRuntimeReady,
} from './playwright-readiness.js';
import { consumeFreshBootMark, isForceGotoEnv, shouldSkipInitialGoto } from './fresh-boot-mark.mjs';
import { performance } from 'node:perf_hooks';

function toPositiveInt(rawValue, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const numeric = Number.parseInt(String(rawValue || ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

export function resolveAppUrl(page, targetPath = '/') {
    const target = String(targetPath || '/');
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return target;

    const currentUrl = String(page?.url?.() || '');
    if (/^https?:\/\//i.test(currentUrl)) {
        return new URL(target, currentUrl).href;
    }

    const runProfile = String(process.env.PW_RUN_PROFILE || '').trim();
    if (runProfile.startsWith('desktop-')) {
        const host = String(process.env.TEST_HOST || '127.0.0.1');
        const port = String(process.env.TEST_PORT || '').trim();
        if (port) return new URL(target, `http://${host}:${port}`).href;
    }

    return target;
}

async function readMenuRuntimeState(page) {
    return page.evaluate(() => {
        const menu = document.getElementById('main-menu');
        const visiblePanel = document.querySelector('.submenu-panel:not(.hidden)');
        const menuVisible = (() => {
            if (!(menu instanceof HTMLElement) || menu.classList.contains('hidden')) return false;
            const style = window.getComputedStyle(menu);
            return style.display !== 'none' && style.visibility !== 'hidden';
        })();
        return {
            menuVisible,
            runtimeReady: !!globalThis?.GAME_INSTANCE,
            visiblePanelId: visiblePanel ? visiblePanel.id : null,
        };
    });
}

export async function waitForMenuIdle(page, timeoutMs = 30000) {
    await page.waitForFunction(() => {
        const menu = document.getElementById('main-menu');
        const menuVisible = (() => {
            if (!(menu instanceof HTMLElement) || menu.classList.contains('hidden')) return false;
            const style = window.getComputedStyle(menu);
            return style.display !== 'none' && style.visibility !== 'hidden';
        })();
        const visiblePanel = document.querySelector('.submenu-panel:not(.hidden)');
        if (!menuVisible) return false;
        if (!(visiblePanel instanceof HTMLElement)) return true;
        return visiblePanel.id === 'submenu-game';
    }, null, { timeout: timeoutMs });
}

export async function waitForLoadedGame(page, timeoutMs = 30000) {
    await waitForShellOrRuntimeReady(page, timeoutMs);
    const state = await readMenuRuntimeState(page);

    if (!state.runtimeReady) {
        await waitForRuntimeReady(page, timeoutMs);
    }

    if (!state.menuVisible || state.visiblePanelId) {
        await page.evaluate(() => {
            globalThis?.GAME_INSTANCE?._returnToMenu?.();
        });
    }

    await waitForMenuIdle(page, timeoutMs);
}

export async function waitForRenderFrames(page, frameCount = 2) {
    await page.evaluate((requestedFrames) => new Promise((resolve) => {
        let remaining = Math.max(1, Number(requestedFrames) || 1);
        const next = () => {
            remaining -= 1;
            if (remaining <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
    }), frameCount);
}

export async function ensureTestModuleImportBridge(page, timeoutMs = 15000) {
    await page.waitForFunction(() => {
        const api = globalThis?.CURVIOS_TEST_API;
        return typeof api?.importCurviosTestModule === 'function'
            && api?.testModuleExports
            && typeof api.testModuleExports === 'object';
    }, null, { timeout: timeoutMs });

    await page.evaluate(() => {
        globalThis.__curviosImport = async (moduleSpecifier) => {
            const normalizedSpecifier = String(moduleSpecifier || '').trim();
            const api = globalThis?.CURVIOS_TEST_API;
            return api.importCurviosTestModule(normalizedSpecifier);
        };
    });
}

// Load page and wait for visible main menu.
// The desktop harness already booted the app, so the first call on an untouched
// page only waits for readiness instead of booting it a second time. Pass
// { forceReload: true } where a test needs the navigation itself.
export async function loadGame(page, options = {}) {
    const forceReload = options?.forceReload === true;
    const envForce = isForceGotoEnv(process.env);
    // One shot: a retry and every later loadGame in the same test navigate again.
    const freshBoot = consumeFreshBootMark(page);
    const maxAttempts = toPositiveInt(process.env.PW_LOAD_GAME_MAX_ATTEMPTS, 2, 1, 5);
    const gotoTimeoutMs = toPositiveInt(process.env.PW_LOAD_GAME_GOTO_TIMEOUT_MS, 60000, 1_000, 300_000);
    const serverTimeoutMs = toPositiveInt(process.env.PW_LOAD_GAME_SERVER_TIMEOUT_MS, 80000, 1_000, 300_000);
    const readyTimeoutMs = toPositiveInt(process.env.PW_LOAD_GAME_READY_TIMEOUT_MS, 60000, 1_000, 300_000);
    const totalTimeoutMs = toPositiveInt(process.env.PW_LOAD_GAME_TOTAL_TIMEOUT_MS, 110000, 5_000, 600_000);
    const retryDelayMs = toPositiveInt(process.env.PW_LOAD_GAME_RETRY_DELAY_MS, 250, 50, 10_000);
    const snapshotTimeoutMs = toPositiveInt(process.env.PW_APP_SNAPSHOT_TIMEOUT_MS, 1500, 100, 10_000);
    const preProbeEnabled = String(process.env.PW_LOAD_GAME_PREPROBE || '').trim() === '1';
    const gotoWaitUntilCandidate = String(process.env.PW_LOAD_GAME_WAIT_UNTIL || 'commit');
    const supportedWaitStates = new Set(['commit', 'domcontentloaded', 'load', 'networkidle']);
    const gotoWaitUntil = supportedWaitStates.has(gotoWaitUntilCandidate) ? gotoWaitUntilCandidate : 'commit';
    let lastError = null;
    let lastStage = 'idle';
    let lastDiagnostics = null;
    let skippedInitialGoto = false;
    const startedAt = performance.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const elapsedAtStart = performance.now() - startedAt;
            const remainingAtStart = totalTimeoutMs - elapsedAtStart;
            if (preProbeEnabled) {
                if (remainingAtStart <= 1_000) {
                    throw new Error('loadGame timeout budget exhausted before server probe');
                }

                const serverBudgetMs = Math.max(1_000, Math.min(serverTimeoutMs, remainingAtStart - 2_000));
                lastStage = 'startup_probe';
                await waitForServerReadiness(page, {
                    path: '/_pw/health',
                    timeoutMs: serverBudgetMs,
                    expectDomHint: false,
                    requireDomHint: false,
                    useNodeFetch: true,
                });
            }

            const targetUrl = resolveAppUrl(page, '/');
            const skipGoto = attempt === 1 && shouldSkipInitialGoto({
                fresh: freshBoot,
                currentUrl: page.url(),
                targetUrl,
                forceReload,
                envForce,
            });

            if (skipGoto) {
                skippedInitialGoto = true;
                lastStage = 'fresh_boot';
            } else {
                const elapsedBeforeGoto = performance.now() - startedAt;
                const remainingBeforeGoto = totalTimeoutMs - elapsedBeforeGoto;
                if (remainingBeforeGoto <= 1_000) {
                    throw new Error('loadGame timeout budget exhausted before navigation');
                }
                const gotoBudgetMs = Math.max(
                    1_000,
                    Math.min(gotoTimeoutMs, remainingBeforeGoto - 1_500)
                );
                lastStage = 'goto';
                await page.goto(targetUrl, { waitUntil: gotoWaitUntil, timeout: gotoBudgetMs });
            }

            const elapsedBeforeReady = performance.now() - startedAt;
            const remainingBeforeReady = totalTimeoutMs - elapsedBeforeReady;
            if (remainingBeforeReady <= 1_000) {
                throw new Error('loadGame timeout budget exhausted before readiness check');
            }
            const readyBudgetMs = Math.max(
                1_000,
                Math.min(readyTimeoutMs, remainingBeforeReady - 250)
            );
            lastStage = 'shell_ready';
            await waitForLoadedGame(page, readyBudgetMs);
            lastStage = 'test_api_bridge';
            await ensureTestModuleImportBridge(page, Math.min(15000, readyBudgetMs));

            return;
        } catch (error) {
            lastError = error;
            lastDiagnostics = await collectPlaywrightStageDiagnostics(page, lastStage, {
                error,
                expectDomHint: true,
                requireDomHint: true,
                snapshotTimeoutMs,
                useNodeFetch: lastStage === 'startup_probe' || lastStage === 'goto',
            });
            const message = String(error?.message || '');
            const isClosedFlake = page.isClosed() || message.includes('Target page, context or browser has been closed');
            if (attempt >= maxAttempts || isClosedFlake) {
                break;
            }
            const elapsed = performance.now() - startedAt;
            const remaining = totalTimeoutMs - elapsed;
            if (remaining <= 1_000) {
                break;
            }
            const retrySleepMs = Math.min(retryDelayMs * attempt, Math.max(100, remaining - 500));
            await page.waitForTimeout(retrySleepMs);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown');
    const diagnosticsText = lastDiagnostics ? ` diagnostics=${JSON.stringify(lastDiagnostics)}` : '';
    const runProfile = String(process.env.PW_RUN_PROFILE || 'preview-smoke').trim() || 'preview-smoke';
    const readinessSummary = lastDiagnostics ? ` ${formatPlaywrightReadinessContract(lastDiagnostics)}` : '';
    const budgetSummary = ` budgets=${JSON.stringify({
        maxAttempts,
        gotoWaitUntil,
        gotoTimeoutMs,
        serverTimeoutMs,
        readyTimeoutMs,
        totalTimeoutMs,
        retryDelayMs,
        snapshotTimeoutMs,
        skippedInitialGoto,
    })}`;
    throw new Error(
        `loadGame failed after ${maxAttempts} attempts in runProfile "${runProfile}" ` +
        `at stage "${lastStage}"${readinessSummary}${budgetSummary}: ${message}${diagnosticsText}`
    );
}

export async function selectSessionType(page, sessionType = 'single') {
    const normalizedSessionType = String(sessionType || 'single').trim().toLowerCase() || 'single';
    const alreadySelected = await page.evaluate((requestedSessionType) => {
        const panel = document.getElementById('submenu-custom');
        const activeSessionType = String(
            window.GAME_INSTANCE?.settings?.localSettings?.sessionType || ''
        ).trim().toLowerCase();
        return !!panel
            && !panel.classList.contains('hidden')
            && activeSessionType === requestedSessionType;
    }, normalizedSessionType);
    if (alreadySelected) return;

    // A busy machine can push the visibility wait past its budget while the menu is
    // perfectly healthy. That must not end the run: the loop below already carries two
    // fallbacks, they were just unreachable because the wait threw out of the whole
    // function instead of falling through to them.
    const buttonTimeoutMs = toPositiveInt(process.env.PW_SESSION_TYPE_TIMEOUT_MS, 4000, 250, 60_000);
    const selector = `#menu-nav [data-session-type="${normalizedSessionType}"]`;
    const isPanelVisible = () => page.evaluate(() => {
        const panel = document.getElementById('submenu-custom');
        return !!(panel && !panel.classList.contains('hidden'));
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const sessionButton = page.locator(selector).first();
            await sessionButton.waitFor({ state: 'visible', timeout: buttonTimeoutMs });
            await sessionButton.click({ force: true });
            if (await isPanelVisible()) return;
        } catch {
            // The button never became visible in time. Dispatch the click through the DOM
            // instead - it bubbles into the same delegated handler, so the session type is
            // still selected properly rather than merely revealing the panel.
            await page.evaluate((buttonSelector) => {
                document.querySelector(buttonSelector)?.click();
            }, selector);
            if (await isPanelVisible()) return;
        }

        try {
            await openViaNavigationRuntime(page, 'submenu-custom');
            return;
        } catch {
            await page.waitForTimeout(150 * (attempt + 1));
        }
    }

    await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: buttonTimeoutMs });
}

async function openViaNavigationRuntime(page, submenuId) {
    const opened = await page.evaluate((panelId) => {
        const runtime = window.GAME_INSTANCE?.uiManager?.menuNavigationRuntime;
        if (!runtime?.showPanel) return false;
        return !!runtime.showPanel(panelId, { trigger: 'test_helper' });
    }, submenuId);
    if (!opened) {
        throw new Error(`Panel konnte nicht geoeffnet werden: ${submenuId}`);
    }
}

export async function openSubmenu(page, submenuId, options = {}) {
    if (submenuId === 'submenu-custom') {
        await selectSessionType(page, options.sessionType || 'single');
        return;
    }

    if (submenuId === 'submenu-game') {
        await selectSessionType(page, options.sessionType || 'single');
        let modePathButton = page
            .locator('#submenu-custom:not(.hidden) [data-mode-path="normal"]:visible:not([disabled])')
            .first();
        if (await modePathButton.count()) {
            await modePathButton.click({ force: true });
        } else {
            const openedCustomSetupStep = await openCustomSetupStep(page);
            if (openedCustomSetupStep) {
                modePathButton = page
                    .locator('#submenu-custom:not(.hidden) [data-mode-path="normal"]:visible:not([disabled])')
                    .first();
            }

            if (await modePathButton.count()) {
                await modePathButton.click({ force: true });
            } else {
                const submenuButton = page
                    .locator('#submenu-custom:not(.hidden) [data-menu-step-target="submenu-game"]:visible:not([disabled])')
                    .first();
                if (await submenuButton.count()) {
                    await submenuButton.click({ force: true });
                } else {
                    await openViaNavigationRuntime(page, 'submenu-game');
                }
            }
        }
        await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
        return;
    }

    const navButton = page.locator(`#menu-nav [data-submenu="${submenuId}"]`).first();
    if (await navButton.count()) {
        await navButton.click({ force: true });
    } else {
        await openViaNavigationRuntime(page, submenuId);
    }
    await page.waitForSelector(`#${submenuId}:not(.hidden)`, { timeout: 4000 });
}

export async function openGameSubmenu(page, options = {}) {
    await openSubmenu(page, 'submenu-game', options);
}

export async function openStartSetupSection(page, sectionId) {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) {
        throw new Error('Start-Setup-Sektion fehlt.');
    }
    const gamePanelVisible = await page.locator('#submenu-game:not(.hidden)').count();
    if (!gamePanelVisible) {
        await openGameSubmenu(page);
    }
    const section = page.locator(`#submenu-game details[data-start-section="${normalizedSectionId}"]`).first();
    await section.waitFor({ state: 'attached', timeout: 4000 });
    const isOpen = await section.evaluate((element) => element instanceof HTMLDetailsElement && element.open);
    if (isOpen) return;
    let openedViaUi = false;
    try {
        await section.locator('summary').click({ force: true });
        await page.waitForFunction((id) => {
            const element = document.querySelector(`#submenu-game details[data-start-section="${id}"]`);
            return element instanceof HTMLDetailsElement && element.open === true;
        }, normalizedSectionId, { timeout: 4000 });
        openedViaUi = true;
    } catch {
        openedViaUi = false;
    }
    if (openedViaUi) return;

    const openedViaFallback = await page.evaluate((id) => {
        const element = document.querySelector(`#submenu-game details[data-start-section="${id}"]`);
        if (!(element instanceof HTMLDetailsElement)) return false;
        element.classList.remove('hidden');
        element.open = true;
        return element.open === true;
    }, normalizedSectionId);
    if (!openedViaFallback) {
        throw new Error(`Start-Setup-Sektion konnte nicht geoeffnet werden: ${normalizedSectionId}`);
    }
}

export async function openCustomSubmenu(page) {
    await openSubmenu(page, 'submenu-custom');
}

// Multiplayer is its own level-1 screen since 879e9ac4: the nav button carries both the session
// type and the panel target, so a single user click switches the session AND opens the lobby.
// There is no `details[data-start-section="multiplayer"]` inside #submenu-game any more.
// `allowRuntimeFallback: false` is for the test that proves the user path itself: the runtime
// fallback opens the lobby without the nav button, so it would hide a button that lost its
// panel binding while the second listener still switches the session type.
export async function openMultiplayerSubmenu(page, options = {}) {
    const requireActive = options.requireActive === true;
    const allowRuntimeFallback = options.allowRuntimeFallback !== false;
    const navButton = page
        .locator('#menu-nav [data-session-type="multiplayer"][data-submenu="submenu-multiplayer"]')
        .first();
    const readSessionType = () => page.evaluate(() => (
        String(window.GAME_INSTANCE?.settings?.localSettings?.sessionType || '').trim().toLowerCase()
    ));
    const lobbyOpened = () => page
        .waitForSelector('#submenu-multiplayer:not(.hidden)', { timeout: 4000 })
        .then(() => true)
        .catch(() => false);

    // The lobby hides the level-1 nav, so a second call would only burn the click timeout.
    const alreadyOpen = await page.locator('#submenu-multiplayer:not(.hidden)').count() > 0
        && await readSessionType() === 'multiplayer';
    if (alreadyOpen) return true;

    let lobbyVisible = false;
    let lastClickError = '';
    if (await navButton.count()) {
        // No `force` here: the level-1 grid is still settling right after the load, and a forced
        // click skips the stability check and lands next to the button.
        for (let attempt = 0; attempt < 2 && !lobbyVisible; attempt += 1) {
            await navButton.click({ timeout: 10_000 }).catch((error) => {
                lastClickError = String(error?.message || error).split('\n')[0];
            });
            lobbyVisible = await lobbyOpened();
        }
    }
    if (!lobbyVisible && allowRuntimeFallback) {
        await openViaNavigationRuntime(page, 'submenu-multiplayer').catch(() => {});
        lobbyVisible = await lobbyOpened();
    }
    const activeSessionType = await readSessionType();
    if (lobbyVisible && activeSessionType === 'multiplayer') {
        return true;
    }
    if (requireActive) {
        throw new Error(
            `Multiplayer-Lobby nicht aktiv (sessionType="${activeSessionType || 'unknown'}", `
            + `Lobby ${lobbyVisible ? 'sichtbar' : 'verborgen'}`
            + `${lastClickError ? `, letzter Klickfehler: ${lastClickError}` : ''}).`
        );
    }
    return false;
}

export async function openLevel4Drawer(page, options = {}) {
    const gamePanelVisible = await page.locator('#submenu-game:not(.hidden)').count();
    if (!gamePanelVisible) {
        await openGameSubmenu(page, options);
    }
    await page.click('#btn-open-level4');
    await page.waitForSelector('#submenu-level4:not(.hidden)', { timeout: 4000 });
    if (options.section) {
        const sectionId = String(options.section).trim();
        await page.click(`#submenu-level4 [data-level4-section-target="${sectionId}"]`);
        await page.waitForSelector(`#submenu-level4 [data-level4-section="${sectionId}"].is-active`, { timeout: 4000 });
    }
}

export async function openExpertSubmenu(page) {
    const expertPanel = page.locator('#submenu-expert');
    if (await expertPanel.count()) {
        const isVisible = await expertPanel.isVisible().catch(() => false);
        if (isVisible) return;
    }
    const level4DrawerVisible = await page.locator('#submenu-level4:not(.hidden)').count();
    if (level4DrawerVisible) {
        const closeDrawer = async () => {
            const drawer = document.getElementById('submenu-level4');
            if (!drawer || drawer.classList.contains('hidden')) return true;
            window.GAME_INSTANCE?.uiManager?.setLevel4Open?.(false);
            return !!drawer.classList.contains('hidden');
        };
        const closeButton = page.locator('#btn-close-level4').first();
        if (await closeButton.count()) {
            await closeButton.click({ force: true }).catch(() => {});
        }
        const drawerHiddenAfterClick = await page.evaluate(closeDrawer);
        if (!drawerHiddenAfterClick) {
            await page.waitForFunction(closeDrawer, null, { timeout: 4000 });
        }
    }
    const expertButton = page.locator('#btn-open-expert').first();
    if (await expertButton.count()) {
        await expertButton.waitFor({ state: 'visible', timeout: 4000 });
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await expertButton.click({ force: true });
            const panelVisible = await expertPanel.isVisible().catch(() => false);
            if (panelVisible) return;
            try {
                await openViaNavigationRuntime(page, 'submenu-expert');
                return;
            } catch {
                await page.waitForTimeout(150 * (attempt + 1));
            }
        }
    } else {
        await openViaNavigationRuntime(page, 'submenu-expert');
        return;
    }
    await page.waitForSelector('#submenu-expert:not(.hidden)', { timeout: 4000 });
}

export async function unlockExpertMode(page, password = '1307') {
    const isUnlocked = await page.evaluate(() => !!window.GAME_INSTANCE?.menuExpertLoginRuntime?.isUnlocked?.());
    if (isUnlocked) return;
    await openExpertSubmenu(page);
    await page.fill('#expert-password-input', password);
    await page.click('#btn-expert-unlock');
    await page.waitForFunction(() => !!window.GAME_INSTANCE?.menuExpertLoginRuntime?.isUnlocked?.(), null, { timeout: 4000 });
}

export async function lockExpertMode(page) {
    await openExpertSubmenu(page);
    const isUnlocked = await page.evaluate(() => !!window.GAME_INSTANCE?.menuExpertLoginRuntime?.isUnlocked?.());
    if (!isUnlocked) return;
    await page.click('#btn-expert-lock');
    await page.waitForFunction(() => !window.GAME_INSTANCE?.menuExpertLoginRuntime?.isUnlocked?.(), null, { timeout: 4000 });
}

export async function openDeveloperSubmenu(page) {
    await unlockExpertMode(page);
    await openExpertSubmenu(page);
    await page.click('#btn-open-developer');
    await page.waitForSelector('#submenu-developer:not(.hidden)', { timeout: 4000 });
}

export async function openDebugSubmenu(page) {
    await unlockExpertMode(page);
    await openExpertSubmenu(page);
    await page.click('#btn-open-debug');
    await page.waitForSelector('#submenu-debug:not(.hidden)', { timeout: 4000 });
}

const BENIGN_ERROR_PATTERNS = [
    /wasm streaming compile failed/i,
    /falling back to ArrayBuffer instantiation/i,
    /\[AiBot\] Failed to load model:/i,
    /\[MediaRecorderSystem\] VideoEncoder error/i,
    /Encoder creation error/i,
    /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/i,
];

function isBenignErrorMessage(message) {
    return BENIGN_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function triggerMatchStart(page, options = {}) {
    const allowRuntimeFallback = options.allowRuntimeFallback === true;
    const startResult = await page.evaluate((allowFallback) => {
        const startButton = document.querySelector('#submenu-game:not(.hidden) #btn-start');
        if (startButton instanceof HTMLButtonElement && !startButton.disabled) {
            startButton.click();
            return { ok: true, method: 'button' };
        }

        if (!allowFallback) {
            return { ok: false, reason: 'start-button-unavailable' };
        }

        // Recovery path: tests must opt in explicitly so product-near runs stay UI-first.
        const game = window.GAME_INSTANCE;
        if (game?.startMatch && typeof game.startMatch === 'function') {
            try {
                const result = game.startMatch();
                if (result === false) {
                    return { ok: false, reason: 'startMatch-returned-false' };
                }
                return { ok: true, method: 'runtime' };
            } catch (error) {
                return {
                    ok: false,
                    reason: `startMatch-error:${error?.message || String(error || 'unknown')}`,
                };
            }
        }

        return { ok: false, reason: 'start-trigger-unavailable' };
    }, allowRuntimeFallback);

    if (!startResult?.ok) {
        throw new Error(`Start-Trigger nicht verfuegbar (${startResult?.reason || 'unknown'}).`);
    }
}

async function openCustomSetupStep(page) {
    const setupSelectors = [
        '#submenu-custom:not(.hidden) [data-menu-step-target="submenu-custom"]:visible:not([disabled])',
        '#submenu-custom:not(.hidden) button:has-text("Setup frei anpassen"):visible:not([disabled])',
        '#submenu-custom:not(.hidden) button:has-text("Setup"):visible:not([disabled])',
    ];

    for (const selector of setupSelectors) {
        const button = page.locator(selector).first();
        if (await button.count()) {
            await button.click({ force: true });
            await page.waitForFunction(() => (
                !!document.querySelector('#submenu-custom:not(.hidden) [data-mode-path]:not([disabled])')
                || !!document.querySelector('#submenu-game:not(.hidden)')
            ), null, { timeout: 4000 }).catch(() => {});
            return true;
        }
    }
    return false;
}

async function selectModePath(page, modePath) {
    const modePathSelector = `#submenu-custom:not(.hidden) [data-mode-path="${modePath}"]:visible:not([disabled])`;
    let modeButton = page.locator(modePathSelector).first();
    if (!(await modeButton.count())) {
        const openedCustomSetupStep = await openCustomSetupStep(page);
        if (openedCustomSetupStep) {
            modeButton = page.locator(modePathSelector).first();
        }
    }

    if (await modeButton.count()) {
        await modeButton.click({ force: true });
        return;
    }

    const runtimeSelected = await page.evaluate((path) => {
        const candidates = [
            `#submenu-custom:not(.hidden) [data-mode-path="${path}"]`,
            `#submenu-custom [data-mode-path="${path}"]`,
        ];
        for (const selector of candidates) {
            const button = document.querySelector(selector);
            if (button instanceof HTMLButtonElement && !button.disabled) {
                button.click();
                return true;
            }
        }
        return false;
    }, modePath);

    if (!runtimeSelected) {
        throw new Error(`Mode-Pfad nicht verfuegbar: ${modePath}`);
    }
}

async function trySelectModePath(page, modePath) {
    try {
        await selectModePath(page, modePath);
        return true;
    } catch {
        return false;
    }
}

async function readMatchStartSnapshot(page) {
    return page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const hud = document.getElementById('hud');
        const huntHud = document.getElementById('hunt-hud');
        const startButton = document.querySelector('#submenu-game #btn-start');
        return {
            modePath: String(game?.settings?.localSettings?.modePath || ''),
            gameMode: String(game?.settings?.gameMode || ''),
            mapKey: String(game?.settings?.mapKey || ''),
            players: Number(game?.entityManager?.players?.length || 0),
            hudVisible: !!(hud && !hud.classList.contains('hidden')),
            huntHudVisible: !!(huntHud && !huntHud.classList.contains('hidden')),
            startLabel: startButton?.textContent?.trim?.() || '',
        };
    });
}

async function applyModePathRuntimeFallback(page, modePath) {
    return page.evaluate((requestedModePath) => {
        const normalizedModePath = String(requestedModePath || '').trim().toLowerCase();
        if (!normalizedModePath) {
            return { ok: false, reason: 'mode-path-missing' };
        }
        const game = window.GAME_INSTANCE;
        if (!game?.settings) {
            return { ok: false, reason: 'game-unavailable' };
        }

        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        if (!game.settings.hunt || typeof game.settings.hunt !== 'object') {
            game.settings.hunt = {};
        }

        game.settings.localSettings.modePath = normalizedModePath;
        if (normalizedModePath === 'fight') {
            game.settings.gameMode = 'HUNT';
            game.settings.hunt.respawnEnabled = true;
        } else if (normalizedModePath === 'normal' || normalizedModePath === 'arcade') {
            game.settings.gameMode = 'CLASSIC';
            game.settings.hunt.respawnEnabled = false;
        }

        const fallbackChangedKeys = [
            'session.modePath',
            'session.gameMode',
            'session.hunt.respawnEnabled',
            'session.mapKey',
        ];
        const compatibility = game.settingsManager?.applyMenuCompatibilityRules?.(game.settings, {
            changedKeys: fallbackChangedKeys,
        });
        const changedKeys = Array.isArray(compatibility?.changedKeys) && compatibility.changedKeys.length > 0
            ? compatibility.changedKeys
            : fallbackChangedKeys;
        game.uiManager?.syncByChangeKeys?.(changedKeys);
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', {
            trigger: 'test_helper_force_mode_path',
            modePath: normalizedModePath,
        });

        return {
            ok: true,
            changedKeys,
            modePath: String(game.settings?.localSettings?.modePath || ''),
            gameMode: String(game.settings?.gameMode || ''),
            mapKey: String(game.settings?.mapKey || ''),
        };
    }, modePath);
}

async function ensureModePathSelected(page, modePath, options = {}) {
    const expectedModePath = String(modePath || '').trim().toLowerCase();
    const expectedGameMode = expectedModePath === 'fight' ? 'HUNT' : 'CLASSIC';
    const before = await readMatchStartSnapshot(page);
    if (before.modePath === expectedModePath && before.gameMode === expectedGameMode) {
        return;
    }

    if (options.allowRuntimeFallback !== true) {
        throw new Error(
            `Mode-Pfad nicht via UI stabil gesetzt: erwartet ${expectedModePath}/${expectedGameMode}, ` +
            `ist ${before.modePath || 'n/a'}/${before.gameMode || 'n/a'}`
        );
    }

    // Recovery path: this mutates runtime state and must be explicitly enabled by the caller.
    const fallbackResult = await applyModePathRuntimeFallback(page, expectedModePath);
    if (!fallbackResult?.ok) {
        throw new Error(`Mode-Pfad Fallback fehlgeschlagen (${fallbackResult?.reason || 'unknown'})`);
    }

    const after = await readMatchStartSnapshot(page);
    if (after.modePath !== expectedModePath || after.gameMode !== expectedGameMode) {
        throw new Error(
            `Mode-Pfad nicht stabil gesetzt: erwartet ${expectedModePath}/${expectedGameMode}, ` +
            `ist ${after.modePath || 'n/a'}/${after.gameMode || 'n/a'}`
        );
    }
}

async function waitForHuntRuntimeReady(page, minimumPlayers = 1, timeoutMs = 60000) {
    try {
        await page.waitForFunction((requiredPlayers) => {
            const hud = document.getElementById('hud');
            const huntHud = document.getElementById('hunt-hud');
            const game = window.GAME_INSTANCE;
            return !!(
                hud && !hud.classList.contains('hidden')
                && huntHud && !huntHud.classList.contains('hidden')
                && game?.entityManager?.players?.length >= requiredPlayers
            );
        }, minimumPlayers, { timeout: timeoutMs });
    } catch {
        const snapshot = await readMatchStartSnapshot(page);
        throw new Error(
            `Hunt-Start Timeout: modePath=${snapshot.modePath || 'n/a'} ` +
            `gameMode=${snapshot.gameMode || 'n/a'} map=${snapshot.mapKey || 'n/a'} ` +
            `hudVisible=${snapshot.hudVisible} huntHudVisible=${snapshot.huntHudVisible} ` +
            `players=${snapshot.players} startLabel=${snapshot.startLabel || 'n/a'}`
        );
    }
}

export async function startGameFromMenu(page, options = {}) {
    await waitForLoadedGame(page);
    await openGameSubmenu(page);
    await triggerMatchStart(page, options);
    await page.waitForFunction(() => {
        const hud = document.getElementById('hud');
        const g = window.GAME_INSTANCE;
        return !!(
            hud && !hud.classList.contains('hidden')
            && g?.entityManager?.players?.length > 0
        );
    }, null, { timeout: 60000 });
}

// Start game with default configuration.
export async function startGame(page, options = {}) {
    await loadGame(page);
    await startGameFromMenu(page, options);
}

// Start game with N bots.
export async function startGameWithBots(page, botCount = 1, options = {}) {
    await loadGame(page);
    await openGameSubmenu(page);
    await page.evaluate((count) => {
        const slider = document.getElementById('bot-count');
        slider.value = String(count);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, botCount);
    await triggerMatchStart(page, options);
    await page.waitForFunction(() => {
        const hud = document.getElementById('hud');
        const g = window.GAME_INSTANCE;
        return !!(
            hud && !hud.classList.contains('hidden')
            && g?.entityManager?.players?.length > 0
        );
    }, null, { timeout: 60000 });
}

// Start hunt mode with default bot count.
export async function startHuntGame(page, options = {}) {
    await loadGame(page);
    await openCustomSubmenu(page);
    await trySelectModePath(page, 'fight');
    await ensureModePathSelected(page, 'fight', options);
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await triggerMatchStart(page, options);
    await waitForHuntRuntimeReady(page, 1, 60000);
}

// Start hunt mode with configurable bot count.
export async function startHuntGameWithBots(page, botCount = 1, options = {}) {
    await loadGame(page);
    await openCustomSubmenu(page);
    await trySelectModePath(page, 'fight');
    await ensureModePathSelected(page, 'fight', options);
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.evaluate((count) => {
        const slider = document.getElementById('bot-count');
        slider.value = String(count);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, botCount);
    await triggerMatchStart(page, options);
    await waitForHuntRuntimeReady(page, 2, 60000);
}

// Press ESC and wait for main menu.
export async function returnToMenu(page) {
    const getMenuState = () => page.evaluate(() => {
        const mainMenu = document.getElementById('main-menu');
        const visiblePanel = document.querySelector('.submenu-panel:not(.hidden)');
        const menuVisible = (() => {
            if (!(mainMenu instanceof HTMLElement) || mainMenu.classList.contains('hidden')) return false;
            const style = window.getComputedStyle(mainMenu);
            return style.display !== 'none' && style.visibility !== 'hidden';
        })();
        return {
            gameState: String(window.GAME_INSTANCE?.state || ''),
            menuVisible,
            visiblePanelId: visiblePanel?.id || '',
        };
    });
    const isMainNavVisible = async () => {
        const menuState = await getMenuState();
        return menuState.menuVisible && !menuState.visiblePanelId;
    };

    const initialMenuState = await getMenuState();
    if (initialMenuState.menuVisible && !initialMenuState.visiblePanelId) return;

    if (!initialMenuState.menuVisible) {
        await page.evaluate(async () => {
            await window.GAME_INSTANCE?._returnToMenu?.();
        });
    } else {
        await page.keyboard.press('Escape');
        if (await isMainNavVisible()) return;

        await page.evaluate(async () => {
            await window.GAME_INSTANCE?._returnToMenu?.();
        });
    }
    await page.waitForFunction(() => {
        const mainMenu = document.getElementById('main-menu');
        const visiblePanel = document.querySelector('.submenu-panel:not(.hidden)');
        if (String(window.GAME_INSTANCE?.state || '') !== 'MENU') {
            return false;
        }
        if (!(mainMenu instanceof HTMLElement) || mainMenu.classList.contains('hidden')) {
            return false;
        }
        const style = window.getComputedStyle(mainMenu);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }
        if (!(visiblePanel instanceof HTMLElement)) {
            return true;
        }
        return visiblePanel.id === 'submenu-game'
            || (visiblePanel.id === 'submenu-custom'
                && document.getElementById('four-player-planar-setup')?.classList.contains('hidden') === false);
    }, null, { timeout: 8000 });
}

// Register error listeners and return captured error list.
export function collectErrors(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            const message = msg.text();
            if (isBenignErrorMessage(message)) return;
            const location = msg.location();
            const source = location?.url ? ` source=${location.url}` : '';
            errors.push(`console.error: ${message}${source}`);
        }
    });
    return errors;
}
