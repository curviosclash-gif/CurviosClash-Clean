import { formatPlayerName, normalizeArray, normalizeNumber } from './PostMatchLabels.js';

function sum(rows, key) {
    return rows.reduce((total, row) => total + Math.max(0, normalizeNumber(row?.[key], 0)), 0);
}

function leaderLabel(rows, players, key) {
    const leader = [...rows].sort((left, right) => normalizeNumber(right?.[key], 0) - normalizeNumber(left?.[key], 0))[0];
    if (!leader || normalizeNumber(leader?.[key], 0) <= 0) return '-';
    const player = normalizeArray(players).find((entry) => Number(entry?.index) === Number(leader.playerIndex));
    return player ? formatPlayerName(player) : String(leader.label || '-');
}

export function buildEscortBlock({ escort = null, huntScoreboard = null, players = [] } = {}) {
    if (!escort?.active) return null;
    const rows = normalizeArray(huntScoreboard);
    const progress = Math.max(0, Math.min(1, normalizeNumber(escort.progress, 0)));
    const hpRatio = Math.max(0, Math.min(1, normalizeNumber(escort.hpRatio, 0)));
    return {
        id: 'escort',
        title: 'Escort-Auswertung',
        kind: 'values',
        tier: 'primary',
        rows: [
            { key: 'route-progress', label: 'Strecke', value: progress, type: 'percent' },
            { key: 'tank-health', label: 'Panzerzustand', value: hpRatio, type: 'percent' },
            {
                key: 'checkpoints',
                label: 'Checkpoints',
                value: `${Math.max(0, normalizeNumber(escort.checkpointsReached, 0))} / ${Math.max(0, normalizeNumber(escort.checkpointCount, 0))}`,
                type: 'text',
            },
            { key: 'escort-time', label: 'Team Blau eskortiert', value: sum(rows, 'escortSeconds'), type: 'duration' },
            { key: 'tank-damage', label: 'Team Orange Schaden', value: sum(rows, 'escortTankDamage'), type: 'count' },
            { key: 'recoveries', label: 'Wiederherstellungen', value: sum(rows, 'escortRecoveries'), type: 'count' },
            { key: 'top-escort', label: 'Bester Begleiter', value: leaderLabel(rows, players, 'escortSeconds'), type: 'text' },
            { key: 'top-attacker', label: 'Bester Angreifer', value: leaderLabel(rows, players, 'escortTankDamage'), type: 'text' },
        ],
    };
}
