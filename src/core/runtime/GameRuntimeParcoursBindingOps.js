import { isFivePortalsConfig } from '../../shared/contracts/PortalChainContract.js';
import { isWeaponRaceConfig } from '../../shared/contracts/WeaponRaceContract.js';
import { handleWeaponRaceLeaderboard, resolveLocalPlayerVehicleId } from './GameRuntimeArcadeSupportOps.js';
import { completeClassicTutorialJourney } from './ArcadeJourneyRuntimeOps.js';

// Existing callback order and semantics are retained for every established run type.
export function bindRuntimeParcoursCallbacks(support, runtimeState = support.getRuntimeState()) {
    const parcoursSystem = runtimeState?.entityManager?._parcoursProgressSystem;
    const fivePortals = isFivePortalsConfig(runtimeState?.runtimeConfig);
    const weaponRace = isWeaponRaceConfig(runtimeState?.runtimeConfig);
    const hunt = support.huntParcoursSupport.isActive(runtimeState?.runtimeConfig);
    const huntCallbacks = hunt ? support.huntParcoursSupport.createParcoursCallbacks(runtimeState.entityManager) : null;
    if (parcoursSystem && typeof parcoursSystem.setXpEventCallback === 'function') {
        parcoursSystem.setXpEventCallback(
            hunt ? huntCallbacks.xp
                : weaponRace ? (eventType, playerIndex, context) => (eventType === 'checkpoint'
                ? support.weaponRaceRuntime.handleCheckpoint({ playerIndex, checkpointId: context?.checkpointId })
                : support.weaponRaceRuntime.handleFinish({ playerIndex, finishedAtMs: context?.finishedAtMs }))
                : fivePortals ? (eventType, playerIndex) => support.fivePortalsRuntime.handleXpEvent(eventType, playerIndex)
                : (eventType, playerIndex) => support.arcadeRunRuntime.applyParcoursXpEvent(eventType, playerIndex, resolveLocalPlayerVehicleId(runtimeState, playerIndex))
        );
    }
    if (parcoursSystem && typeof parcoursSystem.setLeaderboardCallback === 'function') {
        parcoursSystem.setLeaderboardCallback(
            hunt ? huntCallbacks.leaderboard
                : weaponRace ? (data) => handleWeaponRaceLeaderboard(support, runtimeState, data)
                : fivePortals ? (data) => support.fivePortalsRuntime.handleParcoursEvent(data)
                : (data) => {
                    if (!completeClassicTutorialJourney(support, runtimeState, data)) support.arcadeRunRuntime.applyParcoursLeaderboardEvent(data);
                }
        );
    }
    parcoursSystem?.setAttemptResetCallback?.(fivePortals ? () => support.fivePortalsRuntime.handleAttemptReset() : null);
    parcoursSystem?.setDeathCallback?.(weaponRace ? (data) => support.weaponRaceRuntime.handleDeath(data) : null);
    parcoursSystem?.setSpawnCallback?.(weaponRace ? (data) => support.weaponRaceRuntime.handleDeath(data) : null);
    if (parcoursSystem && typeof parcoursSystem.setGhostRecorder === 'function') {
        parcoursSystem.setGhostRecorder(support.arcadeRunRuntime.getGhostRecorder?.() || null);
    }
    if (typeof support.arcadeRunRuntime.setGhostPlaybackHandler === 'function') {
        const entityManager = runtimeState?.entityManager || null;
        support.arcadeRunRuntime.setGhostPlaybackHandler(
            (clip, options) => entityManager?.playLastRoundGhost?.(clip, options)
        );
    }
}
