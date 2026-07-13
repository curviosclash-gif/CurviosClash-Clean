export function disposeMatchSessionSystems(renderer, currentSession, options = {}) {
    if (currentSession?.entityManager) {
        currentSession.entityManager.dispose();
    }
    if (currentSession?.powerupManager) {
        currentSession.powerupManager.dispose();
    }
    if (currentSession?.arena?.dispose) {
        currentSession.arena.dispose();
    }
    if (currentSession?.particles?.dispose) {
        currentSession.particles.dispose();
    }
    if (options.clearScene !== false) {
        renderer.clearMatchScene();
    }
}

export function buildHumanConfigs(settings, runtimeConfig = null) {
    const runtimeVehicles = runtimeConfig?.player?.vehicles || null;
    return [
        {
            invertPitch: !!settings?.invertPitch?.PLAYER_1,
            cockpitCamera: true,
            vehicleId: runtimeVehicles?.PLAYER_1 || settings?.vehicles?.PLAYER_1,
        },
        {
            invertPitch: !!settings?.invertPitch?.PLAYER_2,
            cockpitCamera: true,
            vehicleId: runtimeVehicles?.PLAYER_2 || settings?.vehicles?.PLAYER_2,
        },
    ];
}

export function buildEntityManagerSetupOptions(settings, runtimeConfig = null, entityRuntimeConfig = null, setupOptions = null) {
    const runtimeBotConfig = runtimeConfig?.bot || null;
    const setupPlanarMode = runtimeConfig?.gameplay?.planarMode ?? settings?.gameplay?.planarMode;
    return {
        modelScale: runtimeConfig?.player?.modelScale ?? settings?.gameplay?.planeScale,
        botDifficulty: runtimeConfig?.bot?.activeDifficulty || settings?.botDifficulty || 'NORMAL',
        botPolicyType: runtimeBotConfig?.policyType || null,
        activeGameMode: runtimeConfig?.session?.activeGameMode || settings?.gameMode || null,
        planarMode: typeof setupPlanarMode === 'boolean' ? setupPlanarMode : undefined,
        runtimeConfig,
        entityRuntimeConfig,
        isDesktopRuntime: setupOptions?.isDesktopRuntime,
        humanConfigs: buildHumanConfigs(settings, runtimeConfig),
    };
}
