import { deriveRoundEndOverlayUiState } from '../shared/contracts/MatchUiStateContract.js';
import { normalizePostMatchStats } from '../shared/contracts/PostMatchStatsContract.js';
import { resolveWinnerIndex } from './postmatch/PostMatchLabels.js';
import { buildStandingsBlock } from './postmatch/PostMatchStandingsBlock.js';
import { buildRoundBlock } from './postmatch/PostMatchRoundBlock.js';
import { buildEndlessParcoursBlocks, buildParcoursBlock } from './postmatch/PostMatchParcoursBlocks.js';
import { buildMatchDetailBlock, buildRoundDetailBlock } from './postmatch/PostMatchDetailBlocks.js';
import { buildParticipantComparisonBlock } from './postmatch/PostMatchComparisonBlock.js';
import { buildArcadeProgressionBlock } from './postmatch/PostMatchArcadeProgressionBlock.js';
import { buildEscortBlock } from './postmatch/PostMatchEscortBlock.js';

function getSafeLogger(logger) {
    return logger && typeof logger.log === 'function' ? logger : console;
}

// Reading order of the board: where does the match stand, what happened in this round, what did the
// route do, and only then the tuning figures. The block builders live in src/ui/postmatch/ so this
// file stays the wiring and the contract normalizer has the last word on the shape.
function buildPostMatchStatsSummary({
    recorder = null,
    players = [],
    outcome = null,
    huntScoreboard = null,
    localPlayerIndexes = null,
    checkpointResetsByPlayer = null,
    arcadeProgression = null,
    escortSummary = null,
} = {}) {
    const lastRoundMetrics = recorder?.getLastRoundMetrics?.() || null;
    const aggregateMetrics = recorder?.getAggregateMetrics?.() || null;
    const endlessBlocks = buildEndlessParcoursBlocks(outcome);
    const blocks = [
        buildStandingsBlock({
            players,
            outcome,
            huntScoreboard,
            localPlayerIndexes,
            roundWinnerIndex: resolveWinnerIndex(lastRoundMetrics),
        }),
        buildRoundBlock(lastRoundMetrics, players, outcome),
        buildEscortBlock({ escort: escortSummary, huntScoreboard, players }),
        ...endlessBlocks.filter((block) => block.tier !== 'detail'),
        buildParcoursBlock(lastRoundMetrics),
        buildParticipantComparisonBlock({
            players,
            huntScoreboard,
            weaponRaceStandings: outcome?.parcours?.standings,
            checkpointResetsByPlayer,
        }),
        buildArcadeProgressionBlock(arcadeProgression),
        ...endlessBlocks.filter((block) => block.tier === 'detail'),
        buildRoundDetailBlock(lastRoundMetrics),
        buildMatchDetailBlock(aggregateMetrics, outcome, huntScoreboard),
    ].filter(Boolean);
    const summary = normalizePostMatchStats({ blocks, visible: true });
    return summary.blocks.length > 0 ? summary : null;
}

function finalizeRoundRecording({
    recorder,
    winner,
    players,
    reason = '',
    parcours = null,
    logger = console,
}) {
    const safeLogger = getSafeLogger(logger);
    safeLogger.log('--- ROUND END ---');
    try {
        const roundMetrics = recorder?.finalizeRound?.(winner, players, {
            reason,
            parcours,
        });
        if (roundMetrics) {
            safeLogger.log('[Recorder] Round KPI:', roundMetrics);
        }
        recorder?.dump?.();
        return { ok: true, roundMetrics };
    } catch (error) {
        if (typeof safeLogger.error === 'function') {
            safeLogger.error('Recorder Dump Failed:', error);
        }
        return { ok: false, error };
    }
}

function applyRoundEndWinnerScore(winner, players = [], winnerTeamId = null) {
    if (!winner) {
        return { scored: false, score: null };
    }
    if (winnerTeamId) {
        const teammates = players.filter((player) => player?.teamId === winnerTeamId
            && player?.entitySlotActive !== false);
        for (const teammate of teammates) {
            teammate.score = (Number(teammate.score) || 0) + 1;
        }
        return {
            scored: teammates.length > 0,
            score: teammates.length > 0 ? teammates[0].score : null,
            playerIndexes: teammates.map((player) => player.index),
        };
    }
    winner.score = (Number(winner.score) || 0) + 1;
    return { scored: true, score: winner.score };
}

function buildRoundEndControllerInputs(inputs = {}) {
    return {
        winner: inputs.winner || null,
        humanPlayerCount: Math.max(0, Number(inputs.humanPlayerCount) || 0),
        totalBots: Math.max(0, Number(inputs.totalBots) || 0),
        winsNeeded: Math.max(1, Number(inputs.winsNeeded) || 1),
        reason: typeof inputs.outcomeReason === 'string' ? inputs.outcomeReason : '',
        winnerTeamId: inputs.winnerTeamId || null,
        parcours: inputs.parcours && typeof inputs.parcours === 'object' ? inputs.parcours : null,
    };
}

function deriveOnRoundEndCoordinatorPlan({ roundStateController, players, inputs }) {
    return roundStateController.deriveOnRoundEndPlan(players, buildRoundEndControllerInputs(inputs));
}

function deriveRoundEndCoordinatorUiState(plan = {}, statsSummary = null) {
    return deriveRoundEndOverlayUiState({
        messageText: plan?.transition?.overlayMessageText || '',
        messageSub: plan?.transition?.overlayMessageSub || '',
        overlayStats: statsSummary,
    });
}

function deriveRoundEndCoordinatorEffectsPlan() {
    return {
        shouldUpdateHud: true,
        reason: 'ROUND_END',
    };
}

export function coordinateRoundEnd({
    recorder,
    winner,
    players,
    roundStateController,
    humanPlayerCount,
    totalBots,
    winsNeeded,
    outcomeReason = '',
    winnerTeamId = null,
    parcours = null,
    huntScoreboard = null,
    localPlayerIndexes = null,
    checkpointResetsByPlayer = null,
    arcadeProgression = null,
    escortSummary = null,
    logger = console,
}) {
    const recording = finalizeRoundRecording({
        recorder,
        winner,
        players,
        reason: outcomeReason,
        parcours,
        logger,
    });
    const score = applyRoundEndWinnerScore(winner, players, winnerTeamId);
    const plan = deriveOnRoundEndCoordinatorPlan({
        roundStateController,
        players,
        inputs: { winner, winnerTeamId, humanPlayerCount, totalBots, winsNeeded, outcomeReason, parcours },
    });
    const statsSummary = buildPostMatchStatsSummary({
        recorder,
        players,
        outcome: plan?.outcome,
        huntScoreboard,
        localPlayerIndexes,
        checkpointResetsByPlayer,
        arcadeProgression,
        escortSummary,
    });
    const uiState = deriveRoundEndCoordinatorUiState(plan, statsSummary);
    const effectsPlan = deriveRoundEndCoordinatorEffectsPlan();
    return {
        recording,
        score,
        effectsPlan,
        statsSummary,
        uiState,
        ...plan,
    };
}
