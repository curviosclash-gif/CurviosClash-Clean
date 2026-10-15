// Completion of a parcours sector (including a won weapon race), moved out of
// ArcadeRunRuntime.completeParcoursSector unchanged. `runtime` is the ArcadeRunRuntime.
import { ARCADE_RUN_PHASES, completeArcadeSector } from '../../state/arcade/ArcadeRunState.js';
import { getRuntimeMapDefinition } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';
import { getArcadeJourneyStage } from '../../shared/contracts/ArcadeJourneyContract.js';

export function completeArcadeParcoursSector(runtime, parcoursResult = {}, options = {}) {
    if (!runtime._enabled || !runtime._state) return null;
    if (!runtime.isCurrentSectorParcours()) return null;
    if (!['sector_active', 'sudden_death'].includes(runtime._state.phase)) return null;

    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    const completionMs = Math.max(0, toSafeNumber(
        parcoursResult?.parcours?.completionTimeMs,
        toSafeNumber(parcoursResult?.parcours?.standings?.[0]?.finishTimeMs, 0)
    ));
    const completionReason = String(parcoursResult?.reason || 'PARCOURS_COMPLETE');
    runtime.applyGameplayEvent({
        type: 'sector_complete',
        elapsed: completionMs > 0 ? completionMs / 1000 : runtime._sectorElapsedSeconds,
    });
    runtime._state = completeArcadeSector(runtime._state, nowMs, {
        simulatedDurationSec: completionMs > 0 ? completionMs / 1000 : runtime._sectorElapsedSeconds,
    });
    const map = getRuntimeMapDefinition(runtime._state.currentMapKey);
    const references = (map?.missions || []).filter(m => m.type === 'TIME_TRIAL')
        .map(m => Number(m.params?.target)).filter(value => value > 0 && Number.isFinite(value));
    runtime._state.lastCompletedSectorResult = { ...runtime._state.lastCompletedSectorResult,
        parcours: { ...parcoursResult.parcours, referenceTimeMs: (references.length ? Math.min(...references) : 60) * 1000 } };
    // Fixed Journey routes finish at their last goal, without generating a fourth sector.
    const runFinished = runtime._state.phase === ARCADE_RUN_PHASES.VICTORY
        && Boolean(getArcadeJourneyStage(runtime._state.config.journeyStageId)?.sectorCount);
    if (runFinished) {
        runtime._state.phase = ARCADE_RUN_PHASES.FINISHED;
        runtime._state.victory = null;
        runtime._state.intermission = null;
    } else {
        runtime._prepareIntermission(nowMs);
    }

    const scoreTotal = Math.max(0, toSafeNumber(runtime._state?.score?.total, 0));
    const sectorLabel = `${runtime._state.completedSectors}/${runtime._state.config.sectorCount}`;
    const completionSec = completionMs > 0 ? (completionMs / 1000).toFixed(2) : '?';
    const requiredWins = Math.max(1, Number(options?.winsNeeded) || 1);
    const messageText = runFinished ? 'Erster Lauf geschafft!' : runtime._state.phase === ARCADE_RUN_PHASES.VICTORY ? 'Run geschafft!'
        : completionReason === 'WEAPON_RACE_COMPLETE'
            ? `Weapon Race gewonnen — ${completionSec}s | Sektor ${sectorLabel}`
            : `Parcours abgeschlossen — ${completionSec}s | Sektor ${sectorLabel}`;
    const messageSub = runFinished ? 'ENTER für neuen Run oder ESC für Menü' : runtime._state.phase === ARCADE_RUN_PHASES.VICTORY ? 'Run abschließen oder freiwillig weiterspielen' : 'Intermission: nächster Sektor';

    return {
        outcome: {
            state: runFinished ? 'MATCH_END' : 'ROUND_END',
            canWinMatch: true,
            requiredWins,
            matchWinner: null,
            reason: completionReason,
            parcours: parcoursResult?.parcours || null,
            messageText,
            messageSub,
            arcade: {
                phase: runtime._state.phase,
                sectorIndex: runtime._state.sectorIndex,
                completedSectors: runtime._state.completedSectors,
                score: scoreTotal,
                intermission: runtime.getIntermissionState(),
                parcours: parcoursResult?.parcours || null,
            },
        },
        transition: {
            roundPause: Number(runtime._config.intermissionSeconds) || 10,
            nextState: runFinished ? 'MATCH_END' : 'ROUND_END',
            overlayMessageText: messageText,
            overlayMessageSub: messageSub,
        },
    };
}
