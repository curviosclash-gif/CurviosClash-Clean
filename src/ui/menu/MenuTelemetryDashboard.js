function formatPercent(value) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    return `${Math.round(normalized * 100)}%`;
}

function formatDuration(value) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    return `${normalized.toFixed(normalized >= 10 ? 1 : 2)}s`;
}

function formatDurationMs(value) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const seconds = normalized / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

function formatDecimal(value) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? parsed : 0;
    return normalized.toFixed(1);
}

function clearContainer(container) {
    if (!container) return;
    container.innerHTML = '';
}

function appendRow(list, key, labelText, valueText) {
    const row = document.createElement('div');
    row.className = 'developer-telemetry-row';
    row.setAttribute('data-telemetry-row-key', String(key || 'row'));

    const label = document.createElement('dt');
    label.className = 'developer-telemetry-label';
    label.textContent = String(labelText || '');

    const value = document.createElement('dd');
    value.className = 'developer-telemetry-value';
    value.textContent = String(valueText || '');

    row.append(label, value);
    list.appendChild(row);
}

function createCard(container, id, titleText) {
    const card = document.createElement('section');
    card.className = 'developer-telemetry-card';
    card.setAttribute('data-telemetry-card', String(id || 'card'));

    const title = document.createElement('h3');
    title.className = 'developer-telemetry-title';
    title.textContent = String(titleText || 'Telemetrie');

    const list = document.createElement('dl');
    list.className = 'developer-telemetry-list';

    card.append(title, list);
    container.appendChild(card);
    return list;
}

function renderBucketRows(list, entries = [], emptyLabel = 'Keine Daten') {
    if (!Array.isArray(entries) || entries.length === 0) {
        appendRow(list, 'empty', emptyLabel, '0');
        return;
    }

    entries.forEach((entry, index) => {
        const key = String(entry?.key || 'unknown');
        const rounds = Math.max(0, Number(entry?.rounds) || 0);
        const duration = formatDuration(entry?.averageRoundDuration);
        const parcoursRate = formatPercent(entry?.parcoursCompletionRate);
        const parcoursTime = formatDurationMs(entry?.averageParcoursCompletionTimeMs);
        const valueText = `${rounds} R | H ${formatPercent(entry?.humanWinRate)} | B ${formatPercent(entry?.botWinRate)} | ${duration} | P ${parcoursRate}/${parcoursTime}`;
        appendRow(list, `bucket-${index}`, key, valueText);
    });
}

function renderRecentRoundsCard(container, recentRounds = []) {
    const card = document.createElement('section');
    card.className = 'developer-telemetry-card developer-telemetry-card-wide';
    card.setAttribute('data-telemetry-card', 'recent');

    const title = document.createElement('h3');
    title.className = 'developer-telemetry-title';
    title.textContent = 'Letzte Runden';
    card.appendChild(title);

    const list = document.createElement('ol');
    list.className = 'developer-telemetry-recent-list';

    if (!Array.isArray(recentRounds) || recentRounds.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'developer-telemetry-recent-item developer-telemetry-recent-empty';
        empty.textContent = 'Noch keine Round-End-Telemetrie vorhanden.';
        list.appendChild(empty);
    } else {
        recentRounds.forEach((entry, index) => {
            const item = document.createElement('li');
            item.className = 'developer-telemetry-recent-item';
            item.setAttribute('data-telemetry-recent-index', String(index));
            item.textContent = [
                String(entry?.winnerLabel || 'Unbekannt'),
                `${String(entry?.mapKey || 'unknown')} / ${String(entry?.mode || 'classic')}`,
                formatDuration(entry?.duration),
                `Items ${Math.max(0, Number(entry?.itemUses) || 0)}`,
                `Self ${Math.max(0, Number(entry?.selfCollisions) || 0)}`,
                entry?.parcoursCompleted ? `Parcours ${formatDurationMs(entry?.parcoursCompletionTimeMs)}` : 'Parcours -',
            ].join(' | ');
            list.appendChild(item);
        });
    }

    card.appendChild(list);
    container.appendChild(card);
}

export function renderMenuTelemetryDashboard(container, telemetrySnapshot = null) {
    if (!container) return;
    clearContainer(container);

    const snapshot = telemetrySnapshot && typeof telemetrySnapshot === 'object'
        ? telemetrySnapshot
        : null;
    const balance = snapshot?.balance && typeof snapshot.balance === 'object'
        ? snapshot.balance
        : null;

    if (!snapshot) {
        container.textContent = 'Keine Telemetrie vorhanden.';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'developer-telemetry-grid';

    const overview = createCard(grid, 'overview', 'Uebersicht');
    appendRow(overview, 'rounds', 'Runden', String(Math.max(0, Number(balance?.rounds) || 0)));
    appendRow(overview, 'matches', 'Matches', String(Math.max(0, Number(balance?.matches) || 0)));
    appendRow(overview, 'quickstarts', 'Quickstarts', String(Math.max(0, Number(snapshot.quickStartCount) || 0)));
    appendRow(overview, 'start-attempts', 'Startversuche', String(Math.max(0, Number(snapshot.startAttempts) || 0)));

    const balanceCard = createCard(grid, 'balance', 'Balancing');
    appendRow(balanceCard, 'human-win-rate', 'Human-Winrate', formatPercent(balance?.humanWinRate));
    appendRow(balanceCard, 'bot-win-rate', 'Bot-Winrate', formatPercent(balance?.botWinRate));
    appendRow(balanceCard, 'average-round-duration', 'Avg. Rundendauer', formatDuration(balance?.averageRoundDuration));
    appendRow(balanceCard, 'self-collisions-per-round', 'Selfcrash/R', formatDecimal(balance?.selfCollisionsPerRound));
    appendRow(balanceCard, 'item-uses-per-round', 'Items/R', formatDecimal(balance?.itemUsesPerRound));
    appendRow(balanceCard, 'parcours-rate', 'Parcours-Rate', formatPercent(balance?.parcoursCompletionRate));
    appendRow(balanceCard, 'parcours-time', 'Parcours-Zeit', formatDurationMs(balance?.averageParcoursCompletionTimeMs));

    const mapsCard = createCard(grid, 'maps', 'Top Maps');
    renderBucketRows(mapsCard, snapshot.topMaps, 'Noch keine Maps');

    const modesCard = createCard(grid, 'modes', 'Top Modi');
    renderBucketRows(modesCard, snapshot.topModes, 'Noch keine Modi');

    container.appendChild(grid);
    renderRecentRoundsCard(container, snapshot.recentRounds);
}

export function renderTelemetryHistorySection(container, historySummary) {
    if (!container || !historySummary) return;
    const section = document.createElement('div');
    section.className = 'developer-telemetry-history';
    section.setAttribute('data-telemetry-section', 'history');

    const title = document.createElement('h3');
    title.className = 'developer-telemetry-title';
    title.textContent = 'Cross-Session History (IndexedDB)';
    section.appendChild(title);

    const list = document.createElement('dl');
    list.className = 'developer-telemetry-list';

    const rounds = Math.max(0, Number(historySummary.rounds) || 0);
    appendRow(list, 'history-rounds', 'Gesamt-Runden', String(rounds));
    appendRow(list, 'history-human-wr', 'Human-Winrate', formatPercent(historySummary.humanWinRate));
    appendRow(list, 'history-bot-wr', 'Bot-Winrate', formatPercent(historySummary.botWinRate));
    appendRow(list, 'history-avg-dur', 'Avg. Dauer', formatDuration(historySummary.averageDuration));
    appendRow(list, 'history-self-cr', 'Selfcrash/R', formatDecimal(historySummary.selfCollisionsPerRound));
    appendRow(list, 'history-items-r', 'Items/R', formatDecimal(historySummary.itemUsesPerRound));
    appendRow(list, 'history-parcours-rate', 'Parcours-Rate', formatPercent(historySummary.parcoursCompletionRate));
    appendRow(list, 'history-parcours-time', 'Parcours-Zeit', formatDurationMs(historySummary.averageParcoursCompletionTimeMs));

    if (Array.isArray(historySummary.topMaps) && historySummary.topMaps.length > 0) {
        const mapsStr = historySummary.topMaps.map((m) => `${m.key}(${m.count})`).join(', ');
        appendRow(list, 'history-top-maps', 'Top Maps', mapsStr);
    }
    if (Array.isArray(historySummary.topModes) && historySummary.topModes.length > 0) {
        const modesStr = historySummary.topModes.map((m) => `${m.key}(${m.count})`).join(', ');
        appendRow(list, 'history-top-modes', 'Top Modi', modesStr);
    }

    section.appendChild(list);
    container.appendChild(section);
}
