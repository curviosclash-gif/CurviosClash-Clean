import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test as base } from '@playwright/test';
import {
    DEFAULT_TEARDOWN_DEADLINE_MS,
    closeElectronAppWithDeadline,
    destroyAllElectronWindows,
    resolveShowWindow,
    resolveTestRenderMode,
    shouldForceDesktopWindowTeardown,
} from './desktop-process-teardown.mjs';
import { installFreshBootGuards, markFreshBoot } from './fresh-boot-mark.mjs';

const require = createRequire(import.meta.url);

const ELECTRON_DIR = path.resolve(process.cwd(), 'electron');
const IS_BROWSER_COMPAT = String(process.env.PW_RUN_PROFILE || '').trim() === 'browser-compat';
const ELECTRON_EXECUTABLE = IS_BROWSER_COMPAT
    ? null
    : require(path.resolve(ELECTRON_DIR, 'node_modules', 'electron'));
const DESKTOP_DIAGNOSTICS_FILE = 'desktop-startup-diagnostics.json';
const DESKTOP_MAIN_PROCESS_LOG_FILE = 'desktop-main-process.log';
const DESKTOP_RENDERER_CONSOLE_LOG_FILE = 'desktop-renderer-console.log';
const DESKTOP_RENDERER_ERRORS_LOG_FILE = 'desktop-renderer-errors.log';
const DESKTOP_READY_SCREENSHOT_FILE = 'desktop-renderer-ready.png';
const DESKTOP_FAILURE_SCREENSHOT_FILE = 'desktop-renderer-failure.png';
const DESKTOP_READY_TIMEOUT_MS = 60000;
const DESKTOP_SCREENSHOT_TIMEOUT_MS = 15000;
// Kurz gehalten: Beide Schritte sind reine Abfragen im Abbau. Antwortet die Seite
// oder der Hauptprozess nicht sofort, bleibt der bisherige Weg mit seiner Frist.
const DESKTOP_WINDOW_TEARDOWN_TIMEOUT_MS = 5000;

// Ohne eigenen Profilpfad schreiben alle Desktop-Tests in %APPDATA%\curviosclash-app,
// also in dasselbe Verzeichnis wie die echte App des Nutzers. Ein Lauf bekommt hier
// einen eigenen Unterordner; PW_FRESH_PROFILE=1 gibt zusaetzlich jedem Test einen.
function resolveDesktopUserDataRoot(testInfo) {
    const configuredRoot = String(process.env.CURVIOS_USER_DATA_ROOT || '').trim();
    // Same slug rule as the cluster runner, so a hand-set tag can never leave tmp/playwright.
    const runTag = String(process.env.PW_RUN_TAG || '')
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'local';
    const baseRoot = configuredRoot
        ? path.resolve(configuredRoot)
        : path.resolve(process.cwd(), 'tmp', 'playwright', runTag, 'user-data');
    return String(process.env.PW_FRESH_PROFILE || '').trim() === '1'
        ? path.join(baseRoot, String(testInfo?.testId || 'test'))
        : baseRoot;
}

function toIsoNow(timestamp = Date.now()) {
    return new Date(timestamp).toISOString();
}

function serializeError(error) {
    if (!error) return null;
    return {
        name: String(error?.name || 'Error'),
        message: String(error?.message || String(error)),
        stack: typeof error?.stack === 'string'
            ? error.stack.split('\n').slice(0, 8).join('\n')
            : null,
    };
}

async function writeJson(filePath, payload) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, payload) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${String(payload || '')}\n`, 'utf8');
}

async function captureElectronWindowScreenshot(app, filePath) {
    const pngBase64 = await withTimeout(app.evaluate(async ({ BrowserWindow }) => {
        const browserWindow = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed());
        if (!browserWindow) {
            throw new Error('Kein Electron-Fenster fuer Screenshot verfuegbar.');
        }
        const image = await browserWindow.webContents.capturePage();
        return image.toPNG().toString('base64');
    }), DESKTOP_SCREENSHOT_TIMEOUT_MS, 'desktop screenshot');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(pngBase64, 'base64'));
}

async function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`Desktop-Timeout bei ${label} nach ${timeoutMs}ms`));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitForPreloadBridge(page, timeoutMs) {
    await page.waitForFunction(() => (
        globalThis.__CURVIOS_APP__ === true
        && globalThis.curviosApp?.isApp === true
    ), null, { timeout: timeoutMs });
}

function formatLocation(location) {
    if (!location || typeof location !== 'object') return '';
    const url = String(location.url || '').trim();
    const hasLine = Number.isFinite(location.lineNumber);
    const hasColumn = Number.isFinite(location.columnNumber);
    if (!url && !hasLine && !hasColumn) return '';
    const lineSuffix = hasLine ? `:${location.lineNumber + 1}` : '';
    const columnSuffix = hasColumn ? `:${location.columnNumber + 1}` : '';
    return `${url || 'unknown'}${lineSuffix}${columnSuffix}`;
}

function pushChunk(entries, stream, chunk) {
    const text = String(chunk || '').replace(/\r\n/g, '\n').trimEnd();
    if (!text) return;
    entries.push({
        recordedAt: toIsoNow(),
        stream,
        text,
    });
}

function hasStage(events, stageName) {
    return events.some((entry) => entry.stage === stageName);
}

function getLastStage(events) {
    return events.length ? String(events[events.length - 1]?.stage || 'unknown') : 'not_started';
}

function isDesktopFlake(error) {
    const message = String(error?.message || error || '');
    return message.includes('Target page, context or browser has been closed')
        || message.includes('Target closed')
        || message.includes('Browser has been closed');
}

function resolveDesktopFailureKind({ events, error, setupComplete }) {
    if (isDesktopFlake(error)) {
        return 'desktop-flake';
    }
    if (setupComplete || hasStage(events, 'preload_bridge_ready')) {
        return 'desktop-runtime-regression';
    }
    if (!hasStage(events, 'window_created')) {
        return 'desktop-startup';
    }
    return 'desktop-readiness';
}

function dedupeStrings(values) {
    const seen = new Set();
    const unique = [];
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}

function resolveDesktopFailureHints({
    events,
    error,
    rendererErrors,
    mainProcessEvents,
    processExit,
}) {
    const message = String(error?.message || error || '');
    const hints = [];

    if (/Desktop-App-Build fehlt/i.test(message)) {
        hints.push('`electron/static-server.cjs` konnte `dist/index.html` nicht lesen; der Desktop-Build fehlt fuer den Smoke-Start.');
    }

    if (!hasStage(events, 'window_created')) {
        hints.push('Das erste Electron-Fenster wurde nicht erreicht; pruefe `desktop-main-process.log` fuer Main-Prozess-Start, Dist- und Static-Server-Fehler.');
    } else if (!hasStage(events, 'renderer_loaded')) {
        hints.push('Das Fenster existiert, aber der Renderer hat `did-finish-load` nicht erreicht; der Fehler liegt vor produktiver Renderer-Readiness.');
    } else if (!hasStage(events, 'preload_bridge_ready')) {
        hints.push('Der Renderer ist geladen, aber `__CURVIOS_APP__`/`curviosApp` fehlen; pruefe `electron/preload.cjs` und `desktop-renderer-errors.log`.');
    } else {
        hints.push('Die Desktop-Readiness war bereits gruen; der Fail liegt danach im produktnahen Runtime-/Smoke-Pfad.');
    }

    if (rendererErrors.length > 0) {
        hints.push('Renderer-Fehler wurden mitgeschrieben; starte bei `desktop-renderer-errors.log` und dem Failure-Screenshot.');
    }

    if (mainProcessEvents.some((entry) => entry.stream === 'stderr' || entry.stream === 'error')) {
        hints.push('Der Electron-Main-Prozess hat Fehlerausgaben geliefert; `desktop-main-process.log` enthaelt den Boot-Kontext.');
    }

    if (processExit && !hasStage(events, 'preload_bridge_ready')) {
        hints.push(
            `Der Electron-Prozess endete vor abgeschlossener Desktop-Readiness (code=${processExit.code ?? 'null'}, signal=${processExit.signal ?? 'null'}).`
        );
    }

    if (isDesktopFlake(error)) {
        hints.push('Das Fail-Muster passt zu einem geschlossenen Target/Fokus-Rauschen; als `desktop-flake` einstufen und Artefakte gegenpruefen.');
    }

    return dedupeStrings(hints);
}

function formatMainProcessLog(entries) {
    if (!entries.length) {
        return '[desktop-main-process] no output recorded';
    }
    return entries.map((entry) => {
        const header = `[${entry.recordedAt}] ${entry.stream}`;
        return `${header}\n${entry.text}`;
    }).join('\n\n');
}

function formatRendererConsoleLog(entries) {
    if (!entries.length) {
        return '[desktop-renderer-console] no console messages recorded';
    }
    return entries.map((entry) => {
        const header = `[${entry.recordedAt}] ${entry.type}`;
        const location = entry.location ? ` @ ${entry.location}` : '';
        return `${header}${location}\n${entry.text}`;
    }).join('\n\n');
}

function formatRendererErrorsLog(entries) {
    if (!entries.length) {
        return '[desktop-renderer-errors] no renderer errors recorded';
    }
    return entries.map((entry) => {
        const header = `[${entry.recordedAt}] ${entry.source}${entry.type ? `:${entry.type}` : ''}`;
        const location = entry.location ? ` @ ${entry.location}` : '';
        const detail = entry.detail ? `\n${entry.detail}` : '';
        return `${header}${location}\n${entry.message}${detail}`;
    }).join('\n\n');
}

async function captureRendererState(page) {
    if (!page) {
        return {
            url: '',
            title: '',
            closed: true,
        };
    }
    return {
        url: page.url(),
        title: page.isClosed() ? '' : await page.title().catch(() => ''),
        closed: page.isClosed(),
    };
}

// Liest im Abbau, ob im Hauptfenster noch ein laufendes Spiel sitzt. Nur dieses
// beantwortet den Schliess-Handschlag der Shell; jede andere Seite (Vehicle Lab,
// 3D-Karteneditor, Hangar-Seite) laesst ihn unbeantwortet.
async function probeMainWindowGameRuntime(page) {
    if (!page || page.isClosed()) {
        return { pageClosed: true, gameInstancePresent: null, probeError: null };
    }
    try {
        const gameInstancePresent = await withTimeout(
            page.evaluate(() => Boolean(globalThis.GAME_INSTANCE)),
            DESKTOP_WINDOW_TEARDOWN_TIMEOUT_MS,
            'graceful-close probe'
        );
        return { pageClosed: false, gameInstancePresent: gameInstancePresent === true, probeError: null };
    } catch (error) {
        return {
            pageClosed: page.isClosed(),
            gameInstancePresent: null,
            probeError: serializeCompactError(error),
        };
    }
}

// Ohne Spiel im Hauptfenster wartet die Shell 30 s auf eine Antwort, die nie
// kommt; die Abbaufrist des Geschirrs schlaegt dann nach 20 s mit einem harten
// Kill zu. Stattdessen nimmt das Geschirr sofort den Notweg der Shell selbst:
// Fenster zerstoeren, danach beendet sich die App ueber 'window-all-closed'.
async function releaseWindowsWithoutGracefulClose(app, page) {
    if (!app) return { applied: false, reason: 'no_app' };
    const probe = await probeMainWindowGameRuntime(page);
    if (!shouldForceDesktopWindowTeardown(probe)) {
        let reason = 'game_page';
        if (probe.probeError) reason = 'probe_failed';
        else if (probe.pageClosed) reason = 'page_closed';
        return { applied: false, reason, probeError: probe.probeError };
    }
    try {
        const windows = await withTimeout(
            app.evaluate(destroyAllElectronWindows),
            DESKTOP_WINDOW_TEARDOWN_TIMEOUT_MS,
            'window teardown'
        );
        return { applied: true, reason: 'no_game_in_main_window', windows };
    } catch (error) {
        return { applied: false, reason: 'destroy_failed', probeError: serializeCompactError(error) };
    }
}

function summarizeConsoleMessages(entries) {
    return entries.slice(-20).map((entry) => ({
        type: entry.type,
        text: entry.text.slice(0, 400),
        location: entry.location,
    }));
}

function summarizeRendererErrors(entries) {
    return entries.slice(-20).map((entry) => ({
        source: entry.source,
        type: entry.type,
        message: entry.message.slice(0, 400),
        detail: entry.detail ? entry.detail.slice(0, 800) : null,
        location: entry.location || '',
    }));
}

function summarizeMainProcess(entries) {
    return entries.slice(-20).map((entry) => ({
        stream: entry.stream,
        text: entry.text.slice(0, 800),
        recordedAt: entry.recordedAt,
    }));
}

function annotateDesktopError(error, { diagnosticsPath, failureKind, failureHints }) {
    const suffix = [
        `[desktop-smoke][${failureKind}]`,
        failureHints[0] ? `hint=${failureHints[0]}` : '',
        `diagnostics=${diagnosticsPath}`,
    ].filter(Boolean).join(' ');

    if (error instanceof Error) {
        error.message = `${error.message}\n${suffix}`;
        return error;
    }

    return new Error(`${String(error || 'Desktop-Smoke fehlgeschlagen')}\n${suffix}`);
}

function serializeCompactError(error) {
    if (!error) return 'unknown-error';
    const name = String(error?.name || 'Error');
    const message = String(error?.message || String(error)).split('\n')[0];
    return `${name}: ${message}`;
}

async function createDesktopDiagnostics({
    testInfo,
    events,
    rendererState,
    mainFrameNavigations = [],
    consoleMessages,
    rendererErrors,
    mainProcessEvents,
    artifactPaths,
    activeScreenshotPath,
    processInfo,
    failureKind,
    failureHints,
    teardown = null,
    error = null,
}) {
    return {
        runProfile: String(process.env.PW_RUN_PROFILE || 'preview-smoke'),
        runTag: String(process.env.PW_RUN_TAG || ''),
        test: {
            title: testInfo.title,
            status: testInfo.status,
            expectedStatus: testInfo.expectedStatus,
            outputDir: testInfo.outputDir,
        },
        readiness: {
            stages: events,
            lastStage: getLastStage(events),
            expectedFinalStage: 'preload_bridge_ready',
            ready: events.some((entry) => entry.stage === 'preload_bridge_ready'),
        },
        failure: {
            kind: failureKind,
            hints: failureHints,
        },
        renderer: {
            url: rendererState.url,
            title: rendererState.title,
            closed: rendererState.closed,
            mainFrameLoads: 1 + mainFrameNavigations.filter((entry) => !entry.duringHarnessBoot).length,
            mainFrameNavigations: mainFrameNavigations.slice(-10),
        },
        mainProcess: processInfo,
        teardown,
        artifacts: {
            diagnostics: artifactPaths.diagnosticsPath,
            mainProcessLog: artifactPaths.mainProcessLogPath,
            rendererConsoleLog: artifactPaths.rendererConsoleLogPath,
            rendererErrorsLog: artifactPaths.rendererErrorsLogPath,
            readyScreenshot: artifactPaths.readyScreenshotPath,
            failureScreenshot: artifactPaths.failureScreenshotPath,
            activeScreenshot: activeScreenshotPath,
        },
        consoleMessages,
        rendererErrors,
        mainProcessEvents,
        error: serializeError(error),
        recordedAt: toIsoNow(),
    };
}

const desktopTest = base.extend({
    desktopHarness: async ({}, use, testInfo) => {
        const artifactPaths = {
            diagnosticsPath: testInfo.outputPath(DESKTOP_DIAGNOSTICS_FILE),
            mainProcessLogPath: testInfo.outputPath(DESKTOP_MAIN_PROCESS_LOG_FILE),
            rendererConsoleLogPath: testInfo.outputPath(DESKTOP_RENDERER_CONSOLE_LOG_FILE),
            rendererErrorsLogPath: testInfo.outputPath(DESKTOP_RENDERER_ERRORS_LOG_FILE),
            readyScreenshotPath: testInfo.outputPath(DESKTOP_READY_SCREENSHOT_FILE),
            failureScreenshotPath: testInfo.outputPath(DESKTOP_FAILURE_SCREENSHOT_FILE),
        };
        const events = [];
        const rendererConsoleEntries = [];
        const rendererErrorEntries = [];
        const mainProcessEntries = [];
        let activeScreenshotPath = '';
        let processPid = null;
        let processExit = null;
        let processError = null;
        let failureKind = null;
        let failureHints = [];
        let setupComplete = false;
        let appClosing = false;
        let app = null;
        let page = null;
        let capturedError = null;
        let harnessChildProcess = null;
        // Counting main document loads is the cheap, load independent proof that the
        // app boots once per test instead of twice. The harness boot itself commits
        // before firstWindow() resolves, so it is counted as the fixed first load and
        // every navigation observed after it is an extra boot.
        const mainFrameNavigations = [];
        let harnessBootSettled = false;

        const recordStage = (stage, extra = {}) => {
            events.push({
                stage,
                recordedAt: toIsoNow(),
                ...extra,
            });
        };

        const recordMainProcess = (stream, chunk) => {
            pushChunk(mainProcessEntries, stream, chunk);
        };

        const userDataRoot = resolveDesktopUserDataRoot(testInfo);
        // Ein verstecktes Fenster rendert mit rund einem Bild pro Sekunde; Tests, die auf
        // gezeichnete Bilder warten (@render), sind damit strukturell unerfuellbar.
        // Der Render-Modus (siehe resolveTestRenderMode) ersetzt das versteckte Fenster
        // durch ein gezeigtes weit ausserhalb des Bildschirms: volle Bildrate, kein Fokus.
        const showWindow = resolveShowWindow(process.env, testInfo?.titlePath || []);

        try {
            await mkdir(userDataRoot, { recursive: true });
            app = await electron.launch({
                executablePath: ELECTRON_EXECUTABLE,
                args: ['.'],
                cwd: ELECTRON_DIR,
                env: {
                    ...process.env,
                    CURVIOS_ELECTRON_SHOW_WINDOW: showWindow ? '1' : '0',
                    CURVIOS_ELECTRON_TEST_RENDER: resolveTestRenderMode(process.env),
                    CURVIOS_DESKTOP_STATIC_PORT: String(process.env.TEST_PORT || ''),
                    CURVIOS_USER_DATA_ROOT: userDataRoot,
                },
            });

            const childProcess = app.process?.() || null;
            harnessChildProcess = childProcess;
            recordMainProcess(
                'harness',
                `launch executable=${ELECTRON_EXECUTABLE} cwd=${ELECTRON_DIR} `
                + `runProfile=${String(process.env.PW_RUN_PROFILE || 'preview-smoke')} `
                + `userDataRoot=${userDataRoot}`
            );

            if (childProcess?.stdout) {
                childProcess.stdout.on('data', (chunk) => {
                    recordMainProcess('stdout', chunk);
                });
            } else {
                recordMainProcess('harness', 'stdout stream unavailable');
            }

            if (childProcess?.stderr) {
                childProcess.stderr.on('data', (chunk) => {
                    recordMainProcess('stderr', chunk);
                });
            } else {
                recordMainProcess('harness', 'stderr stream unavailable');
            }

            if (childProcess) {
                childProcess.on('exit', (code, signal) => {
                    processExit = {
                        code: code ?? null,
                        signal: signal ?? null,
                        recordedAt: toIsoNow(),
                    };
                    recordMainProcess('exit', `code=${code ?? 'null'} signal=${signal ?? 'null'}`);
                });
                childProcess.on('error', (error) => {
                    processError = serializeError(error);
                    recordMainProcess('error', processError?.stack || processError?.message || 'unknown child process error');
                });
            }

            recordStage('process_started', {
                pid: childProcess?.pid ?? null,
            });
            processPid = childProcess?.pid ?? null;

            page = await withTimeout(app.firstWindow(), DESKTOP_READY_TIMEOUT_MS, 'window_created');
            page.on('framenavigated', (frame) => {
                if (frame !== page.mainFrame()) return;
                mainFrameNavigations.push({
                    recordedAt: toIsoNow(),
                    url: String(frame.url() || ''),
                    duringHarnessBoot: !harnessBootSettled,
                });
            });
            page.on('console', (message) => {
                const type = String(message?.type?.() || '').trim().toLowerCase() || 'log';
                const location = formatLocation(message?.location?.());
                const entry = {
                    recordedAt: toIsoNow(),
                    type,
                    text: String(message?.text?.() || ''),
                    location,
                };
                rendererConsoleEntries.push(entry);
                if (type === 'error' || type === 'warning' || type === 'assert') {
                    rendererErrorEntries.push({
                        recordedAt: entry.recordedAt,
                        source: 'console',
                        type,
                        message: entry.text,
                        detail: '',
                        location,
                    });
                }
            });
            page.on('pageerror', (error) => {
                const serialized = serializeError(error);
                rendererErrorEntries.push({
                    recordedAt: toIsoNow(),
                    source: 'pageerror',
                    type: serialized?.name || 'Error',
                    message: serialized?.message || 'unknown page error',
                    detail: serialized?.stack || '',
                    location: '',
                });
            });
            page.on('crash', () => {
                rendererErrorEntries.push({
                    recordedAt: toIsoNow(),
                    source: 'page',
                    type: 'crash',
                    message: 'Renderer process crashed.',
                    detail: '',
                    location: '',
                });
            });
            page.on('close', () => {
                if (appClosing) return;
                rendererErrorEntries.push({
                    recordedAt: toIsoNow(),
                    source: 'page',
                    type: 'close',
                    message: 'Renderer window closed before harness teardown.',
                    detail: '',
                    location: '',
                });
            });

            recordStage('window_created', {
                url: page.url(),
            });

            await page.waitForLoadState('load', { timeout: DESKTOP_READY_TIMEOUT_MS });
            harnessBootSettled = true;
            recordStage('renderer_loaded', {
                url: page.url(),
            });

            await waitForPreloadBridge(page, DESKTOP_READY_TIMEOUT_MS);
            recordStage('preload_bridge_ready', {
                url: page.url(),
            });

            try {
                await captureElectronWindowScreenshot(app, artifactPaths.readyScreenshotPath);
                activeScreenshotPath = artifactPaths.readyScreenshotPath;
            } catch (screenshotError) {
                const detail = serializeCompactError(screenshotError);
                recordStage('ready_screenshot_skipped', { reason: detail });
                rendererErrorEntries.push({
                    recordedAt: toIsoNow(),
                    source: 'harness',
                    type: 'ready-screenshot-failed',
                    message: 'Ready screenshot skipped after timeout/error.',
                    detail,
                    location: '',
                });
            }
            setupComplete = true;

            // The app is booted and untouched at this point: loadGame may skip its own
            // navigation. The guards drop that mark again as soon as a test registers
            // something that needs a following navigation, and the listener baseline
            // taken here covers tests that want to watch a load (collectErrors).
            installFreshBootGuards({ page, context: page.context() });
            markFreshBoot(page);

            await use({
                app,
                page,
                diagnosticsPath: artifactPaths.diagnosticsPath,
                screenshotPath: artifactPaths.readyScreenshotPath,
                artifacts: artifactPaths,
            });
        } catch (error) {
            capturedError = error;
            failureKind = resolveDesktopFailureKind({
                events,
                error,
                setupComplete,
            });
            failureHints = resolveDesktopFailureHints({
                events,
                error,
                rendererErrors: rendererErrorEntries,
                mainProcessEvents: mainProcessEntries,
                processExit,
            });
            if (page && !page.isClosed()) {
                await captureElectronWindowScreenshot(app, artifactPaths.failureScreenshotPath).then(() => {
                    activeScreenshotPath = artifactPaths.failureScreenshotPath;
                }).catch(() => {});
            }
            throw annotateDesktopError(error, {
                diagnosticsPath: artifactPaths.diagnosticsPath,
                failureKind,
                failureHints,
            });
        } finally {
            appClosing = true;
            const rendererState = await captureRendererState(page);
            const windowRelease = await releaseWindowsWithoutGracefulClose(app, page);
            const teardown = {
                ...await closeElectronAppWithDeadline({
                    app,
                    childProcess: harnessChildProcess,
                    deadlineMs: DEFAULT_TEARDOWN_DEADLINE_MS,
                }),
                windowRelease,
            };
            if (windowRelease.applied) {
                recordMainProcess(
                    'harness',
                    `teardown destroyed ${windowRelease.windows} window(s): no game in the main window, `
                    + 'so nobody could answer the graceful-close handshake'
                );
            }
            if (teardown.forcedKill) {
                recordMainProcess(
                    'harness',
                    `teardown forced kill after ${teardown.afterMs}ms (deadline=${teardown.deadlineMs}ms, exited=${teardown.exited})`
                );
            }
            failureKind = failureKind || (capturedError
                ? resolveDesktopFailureKind({
                    events,
                    error: capturedError,
                    setupComplete,
                })
                : null);
            failureHints = !capturedError
                ? []
                : failureHints.length
                ? failureHints
                : resolveDesktopFailureHints({
                    events,
                    error: capturedError,
                    rendererErrors: rendererErrorEntries,
                    mainProcessEvents: mainProcessEntries,
                    processExit,
                });
            const processInfo = {
                pid: processPid,
                exitCode: processExit?.code ?? null,
                exitSignal: processExit?.signal ?? null,
                processError,
            };
            await Promise.allSettled([
                writeText(artifactPaths.mainProcessLogPath, formatMainProcessLog(mainProcessEntries)),
                writeText(artifactPaths.rendererConsoleLogPath, formatRendererConsoleLog(rendererConsoleEntries)),
                writeText(artifactPaths.rendererErrorsLogPath, formatRendererErrorsLog(rendererErrorEntries)),
                writeJson(artifactPaths.diagnosticsPath, await createDesktopDiagnostics({
                    testInfo,
                    events,
                    rendererState,
                    mainFrameNavigations,
                    consoleMessages: summarizeConsoleMessages(rendererConsoleEntries),
                    rendererErrors: summarizeRendererErrors(rendererErrorEntries),
                    mainProcessEvents: summarizeMainProcess(mainProcessEntries),
                    artifactPaths,
                    activeScreenshotPath,
                    processInfo,
                    failureKind,
                    failureHints,
                    teardown,
                    error: capturedError,
                })),
            ]);
        }
    },
    electronApp: async ({ desktopHarness }, use) => {
        await use(desktopHarness.app);
    },
    page: async ({ desktopHarness }, use) => {
        await use(desktopHarness.page);
    },
});

export const test = IS_BROWSER_COMPAT ? base : desktopTest;

export { expect };
