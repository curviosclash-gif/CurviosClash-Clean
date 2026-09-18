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
        /**
         * Reads maps saved in the desktop editor again. Runs through the UI so
         * the main map picker is redrawn along with the split setups.
         */
        refreshLocalMapCatalog() {
            return runtime()?.runtimeCoordinator?.getUiManager?.()?.refreshLocalMapCatalog?.() === true;
        },
        notifySettingsChanged() {
            runtime()?._onSettingsChanged?.();
        },
        /** Passes the runtime answer on so a rejected start can be undone. */
        startMatch() {
            return runtime()?.startMatch?.();
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
        /** Inbound rocket threat of one player - the same source the Hunt HUD reads. */
        getRocketThreat(playerIndex) {
            return runtime()?.entityManager?._projectileSystem?.getRocketThreat?.(playerIndex) || null;
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
