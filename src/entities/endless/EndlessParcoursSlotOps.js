import { ENDLESS_PARCOURS_BOT_CAPACITY } from '../../shared/contracts/EndlessParcoursContract.js';
import { ENDLESS_PARCOURS_WAVE_PHASES, resolveEndlessWaveProfile } from '../../shared/contracts/EndlessParcoursWaveContract.js';
import {
    findSafeEndlessSpawnAnchor,
    promoteEndlessElite,
    resolveEndlessBotRocketType,
    resolveEndlessBotRole,
    resolveEndlessSpawnSide,
    shouldUseAheadAnchor,
    telegraphEndlessSpawn,
} from './EndlessParcoursBotDirectorOps.js';
import { canActivateEndlessSlot, countEndlessOccupiedSlots } from './EndlessParcoursWaveOps.js';

const BOT_SPAWN_DEFER_SECONDS = 0.5;

export function prepareEndlessSlot(runtime, slotState) {
    if (slotState.state !== 'reserved' || slotState.telegraphedAt >= 0) return false;
    return telegraphEndlessSpawn(runtime, slotState, { elite: slotState.plannedElite === true });
}

function sameAnchor(left, right) {
    return left && right && left.id === right.id
        && left.x === right.x && left.y === right.y && left.z === right.z;
}

function isAnchorLoaded(runtime, anchor) {
    if (!anchor) return false;
    for (const instance of runtime.activeModules.values()) {
        for (const candidate of instance.module.botAnchors) {
            if (candidate.id === anchor.id) return true;
        }
    }
    return false;
}

function resetTelegraph(runtime, slotState, anchor) {
    const human = runtime.entityManager?.humanPlayers?.[0] || null;
    slotState.plannedAnchor = {
        id: anchor.id, x: anchor.x, y: anchor.y, z: anchor.z, ahead: anchor.ahead === true,
    };
    slotState.telegraphedAt = runtime.elapsedCombatSeconds;
    runtime.spawnWarning = {
        side: resolveEndlessSpawnSide(human, anchor), remaining: 1, elite: slotState.plannedElite === true,
    };
}

export function tryActivateEndlessSlot(runtime, slotState) {
    if (!canActivateEndlessSlot(runtime, slotState)) return false;
    const elite = slotState.plannedElite === true;
    const planned = slotState.plannedAnchor;
    if (!isAnchorLoaded(runtime, planned)
        || !runtime._isSpawnAnchorSafe(planned, runtime.entityManager?.humanPlayers?.[0] || null)) {
        const replacement = findSafeEndlessSpawnAnchor(runtime, slotState, {
            wantsElite: elite,
            wantsAhead: elite || shouldUseAheadAnchor(runtime, slotState),
        });
        if (!replacement) {
            slotState.eligibleAt = runtime.elapsedCombatSeconds + BOT_SPAWN_DEFER_SECONDS;
            return false;
        }
        if (!sameAnchor(planned, replacement)) {
            resetTelegraph(runtime, slotState, replacement);
            return false;
        }
    }

    const profile = resolveEndlessWaveProfile(runtime.waveNumber);
    slotState.life += 1;
    slotState.activationGeneration += 1;
    const activated = runtime.entityManager?.activateBotSlot?.({
        slot: slotState.slot,
        position: slotState.plannedAnchor,
        direction: runtime._tmpSpawnDirection,
        role: resolveEndlessBotRole(runtime, slotState, { elite }),
        difficulty: elite ? 'HARD' : profile.difficulty,
        life: slotState.life,
        endlessProfile: profile,
    }) === true;
    if (!activated) {
        slotState.life -= 1;
        slotState.activationGeneration -= 1;
        slotState.eligibleAt = runtime.elapsedCombatSeconds + BOT_SPAWN_DEFER_SECONDS;
        return false;
    }
    runtime._activationSequence += 1;
    slotState.activatedOrder = runtime._activationSequence;
    slotState.player.endlessActivationGeneration = slotState.activationGeneration;
    slotState.player.endlessBotSlot = slotState.slot;
    slotState.player.endlessRunId = runtime.runId;
    slotState.player.endlessWaveNumber = runtime.waveNumber;
    slotState.player.endlessDifficulty = elite ? 'HARD' : profile.difficulty;
    slotState.player.endlessDamageMultiplier = profile.damageMultiplier;
    slotState.player.endlessForcedRetreat = false;
    slotState.player.endlessRetreatReason = '';
    if (!Array.isArray(slotState.player.inventory)) slotState.player.inventory = [];
    if (elite) {
        promoteEndlessElite(slotState.player);
        slotState.player.inventory.length = 0;
        slotState.player.inventory.push('ROCKET_HEAVY');
        runtime._eliteWaveSpawned = runtime.waveNumber;
    } else {
        const baseMaxHp = Math.max(1, Number(slotState.player.maxHp) || 100);
        slotState.player.maxHp = Math.round(baseMaxHp * profile.healthMultiplier);
        slotState.player.hp = slotState.player.maxHp;
        const rocketType = resolveEndlessBotRocketType(runtime.waveNumber, slotState.player.scenarioRole);
        if (rocketType) {
            slotState.player.inventory.length = 0;
            slotState.player.inventory.push(rocketType);
        }
    }
    slotState.state = 'active';
    slotState.eligibleAt = 0;
    slotState.plannedAnchor = null;
    slotState.plannedElite = false;
    slotState.telegraphedAt = -1;
    runtime.lastBotActivationAtSeconds = runtime.elapsedCombatSeconds;
    runtime.spawnWarning = null;
    return true;
}

export function reconcileEndlessBots(runtime) {
    if (!runtime.combatStarted || runtime.wavePhase !== ENDLESS_PARCOURS_WAVE_PHASES.ATTACK) return;
    if (countEndlessOccupiedSlots(runtime._botSlots) > Math.min(ENDLESS_PARCOURS_BOT_CAPACITY, runtime._botSlots.length)) {
        throw new Error('Endless bot occupancy exceeded its hard capacity');
    }
    const reserved = runtime._botSlots
        .filter((slot) => slot.state === 'reserved' && slot.reservedWave === runtime.waveNumber)
        .sort((left, right) => left.slot - right.slot);
    if (reserved.length === 0) return;
    prepareEndlessSlot(runtime, reserved[0]);
    tryActivateEndlessSlot(runtime, reserved[0]);
}
