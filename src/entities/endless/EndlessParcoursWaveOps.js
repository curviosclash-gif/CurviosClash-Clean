import {
    ENDLESS_PARCOURS_WAVE_PHASES,
    ENDLESS_PARCOURS_WAVE_TIMING,
    resolveEndlessPauseAfterWave,
    resolveEndlessWaveProfile,
} from '../../shared/contracts/EndlessParcoursWaveContract.js';
import { clearEndlessElite } from './EndlessParcoursBotDirectorOps.js';

function resetReservation(slot) {
    slot.state = 'idle';
    slot.eligibleAt = 0;
    slot.telegraphedAt = -1;
    slot.plannedAnchor = null;
    slot.plannedElite = false;
    slot.reservedWave = 0;
}

export function countEndlessOccupiedSlots(slots) {
    let count = 0;
    for (const slot of slots || []) {
        if (slot.state !== 'idle') count += 1;
    }
    return count;
}

export function isEndlessRecoveryActivationBlocked(runtime) {
    return runtime?.activeModules?.get?.(runtime.currentModuleIndex)?.module?.recovery === true;
}

export function canActivateEndlessSlot(runtime, slot) {
    if (!runtime || !slot || slot.state !== 'reserved') return false;
    if (runtime.wavePhase !== ENDLESS_PARCOURS_WAVE_PHASES.ATTACK) return false;
    if (slot.reservedWave !== runtime.waveNumber) return false;
    if (runtime.respiteUntilSeconds > runtime.elapsedCombatSeconds) return false;
    if (isEndlessRecoveryActivationBlocked(runtime)) return false;
    if (runtime.elapsedCombatSeconds - runtime.lastBotActivationAtSeconds
        < ENDLESS_PARCOURS_WAVE_TIMING.activationIntervalSeconds) return false;
    if (slot.telegraphedAt < 0 || runtime.elapsedCombatSeconds - slot.telegraphedAt
        < ENDLESS_PARCOURS_WAVE_TIMING.telegraphSeconds) return false;
    return true;
}

function reserveSlot(runtime, slot, elite = false) {
    if (!slot || slot.state !== 'idle') return false;
    if (countEndlessOccupiedSlots(runtime._botSlots) >= runtime._botSlots.length) return false;
    slot.state = 'reserved';
    slot.eligibleAt = runtime.elapsedCombatSeconds;
    slot.telegraphedAt = -1;
    slot.plannedAnchor = null;
    slot.plannedElite = elite === true;
    slot.reservedWave = runtime.waveNumber;
    return true;
}

export function reserveEndlessWaveSlots(runtime) {
    if (!runtime || runtime.wavePhase !== ENDLESS_PARCOURS_WAVE_PHASES.ATTACK) return;
    const profile = resolveEndlessWaveProfile(runtime.waveNumber);
    let occupied = countEndlessOccupiedSlots(runtime._botSlots);
    let elitePresent = false;
    for (const slot of runtime._botSlots) {
        if (slot.state === 'active' && slot.player?.isEndlessElite === true) elitePresent = true;
        if (slot.state === 'reserved' && slot.plannedElite === true) elitePresent = true;
    }

    if (profile.elite && !elitePresent && !runtime._eliteExchangeSlot) {
        const free = runtime._botSlots.find((slot) => slot.state === 'idle');
        if (free && occupied < profile.capacity) {
            reserveSlot(runtime, free, true);
            occupied += 1;
        } else if (occupied >= profile.capacity) {
            const ordinary = runtime._botSlots
                .filter((slot) => slot.state === 'active' && slot.player?.isEndlessElite !== true)
                .sort((left, right) => (left.activatedOrder - right.activatedOrder) || (left.slot - right.slot))[0];
            if (ordinary) {
                ordinary.state = 'exchange_retreat';
                ordinary.retreatUntilSeconds = runtime.elapsedCombatSeconds
                    + ENDLESS_PARCOURS_WAVE_TIMING.retreatSeconds;
                ordinary.player.endlessForcedRetreat = true;
                ordinary.player.endlessRetreatReason = 'elite_exchange';
                runtime._eliteExchangeSlot = ordinary;
                runtime.entityManager?._notifyPlayerFeedback?.(
                    runtime.entityManager?.humanPlayers?.[0] || null,
                    `Jäger ${ordinary.slot + 1} zieht für den Anführer ab`
                );
            }
        }
    }

    while (occupied < profile.capacity) {
        const free = runtime._botSlots.find((slot) => slot.state === 'idle');
        if (!free || !reserveSlot(runtime, free, false)) break;
        occupied += 1;
    }
}

export function onEndlessExchangeSlotFreed(runtime, slot) {
    if (!runtime || runtime._eliteExchangeSlot !== slot) return false;
    runtime._eliteExchangeSlot = null;
    if (runtime.wavePhase !== ENDLESS_PARCOURS_WAVE_PHASES.ATTACK) return false;
    return reserveSlot(runtime, slot, true);
}

function deactivateWithoutReward(runtime, slot, reason) {
    clearEndlessElite(slot.player);
    if (slot.player) {
        slot.player.endlessForcedRetreat = false;
        slot.player.endlessRetreatReason = '';
    }
    runtime.entityManager?.deactivateBotSlot?.(slot.slot, reason);
    resetReservation(slot);
}

export function updateEndlessRetreats(runtime) {
    for (const slot of runtime._botSlots) {
        if (slot.state !== 'exchange_retreat' && slot.state !== 'retreating') continue;
        if (slot.retreatUntilSeconds > runtime.elapsedCombatSeconds) continue;
        const exchange = slot.state === 'exchange_retreat';
        deactivateWithoutReward(runtime, slot, exchange ? 'elite_exchange' : 'wave_retreat');
        if (exchange) onEndlessExchangeSlotFreed(runtime, slot);
    }
}

function expireWaveReservations(runtime) {
    for (const slot of runtime._botSlots) {
        if (slot.state === 'reserved') resetReservation(slot);
    }
    runtime.spawnWarning = null;
}

function beginWaveRetreat(runtime) {
    runtime.wavePhase = ENDLESS_PARCOURS_WAVE_PHASES.RETREAT;
    runtime.wavePhaseElapsedSeconds = 0;
    for (const slot of runtime._botSlots) {
        if (slot.state !== 'active') continue;
        slot.state = 'retreating';
        slot.retreatUntilSeconds = runtime.elapsedCombatSeconds
            + ENDLESS_PARCOURS_WAVE_TIMING.retreatSeconds;
        slot.player.endlessForcedRetreat = true;
        slot.player.endlessRetreatReason = 'wave_retreat';
        slot.player.trail?.clear?.();
        runtime.entityManager?._projectileSystem?.clearForOwner?.(slot.player);
    }
}

export function beginEndlessAttackWave(runtime, waveNumber = runtime.waveNumber + 1) {
    runtime.waveNumber = Math.max(1, Math.floor(Number(waveNumber) || 1));
    runtime.wavePhase = ENDLESS_PARCOURS_WAVE_PHASES.ATTACK;
    runtime.wavePhaseElapsedSeconds = 0;
    runtime._eliteExchangeSlot = null;
    reserveEndlessWaveSlots(runtime);
}

export function advanceEndlessWave(runtime, dt) {
    if (!runtime?.combatStarted) return;
    const safeDt = Math.max(0, Number(dt) || 0);
    runtime.wavePhaseElapsedSeconds += safeDt;
    updateEndlessRetreats(runtime);
    if (runtime.wavePhase === ENDLESS_PARCOURS_WAVE_PHASES.ATTACK
        && runtime.wavePhaseElapsedSeconds >= ENDLESS_PARCOURS_WAVE_TIMING.attackSeconds) {
        runtime.lastCompletedWave = runtime.waveNumber;
        expireWaveReservations(runtime);
        if (resolveEndlessPauseAfterWave(runtime.waveNumber) === ENDLESS_PARCOURS_WAVE_PHASES.RETREAT) {
            beginWaveRetreat(runtime);
        } else {
            runtime.wavePhase = ENDLESS_PARCOURS_WAVE_PHASES.RESUPPLY;
            runtime.wavePhaseElapsedSeconds = 0;
        }
        return;
    }
    if (runtime.wavePhase === ENDLESS_PARCOURS_WAVE_PHASES.RETREAT
        && runtime.wavePhaseElapsedSeconds >= ENDLESS_PARCOURS_WAVE_TIMING.retreatSeconds) {
        updateEndlessRetreats(runtime);
        runtime.wavePhase = ENDLESS_PARCOURS_WAVE_PHASES.REST;
        runtime.wavePhaseElapsedSeconds = 0;
        return;
    }
    if (runtime.wavePhase === ENDLESS_PARCOURS_WAVE_PHASES.REST
        && runtime.wavePhaseElapsedSeconds >= ENDLESS_PARCOURS_WAVE_TIMING.restSeconds) {
        beginEndlessAttackWave(runtime);
        return;
    }
    if (runtime.wavePhase === ENDLESS_PARCOURS_WAVE_PHASES.RESUPPLY
        && runtime.wavePhaseElapsedSeconds >= ENDLESS_PARCOURS_WAVE_TIMING.resupplySeconds) {
        beginEndlessAttackWave(runtime);
    }
}

export function resolveEndlessWavePhaseRemaining(runtime) {
    const durations = {
        [ENDLESS_PARCOURS_WAVE_PHASES.ATTACK]: ENDLESS_PARCOURS_WAVE_TIMING.attackSeconds,
        [ENDLESS_PARCOURS_WAVE_PHASES.RETREAT]: ENDLESS_PARCOURS_WAVE_TIMING.retreatSeconds,
        [ENDLESS_PARCOURS_WAVE_PHASES.REST]: ENDLESS_PARCOURS_WAVE_TIMING.restSeconds,
        [ENDLESS_PARCOURS_WAVE_PHASES.RESUPPLY]: ENDLESS_PARCOURS_WAVE_TIMING.resupplySeconds,
    };
    return Math.max(0, (durations[runtime?.wavePhase] || 0) - (runtime?.wavePhaseElapsedSeconds || 0));
}
