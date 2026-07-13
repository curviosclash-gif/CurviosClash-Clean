import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test as base } from '@playwright/test';

const require = createRequire(import.meta.url);

const ELECTRON_DIR = path.resolve(process.cwd(), 'electron');
const ELECTRON_EXECUTABLE = require(path.resolve(ELECTRON_DIR, 'node_modules', 'electron'));
const DESKTOP_DIAGNOSTICS_FILE = 'desktop-startup-diagnostics.json';
const DESKTOP_MAIN_PROCESS_LOG_FILE = 'desktop-main-process.log';
const DESKTOP_RENDERER_CONSOLE_LOG_FILE = 'desktop-renderer-console.log';
const DESKTOP_RENDERER_ERRORS_LOG_FILE = 'desktop-renderer-errors.log';
const DESKTOP_READY_SCREENSHOT_FILE = 'desktop-renderer-ready.png';
const DESKTOP_FAILURE_SCREENSHOT_FILE = 'desktop-renderer-failure.png';
const DESKTOP_READY_TIMEOUT_MS = 60000;

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

async function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`Desktop-Readiness-Timeout bei ${label} nach ${timeoutMs}ms`));
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
    consoleMessages,
    rendererErrors,
    mainProcessEvents,
    artifactPaths,
    activeScreenshotPath,
    processInfo,
    failureKind,
    failureHints,
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
        },
        mainProcess: processInfo,
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

export const test = base.extend({
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

        try {
            app = await electron.launch({
                executablePath: ELECTRON_EXECUTABLE,
                args: ['.'],
                cwd: ELECTRON_DIR,
                env: {
                    ...process.env,
                    CURVIOS_ELECTRON_SHOW_WINDOW: String(process.env.CURVIOS_ELECTRON_SHOW_WINDOW || '0'),
                },
            });

            const childProcess = app.process?.() || null;
            recordMainProcess(
                'harness',
                `launch executable=${ELECTRON_EXECUTABLE} cwd=${ELECTRON_DIR} runProfile=${String(process.env.PW_RUN_PROFILE || 'preview-smoke')}`
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
            recordStage('renderer_loaded', {
                url: page.url(),
            });

            await waitForPreloadBridge(page, DESKTOP_READY_TIMEOUT_MS);
            recordStage('preload_bridge_ready', {
                url: page.url(),
            });

            try {
                await page.screenshot({
                    path: artifactPaths.readyScreenshotPath,
                    timeout: 5000,
                });
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
                await page.screenshot({
                    path: artifactPaths.failureScreenshotPath,
                    timeout: 5000,
                }).then(() => {
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
            await app?.close().catch(() => {});
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
                    consoleMessages: summarizeConsoleMessages(rendererConsoleEntries),
                    rendererErrors: summarizeRendererErrors(rendererErrorEntries),
                    mainProcessEvents: summarizeMainProcess(mainProcessEntries),
                    artifactPaths,
                    activeScreenshotPath,
                    processInfo,
                    failureKind,
                    failureHints,
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

export { expect };
