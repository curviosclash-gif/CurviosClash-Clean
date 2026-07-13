export function createEntityRuntimePorts(runtime) {
    const systems = runtime?.systems || {};
    const support = runtime?.support || {};
    return {
        spawn: {
            setupOps: systems.setupOps || null,
            spawnOps: systems.spawnOps || null,
            spawnPlacementSystem: support.spawnPlacementSystem || null,
            respawnSystem: systems.respawnSystem || null,
            parcoursProgressSystem: systems.parcoursProgressSystem || null,
        },
        combat: {
            huntCombatSystem: systems.huntCombatSystem || null,
            overheatGunSystem: systems.overheatGunSystem || null,
            huntScoring: support.huntScoring || null,
            roundOutcomeSystem: systems.roundOutcomeSystem || null,
        },
        collision: {
            collisionResponseSystem: support.collisionResponseSystem || null,
            lockOnCache: support.lockOnCache || null,
            fallbackArenaCollision: support.fallbackArenaCollision || null,
        },
        trail: {
            trailSpatialIndex: support.trailSpatialIndex || null,
        },
        runtimeContext: runtime?.context || null,
        tickPipeline: systems.tickPipeline || null,
    };
}
