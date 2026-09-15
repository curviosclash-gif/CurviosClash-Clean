export class EntityTickPipeline {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this._mapAmbienceOptions = {
            localPlayerIndex: 0,
            mapDefinition: null,
            mapScale: 1,
            elapsedSeconds: 0,
        };
    }

    update(dt, inputManager, renderFrameId = 0) {
        const owner = this.entityManager;
        if (!owner) return;
        const safeDt = Math.max(0, Number(dt) || 0);
        owner._simulationClockMs = Math.max(0, (Number(owner._simulationClockMs) || 0) + (safeDt * 1000));
        const simulationNowMs = owner._simulationClockMs;

        owner._lockOnCache.clear();
        owner._globalFogEffectSystem?.update?.(safeDt);
        owner._staticTurretSystem?.update?.(safeDt);
        owner._exclusionZoneSystem?.update?.(safeDt);
        owner._mapDestructibleBlastSystem?.update?.();
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

            if (owner._roundEnded) {
                owner.audio?.stopEngine?.();
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
            owner.audio?.syncMapAmbienceFromPlayers?.(owner.players, ambienceOptions);

            const outcome = owner._roundOutcomeSystem.resolve();
            if (outcome.shouldEnd) {
                owner._globalFogEffectSystem?.reset?.();
                owner._roundEnded = true;
                owner._lastRoundOutcome = outcome;
                owner.audio?.stopEngine?.();
                owner.onAuthoritativeFightStateChanged?.();
                owner._eventBus.emitRoundEnd(outcome.winner, outcome);
            }
        } finally {
            owner._playerInputSystem.endFrame?.();
        }
    }
}
