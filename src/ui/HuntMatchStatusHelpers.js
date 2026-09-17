export function formatHuntClock(seconds) {
    const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Top three plus every local player below them, so a split screen shows both humans.
export function formatHuntScoreboard(rows, localPlayerIndices, fallback) {
    const locals = new Set(Array.isArray(localPlayerIndices) ? localPlayerIndices : [localPlayerIndices]);
    const visible = rows.slice(0, 3);
    for (const row of rows) {
        if (locals.has(row?.playerIndex) && !visible.includes(row)) visible.push(row);
    }
    return visible.length > 0
        ? visible.map((row) => `${locals.has(row.playerIndex) ? '▶ ' : ''}${row.label} ${row.kills}`).join('   |   ')
        : String(fallback || 'Noch keine Abschüsse');
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
