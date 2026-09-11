import { ENDLESS_PARCOURS_BOT_CAPACITY } from '../../shared/contracts/EndlessParcoursContract.js';

/**
 * Der komplette Laufzustand eines Endlos-Laufs an einem Ort. Getrennt von der
 * Runtime, damit ein Lauf ohne Renderer und Szene beschrieben werden kann - und
 * damit die Runtime unter der Zeilengrenze bleibt.
 */
export function createEndlessRuntimeState() {
    return {
        maxProgressMeters: 0,
        completedModules: 0,
        survivalSeconds: 0,
        elapsedCombatSeconds: 0,
        combatStarted: false,
        waveNumber: 0,
        wavePhase: 'intro',
        wavePhaseElapsedSeconds: 0,
        lastCompletedWave: 0,
        lastBotActivationAtSeconds: Number.NEGATIVE_INFINITY,
        botKills: 0,
        eliteKills: 0,
        score: 0,
        bonusScore: 0,
        runXp: 0,
        startVehicleId: '',
        startProfile: null,
        startBonuses: null,
        runUnlocks: [],
        runId: '',
        currentModuleIndex: 0,
        streak: 0,
        bestStreak: 0,
        streakExpiresAtSeconds: 0,
        lastStreakKind: '',
        checkpointsPassed: 0,
        lastCheckpointIndex: -1,
        lastCheckpointAtSeconds: 0,
        lastCheckpointAnchor: null,
        respiteUntilSeconds: 0,
        reviveArmedUntilSeconds: 0,
        reviveUsedAtCheckpointIndex: -1,
        reviveCount: 0,
        shakeoffs: 0,
        sideRoutesCompleted: 0,
        flightObjectivesCompleted: 0,
        currentArea: 'intro',
        objectiveAreaBlock: -1,
        flightObjective: null,
        _damagedSinceCheckpoint: false,
        gateFlashRemaining: 0,
        stagePulseRemaining: 0,
        spawnWarning: null,
        voidWarning: { remainingMeters: Number.POSITIVE_INFINITY, warning: false },
        _eliteWaveSpawned: 0,
        _eliteExchangeSlot: null,
        _activationSequence: 0,
        _lastThreatLevel: 'INTRO',
        _lastAnnouncedBotTarget: 0,
        _activePaletteTier: -1,
        // null heisst "noch nichts gemessen". Ein Zahlenwert als Startwert haette
        // den ersten Tick als Treffer bzw. als Aufnahme gedeutet.
        _lastHumanHp: null,
        _lastHumanShield: null,
        _lastInventoryCount: null,
        _pendingFinalReason: '',
        _finalized: false,
        _disposed: false,
        _summary: null,
        _recordStore: null,
        _isNewRecord: false,
        _newMilestones: [],
        _lastPersistenceResult: { ok: true, reason: 'not_attempted' },
        _settlement: null,
    };
}

/**
 * Ein Slot ist ein wiederverwendbarer Jaeger-Platz. `plannedAnchor` haelt den
 * Einstiegspunkt, der bei der Ankuendigung ausgewaehlt wurde, damit die Warnung
 * und der spaetere Einsatz dieselbe Richtung meinen.
 *
 * @param {{ player?: any }[]} bots
 */
export function createEndlessBotSlots(bots) {
    const source = Array.isArray(bots) ? bots : [];
    const slots = [];
    for (let slot = 0; slot < Math.min(ENDLESS_PARCOURS_BOT_CAPACITY, source.length); slot += 1) {
        slots.push({
            slot,
            player: source[slot]?.player || null,
            state: 'idle',
            life: 0,
            eligibleAt: 0,
            telegraphedAt: -1,
            plannedAnchor: null,
            plannedElite: false,
            reservedWave: 0,
            activatedOrder: 0,
            activationGeneration: 0,
            retreatUntilSeconds: 0,
        });
    }
    return slots;
}
