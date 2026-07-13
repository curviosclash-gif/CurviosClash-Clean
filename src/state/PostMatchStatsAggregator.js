const POST_MATCH_STATS_CONTRACT_VERSION = 'post-match-stats.v1';

function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDuration(seconds) {
    const value = Math.max(0, normalizeNumber(seconds, 0));
    return `${value.toFixed(value >= 10 ? 1 : 2)}s`;
}

function formatDurationMs(ms) {
    const valueMs = Math.max(0, normalizeNumber(ms, 0));
    const seconds = valueMs / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

function formatPercent(value) {
    return `${Math.round(Math.max(0, normalizeNumber(value, 0)) * 100)}%`;
}

function formatDecimal(value, digits = 1) {
    return normalizeNumber(value, 0).toFixed(digits);
}

function formatPlayerName(player) {
    if (!player) return 'Unbekannt';
    return player.isBot ? `Bot ${Number(player.index) + 1}` : `Spieler ${Number(player.index) + 1}`;
}

function resolveWinnerLabel(lastRoundMetrics, players) {
    if (!lastRoundMetrics) return 'Unbekannt';
    const winnerIndex = Number(lastRoundMetrics.winnerIndex);
    if (!Number.isFinite(winnerIndex) || winnerIndex < 0) return 'Unentschieden';
    const winner = normalizeArray(players).find((player) => Number(player?.index) === winnerIndex) || null;
    if (winner) return formatPlayerName(winner);
    return lastRoundMetrics.winnerIsBot ? `Bot ${winnerIndex + 1}` : `Spieler ${winnerIndex + 1}`;
}

function resolveObjectiveLabel(reason) {
    const normalized = String(reason || '').trim();
    if (normalized === 'PARCOURS_COMPLETE') return 'Parcours abgeschlossen';
    if (normalized === 'ELIMINATION') return 'Elimination';
    return normalized || '-';
}

function buildRoundBlock(lastRoundMetrics, players, outcome) {
    if (!lastRoundMetrics) return null;
    return {
        id: 'round',
        title: outcome?.state === 'MATCH_END' ? 'Finalrunde' : 'Diese Runde',
        rows: [
            { key: 'winner', label: 'Sieger', value: resolveWinnerLabel(lastRoundMetrics, players) },
            { key: 'objective', label: 'Grund', value: resolveObjectiveLabel(lastRoundMetrics.reason || outcome?.reason) },
            { key: 'duration', label: 'Dauer', value: formatDuration(lastRoundMetrics.duration) },
            { key: 'bot-survival', label: 'Bot-Ueberleben', value: formatDuration(lastRoundMetrics.botSurvivalAverage) },
            { key: 'self-collisions', label: 'Selbstcrashs', value: String(Math.max(0, normalizeNumber(lastRoundMetrics.selfCollisions, 0))) },
            { key: 'item-uses', label: 'Items', value: String(Math.max(0, normalizeNumber(lastRoundMetrics.itemUseEvents, 0))) },
            { key: 'stuck-rate', label: 'Stuck/min', value: formatDecimal(lastRoundMetrics.stuckPerMinute, 1) },
        ],
    };
}

function buildParcoursBlock(lastRoundMetrics) {
    if (!lastRoundMetrics) return null;
    if (lastRoundMetrics.parcoursCompleted !== true) return null;
    return {
        id: 'parcours',
        title: 'Parcours',
        rows: [
            { key: 'route', label: 'Route', value: String(lastRoundMetrics.parcoursRouteId || '-') },
            { key: 'completion-time', label: 'Zeit', value: formatDurationMs(lastRoundMetrics.parcoursCompletionTimeMs) },
            { key: 'checkpoints', label: 'Checkpoints', value: String(Math.max(0, normalizeNumber(lastRoundMetrics.parcoursCheckpointCount, 0))) },
        ],
    };
}

function buildMatchBlock(aggregateMetrics, outcome) {
    if (!aggregateMetrics) return null;
    return {
        id: 'match',
        title: outcome?.state === 'MATCH_END' ? 'Match gesamt' : 'Match bisher',
        rows: [
            { key: 'rounds', label: 'Runden', value: String(Math.max(0, normalizeNumber(aggregateMetrics.rounds, 0))) },
            { key: 'bot-win-rate', label: 'Bot-Siegrate', value: formatPercent(aggregateMetrics.botWinRate) },
            { key: 'bot-survival-average', label: 'Bot-Ueberleben', value: formatDuration(aggregateMetrics.averageBotSurvival) },
            { key: 'self-collisions-per-round', label: 'Selbstcrashs/R', value: formatDecimal(aggregateMetrics.selfCollisionsPerRound, 1) },
            { key: 'item-use-per-round', label: 'Items/R', value: formatDecimal(aggregateMetrics.itemUsePerRound, 1) },
            { key: 'bounce-wall-per-round', label: 'Wall-Bounces/R', value: formatDecimal(aggregateMetrics.bounceWallPerRound, 1) },
        ],
    };
}

function buildScoreboardRows(players, requiredWins) {
    const sortedPlayers = normalizeArray(players)
        .filter(Boolean)
        .slice()
        .sort((left, right) => {
            const scoreDelta = normalizeNumber(right?.score, 0) - normalizeNumber(left?.score, 0);
            if (scoreDelta !== 0) return scoreDelta;
            const botDelta = Number(!!left?.isBot) - Number(!!right?.isBot);
            if (botDelta !== 0) return botDelta;
            return normalizeNumber(left?.index, 0) - normalizeNumber(right?.index, 0);
        });

    const visibleRows = sortedPlayers.slice(0, 4).map((player) => ({
        key: `player-${Number(player?.index) || 0}`,
        label: formatPlayerName(player),
        value: `${Math.max(0, normalizeNumber(player?.score, 0))}/${Math.max(1, normalizeNumber(requiredWins, 1))}`,
    }));

    if (sortedPlayers.length > visibleRows.length) {
        visibleRows.push({
            key: 'more',
            label: 'Weitere',
            value: `+${sortedPlayers.length - visibleRows.length}`,
        });
    }
    return visibleRows;
}

function buildScoreboardBlock(players, outcome) {
    const rows = buildScoreboardRows(players, outcome?.requiredWins || 1);
    if (rows.length === 0) return null;
    return {
        id: 'scoreboard',
        title: outcome?.state === 'MATCH_END' ? 'Endstand' : 'Zwischenstand',
        rows,
    };
}

export function buildPostMatchStatsSummary({ recorder, players = [], outcome = null } = {}) {
    const lastRoundMetrics = recorder?.getLastRoundMetrics?.() || null;
    const aggregateMetrics = recorder?.getAggregateMetrics?.() || null;

    const blocks = [
        buildRoundBlock(lastRoundMetrics, players, outcome),
        buildParcoursBlock(lastRoundMetrics),
        buildMatchBlock(aggregateMetrics, outcome),
        buildScoreboardBlock(players, outcome),
    ].filter(Boolean);

    if (blocks.length === 0) return null;
    return {
        contractVersion: POST_MATCH_STATS_CONTRACT_VERSION,
        visible: true,
        blocks,
    };
}
