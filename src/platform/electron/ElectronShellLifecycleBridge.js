// ============================================
// ElectronShellLifecycleBridge.js
// Thin adapter for the Electron shell's graceful-close lifecycle contract.
//
// This module deliberately does NOT import the full ElectronPlatformBridge
// to avoid pulling the platform capability chain (PlatformCapabilityContract,
// PlatformCapabilityRegistry) into TypeScript's analysis of AppInitializer.js.
//
// Approved adapter for the curviosApp legacy-surface guard matrix.
// ============================================

const LIFECYCLE_CONTRACT_VERSION = 'preload.lifecycle.v1';

/**
 * Resolves the lifecycle sub-contract from the Electron preload.
 * Returns null if not running in Electron or if the preload is absent.
 *
 * @param {typeof globalThis} [runtimeGlobal]
 * @returns {{ onGracefulClose: Function, confirmGracefulClose: Function, contractVersion: string } | null}
 */
function resolveLifecycleContract(runtimeGlobal = globalThis) {
    const appRuntime = runtimeGlobal?.curviosApp;
    if (!appRuntime || typeof appRuntime !== 'object') return null;
    const contracts = appRuntime?.contracts && typeof appRuntime.contracts === 'object'
        ? appRuntime.contracts : null;
    const lifecycle = contracts?.lifecycle ?? appRuntime?.lifecycle ?? null;
    if (!lifecycle || typeof lifecycle !== 'object') return null;
    if (typeof lifecycle.onGracefulClose !== 'function'
        || typeof lifecycle.confirmGracefulClose !== 'function') return null;
    return lifecycle;
}

/**
 * Creates a thin lifecycle adapter for the shell's graceful-close handshake.
 *
 * When the Electron window is closed the main process sends 'request-graceful-close'.
 * Callers subscribe via onGracefulClose(cb), run their teardown (e.g. game.dispose()),
 * and signal completion via confirmGracefulClose().  isAvailable() returns false in
 * browser environments where no preload lifecycle contract exists.
 *
 * @param {typeof globalThis} [runtimeGlobal]
 * @returns {{
 *   isAvailable: () => boolean,
 *   onGracefulClose: (cb: () => void | Promise<void>) => (() => void),
 *   confirmGracefulClose: () => void,
 *   contractVersion: string,
 * }}
 */
export function createElectronShellLifecycleAdapter(runtimeGlobal = globalThis) {
    const lifecycle = resolveLifecycleContract(runtimeGlobal);
    const available = lifecycle !== null;

    return Object.freeze({
        isAvailable: () => available,
        contractVersion: lifecycle?.contractVersion || LIFECYCLE_CONTRACT_VERSION,
        onGracefulClose: available
            ? (callback) => lifecycle.onGracefulClose(callback)
            : () => () => {},
        confirmGracefulClose: available
            ? () => lifecycle.confirmGracefulClose()
            : () => {},
    });
}
