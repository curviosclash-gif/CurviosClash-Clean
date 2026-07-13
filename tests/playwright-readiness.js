import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const DEFAULT_SERVER_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_SERVER_READINESS_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_APP_BOOT_SNAPSHOT_TIMEOUT_MS = 1_500;
const DEFAULT_RUN_PROFILE = 'desktop-smoke';
const RUN_PROFILE_ALIASES = Object.freeze({
    'preview-smoke': 'desktop-smoke',
    'dev-runtime': 'desktop-e2e',
    'browser-contract': 'browser-compat',
});
const DEFAULT_SERVER_PROBE_PATH = '/';
const STARTUP_FAILURE_STAGES = new Set(['idle', 'goto', 'startup_probe', 'http_probe']);
const READINESS_FAILURE_STAGES = new Set([
    'shell_ready',
    'runtime_ready',
    'return_to_menu_probe',
    'return_to_menu',
    'menu_idle',
    'browser_prewarm',
]);
const PLAYWRIGHT_FLAKE_REASON_PATTERNS = [
    ['page_closed', /Target page, context or browser has been closed/i],
    ['browser_closed', /browser has been closed/i],
    ['frame_detached', /frame was detached/i],
    ['execution_context_destroyed', /Execution context was destroyed/i],
    ['navigation_aborted', /net::ERR_ABORTED/i],
    ['page_crashed', /page crashed/i],
];
const RUN_PROFILE_FAILURE_FALLBACKS = Object.freeze({
    'browser-compat': 'contract',
    'desktop-e2e': 'runtime-regression',
});

function hasMainMenuDomHint(html) {
    const source = String(html || '');
    return (
        source.includes('id="main-menu"')
        || source.includes("id='main-menu'")
        || source.includes('#main-menu')
    );
}

function resolveRunProfile(rawValue = process.env.PW_RUN_PROFILE) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    return RUN_PROFILE_ALIASES[normalized] || normalized || DEFAULT_RUN_PROFILE;
}

function toProbeErrorMessage(error) {
    return String(error?.message || 'request_failed');
}

async function probeHttpViaNode(url, timeoutMs, { expectDomHint } = {}) {
    const targetUrl = new URL(url);
    const client = targetUrl.protocol === 'https:' ? https : http;

    return await new Promise((resolve) => {
        const req = client.request(targetUrl, {
            method: 'GET',
            headers: {
                'cache-control': 'no-store',
                accept: '*/*',
            },
        }, (res) => {
            const status = Number(res.statusCode || 0);
            const ok = status >= 200 && status < 400;

            if (expectDomHint) {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    if (body.length > 120_000) return;
                    body += chunk;
                });
                res.on('end', () => {
                    resolve({
                        ok,
                        status,
                        error: null,
                        domHintSeen: hasMainMenuDomHint(body),
                    });
                });
            } else {
                res.resume();
                res.once('end', () => {
                    resolve({
                        ok,
                        status,
                        error: null,
                        domHintSeen: null,
                    });
                });
            }
        });

        const timeout = setTimeout(() => {
            req.destroy(new Error('probe-timeout'));
        }, timeoutMs);

        req.once('error', (error) => {
            clearTimeout(timeout);
            resolve({
                ok: false,
                status: 0,
                error: toProbeErrorMessage(error),
                domHintSeen: null,
            });
        });

        req.once('close', () => {
            clearTimeout(timeout);
        });

        req.end();
    });
}

function toResponseOk(response) {
    if (typeof response?.ok === 'function') {
        return response.ok();
    }
    return response?.ok === true;
}

function toResponseStatus(response) {
    if (typeof response?.status === 'function') {
        return Number(response.status()) || 0;
    }
    return Number(response?.status) || 0;
}

function createFallbackSnapshot(overrides = {}) {
    return {
        pageClosed: false,
        mainMenuVisible: false,
        runtimeReady: false,
        visiblePanelId: null,
        errorOverlayVisible: false,
        errorOverlayText: '',
        documentReadyState: 'unavailable',
        locationHref: '',
        appBootState: 'booting',
        ...overrides,
    };
}

function findPlaywrightFlakeReason(error) {
    const message = String(error?.message || error || '').trim();
    if (!message) return null;
    for (const [reason, pattern] of PLAYWRIGHT_FLAKE_REASON_PATTERNS) {
        if (pattern.test(message)) {
            return reason;
        }
    }
    return null;
}

function normalizeStage(stage) {
    const normalized = String(stage || '').trim();
    return normalized || 'idle';
}

function resolveFailureReason(stage, serverReady, shellReady, appReady, appBootState, error, pageClosed) {
    if (pageClosed === true) return 'page_closed';
    const flakeReason = findPlaywrightFlakeReason(error);
    if (flakeReason) return flakeReason;
    if (!serverReady) {
        return stage === 'goto' ? 'startup_navigation_failed' : 'server_not_ready';
    }
    if (!shellReady) return 'shell_not_ready';
    if (!appReady) {
        if (appBootState === 'runtime_error_overlay') return 'runtime_error_overlay';
        return `app_boot_${appBootState}`;
    }
    if (READINESS_FAILURE_STAGES.has(stage)) {
        return `${stage}_incomplete`;
    }
    if (STARTUP_FAILURE_STAGES.has(stage)) {
        return `${stage}_failed`;
    }
    return error ? 'transient_playwright_error' : null;
}

export function resolvePlaywrightFailureTaxonomy(options = {}) {
    const runProfile = resolveRunProfile(options.runProfile);
    const stage = normalizeStage(options.stage);
    const failureReason = String(options.failureReason || '').trim();
    const pageClosed = options.pageClosed === true;
    const flakeReason = findPlaywrightFlakeReason(options.error);
    const hasError = options.error != null;
    const serverReady = options.serverReady === true;
    const shellReady = options.shellReady === true;
    const appReady = options.appReady === true;

    if (pageClosed || flakeReason || failureReason === 'page_closed') {
        return 'flake';
    }
    if (!failureReason && !hasError) {
        return null;
    }
    if (!serverReady || STARTUP_FAILURE_STAGES.has(stage)) {
        return 'startup';
    }
    if (!shellReady || !appReady || READINESS_FAILURE_STAGES.has(stage)) {
        return 'readiness';
    }
    const fallbackClass = RUN_PROFILE_FAILURE_FALLBACKS[runProfile];
    if (fallbackClass) {
        return fallbackClass;
    }
    return 'readiness';
}

export function summarizeAppReadiness(appBootSnapshot) {
    return {
        shellReady: appBootSnapshot?.mainMenuVisible === true,
        appReady: appBootSnapshot?.runtimeReady === true,
        appBootState: String(appBootSnapshot?.appBootState || 'booting'),
    };
}

export function isServerProbeReady(serverProbe, options = {}) {
    if (!serverProbe || serverProbe.ok !== true) return false;
    if (options.requireDomHint !== true) return true;
    return serverProbe.domHintSeen === true;
}

export function createPlaywrightReadinessContract(options = {}) {
    const stage = normalizeStage(options.stage);
    const runProfile = resolveRunProfile(options.runProfile);
    const serverProbe = options.serverProbe && typeof options.serverProbe === 'object'
        ? options.serverProbe
        : {
            ok: false,
            status: 0,
            error: null,
            url: DEFAULT_SERVER_PROBE_PATH,
            domHintSeen: null,
        };
    const appBoot = options.appBootSnapshot && typeof options.appBootSnapshot === 'object'
        ? options.appBootSnapshot
        : createFallbackSnapshot();
    const requireDomHint = options.requireDomHint === true;
    const appReadiness = summarizeAppReadiness(appBoot);
    const serverReady = isServerProbeReady(serverProbe, { requireDomHint });
    const shellReady = appReadiness.shellReady;
    const appReady = appReadiness.appReady;
    const appBootState = appReadiness.appBootState;
    const failureReason = resolveFailureReason(
        stage,
        serverReady,
        shellReady,
        appReady,
        appBootState,
        options.error,
        appBoot.pageClosed === true
    );
    const failureClass = resolvePlaywrightFailureTaxonomy({
        runProfile,
        stage,
        failureReason,
        error: options.error,
        pageClosed: appBoot.pageClosed === true,
        serverReady,
        shellReady,
        appReady,
    });

    return {
        stage,
        runProfile,
        serverProbe,
        serverReady,
        shellReady,
        appReady,
        appBootState,
        appBoot,
        failureClass,
        failureReason,
        errorMessage: options.error ? String(options.error?.message || options.error) : null,
    };
}

export function formatPlaywrightReadinessContract(contract) {
    const parts = [];
    if (contract?.failureClass) parts.push(`failureClass="${contract.failureClass}"`);
    if (contract?.failureReason) parts.push(`failureReason="${contract.failureReason}"`);
    parts.push(`stage="${normalizeStage(contract?.stage)}"`);
    parts.push(`serverReady=${contract?.serverReady === true}`);
    parts.push(`shellReady=${contract?.shellReady === true}`);
    parts.push(`appReady=${contract?.appReady === true}`);
    parts.push(`appBootState="${String(contract?.appBootState || 'booting')}"`);
    return parts.join(' ');
}

export async function probeServerReadiness(target, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1, Number(options.timeoutMs))
        : DEFAULT_SERVER_PROBE_TIMEOUT_MS;
    const requestPath = String(options.path || DEFAULT_SERVER_PROBE_PATH);
    const expectDomHint = options.expectDomHint === true;
    const useNodeFetch = options.useNodeFetch === true;

    const host = String(process.env.TEST_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const port = String(process.env.TEST_PORT || '').trim();
    const baseUrl = port ? `http://${host}:${port}` : null;
    const absoluteUrl = baseUrl ? `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}` : null;

    if (useNodeFetch || typeof target === 'string' || target instanceof URL) {
        const url = useNodeFetch ? String(absoluteUrl || requestPath) : String(target);
        try {
            const result = await probeHttpViaNode(url, timeoutMs, { expectDomHint });
            return { ...result, url };
        } catch (error) {
            return {
                ok: false,
                status: 0,
                error: toProbeErrorMessage(error),
                url,
                domHintSeen: null,
            };
        }
    }

    try {
        const response = await target.context().request.get(requestPath, {
            failOnStatusCode: false,
            timeout: timeoutMs,
        });
        const probe = {
            ok: toResponseOk(response),
            status: toResponseStatus(response),
            error: null,
            url: requestPath,
            domHintSeen: null,
        };
        if (expectDomHint) {
            probe.domHintSeen = hasMainMenuDomHint(await response.text());
        }
        return probe;
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: toProbeErrorMessage(error),
            url: requestPath,
            domHintSeen: null,
        };
    }
}

export async function waitForServerReadiness(target, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1, Number(options.timeoutMs))
        : 30_000;
    const requestPath = String(options.path || DEFAULT_SERVER_PROBE_PATH);
    const expectDomHint = options.expectDomHint === true;
    const requireDomHint = options.requireDomHint === true;
    const useNodeFetch = options.useNodeFetch === true;
    const startedAt = performance.now();
    let lastProbe = null;
    let delayMs = Number.isFinite(options.delayMs) ? Math.max(50, Number(options.delayMs)) : 250;

    while (performance.now() - startedAt < timeoutMs) {
        const elapsed = performance.now() - startedAt;
        const remaining = timeoutMs - elapsed;
        const probeTimeoutMs = Number.isFinite(options.probeTimeoutMs)
            ? Math.max(1_000, Math.min(Number(options.probeTimeoutMs), remaining))
            : Math.max(1_000, Math.min(DEFAULT_SERVER_READINESS_PROBE_TIMEOUT_MS, remaining));

        lastProbe = await probeServerReadiness(target, {
            path: requestPath,
            timeoutMs: probeTimeoutMs,
            expectDomHint,
            useNodeFetch,
        });

        if (isServerProbeReady(lastProbe, { requireDomHint })) {
            return lastProbe;
        }

        if (remaining <= 100) break;

        const sleepMs = Math.min(delayMs, Math.max(50, remaining - 50));
        if (typeof target?.waitForTimeout === 'function') {
            await target.waitForTimeout(sleepMs);
        } else {
            await new Promise((resolve) => setTimeout(resolve, sleepMs));
        }

        delayMs = Math.min(2_000, Math.round(delayMs * 1.4));
    }

    const error = new Error(
        `[playwright-readiness] server not ready after ${timeoutMs}ms at path "${requestPath}" ` +
        `(lastProbe url="${String(lastProbe?.url || '')}" ok=${lastProbe?.ok === true} ` +
        `status=${Number(lastProbe?.status || 0)} error="${String(lastProbe?.error || '')}")`
    );
    error.cause = lastProbe?.error ? new Error(String(lastProbe.error)) : undefined;
    throw error;
}

export async function captureAppBootSnapshot(page, options = {}) {
    if (page.isClosed()) {
        return createFallbackSnapshot({
            pageClosed: true,
            appBootState: 'page_closed',
        });
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1, Number(options.timeoutMs))
        : DEFAULT_APP_BOOT_SNAPSHOT_TIMEOUT_MS;
    const timedOut = Symbol('snapshot-timeout');
    try {
        const snapshotPromise = page.evaluate(() => {
            const menu = document.getElementById('main-menu');
            const visiblePanel = document.querySelector('.submenu-panel:not(.hidden)');
            const errorOverlay = document.getElementById('runtime-error-overlay');
            const mainMenuVisible = (() => {
                if (!(menu instanceof HTMLElement) || menu.classList.contains('hidden')) return false;
                const style = window.getComputedStyle(menu);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })();
            const errorOverlayVisible = (() => {
                if (!(errorOverlay instanceof HTMLElement) || errorOverlay.classList.contains('hidden')) return false;
                const style = window.getComputedStyle(errorOverlay);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })();
            const runtimeReady = !!globalThis?.GAME_INSTANCE;
            return {
                pageClosed: false,
                mainMenuVisible,
                runtimeReady,
                visiblePanelId: visiblePanel instanceof HTMLElement ? visiblePanel.id : null,
                errorOverlayVisible,
                errorOverlayText: errorOverlayVisible
                    ? String(errorOverlay?.textContent || '').slice(0, 400)
                    : '',
                documentReadyState: String(document.readyState || ''),
                locationHref: String(window.location.href || ''),
                appBootState: runtimeReady
                    ? 'runtime_ready'
                    : (errorOverlayVisible
                        ? 'runtime_error_overlay'
                        : (mainMenuVisible ? 'menu_shell_ready' : 'booting')),
            };
        });

        const snapshot = await Promise.race([
            snapshotPromise,
            page.waitForTimeout(timeoutMs).then(() => timedOut),
        ]);

        if (snapshot === timedOut) {
            snapshotPromise.catch(() => {});
            return createFallbackSnapshot({
                pageClosed: false,
                appBootState: 'snapshot_unavailable',
                snapshotError: `snapshot-timeout:${timeoutMs}ms`,
            });
        }

        return snapshot;
    } catch (error) {
        return createFallbackSnapshot({
            pageClosed: false,
            appBootState: 'snapshot_unavailable',
            snapshotError: toProbeErrorMessage(error),
        });
    }
}

export async function waitForShellOrRuntimeReady(page, timeoutMs) {
    await page.waitForFunction(() => {
        const menu = document.getElementById('main-menu');
        const runtimeReady = !!globalThis?.GAME_INSTANCE;
        if (runtimeReady) return true;
        if (!(menu instanceof HTMLElement) || menu.classList.contains('hidden')) return false;
        const style = window.getComputedStyle(menu);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }, null, { timeout: timeoutMs });
}

export async function waitForRuntimeReady(page, timeoutMs) {
    await page.waitForFunction(() => !!globalThis?.GAME_INSTANCE, null, { timeout: timeoutMs });
}

export async function collectPlaywrightStageDiagnostics(page, stage, options = {}) {
    const [serverProbe, appBoot] = await Promise.all([
        probeServerReadiness(page, {
            path: options.path,
            timeoutMs: options.serverProbeTimeoutMs,
            expectDomHint: options.expectDomHint,
            useNodeFetch: options.useNodeFetch,
        }),
        captureAppBootSnapshot(page, { timeoutMs: options.snapshotTimeoutMs }),
    ]);
    return createPlaywrightReadinessContract({
        stage,
        runProfile: options.runProfile,
        serverProbe,
        appBootSnapshot: appBoot,
        requireDomHint: options.requireDomHint,
        error: options.error,
    });
}
