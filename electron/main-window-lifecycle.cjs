'use strict';

// Electron-free close lifecycle for the desktop main window.
//
// Every side effect is injected as a dependency so the state machine can be
// exercised in plain Node contract tests.

const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 30000;

const CLOSE_PHASE = Object.freeze({
    IDLE: 'idle',
    EXPORT_DECISION: 'export-decision',
    AWAITING_EXPORT: 'awaiting-export',
    HANDSHAKE: 'handshake',
    CLOSING: 'closing',
});

// A renderer that exited on its own after a normal teardown is not a crash; the
// regular close path already owns the window at that point.
const CLEAN_RENDERER_EXIT_REASON = 'clean-exit';

/**
 * @typedef {'idle' | 'export-decision' | 'awaiting-export' | 'handshake' | 'closing'} ClosePhase
 */

/**
 * @typedef {'wait' | 'cancel-export' | 'stay'} ExportCloseDecision
 */

/**
 * @typedef {object} CloseableWindow
 * @property {() => boolean} [isDestroyed]
 * @property {() => void} close
 * @property {() => void} [destroy]
 */

/**
 * @typedef {(event?: unknown) => void} GracefulCloseReadyListener
 */

/**
 * @typedef {object} MainWindowCloseLifecycleOptions
 * @property {() => (CloseableWindow | null | undefined)} [getWindow]
 * @property {() => boolean} [isExportActive]
 * @property {(payload: { reason: string }) => unknown} [cancelExport]
 * @property {() => unknown} [settleExport] Resolves once a running export ended.
 * @property {() => (ExportCloseDecision | Promise<ExportCloseDecision>)} [confirmExportClose]
 * @property {() => void} [requestGracefulClose]
 * @property {(handler: GracefulCloseReadyListener) => unknown} [addReadyListener]
 * @property {(handler: GracefulCloseReadyListener) => unknown} [removeReadyListener]
 * @property {(event?: unknown) => boolean} [isTrustedReadySender]
 * @property {number} [timeoutMs]
 * @property {(handler: () => void, delayMs: number) => unknown} [setTimeoutFn]
 * @property {(handle: unknown) => void} [clearTimeoutFn]
 * @property {(error: unknown) => void} [onError]
 */

/**
 * @typedef {object} MainWindowCloseLifecycle
 * @property {(event?: { preventDefault?: () => void }) => void} handleClose
 * @property {(details?: { reason?: string } | null) => Promise<void>} handleRenderProcessGone
 * @property {() => boolean} isClosing
 * @property {() => ClosePhase} getPhase
 */

/**
 * Drives the graceful-close handshake of the main window.
 *
 * Guarantees:
 * - every handshake arms the fallback timeout, including the one that follows a
 *   confirmed video-export close dialog,
 * - repeated close clicks reuse the running handshake instead of stacking
 *   listeners and timeouts,
 * - a dead renderer cancels a running export and tears the window down, because
 *   it can never answer the handshake.
 *
 * @param {MainWindowCloseLifecycleOptions} [options]
 * @returns {MainWindowCloseLifecycle}
 */
function createMainWindowCloseLifecycle({
    getWindow,
    isExportActive = () => false,
    cancelExport = async () => {},
    settleExport = async () => {},
    confirmExportClose = async () => /** @type {ExportCloseDecision} */ ('stay'),
    requestGracefulClose = () => {},
    addReadyListener = () => {},
    removeReadyListener = () => {},
    isTrustedReadySender = () => true,
    timeoutMs = DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onError = () => {},
} = {}) {
    /** @type {ClosePhase} */
    let phase = CLOSE_PHASE.IDLE;
    /** @type {boolean} */
    let exportCloseApproved = false;
    /** @type {unknown} */
    let timeoutId = null;
    /** @type {GracefulCloseReadyListener | null} */
    let readyListener = null;

    /** @returns {CloseableWindow | null} */
    function resolveLiveWindow() {
        const window = getWindow?.();
        if (!window) return null;
        if (typeof window.isDestroyed === 'function' && window.isDestroyed()) return null;
        return window;
    }

    function clearHandshakeResources() {
        if (timeoutId !== null) {
            clearTimeoutFn(timeoutId);
            timeoutId = null;
        }
        if (readyListener) {
            removeReadyListener(readyListener);
            readyListener = null;
        }
    }

    /** @param {{ force?: boolean }} [options] */
    function finish({ force = false } = {}) {
        if (phase === CLOSE_PHASE.CLOSING) return;
        phase = CLOSE_PHASE.CLOSING;
        clearHandshakeResources();
        const window = resolveLiveWindow();
        if (!window) return;
        if (force && typeof window.destroy === 'function') {
            window.destroy();
            return;
        }
        window.close();
    }

    function startHandshake() {
        phase = CLOSE_PHASE.HANDSHAKE;
        readyListener = (event) => {
            if (!isTrustedReadySender(event)) return;
            finish();
        };
        addReadyListener(readyListener);
        // The fallback timeout is unconditional: without it an unresponsive or
        // dead renderer would leave the window only killable via the task
        // manager. A still-running export is aborted first so FFmpeg and its
        // temp files never outlive the window.
        timeoutId = setTimeoutFn(() => {
            timeoutId = null;
            if (isExportActive() === true) {
                void abortExportThenFinish('graceful_close_timeout');
                return;
            }
            finish({ force: true });
        }, timeoutMs);

        try {
            requestGracefulClose();
        } catch {
            // Renderer already gone — proceed immediately.
            finish({ force: true });
        }
    }

    /** @param {string} reason */
    async function abortExportThenFinish(reason) {
        if (phase === CLOSE_PHASE.CLOSING) return;
        try {
            await cancelExport({ reason });
        } catch (error) {
            onError(error);
        }
        finish({ force: true });
    }

    // "Wait for the export" means exactly that: the renderer keeps encoding and
    // the window only starts its teardown handshake once the export ended. A
    // timeout here would silently truncate every export longer than timeoutMs.
    async function startExportSettleWait() {
        phase = CLOSE_PHASE.AWAITING_EXPORT;
        try {
            await settleExport();
        } catch (error) {
            onError(error);
        }
        if (phase !== CLOSE_PHASE.AWAITING_EXPORT) return;
        startHandshake();
    }

    function startExportDecision() {
        phase = CLOSE_PHASE.EXPORT_DECISION;
        Promise.resolve()
            .then(() => confirmExportClose())
            .then(async (decision) => {
                if (phase !== CLOSE_PHASE.EXPORT_DECISION) return;
                phase = CLOSE_PHASE.IDLE;
                if (decision === 'stay') return;
                exportCloseApproved = true;
                if (decision === 'cancel-export') {
                    try {
                        await cancelExport({ reason: 'application_close_confirmed' });
                    } catch (error) {
                        onError(error);
                    }
                }
                if (phase !== CLOSE_PHASE.IDLE) return;
                resolveLiveWindow()?.close();
            })
            .catch((error) => {
                if (phase === CLOSE_PHASE.EXPORT_DECISION) phase = CLOSE_PHASE.IDLE;
                onError(error);
            });
    }

    return Object.freeze({
        handleClose(event) {
            if (phase === CLOSE_PHASE.CLOSING) return;
            event?.preventDefault?.();
            if (phase !== CLOSE_PHASE.IDLE) return;
            if (isExportActive() === true) {
                if (!exportCloseApproved) {
                    startExportDecision();
                    return;
                }
                void startExportSettleWait();
                return;
            }
            startHandshake();
        },
        async handleRenderProcessGone(details = null) {
            if (details?.reason === CLEAN_RENDERER_EXIT_REASON) return;
            if (phase === CLOSE_PHASE.CLOSING) return;
            if (isExportActive() === true) {
                await abortExportThenFinish('render_process_gone');
                return;
            }
            finish({ force: true });
        },
        isClosing() {
            return phase === CLOSE_PHASE.CLOSING;
        },
        getPhase() {
            return phase;
        },
    });
}

module.exports = {
    DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS,
    CLOSE_PHASE,
    createMainWindowCloseLifecycle,
};
