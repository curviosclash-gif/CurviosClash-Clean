// Round-end plan of the Arcade run (death, abort, sector clear, objective failure), moved out of
// ArcadeRunRuntime.deriveRoundEndPlan unchanged. `runtime` is the ArcadeRunRuntime.
import { ARCADE_RUN_PHASES, completeArcadeSector } from '../../state/arcade/ArcadeRunState.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';
import { captureArcadeHumanVitals } from './ArcadeIntermissionEffects.js';

const ARCADE_RUN_ABORT_REASONS = new Set(['ABORT', 'ABORTED', 'MATCH_ABORT', 'QUIT', 'RUN_ABORT']);

function resolveTerminalReason({ outcomeReason, weaponRaceBotWon, weaponRaceHumanWon, allHumansDead }) {
    if (weaponRaceBotWon) return 'WEAPON_RACE_LOST';
    if (weaponRaceHumanWon) return '';
    if (allHumansDead) return 'ELIMINATION';
    return ARCADE_RUN_ABORT_REASONS.has(outcomeReason) ? outcomeReason : '';
}

function resolveRoundEndMessageText(state, { runFinished, convoyFailed, objectiveTimedOut, sectorLabel, scoreTotal }) {
    if (state.phase === ARCADE_RUN_PHASES.VICTORY) return 'Run geschafft!';
    if (runFinished) {
        if (convoyFailed) return `Sektor ${sectorLabel} verloren · Konvoi durchgebrochen · Run beendet · Score ${Math.round(scoreTotal)}`;
        if (objectiveTimedOut) return `Arcade Run beendet · Zielzeit abgelaufen · Score ${Math.round(scoreTotal)}`;
        return `Arcade Run beendet - Score ${Math.round(scoreTotal)}`;
    }
    if (convoyFailed) return `Sektor ${sectorLabel} verloren · Konvoi durchgebrochen`;
    if (objectiveTimedOut) return `Sektor ${sectorLabel} verloren · Zielzeit abgelaufen`;
    return `Sektor ${sectorLabel} abgeschlossen`;
}

export function deriveArcadeRoundEndPlan(runtime, { players, inputs = {}, baseController } = {}) {
    if (!runtime._enabled || !runtime._state || !baseController) {
        return baseController?.deriveOnRoundEndPlan?.(players, inputs) || null;
    }
    if (![ARCADE_RUN_PHASES.SECTOR_ACTIVE, ARCADE_RUN_PHASES.SUDDEN_DEATH].includes(runtime._state.phase)) return null;
    runtime._pendingHumanVitals = captureArcadeHumanVitals(players);
    const outcomeReason = String(inputs?.reason || '').trim().toUpperCase();
    const parcoursInput = inputs?.parcours && typeof inputs.parcours === 'object'
        ? inputs.parcours
        : null;
    const weaponRaceOutcome = outcomeReason === 'WEAPON_RACE_COMPLETE';
    const weaponRaceBotWon = weaponRaceOutcome && inputs?.winner?.isBot === true;
    const weaponRaceHumanWon = weaponRaceOutcome && inputs?.winner && inputs.winner.isBot !== true;
    const roster = Array.isArray(players) ? players : [];
    const humans = roster.filter((entry) => entry && entry.isBot !== true);
    const hasAliveHuman = humans.some((entry) => entry.alive !== false && toSafeNumber(entry.hp, 1) > 0);
    const allHumansDead = humans.length > 0
        ? !hasAliveHuman
        : outcomeReason !== 'PARCOURS_COMPLETE';
    const terminalReason = resolveTerminalReason({ outcomeReason, weaponRaceBotWon, weaponRaceHumanWon, allHumansDead });
    const objectiveState = runtime._state.objectiveState;
    const objectiveFailed = outcomeReason === 'ARCADE_OBJECTIVE_FAILED' && objectiveState?.failed === true;
    const objectiveTimedOut = objectiveFailed && objectiveState.failureReason === 'time_limit';
    const convoyFailed = objectiveFailed && objectiveState.objectiveId === 'intercept';
    if (!terminalReason && (outcomeReason === 'PARCOURS_COMPLETE' || weaponRaceHumanWon)) {
        const parcoursPlan = runtime.completeParcoursSector(
            {
                reason: outcomeReason,
                parcours: parcoursInput,
            },
            {
                winsNeeded: inputs?.winsNeeded,
            }
        );
        if (parcoursPlan) {
            return parcoursPlan;
        }
    }
    const nowMs = Math.max(0, toSafeNumber(runtime.now(), Date.now()));
    if (terminalReason.length > 0) {
        runtime._pendingHumanVitals = null;
        runtime._state.phase = ARCADE_RUN_PHASES.FINISHED;
        runtime._state.intermission = null;
    } else {
        runtime.applyGameplayEvent({ type: 'sector_complete', elapsed: runtime._sectorElapsedSeconds });
        runtime._state = completeArcadeSector(runtime._state, nowMs, {
            simulatedDurationSec: runtime._sectorElapsedSeconds,
        });
        if (objectiveFailed && runtime._state.phase === ARCADE_RUN_PHASES.VICTORY) {
            runtime._state = {
                ...runtime._state,
                phase: ARCADE_RUN_PHASES.FINISHED,
                victory: null,
                intermission: null,
                finaleFailed: true,
            };
        } else {
            runtime._prepareIntermission(nowMs);
        }
    }
    const runFinished = runtime._state.phase === ARCADE_RUN_PHASES.FINISHED;
    const scoreTotal = Math.max(0, toSafeNumber(runtime._state?.score?.total, 0));
    const combo = Math.max(0, Math.floor(toSafeNumber(runtime._state?.score?.combo, 0)));
    const multiplier = Math.max(1, toSafeNumber(runtime._state?.score?.multiplier, 1));
    const sectorLabel = `${runtime._state.completedSectors}/${runtime._state.config.sectorCount}`;
    const messageText = resolveRoundEndMessageText(runtime._state, {
        runFinished,
        convoyFailed,
        objectiveTimedOut,
        sectorLabel,
        scoreTotal,
    });
    const messageSub = runtime._state.phase === ARCADE_RUN_PHASES.VICTORY ? 'Run abschließen oder freiwillig weiterspielen' : runFinished
        ? 'ENTER für neuen Run oder ESC für Menü'
        : `Intermission: Combo ${combo} / x${multiplier}`;
    return {
        outcome: {
            state: runFinished ? 'MATCH_END' : 'ROUND_END',
            canWinMatch: true,
            requiredWins: Math.max(1, Number(inputs?.winsNeeded) || 1),
            matchWinner: null,
            reason: terminalReason || outcomeReason,
            parcours: parcoursInput,
            messageText,
            messageSub,
            arcade: {
                phase: runtime._state.phase,
                sectorIndex: runtime._state.sectorIndex,
                completedSectors: runtime._state.completedSectors,
                score: scoreTotal,
                intermission: runFinished ? null : runtime.getIntermissionState(),
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
