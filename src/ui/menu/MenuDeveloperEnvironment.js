import { resolveElectronDeveloperEnvironment } from '../../platform/electron/ElectronPlatformBridge.js';

/**
 * Decides whether this runtime is a development environment: the desktop shell reports it
 * (source start or --dev-tools), a browser only counts when it runs on the Vite dev server.
 * Players on a packaged build never get developer tools.
 *
 * @param {{ runtimeGlobal?: typeof globalThis, viteDev?: boolean }} [options]
 * @returns {boolean}
 */
export function resolveMenuDeveloperEnvironment({
    runtimeGlobal = globalThis,
    viteDev = /** @type {any} */ (import.meta).env?.DEV === true,
} = {}) {
    return resolveElectronDeveloperEnvironment(runtimeGlobal) || viteDev === true;
}
