export function isTeamObjectiveFirstTickScenario(scenario = {}) {
    const id = String(scenario.id || '').trim().toUpperCase();
    return id === 'H-TEAM-FLAGS' || id === 'H-TEAM-ESCORT';
}

/** Serializable page-evaluable sampler shared by every bot-validation scenario. */
export async function captureBotRuntimeSample({ waitForFirstTick = false, timeoutMs = 0 } = {}) {
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
                snapshot: snapshot && typeof snapshot === 'object' ? { ...snapshot } : null,
            };
        });
        const botTeamIds = botPlayers.map((player) => String(player?.teamId || '').trim().toUpperCase());
        const botObjectiveAssignments = botPlayers.map((player) => ({
            playerIndex: Number(player?.index ?? -1),
            teamId: String(player?.teamId || '').trim().toUpperCase(),
            objectiveType: String(player?.botObjectiveType || '').trim().toUpperCase(),
            objectiveRole: String(player?.flagBotRole || player?.escortBotRole || '').trim().toUpperCase(),
            objectiveTargetId: String(player?.flagBotTargetId || '').trim(),
        })).filter((entry) => !!entry.objectiveType);
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
        };
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
    if (!waitForFirstTick || game.state !== 'PLAYING') return sampleRuntime(game, entityManager);
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

        return sampleRuntime(current.game, current.entityManager);
    }
}
