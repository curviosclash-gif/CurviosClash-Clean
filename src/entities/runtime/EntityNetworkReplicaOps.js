// Network replica fan-out of the entity runtime: which systems a client mirrors from the host,
// and how a host snapshot reaches them. A new system with setNetworkReplica belongs in
// NETWORK_REPLICA_TARGETS; tests/entity-network-replica.contract.test.mjs reports one that is missing.

/** [field on the EntityManager, method that switches it to replica mode], in call order. */
export const NETWORK_REPLICA_TARGETS = Object.freeze([
    ['_projectileSystem', 'setNetworkReplica'],
    ['powerupManager', 'setNetworkReplica'],
    ['_staticTurretSystem', 'setNetworkReplica'],
    ['_flagObjectiveSystem', 'setNetworkReplica'],
    ['_mapHazardSystem', 'setNetworkReplica'],
    ['_mapDestructibleSystem', 'setNetworkReplica'],
    ['_mapOwnedPickupSystem', 'setNetworkReplica'],
    ['_waterZoneSystem', 'setNetworkReplica'],
    ['arena', 'setDandelionSeedNetworkReplica'],
    ['_globalFogEffectSystem', 'setNetworkReplica'],
    ['_mapSandstormSystem', 'setNetworkReplica'],
    ['_exclusionZoneSystem', 'setNetworkReplica'],
    ['_secretRoomSystem', 'setNetworkReplica'],
    ['_mapUnitSystem', 'setNetworkReplica'],
    ['_repairDroneSystem', 'setNetworkReplica'],
    ['_lightningStrikeSystem', 'setNetworkReplica'],
]);

export function setEntityNetworkReplica(manager, enabled) {
    for (const [field, method] of NETWORK_REPLICA_TARGETS) {
        manager[field]?.[method]?.(enabled);
    }
}

export function applyEntityNetworkSnapshot(manager, snapshot) {
    if (snapshot?.mapFireDestructibles) manager._mapDestructibleSystem?.applyNetworkState?.(snapshot.mapFireDestructibles);
    manager._projectileSystem?.applyNetworkSnapshot?.(snapshot?.projectiles, manager.players);
    manager.powerupManager?.applyNetworkSnapshot?.(snapshot?.powerups);
    manager._staticTurretSystem?.applyNetworkSnapshot?.(snapshot?.turrets, manager.players);
    manager._repairDroneSystem?.applyNetworkState?.(snapshot?.repairDrones);
    manager._globalFogEffectSystem?.applyNetworkSnapshot?.(snapshot?.globalFog);
    manager._mapSandstormSystem?.applyNetworkSnapshot?.(snapshot?.sandstorm);
    if (Number.isFinite(Number(snapshot?.mapElapsedSeconds))) manager.arena?.setGlbAnimationElapsedSeconds?.(snapshot.mapElapsedSeconds);
    if (Array.isArray(snapshot?.dandelionSeeds)) manager.arena?.applyDandelionSeedState?.(snapshot.dandelionSeeds);
    if (Array.isArray(snapshot?.cherryLeaves)) manager.arena?.applyCherryLeafState?.(snapshot.cherryLeaves);
    if (Array.isArray(snapshot?.sunflowerKernels)) manager.arena?.applySunflowerKernelState?.(snapshot.sunflowerKernels);
}
