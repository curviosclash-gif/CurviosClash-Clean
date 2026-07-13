// ============================================
// RoundStateOps.js - pure round/match end decision helpers
// ============================================

import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';

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

function formatDurationMs(value) {
    const ms = Math.max(0, Number(value) || 0);
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

function getResultPlayerName(player) {
    if (!player) {
        return '';
    }
    return player.isBot ? `Bot ${player.index + 1}` : `Spieler ${player.index + 1}`;
}

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
                messageSub: 'ENTER fuer neues Match oder ESC fuer Menue',
            };
        }
        return {
            state: GAME_STATE_IDS.MATCH_END,
            canWinMatch,
            requiredWins,
            matchWinner,
            reason,
            parcours,
            messageText: `Sieg: ${name} (Score: ${matchWinner.score})`,
            messageSub: 'ENTER fuer neues Match oder ESC fuer Menue',
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
                messageSub: 'Naechste Runde in 3...',
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
            messageSub: 'Naechste Runde in 3...',
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
        messageSub: 'Naechste Runde in 3...',
    };
}
