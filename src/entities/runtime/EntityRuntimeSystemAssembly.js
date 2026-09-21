import { PlayerInputSystem } from '../systems/PlayerInputSystem.js';
import { PlayerLifecycleSystem } from '../systems/PlayerLifecycleSystem.js';
import { HuntCombatSystem } from '../systems/HuntCombatSystem.js';
import { ParcoursProgressSystem } from '../systems/ParcoursProgressSystem.js';
import { RoundOutcomeSystem } from '../systems/RoundOutcomeSystem.js';
import { isFivePortalsConfig } from '../../shared/contracts/FivePortalsContract.js';
import { OverheatGunSystem } from '../../hunt/OverheatGunSystem.js';
import { FlamethrowerSystem } from '../../hunt/FlamethrowerSystem.js';
import { RespawnSystem } from '../../hunt/RespawnSystem.js';
import { EntitySetupOps } from './EntitySetupOps.js';
import { EntitySpawnOps } from './EntitySpawnOps.js';
import { EntityTickPipeline } from './EntityTickPipeline.js';
import { StaticTurretSystem } from '../systems/StaticTurretSystem.js';
import { MapHazardSystem } from '../systems/MapHazardSystem.js';
import { MapDestructibleSystem } from '../systems/MapDestructibleSystem.js';
import { MapDestructibleBlastSystem } from '../systems/MapDestructibleBlastSystem.js';
import { GlobalFogEffectSystem } from '../systems/GlobalFogEffectSystem.js';
import { ExclusionZoneSystem } from '../systems/ExclusionZoneSystem.js';
import { isArenaWavesConfig } from '../../shared/contracts/ArenaWavesContract.js';
import { ObjectiveTargetMarkerSystem } from '../systems/ObjectiveTargetMarkerSystem.js';
import { SecretRoomSystem } from '../systems/SecretRoomSystem.js';
import { TargetableRegistry } from '../systems/TargetableRegistry.js';
import { MapUnitSystem } from '../systems/MapUnitSystem.js';
import { LightningStrikeSystem } from '../../hunt/LightningStrikeSystem.js';
import { RailgunSystem } from '../../hunt/RailgunSystem.js';
import { RepairDroneSystem } from '../systems/RepairDroneSystem.js';
import { FlagObjectiveSystem } from '../systems/FlagObjectiveSystem.js';
import { WaterZoneSystem } from '../systems/WaterZoneSystem.js';

export function createEntityRuntimeSystems(owner, runtimeContext, support = null) {
    const systems = {
        projectileSystem: support?.projectileSystem || null,
        playerInputSystem: new PlayerInputSystem(owner),
        playerLifecycleSystem: new PlayerLifecycleSystem(owner),
        parcoursProgressSystem: new ParcoursProgressSystem(owner),
        overheatGunSystem: new OverheatGunSystem(owner, runtimeContext),
        respawnSystem: new RespawnSystem(runtimeContext),
        huntCombatSystem: new HuntCombatSystem(runtimeContext),
        globalFogEffectSystem: new GlobalFogEffectSystem(owner),
        staticTurretSystem: new StaticTurretSystem(owner),
        mapHazardSystem: new MapHazardSystem(owner),
        mapDestructibleSystem: new MapDestructibleSystem(owner),
        mapDestructibleBlastSystem: new MapDestructibleBlastSystem(owner),
        waterZoneSystem: new WaterZoneSystem(owner),
        objectiveTargetMarkerSystem: new ObjectiveTargetMarkerSystem(owner),
        secretRoomSystem: new SecretRoomSystem(owner),
        flagObjectiveSystem: null,
        exclusionZoneSystem: null,
        roundOutcomeSystem: new RoundOutcomeSystem({
            getPlayers: () => owner.players,
            getHumanPlayers: () => owner.humanPlayers,
            getBots: () => owner.bots,
            getScoreboard: () => owner.getHuntScoreboard(),
            isRespawnEnabled: () => owner.gameModeStrategy?.isRespawnEnabled?.() === true,
            isEliminationSuppressed: () => owner._parcoursProgressSystem?.isRespawnEnabled?.() === true
                || isArenaWavesConfig(owner.runtimeConfig),
            isRespawnPending: (player) => owner._respawnSystem?.isRespawnPending?.(player) === true,
            isOutcomeAuthority: () => owner.isFightOutcomeAuthority !== false,
            getDeathmatchKillLimit: () => owner.entityRuntimeConfig?.HUNT?.DEATHMATCH_KILL_LIMIT || 10,
            getWinCondition: () => owner.entityRuntimeConfig?.HUNT?.WIN_CONDITION,
            getDeathmatchTimeLimitSeconds: () => owner.entityRuntimeConfig?.HUNT?.DEATHMATCH_TIME_LIMIT_SECONDS || 0,
            getElapsedSeconds: () => Math.max(0, Number(owner._simulationClockMs) || 0) * 0.001,
            getObjectiveOutcome: () => owner._flagObjectiveSystem?.getRoundOutcome?.()
                || owner._mapUnitSystem?.getEscortOutcome?.()
                || (isFivePortalsConfig(owner.runtimeConfig)
                    ? null : (owner._parcoursProgressSystem?.getRoundOutcome?.() || null)),
            isTeamMode: () => owner.runtimeConfig?.hunt?.teamMode === true,
        }),
        setupOps: new EntitySetupOps(owner),
        spawnOps: new EntitySpawnOps(owner),
        tickPipeline: new EntityTickPipeline(owner),
    };
    systems.exclusionZoneSystem = new ExclusionZoneSystem(owner, {
        projectileSystem: systems.projectileSystem,
    });
    // Published here rather than with the other systems in EntityManager: that file sits on the
    // 500 line limit, and this is the module that owns the wiring anyway.
    owner._secretRoomSystem = systems.secretRoomSystem;
    // Every weapon reads its non-player targets from here; map units add their provider later.
    systems.targetableRegistry = new TargetableRegistry();
    systems.targetableRegistry.addProvider(() => systems.staticTurretSystem.getDestructibleTargets());
    systems.targetableRegistry.addProvider(() => systems.mapDestructibleSystem.getTargets());
    if (owner) owner._targetableRegistry = systems.targetableRegistry;
    systems.flagObjectiveSystem = new FlagObjectiveSystem(owner);
    systems.targetableRegistry.addProvider(() => systems.flagObjectiveSystem.getTargets());
    if (owner) owner._flagObjectiveSystem = systems.flagObjectiveSystem;
    systems.mapUnitSystem = new MapUnitSystem(owner);
    systems.targetableRegistry.addProvider(() => systems.mapUnitSystem.getTargets());
    if (owner) owner._mapUnitSystem = systems.mapUnitSystem;
    systems.repairDroneSystem = new RepairDroneSystem(owner);
    systems.targetableRegistry.addProvider(() => systems.repairDroneSystem.getTargets());
    if (owner) owner._repairDroneSystem = systems.repairDroneSystem;
    systems.lightningStrikeSystem = new LightningStrikeSystem(owner);
    if (owner) owner._lightningStrikeSystem = systems.lightningStrikeSystem;
    systems.railgunSystem = new RailgunSystem(owner);
    if (owner) owner._railgunSystem = systems.railgunSystem;
    systems.flamethrowerSystem = new FlamethrowerSystem(owner);
    if (owner) owner._flamethrowerSystem = systems.flamethrowerSystem;
    return systems;
}
