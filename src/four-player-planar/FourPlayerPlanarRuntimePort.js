/**
 * Publishes exactly the runtime capabilities the four player planar module
 * needs, so the module no longer keeps a back reference to the whole runtime.
 *
 * @param {object} options
 * @param {() => object|null} options.getRuntime
 */
export function createFourPlayerPlanarRuntimePort({ getRuntime }) {
    const runtime = () => getRuntime?.() || null;
    return {
        getSettings() {
            return runtime()?.settings || null;
        },
        /** Local settings are created on demand so callers can write into them. */
        ensureLocalSettings() {
            const settings = runtime()?.settings;
            if (!settings) return null;
            if (!settings.localSettings) settings.localSettings = {};
            return settings.localSettings;
        },
        getGlobalKeyBindings() {
            return runtime()?.input?.bindings?.GLOBAL || {};
        },
        notifySettingsChanged() {
            runtime()?._onSettingsChanged?.();
        },
        startMatch() {
            runtime()?.startMatch?.();
        },
        getRuntimeConfig() {
            return runtime()?.runtimeConfig || null;
        },
        getGameStateId() {
            return runtime()?.state ?? null;
        },
        getPlayers() {
            return runtime()?.entityManager?.players || [];
        },
        getHuntScoreboard() {
            return runtime()?.entityManager?.getHuntScoreboard?.() || [];
        },
        getGlobalFogState() {
            return runtime()?.entityManager?.getGlobalFogState?.() || null;
        },
        /** Forces third person on every local viewport of the planar match. */
        forceThirdPersonCameras(playerCount) {
            const cameraModes = runtime()?.renderer?.cameraModes;
            if (!Array.isArray(cameraModes)) return;
            const limit = Math.min(playerCount, cameraModes.length);
            for (let index = 0; index < limit; index += 1) cameraModes[index] = 0;
        },
    };
}
