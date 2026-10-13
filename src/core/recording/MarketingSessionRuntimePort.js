export function createMarketingSessionRuntimePort(runtime) {
    return {
        get audio() { return runtime.audio; },
        get activeGameMode() { return runtime.activeGameMode; },
        get entityManager() { return runtime.entityManager; },
        get gameLoop() { return runtime.gameLoop; },
        get input() { return runtime.input; },
        get mapKey() { return runtime.mapKey; },
        get matchSessionRuntimeBridge() { return runtime.matchSessionRuntimeBridge; },
        get mediaRecorderSystem() { return runtime.mediaRecorderSystem; },
        get numBots() { return runtime.numBots; },
        get numHumans() { return runtime.numHumans; },
        get particles() { return runtime.particles; },
        get recorder() { return runtime.recorder; },
        get renderer() { return runtime.renderer; },
        get runtimeConfig() { return runtime.runtimeConfig; },
        get settings() { return runtime.settings; },
        get state() { return runtime.state; },
        get update() { return runtime.update; },
        set update(value) { runtime.update = value; },
        applySettings() { return runtime._applySettingsToRuntime({ schedulePrewarm: false }); },
        startMatch() { return runtime.startMatch(); },
    };
}
