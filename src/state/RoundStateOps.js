// ============================================
// RoundStateOps.js - pure round/match end decision helpers
// ============================================

import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { PLAYER_LABEL_STYLES, formatPlayerDisplayLabel } from '../shared/contracts/PlayerDisplayLabelContract.js';

function ensureArray(players) {
    return Array.isArray(players) ? players : [];
}

function normalizeCount(value) {
    return Math.max(0, parseInt(value, 10) || 0);
}

function normalizeRequiredWins(winsNeeded) {
    return Math.max(1, parseInt(winsNeeded, 10) || 1);
}

function normalizeOutcomeReason(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || 'ELIMINATION';
}

const GERMAN_TENTHS = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const GERMAN_COUNT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

// Same form as the board's duration row (src/ui/postmatch/PostMatchFormat.js, which state may not
// import): "12,5 s" below a minute, "1:15" from a minute on.
function formatDurationMs(value) {
    const seconds = Math.round(Math.max(0, Number(value) || 0) / 100) / 10;
    if (seconds < 60) return `${GERMAN_TENTHS.format(seconds)} s`;
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function formatScore(value) {
    return GERMAN_COUNT.format(Math.floor(Number(value) || 0));
}

function getResultPlayerName(player) {
    if (!player) {
        return '';
    }
    return formatPlayerDisplayLabel(player, { style: PLAYER_LABEL_STYLES.LONG });
}

/** Round wins of the strongest player who did not win the match - the right half of "3 : 1 Runden". */
function getRunnerUpWins(players, matchWinner) {
    let best = 0;
    for (const player of players) {
        if (!player || player === matchWinner) {
            continue;
        }
        best = Math.max(best, normalizeCount(player.score));
    }
    return best;
}

// The key hints live on the result board's continue prompt (P7c), so the subtitle carries only
// the outcome itself.
export function deriveRoundEndOutcome(players, inputs = {}) {
    const safePlayers = ensureArray(players);
    const winner = inputs.winner || null;
    const reason = normalizeOutcomeReason(inputs.reason);
    const parcours = inputs.parcours && typeof inputs.parcours === 'object'
        ? { ...inputs.parcours }
        : null;
    const humanPlayerCount = normalizeCount(inputs.humanPlayerCount);
    const totalBots = normalizeCount(inputs.totalBots);
    const requiredWins = normalizeRequiredWins(inputs.winsNeeded);
    const canWinMatch = humanPlayerCount > 1 || totalBots > 0;
    const matchWinner = canWinMatch ? (safePlayers.find((player) => player && player.score >= requiredWins) || null) : null;

    if (reason.startsWith('ENDLESS_')) {
        const summary = parcours?.endlessSummary || {};
        return {
            state: GAME_STATE_IDS.MATCH_END,
            canWinMatch: false,
            requiredWins,
            matchWinner: null,
            reason,
            parcours,
            messageText: summary.isNewRecord === true
                ? `Neuer Rekord – ${formatScore(summary.score)} Punkte`
                : `Endlosjagd beendet – ${formatScore(summary.score)} Punkte`,
            messageSub: Array.isArray(summary.newMilestones) && summary.newMilestones.length > 0
                ? `${summary.newMilestones.length} neue Meilensteine`
                : '',
        };
    }

    if (matchWinner) {
        const name = getResultPlayerName(matchWinner);
        if (reason === 'PARCOURS_COMPLETE') {
            const completionSuffix = Number.isFinite(Number(parcours?.completionTimeMs))
                ? ` (${formatDurationMs(parcours.completionTimeMs)})`
                : '';
            return {
                state: GAME_STATE_IDS.MATCH_END,
                canWinMatch,
                requiredWins,
                matchWinner,
                reason,
                parcours,
                messageText: `Parcours abgeschlossen: ${name}${completionSuffix}`,
                messageSub: '',
            };
        }
        return {
            state: GAME_STATE_IDS.MATCH_END,
            canWinMatch,
            requiredWins,
            matchWinner,
            reason,
            parcours,
            messageText: `${name} gewinnt das Match`,
            messageSub: `${normalizeCount(matchWinner.score)} : ${getRunnerUpWins(safePlayers, matchWinner)} Runden`,
        };
    }

    if (winner) {
        const name = getResultPlayerName(winner);
        if (reason === 'PARCOURS_COMPLETE') {
            const completionSuffix = Number.isFinite(Number(parcours?.completionTimeMs))
                ? ` (${formatDurationMs(parcours.completionTimeMs)})`
                : '';
            return {
                state: GAME_STATE_IDS.ROUND_END,
                canWinMatch,
                requiredWins,
                matchWinner: null,
                reason,
                parcours,
                messageText: `Parcours abgeschlossen: ${name}${completionSuffix}`,
                messageSub: 'Nächste Runde in 3...',
            };
        }
        return {
            state: GAME_STATE_IDS.ROUND_END,
            canWinMatch,
            requiredWins,
            matchWinner: null,
            reason,
            parcours,
            messageText: `${name} gewinnt die Runde`,
            messageSub: 'Nächste Runde in 3...',
        };
    }

    return {
        state: GAME_STATE_IDS.ROUND_END,
        canWinMatch,
        requiredWins,
        matchWinner: null,
        reason,
        parcours,
        messageText: 'Unentschieden',
        messageSub: 'Nächste Runde in 3...',
    };
}
