import {
    FOUR_PLAYER_PLANAR_PLAYER_COLORS,
    SPLIT_SCREEN_VARIANTS,
} from '../../four-player-planar/FourPlayerPlanarContract.js';

export function disposeMatchSessionSystems(renderer, currentSession, options = {}) {
    currentSession?.endlessParcoursRuntime?.dispose?.();
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
    const fightLoadouts = runtimeConfig?.session?.modePath === 'fight'
        ? runtimeConfig?.player?.fightLoadouts || null
        : null;
    const configuredHumanCount = Math.max(1, Number(runtimeConfig?.session?.numHumans) || 2);
    const fallbackVehicleId = runtimeVehicles?.PLAYER_1 || settings?.vehicles?.PLAYER_1;
    const configs = [];
    for (let index = 0; index < configuredHumanCount; index += 1) {
        const slot = `PLAYER_${index + 1}`;
        configs.push({
            invertPitch: !!settings?.invertPitch?.[slot],
            cockpitCamera: true,
            vehicleId: runtimeVehicles?.[slot] || fallbackVehicleId,
            fightLoadout: fightLoadouts?.[slot] || fightLoadouts?.PLAYER_1 || null,
            color: runtimeConfig?.session?.splitScreenVariant === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR
                ? FOUR_PLAYER_PLANAR_PLAYER_COLORS[index]
                : undefined,
        });
    }
    return configs;
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
