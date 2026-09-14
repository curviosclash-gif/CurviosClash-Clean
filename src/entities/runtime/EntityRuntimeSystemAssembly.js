import { PlayerInputSystem } from '../systems/PlayerInputSystem.js';
import { PlayerLifecycleSystem } from '../systems/PlayerLifecycleSystem.js';
import { HuntCombatSystem } from '../systems/HuntCombatSystem.js';
import { ParcoursProgressSystem } from '../systems/ParcoursProgressSystem.js';
import { RoundOutcomeSystem } from '../systems/RoundOutcomeSystem.js';
import { OverheatGunSystem } from '../../hunt/OverheatGunSystem.js';
import { RespawnSystem } from '../../hunt/RespawnSystem.js';
import { EntitySetupOps } from './EntitySetupOps.js';
import { EntitySpawnOps } from './EntitySpawnOps.js';
import { EntityTickPipeline } from './EntityTickPipeline.js';
import { StaticTurretSystem } from '../systems/StaticTurretSystem.js';
import { MapHazardSystem } from '../systems/MapHazardSystem.js';
import { MapDestructibleSystem } from '../systems/MapDestructibleSystem.js';
import { GlobalFogEffectSystem } from '../systems/GlobalFogEffectSystem.js';
import { ExclusionZoneSystem } from '../systems/ExclusionZoneSystem.js';

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
        exclusionZoneSystem: null,
        roundOutcomeSystem: new RoundOutcomeSystem({
            getPlayers: () => owner.players,
            getHumanPlayers: () => owner.humanPlayers,
            getBots: () => owner.bots,
            getScoreboard: () => owner.getHuntScoreboard(),
            isRespawnEnabled: () => owner.gameModeStrategy?.isRespawnEnabled?.() === true,
            isEliminationSuppressed: () => owner._parcoursProgressSystem?.isRespawnEnabled?.() === true,
            isRespawnPending: (player) => owner._respawnSystem?.isRespawnPending?.(player) === true,
            isOutcomeAuthority: () => owner.isFightOutcomeAuthority !== false,
            getDeathmatchKillLimit: () => owner.entityRuntimeConfig?.HUNT?.DEATHMATCH_KILL_LIMIT || 10,
            getDeathmatchTimeLimitSeconds: () => owner.entityRuntimeConfig?.HUNT?.DEATHMATCH_TIME_LIMIT_SECONDS || 0,
            getElapsedSeconds: () => Math.max(0, Number(owner._simulationClockMs) || 0) * 0.001,
            getObjectiveOutcome: () => owner._parcoursProgressSystem?.getRoundOutcome?.() || null,
        }),
        setupOps: new EntitySetupOps(owner),
        spawnOps: new EntitySpawnOps(owner),
        tickPipeline: new EntityTickPipeline(owner),
    };
    systems.exclusionZoneSystem = new ExclusionZoneSystem(owner, {
        projectileSystem: systems.projectileSystem,
    });
    return systems;
}
