export function isTeamObjectiveFirstTickScenario(scenario = {}) {
    const id = String(scenario.id || '').trim().toUpperCase();
    return id === 'H-TEAM-FLAGS' || id === 'H-TEAM-ESCORT';
}

/** Serializable runtime/objective sampler; paired start probes share one advancing tick. */
export async function captureBotRuntimeSample({ waitForFirstTick = false, timeoutMs = 0, captureKind = 'runtime' } = {}) {
    const sampleRuntime = (game, entityManager) => {
        const botPlayers = Array.isArray(entityManager?.players)
            ? entityManager.players.filter((player) => !!player?.isBot)
            : [];
        const botPolicyTypes = botPlayers.map((player) => (
            String(entityManager?.botByPlayer?.get?.(player)?.type || '').trim().toLowerCase()
        ));
        const botDecisions = botPlayers.map((player) => {
            const policy = entityManager?.botByPlayer?.get?.(player) || null;
            const snapshot = typeof policy?.getDecisionSnapshot === 'function'
                ? policy.getDecisionSnapshot()
                : null;
            return {
                playerIndex: Number(player?.index ?? -1),
                policyType: String(policy?.type || '').trim().toLowerCase(),
                actionSource: policy?.getActionSourceSnapshot?.() || null,
                snapshot: snapshot && typeof snapshot === 'object' ? { ...snapshot } : null,
            };
        });
        const botTeamIds = botPlayers.map((player) => String(player?.teamId || '').trim().toUpperCase());
        const botObjectiveAssignments = botPlayers.map((player) => {
            const objectiveType = String(player?.botObjectiveType || '').trim().toUpperCase();
            const objectiveRole = objectiveType === 'FLAGS' ? player.flagBotRole
                : objectiveType === 'ESCORT' ? player.escortBotRole : player.flagBotRole || player.escortBotRole;
            return {
                playerIndex: Number(player?.index ?? -1),
                teamId: String(player?.teamId || '').trim().toUpperCase(),
                objectiveType,
                objectiveRole: String(objectiveRole || '').trim().toUpperCase(),
                objectiveTargetId: String(player?.flagBotTargetId || '').trim(),
            };
        }).filter((entry) => !!entry.objectiveType);
        const arcadeSeed = Number(game.runtimeConfig?.arcade?.seed);
        const arcadeEnabled = game.runtimeConfig?.arcade?.enabled === true;
        const runtimeGameMode = String(game.runtimeConfig?.session?.activeGameMode || '').trim().toUpperCase();
        return {
            runtimePolicyType: String(game.runtimeConfig?.bot?.policyType || '').trim().toLowerCase(),
            entityPolicyType: String(entityManager?.botPolicyType || '').trim().toLowerCase(),
            botPolicyTypes,
            botDecisions,
            botTeamIds,
            botObjectiveAssignments,
            botCount: botPlayers.length,
            runtimeGameMode,
            entityGameMode: String(entityManager?.activeGameMode || '').trim().toUpperCase(),
            semanticGameMode: arcadeEnabled ? 'ARCADE' : runtimeGameMode,
            modePath: String(game.settings?.localSettings?.modePath || '').trim().toLowerCase(),
            arcadeEnabled,
            arcadeSeed: Number.isFinite(arcadeSeed) ? arcadeSeed : null,
            runtimeTeamMode: game.runtimeConfig?.hunt?.teamMode === true,
            runtimeTeamObjective: String(game.runtimeConfig?.hunt?.teamObjective || 'HUNT').trim().toUpperCase(),
            pageVisibility: globalThis.document?.visibilityState || '',
            renderFrameId: Number(game.gameLoop?.renderFrameId || 0),
            performance: game.runtimePerfProfiler?.getTelemetryIntervalSnapshot?.() || null,
            huntKillCount: (entityManager?.getHuntScoreboard?.() || [])
                .reduce((total, row) => total + Math.max(0, Number(row?.kills) || 0), 0),
            mgAimBins: entityManager?._overheatGunSystem?.__botValidationMgAimBins || null,
            combatTrace: game.__botValidationCombatTrace || null,
        };
    };

    const sampleObjective = (game, entityManager) => {
        if (!game || !entityManager) throw new Error('GAME_INSTANCE runtime missing');
        const finitePosition = (position) => position && [position.x, position.y, position.z].every(Number.isFinite)
            ? { x: position.x, y: position.y, z: position.z }
            : null;
        const bots = (Array.isArray(entityManager.players) ? entityManager.players : [])
            .filter((player) => player?.isBot === true)
            .map((player) => {
                const objectiveType = String(player.botObjectiveType || '').trim().toUpperCase();
                const objectiveRole = objectiveType === 'FLAGS'
                    ? player.flagBotRole
                    : objectiveType === 'ESCORT' ? player.escortBotRole : '';
                return {
                    playerIndex: Number(player.index ?? -1),
                    teamId: String(player.teamId || '').trim().toUpperCase(),
                    objectiveType,
                    objectiveRole: String(objectiveRole || '').trim().toUpperCase(),
                    objectiveTargetId: objectiveType === 'FLAGS'
                        ? String(player.flagBotTargetId || '').trim()
                        : '',
                    position: finitePosition(player.position),
                    nearEscortTank: entityManager._mapUnitSystem?.isPositionNearEscortTank?.(player.position) === true,
                };
            });
        const flags = Array.isArray(entityManager._flagObjectiveSystem?.flags)
            ? entityManager._flagObjectiveSystem.flags.map((flag) => ({
                id: String(flag.id || ''),
                teamId: String(flag.teamId || '').trim().toUpperCase(),
                hp: Number(flag.hp),
                maxHp: Number(flag.maxHp),
                position: finitePosition(flag.position),
            }))
            : [];
        const escort = entityManager._mapUnitSystem?.getEscortObjectiveState?.() || null;
        const scoreboard = entityManager.getHuntScoreboard?.() || [];
        return {
            gameState: String(game.state || ''),
            simulationSeconds: Math.max(0, Number(entityManager._simulationClockMs) || 0) * 0.001,
            bots,
            flags,
            flagCaptureEvent: entityManager._flagObjectiveSystem?.captureEvent
                ? { ...entityManager._flagObjectiveSystem.captureEvent }
                : null,
            escort: escort ? {
                phase: String(escort.phase || ''),
                progress: Number(escort.progress),
                checkpointsReached: Number(escort.checkpointsReached),
                checkpointCount: Number(escort.checkpointCount),
                hp: Number(escort.hp),
                maxHp: Number(escort.maxHp),
                position: finitePosition(escort.position),
            } : null,
            scoreboard: scoreboard.map((row) => ({
                playerIndex: Number(row.playerIndex),
                flagCaptures: Number(row.flagCaptures) || 0,
                escortSeconds: Number(row.escortSeconds) || 0,
                escortTankDamage: Number(row.escortTankDamage) || 0,
                escortGuardKills: Number(row.escortGuardKills) || 0,
                escortAttackKills: Number(row.escortAttackKills) || 0,
                escortCheckpointContributions: Number(row.escortCheckpointContributions) || 0,
                escortRepairHp: Number(row.escortRepairHp) || 0,
                escortRecoveries: Number(row.escortRecoveries) || 0,
                escortTankDowns: Number(row.escortTankDowns) || 0,
                escortFinalDestructions: Number(row.escortFinalDestructions) || 0,
            })),
        };
    };

    const captureCurrent = (game, entityManager) => {
        if (captureKind === 'objective') return sampleObjective(game, entityManager);
        const runtimeSample = sampleRuntime(game, entityManager);
        return captureKind === 'start'
            ? { runtimeSample, objectiveSnapshot: sampleObjective(game, entityManager) }
            : runtimeSample;
    };

    const readBarrierState = () => {
        const game = window.GAME_INSTANCE;
        const entityManager = game?.entityManager;
        if (!game || !entityManager) throw new Error('objective first-tick barrier lost GAME_INSTANCE or entityManager');
        if (game.state !== 'PLAYING') {
            throw new Error(`objective first-tick barrier stopped before a tick: state=${String(game.state)}`);
        }
        if (!Number.isSafeInteger(entityManager._networkRoundSerial) || entityManager._networkRoundSerial < 0) {
            throw new Error('objective first-tick barrier requires a valid round serial');
        }
        if (!Number.isFinite(entityManager._simulationClockMs)) {
            throw new Error('objective first-tick barrier requires a finite simulation clock');
        }
        const bots = (Array.isArray(entityManager.players) ? entityManager.players : [])
            .filter((player) => !!player?.isBot)
            .map((player) => ({ player, policy: entityManager.botByPlayer?.get?.(player) || null }));
        if (bots.length === 0) throw new Error('objective first-tick barrier found no live bot players');
        if (bots.some((bot) => !bot.policy)) {
            throw new Error('objective first-tick barrier found a bot without its policy instance');
        }
        return {
            game,
            entityManager,
            roundSerial: entityManager._networkRoundSerial,
            simulationClockMs: entityManager._simulationClockMs,
            bots,
        };
    };

    const game = window.GAME_INSTANCE;
    if (!game) throw new Error('GAME_INSTANCE missing');
    const entityManager = game.entityManager;
    if (!waitForFirstTick || game.state !== 'PLAYING') return captureCurrent(game, entityManager);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('objective first-tick barrier requires a positive finite timeout');
    }

    const initial = readBarrierState();
    const startedAt = window.performance.now();
    if (!Number.isFinite(startedAt)) throw new Error('objective first-tick barrier clock is invalid');

    while (true) {
        const remainingMs = timeoutMs - (window.performance.now() - startedAt);
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
            throw new Error(`objective first-tick barrier timed out without simulation advance (${timeoutMs} ms)`);
        }

        let frameId = null;
        let timerId = null;
        let timedOut = false;
        try {
            const result = await new Promise((resolve) => {
                frameId = window.requestAnimationFrame(() => resolve('frame'));
                timerId = window.setTimeout(() => {
                    timedOut = true;
                    resolve('timeout');
                }, remainingMs);
            });
            if (result !== 'frame' || timedOut) {
                throw new Error(`objective first-tick barrier timed out without simulation advance (${timeoutMs} ms)`);
            }
        } finally {
            if (frameId !== null) window.cancelAnimationFrame(frameId);
            if (timerId !== null) window.clearTimeout(timerId);
        }

        const current = readBarrierState();
        if (current.game !== initial.game || current.entityManager !== initial.entityManager) {
            throw new Error('objective first-tick barrier detected a game or entityManager replacement');
        }
        if (current.roundSerial !== initial.roundSerial) {
            throw new Error('objective first-tick barrier detected a round change');
        }
        if (current.bots.length !== initial.bots.length) {
            throw new Error('objective first-tick barrier detected a bot roster change');
        }
        for (let index = 0; index < initial.bots.length; index += 1) {
            if (current.bots[index].player !== initial.bots[index].player
                || current.bots[index].policy !== initial.bots[index].policy) {
                throw new Error('objective first-tick barrier detected a bot or policy replacement');
            }
        }
        if (current.simulationClockMs < initial.simulationClockMs) {
            throw new Error('objective first-tick barrier detected a simulation clock reset');
        }
        if (current.simulationClockMs <= initial.simulationClockMs) continue;

        return captureCurrent(current.game, current.entityManager);
    }
}
