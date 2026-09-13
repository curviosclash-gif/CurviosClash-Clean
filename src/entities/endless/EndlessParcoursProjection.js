import {
    calculateEndlessScore,
    ENDLESS_PARCOURS_BOT_CAPACITY,
    resolveEndlessMilestones,
    resolveEndlessThreatLevel,
} from '../../shared/contracts/EndlessParcoursContract.js';
import { resolveEndlessStreakMultiplier } from '../../shared/contracts/EndlessParcoursStageContract.js';
import { ENDLESS_PARCOURS_RULE_VERSION } from '../../shared/contracts/EndlessParcoursWaveContract.js';
import { countActiveEndlessBotSlots } from './EndlessParcoursRuntimeCounters.js';
import { resolveEndlessWavePhaseRemaining } from './EndlessParcoursWaveOps.js';

/**
 * Ergebnis eines Laufs. Dieselbe Form landet im Rundenende-Fenster, in der
 * Rekordablage und in der Meilenstein-Pruefung.
 *
 * @param {any} runtime
 * @param {unknown} reason
 */
export function buildEndlessSummary(runtime, reason) {
    return {
        runType: 'endless_parcours',
        runId: runtime.runId,
        ruleVersion: ENDLESS_PARCOURS_RULE_VERSION,
        vehicleId: runtime.startVehicleId,
        reason: String(reason || ''),
        score: calculateEndlessScore(runtime),
        distanceMeters: runtime.maxProgressMeters,
        survivalSeconds: runtime.survivalSeconds,
        completedModules: runtime.completedModules,
        botKills: runtime.botKills,
        eliteKills: runtime.eliteKills,
        bonusScore: runtime.bonusScore,
        bestStreak: runtime.bestStreak,
        checkpointsPassed: runtime.checkpointsPassed,
        shakeoffs: runtime.shakeoffs,
        revives: runtime.reviveCount,
        lastCompletedWave: runtime.lastCompletedWave,
        sideRoutesCompleted: runtime.sideRoutesCompleted,
        flightObjectivesCompleted: runtime.flightObjectivesCompleted,
        xp: runtime.runXp,
        unlocks: runtime.runUnlocks.slice(),
        seed: runtime.baseSeed,
        isNewRecord: false,
    };
}

/**
 * Alles, was das HUD ueber den laufenden Lauf wissen muss.
 *
 * @param {any} runtime
 */
export function buildEndlessHudState(runtime) {
    return {
        runType: 'endless_parcours',
        phase: runtime._finalized ? 'finished' : 'running',
        seed: runtime.baseSeed,
        score: { total: calculateEndlessScore(runtime) },
        maxProgressMeters: runtime.maxProgressMeters,
        survivalSeconds: runtime.survivalSeconds,
        completedModules: runtime.completedModules,
        botKills: runtime.botKills,
        eliteKills: runtime.eliteKills,
        activeBots: countActiveEndlessBotSlots(runtime._botSlots),
        occupiedBotSlots: runtime._botSlots.filter((entry) => entry.state !== 'idle').length,
        botCapacity: ENDLESS_PARCOURS_BOT_CAPACITY,
        threatLevel: runtime.combatStarted
            ? resolveEndlessThreatLevel(runtime.elapsedCombatSeconds)
            : 'INTRO',
        streak: runtime.streak,
        streakMultiplier: resolveEndlessStreakMultiplier(runtime.streak),
        streakRemainingSeconds: Math.max(0, runtime.streakExpiresAtSeconds - runtime.elapsedCombatSeconds),
        bonusScore: runtime.bonusScore,
        checkpointsPassed: runtime.checkpointsPassed,
        shakeoffs: runtime.shakeoffs,
        reviveArmed: runtime.reviveArmedUntilSeconds > runtime.elapsedCombatSeconds
            && runtime.reviveUsedAtCheckpointIndex !== runtime.lastCheckpointIndex,
        spawnWarning: runtime.spawnWarning ? { ...runtime.spawnWarning } : null,
        voidWarning: {
            active: runtime.voidWarning?.warning === true,
            remainingMeters: Math.max(0, Number(runtime.voidWarning?.remainingMeters) || 0),
        },
        recordScore: runtime._records.best.score,
        recordDistanceMeters: runtime._records.bestDistance?.distanceMeters || runtime._records.best.distanceMeters,
        isNewRecord: runtime._isNewRecord,
        milestones: runtime._records.milestones,
        newMilestones: runtime._newMilestones,
        area: runtime.currentArea,
        flightObjective: runtime.flightObjective ? { ...runtime.flightObjective } : null,
        postRunSummary: runtime._summary,
        persistence: runtime._lastPersistenceResult,
        xp: runtime.runXp,
        wave: {
            number: runtime.waveNumber,
            phase: runtime.wavePhase,
            remainingSeconds: resolveEndlessWavePhaseRemaining(runtime),
            lastCompleted: runtime.lastCompletedWave,
        },
    };
}

/**
 * Zahlen fuer Tests und Diagnose: wie viel Strecke geladen ist, welche
 * Anschluesse gerade im Fenster stehen und wie die Jaeger-Plaetze stehen.
 *
 * @param {any} runtime
 */
export function buildEndlessDebugSnapshot(runtime) {
    const instances = Array.from(runtime.activeModules.values());
    return {
        activeModules: runtime.activeModules.size,
        colliderBatches: runtime.arena?.getStaticColliderBatchCount?.() || 0,
        pickups: Array.isArray(runtime.powerupManager?.items) ? runtime.powerupManager.items.length : 0,
        spawnAnchors: instances.reduce((total, entry) => total + entry.module.botAnchors.length, 0),
        activeBots: countActiveEndlessBotSlots(runtime._botSlots),
        occupiedBots: runtime._botSlots.filter((entry) => entry.state !== 'idle').length,
        connectors: instances.map((entry) => entry.module.exitConnector),
        cycleColliders: instances.reduce((total, entry) => total + entry.cycleColliders.length, 0),
        recordMarkers: instances.filter((entry) => entry.recordMarker).length,
        generatedModuleMetadata: runtime._path.getChainLength(),
        sideRouteMetadata: runtime._sideRouteStates.size,
        milestones: resolveEndlessMilestones(buildEndlessSummary(runtime, 'debug')),
        botSlots: runtime._botSlots.map((entry) => ({
            slot: entry.slot,
            playerIndex: entry.player?.index,
            state: entry.state,
            life: entry.life,
            activationGeneration: entry.activationGeneration,
            activatedOrder: entry.activatedOrder,
            elite: entry.player?.isEndlessElite === true,
        })),
    };
}
