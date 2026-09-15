'use strict';

// Electron-free close lifecycle for the desktop main window.
//
// Every side effect is injected as a dependency so the state machine can be
// exercised in plain Node contract tests.

const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 30000;

const CLOSE_PHASE = Object.freeze({
    IDLE: 'idle',
    EXPORT_DECISION: 'export-decision',
    HANDSHAKE: 'handshake',
    CLOSING: 'closing',
});

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
 */
function createMainWindowCloseLifecycle({
    getWindow,
    isExportActive = () => false,
    cancelExport = async () => {},
    confirmExportClose = async () => 'stay',
    requestGracefulClose = () => {},
    addReadyListener = () => {},
    removeReadyListener = () => {},
    isTrustedReadySender = () => true,
    timeoutMs = DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onError = () => {},
} = {}) {
    let phase = CLOSE_PHASE.IDLE;
    let exportCloseApproved = false;
    let timeoutId = null;
    let readyListener = null;

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
        // manager.
        timeoutId = setTimeoutFn(() => {
            timeoutId = null;
            finish({ force: true });
        }, timeoutMs);

        try {
            requestGracefulClose();
        } catch {
            // Renderer already gone — proceed immediately.
            finish({ force: true });
        }
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
            if (phase === CLOSE_PHASE.HANDSHAKE || phase === CLOSE_PHASE.EXPORT_DECISION) return;
            if (!exportCloseApproved && isExportActive() === true) {
                startExportDecision();
                return;
            }
            startHandshake();
        },
        async handleRenderProcessGone() {
            if (phase === CLOSE_PHASE.CLOSING) return;
            if (isExportActive() === true) {
                try {
                    await cancelExport({ reason: 'render_process_gone' });
                } catch (error) {
                    onError(error);
                }
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
