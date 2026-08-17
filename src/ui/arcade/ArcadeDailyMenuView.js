export function createArcadeDailyMenuCard(createElement, buttonLabel = 'Daily starten') {
    const card = createElement('section', 'arcade-surface-card');
    card.appendChild(createElement('h3', 'arcade-surface-card-title', 'Daily Challenge'));
    const line = createElement('p', 'arcade-surface-card-value');
    line.id = 'arcade-daily-line';
    card.appendChild(line);
    const actions = createElement('div', 'arcade-surface-actions');
    const button = createElement('button', 'secondary-btn', buttonLabel);
    button.type = 'button';
    button.id = 'btn-arcade-daily';
    actions.appendChild(button);
    card.appendChild(actions);
    return { card, line, button };
}

export function renderArcadeDailyMenuState(line, daily = null, fallbackSeed = 0) {
    if (!line) return;
    const seed = Math.max(0, Math.floor(Number(daily?.seed) || Number(fallbackSeed) || 0));
    if (daily?.playedToday !== true) {
        line.textContent = `Heute noch nicht gespielt | Seed ${seed}`;
        return;
    }
    const runsPlayed = Math.max(0, Math.floor(Number(daily.runsPlayed) || 0));
    const attemptLabel = runsPlayed === 1 ? '1 Versuch' : `${runsPlayed} Versuche`;
    const bestScore = Math.max(0, Math.round(Number(daily.bestScore) || 0));
    const lastScore = Math.max(0, Math.round(Number(daily.lastScore) || 0));
    line.textContent = `Heute: ${attemptLabel} | Bestwert ${bestScore} | Zuletzt ${lastScore}`;
}
