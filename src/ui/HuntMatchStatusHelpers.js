import { isArenaWavesConfig } from '../shared/contracts/ArenaWavesContract.js';
import { isEndlessParcoursConfig } from '../shared/contracts/EndlessParcoursContract.js';
import { HUNT_WIN_CONDITIONS, normalizeHuntWinCondition } from '../shared/contracts/HuntWinConditionContract.js';
import { HUNT_LAST_ALIVE_LIVES } from '../shared/contracts/HuntLivesContract.js';

export function formatHuntClock(seconds) {
    const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Top three plus every local player below them, so a split screen shows both humans.
export function getHuntScoreValue(row, winCondition, livesRemainingByPlayer = {}) {
    const mode = normalizeHuntWinCondition(winCondition);
    const value = mode === HUNT_WIN_CONDITIONS.LAST_ALIVE
        ? (livesRemainingByPlayer?.[row?.playerIndex] ?? HUNT_LAST_ALIVE_LIVES)
        : mode === HUNT_WIN_CONDITIONS.SCORE_TARGET ? row?.points : row?.kills;
    return Math.max(0, Number(value) || 0);
}

export function rankHuntScoreboardRows(rows, winCondition, livesRemainingByPlayer = {}) {
    if (normalizeHuntWinCondition(winCondition) !== HUNT_WIN_CONDITIONS.LAST_ALIVE) return rows;
    return [...rows].sort((left, right) =>
        getHuntScoreValue(right, winCondition, livesRemainingByPlayer)
        - getHuntScoreValue(left, winCondition, livesRemainingByPlayer));
}

export function formatHuntScoreboard(rows, localPlayerIndices, fallback, winCondition, livesRemainingByPlayer = {}) {
    const locals = new Set(Array.isArray(localPlayerIndices) ? localPlayerIndices : [localPlayerIndices]);
    const visible = rows.slice(0, 3);
    for (const row of rows) {
        if (locals.has(row?.playerIndex) && !visible.includes(row)) visible.push(row);
    }
    return visible.length > 0
        ? visible.map((row) => `${locals.has(row.playerIndex) ? '▶ ' : ''}${row.label} ${getHuntScoreValue(row, winCondition, livesRemainingByPlayer)}`).join('   |   ')
        : String(fallback || (normalizeHuntWinCondition(winCondition) === HUNT_WIN_CONDITIONS.SCORE_TARGET
            ? 'Noch keine Punkte' : 'Noch keine Abschüsse'));
}

export function updateHuntTargetProgress(progress, state, target, score) {
    if (!progress) return;
    const visible = target > 1 && target <= 20;
    progress.classList.toggle('hidden', !visible);
    if (!visible) return;
    if (state.target !== target) {
        progress.replaceChildren();
        for (let index = 0; index < target; index += 1) {
            progress.appendChild(progress.ownerDocument.createElement('span'));
        }
        state.target = target;
        state.filled = -1;
    }
    const filled = Math.max(0, Math.min(target, Number(score) || 0));
    if (filled === state.filled) return;
    for (let index = 0; index < target; index += 1) {
        progress.children[index].classList.toggle('filled', index < filled);
    }
    state.filled = filled;
}

/** Header line: arcade hunt runs are no elimination match, even though they use the fight HUD. */
export function resolveHuntObjectiveText(huntProjection, runtimeConfig, { killLimit, timeText, matchPointText }) {
    if (isArenaWavesConfig(runtimeConfig)) return 'Fünf Fronten · halte jede Welle auf';
    if (isEndlessParcoursConfig(runtimeConfig)) return 'Endlosjagd · überlebe so lange wie möglich';
    if (huntProjection?.respawnEnabled !== true) return 'Elimination · letzter Überlebender gewinnt';
    const mode = normalizeHuntWinCondition(huntProjection?.winCondition);
    const prefix = huntProjection?.teamMode === true ? 'Team-HUNT · ' : '';
    if (mode === HUNT_WIN_CONDITIONS.LAST_ALIVE) return `${prefix}Letztes Team · ${HUNT_LAST_ALIVE_LIVES} Leben pro Spieler`;
    if (mode === HUNT_WIN_CONDITIONS.SCORE_TARGET) return `${prefix}Punktziel · zuerst ${killLimit} Punkte${matchPointText}`;
    return `${prefix}zuerst ${killLimit} Abschüsse${timeText}${matchPointText}`;
}
