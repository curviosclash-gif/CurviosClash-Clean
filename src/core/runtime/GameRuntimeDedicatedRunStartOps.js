// Start of the dedicated Arcade run types (five portals, arena waves, weapon race), moved out of
// GameRuntimeArcadeSupport.startRunIfEnabled unchanged. `support` is the GameRuntimeArcadeSupport.
import {
    buildArcadeEncounterPlan,
    resolveArcadeP1RecordStore,
    resolveActiveArcadeVehicleId,
    resolveArenaStartMachineGunId,
} from './GameRuntimeArcadeSupportOps.js';

export function startFivePortalsRun(support, runtimeState, runtimeConfig) {
    support._bindGameplayCallback(runtimeState);
    const started = support.fivePortalsRuntime.start(runtimeState?.entityManager || null,
        { vehicleId: resolveActiveArcadeVehicleId(runtimeConfig, support.game?.settings), chainId: runtimeConfig?.arcade?.portalChainId });
    support._sectorRebuildInFlight = false;
    return started;
}

export function startArenaWavesRun(support, runtimeState, runtimeConfig, localProfileContext) {
    support._bindGameplayCallback(runtimeState);
    const existing = support.arenaWavesRuntime.getHudState();
    if (existing.phase !== 'idle' && existing.phase !== 'finished') {
        const rebound = support.arenaWavesRuntime.start({
            entityManager: runtimeState?.entityManager || null,
            strategy: runtimeState?.entityManager?.gameModeStrategy || null,
        });
        support._sectorRebuildInFlight = false;
        return rebound;
    }
    const started = support.arenaWavesRuntime.start({
        entityManager: runtimeState?.entityManager || null,
        strategy: runtimeState?.entityManager?.gameModeStrategy || null,
        seed: runtimeConfig?.arcade?.seed,
        vehicleId: resolveActiveArcadeVehicleId(runtimeConfig, support.game?.settings),
        selectedMachineGunId: resolveArenaStartMachineGunId(localProfileContext, runtimeState),
    });
    support._sectorRebuildInFlight = false;
    return started;
}

export function startWeaponRaceRun(support, runtimeState, runtimeConfig) {
    support._bindGameplayCallback(runtimeState);
    support.arcadeRunRuntime.setActiveVehicle(resolveActiveArcadeVehicleId(runtimeConfig, support.game?.settings));
    const strategy = runtimeState?.entityManager?.gameModeStrategy || null;
    support.arcadeRunRuntime.setStrategy(strategy, runtimeState?.entityManager?.humanPlayers);
    support._sectorRebuildInFlight = false;
    const existing = support.arcadeRunRuntime.getStateSnapshot?.();
    if (!existing || String(existing.phase || '').toLowerCase() === 'finished') {
        const encounterPlan = support._preparedEncounterPlan || buildArcadeEncounterPlan(
            runtimeConfig,
            resolveArcadeP1RecordStore(support, runtimeConfig),
        );
        support._preparedEncounterPlan = null;
        const startOptions = {
            entityManager: runtimeState?.entityManager || null,
            roundStateController: runtimeState?.roundStateController || null,
            playerCount: Math.max(1, Number(runtimeState?.numHumans) || 1),
            encounterPlan,
            strategy,
        };
        if (runtimeConfig?.arcade?.dailyChallenge === true) support.arcadeRunRuntime.startDailyChallenge(startOptions);
        else support.arcadeRunRuntime.startRun(startOptions);
    }
    const raceStartOptions = {
        entityManager: runtimeState?.entityManager || null,
        vehicleId: resolveActiveArcadeVehicleId(runtimeConfig, support.game?.settings),
    };
    return support.weaponRaceRuntime.phase === 'idle' || support.weaponRaceRuntime.phase === 'finished'
        ? support.weaponRaceRuntime.start(raceStartOptions)
        : support.weaponRaceRuntime.rebind(raceStartOptions);
}
