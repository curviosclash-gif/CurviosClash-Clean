import {
    createRocketWarningAudioState,
    resolveLocalHumanCount,
    updateRocketWarningAudio,
} from '../systems/projectile/RocketWarningAudioOps.js';

export class EntityTickPipeline {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this._mapAmbienceOptions = {
            localPlayerIndex: 0,
            mapDefinition: null,
            mapScale: 1,
            elapsedSeconds: 0,
            sandstormState: null,
        };
        this._rocketWarningState = createRocketWarningAudioState();
        this._rocketWarningOptions = { localPlayerIndex: 0, localHumanCount: 1, roundEnded: false };
        // Bound once so the per frame call allocates no closure.
        this._getRocketThreat = (index) => this.entityManager?._projectileSystem?.getRocketThreat?.(index);
    }

    update(dt, inputManager, renderFrameId = 0) {
        const owner = this.entityManager;
        if (!owner) return;
        const safeDt = Math.max(0, Number(dt) || 0);
        owner._simulationClockMs = Math.max(0, (Number(owner._simulationClockMs) || 0) + (safeDt * 1000));
        const simulationNowMs = owner._simulationClockMs;

        owner._lockOnCache.clear();
        owner._globalFogEffectSystem?.update?.(safeDt);
        owner._mapSandstormSystem?.update?.(safeDt);
        owner._staticTurretSystem?.update?.(safeDt);
        owner._flagObjectiveSystem?.update?.(safeDt);
        owner._mapUnitSystem?.update?.(safeDt);
        owner._lightningStrikeSystem?.update?.(safeDt);
        owner._railgunSystem?.update?.(safeDt);
        owner._exclusionZoneSystem?.update?.(safeDt);
        owner._mapDestructibleBlastSystem?.update?.();
        owner._waterZoneSystem?.update?.(safeDt);
        // Before the projectiles: a portal that opens this tick has to take their shots too.
        owner._secretRoomSystem?.update?.(safeDt);
        owner._objectiveTargetMarkerSystem?.update?.(safeDt);
        owner._projectileSystem.update(dt);
        owner._overheatGunSystem.update(dt);
        owner._respawnSystem.update(dt);
        owner._playerInputSystem.beginFrame?.();
        try {
            for (const player of owner.players) {
                if (!player.alive) continue;
                owner._playerLifecycleSystem.updateShootCooldown(player, dt);
                const input = owner._playerInputSystem.resolvePlayerInput(player, dt, inputManager);
                owner._playerLifecycleSystem.updatePlayer(player, dt, input, renderFrameId, simulationNowMs);
            }
            owner._repairDroneSystem?.update?.(safeDt);

            if (owner._roundEnded) {
                owner.audio?.stopEngine?.();
                owner.audio?.clearMapAmbience?.();
                return;
            }

            owner.audio?.syncEngineFromPlayers?.(owner.players, {
                localPlayerIndex: owner.renderer?.viewportSystem?.localPlayerIndex,
            });
            const ambienceOptions = this._mapAmbienceOptions;
            ambienceOptions.localPlayerIndex = owner.renderer?.viewportSystem?.localPlayerIndex;
            ambienceOptions.mapDefinition = owner.arena?.currentMapDefinition;
            ambienceOptions.mapScale = owner.entityRuntimeConfig?.ARENA?.MAP_SCALE;
            ambienceOptions.elapsedSeconds = owner.arena?.glbAnimationElapsedSeconds;
            ambienceOptions.sandstormState = owner._mapSandstormSystem?.state || null;
            owner.audio?.syncMapAmbienceFromPlayers?.(owner.players, ambienceOptions);

            const warningOptions = this._rocketWarningOptions;
            warningOptions.localPlayerIndex = owner.renderer?.viewportSystem?.localPlayerIndex
                ?? owner.runtimeConfig?.session?.localPlayerIndex ?? 0;
            warningOptions.localHumanCount = resolveLocalHumanCount(owner.runtimeConfig?.session);
            warningOptions.roundEnded = owner._roundEnded === true;
            updateRocketWarningAudio(
                this._rocketWarningState, owner.players, this._getRocketThreat,
                owner.audio, simulationNowMs, warningOptions,
            );

            const outcome = owner._roundOutcomeSystem.resolve();
            if (outcome.shouldEnd) {
                owner._globalFogEffectSystem?.reset?.();
                owner._mapSandstormSystem?.reset?.();
                owner._roundEnded = true;
                owner._lastRoundOutcome = outcome;
                owner.audio?.stopEngine?.();
                owner.audio?.clearMapAmbience?.();
                owner.onAuthoritativeFightStateChanged?.();
                owner._eventBus.emitRoundEnd(outcome.winner, outcome);
            }
        } finally {
            owner._playerInputSystem.endFrame?.();
        }
    }
}
