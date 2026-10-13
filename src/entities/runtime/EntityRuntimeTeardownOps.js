// Teardown of the entity runtime. clear() keeps the systems for the next round (dispose = false);
// dispose() releases them for good. The order is the order the systems were torn down in before
// this moved out of EntityManager.

export function teardownEntityRuntime(manager, { disposeProjectileSystem = false } = {}) {
    const dispose = disposeProjectileSystem;
    manager.audio?.clearMapAmbience?.();
    for (const player of manager.players) {
        if (player) player.dispose();
    }
    manager.players.length = 0;
    manager.humanPlayers.length = 0;
    manager.bots.length = 0;
    manager.botByPlayer.clear();
    if (dispose) manager._projectileSystem.dispose();
    else manager._projectileSystem.clear();
    manager._lastRoundGhostSystem?.clear?.();
    manager._killcamReplaySystem?.clear?.();
    manager._killcamSystem?.resetPixelCapture?.();
    manager._overheatGunSystem.reset();
    manager._respawnSystem.reset();
    manager._parcoursProgressSystem?.reset?.();
    if (dispose) manager._staticTurretSystem?.dispose?.();
    else manager._staticTurretSystem?.clear?.();
    if (dispose) manager._flagObjectiveSystem?.dispose?.();
    else manager._flagObjectiveSystem?.clear?.();
    manager._mapHazardSystem?.clear?.();
    manager._mapDestructibleSystem?.clear?.();
    manager._mapOwnedPickupSystem?.clear?.();
    if (dispose) {
        manager._mapUnitSystem?.dispose?.();
        manager._repairDroneSystem?.dispose?.();
        manager._lightningStrikeSystem?.dispose?.();
        manager._railgunSystem?.dispose?.();
        manager._waterZoneSystem?.dispose?.();
    } else {
        manager._mapUnitSystem?.clear?.();
        manager._repairDroneSystem?.clear?.();
        manager._lightningStrikeSystem?.reset?.();
        manager._waterZoneSystem?.clear?.();
    }
    manager._mapDestructibleBlastSystem?.clear?.();
    if (dispose) manager._exclusionZoneSystem?.dispose?.();
    else manager._exclusionZoneSystem?.reset?.();
    manager._globalFogEffectSystem?.reset?.();
    if (dispose) manager._mapSandstormSystem?.dispose?.();
    else manager._mapSandstormSystem?.reset?.();
    if (dispose) manager._objectiveTargetMarkerSystem?.dispose?.();
    else manager._objectiveTargetMarkerSystem?.reset?.();
    manager._huntScoring.reset();
    manager._simulationClockMs = 0;

    if (manager.powerupManager) {
        manager.powerupManager.clear();
    }

    manager._trailSpatialIndex.clear();
    manager._lockOnCache.clear();
    manager.onHuntDamageEvent = null;
    manager.onHuntFeedEvent = null;
    manager.onArcadeGameplayEvent = null;
    if (dispose) {
        manager._lastRoundGhostSystem?.dispose?.();
        manager._killcamReplaySystem?.dispose?.();
        manager._killcamSystem?.dispose?.();
    }
}
