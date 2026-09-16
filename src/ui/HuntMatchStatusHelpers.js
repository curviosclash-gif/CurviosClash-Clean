export function formatHuntClock(seconds) {
    const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatHuntScoreboard(rows, localPlayerIndex, fallback) {
    const visible = rows.slice(0, 3);
    const local = rows.find((row) => row?.playerIndex === localPlayerIndex);
    if (local && !visible.includes(local)) visible.push(local);
    return visible.length > 0
        ? visible.map((row) => `${row.playerIndex === localPlayerIndex ? '▶ ' : ''}${row.label} ${row.kills}`).join('   |   ')
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
