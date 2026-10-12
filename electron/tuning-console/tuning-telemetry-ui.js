// "Telemetrie" in the F7 console: the round telemetry of the running game with filters,
// key figures, top maps and modes, the latest rounds, export as JSON or CSV and a two-step
// reset. It replaces the debug panel of the game menu; release builds carry neither.

import { armConfirmButton } from '../../src/ui/ConfirmButtonArming.js';

const CONTROL_LABELS = Object.freeze({
    human: 'nur echtes Spiel',
    all: 'alle Runden',
    idle: 'unbedientes Fenster',
    automation: 'Werkzeug/Automation',
    unknown: 'unbekannt',
});

const PERIODS = Object.freeze([[0, 'gesamt'], [1, '1 Tag'], [7, '7 Tage'], [30, '30 Tage']]);

function el(tagName, className = '', text = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
}

function formatNumber(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits).replace(/\.0+$/, '') : '–';
}

function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number * 100)} %` : '–';
}

function createSelect(options, value) {
    const select = el('select');
    for (const [optionValue, label] of options) {
        const option = el('option', '', label);
        option.value = String(optionValue);
        option.selected = String(optionValue) === String(value);
        select.append(option);
    }
    return select;
}

/**
 * @param {{ tuningApi: any, container: HTMLElement, setStatus: (message: string, tone?: string) => void }} options
 */
export function createTuningTelemetryUi({ tuningApi, container, setStatus }) {
    const state = { filters: { buildId: '', mapKey: '', mode: '', controlSource: 'human', sinceDays: 0 }, overview: null, busy: false };
    if (!container || typeof tuningApi?.telemetry !== 'function') return { refresh: async () => {} };

    const details = el('details', 'balancing-panel telemetry-panel');
    const summary = el('summary', 'balancing-summary', 'Telemetrie');
    const filterRow = el('div', 'telemetry-filters');
    const actions = el('div', 'balancing-actions');
    const refreshButton = el('button', '', 'Aktualisieren');
    const jsonButton = el('button', '', 'Export JSON');
    const csvButton = el('button', '', 'Export CSV');
    const resetButton = el('button', 'telemetry-reset', 'Daten löschen');
    for (const button of [refreshButton, jsonButton, csvButton, resetButton]) button.type = 'button';
    actions.append(refreshButton, jsonButton, csvButton, resetButton);
    const body = el('div', 'balancing-list telemetry-body');
    details.append(summary, filterRow, actions, body);
    container.replaceChildren(details);

    async function call(op, payload = {}) {
        if (state.busy) return null;
        state.busy = true;
        try {
            const result = await tuningApi.telemetry(op, { ...payload, filters: state.filters });
            if (!result || result.ok !== true) {
                if (result?.reason !== 'dialog_cancelled') {
                    setStatus(`Telemetrie ${op} fehlgeschlagen: ${result?.detail || result?.reason || 'unbekannt'}`, 'error');
                }
                return null;
            }
            return result.value;
        } finally {
            state.busy = false;
        }
    }

    async function refresh() {
        const value = await call('overview');
        if (value) {
            state.overview = value;
            render();
        }
    }

    function renderFilters() {
        const options = state.overview?.filterOptions || { buildIds: [], mapKeys: [], modes: [] };
        const all = [['', 'alle']];
        const selects = [
            ['buildId', createSelect([...all, ...options.buildIds.map((value) => [value, value])], state.filters.buildId)],
            ['mapKey', createSelect([...all, ...options.mapKeys.map((value) => [value, value])], state.filters.mapKey)],
            ['mode', createSelect([...all, ...options.modes.map((value) => [value, value])], state.filters.mode)],
            ['controlSource', createSelect(Object.entries(CONTROL_LABELS), state.filters.controlSource || 'all')],
            ['sinceDays', createSelect(PERIODS, state.filters.sinceDays)],
        ];
        const labels = { buildId: 'Build', mapKey: 'Karte', mode: 'Modus', controlSource: 'Steuerung', sinceDays: 'Zeitraum' };
        filterRow.replaceChildren(...selects.map(([key, select]) => {
            select.addEventListener('change', () => {
                state.filters = { ...state.filters, [key]: key === 'sinceDays' ? Number(select.value) : select.value };
                void refresh();
            });
            const label = el('label', 'telemetry-filter', labels[key]);
            label.append(select);
            return label;
        }));
    }

    function renderCards(summaryValues) {
        const cards = el('div', 'telemetry-cards');
        const figures = [
            ['Runden', formatNumber(summaryValues.rounds, 0)],
            ['Ø Dauer', `${formatNumber(summaryValues.averageDuration)} s`],
            ['Siegquote Mensch', formatPercent(summaryValues.humanWinRate)],
            ['Abschüsse/Runde', formatNumber(summaryValues.killsPerRound, 2)],
            ['Spawn-Tode/Runde', formatNumber(summaryValues.spawnDeathsPerRound, 2)],
            ['Eigenkollisionen/Runde', formatNumber(summaryValues.selfCollisionsPerRound, 2)],
            ['Gegenstände/Runde', formatNumber(summaryValues.itemUsesWithoutMgPerRound, 2)],
            ['Parcours geschafft', formatPercent(summaryValues.parcoursCompletionRate)],
            ['Bildzeit p95', `${formatNumber(summaryValues.averageFrameP95Ms)} ms`],
        ];
        for (const [label, value] of figures) {
            const card = el('div', 'telemetry-card');
            card.append(el('b', '', value), el('span', '', label));
            cards.append(card);
        }
        return cards;
    }

    function renderBars(title, entries) {
        const block = el('div', 'telemetry-bars');
        block.append(el('h3', 'balancing-group', title));
        const max = Math.max(1, ...entries.map((entry) => entry.count));
        for (const entry of entries) {
            const row = el('div', 'telemetry-bar');
            const fill = el('span', 'telemetry-bar__fill');
            fill.style.width = `${Math.round((entry.count / max) * 100)}%`;
            row.append(el('span', 'telemetry-bar__label', entry.key), fill, el('span', 'telemetry-bar__count', String(entry.count)));
            block.append(row);
        }
        if (entries.length === 0) block.append(el('p', 'muted', 'keine Daten'));
        return block;
    }

    function renderRecent(rounds) {
        const block = el('div', 'telemetry-recent');
        block.append(el('h3', 'balancing-group', 'Letzte Runden'));
        for (const round of rounds) {
            const time = round.at ? new Date(round.at).toLocaleString('de-DE') : '–';
            block.append(el('div', 'telemetry-round',
                `${time} · ${round.mapKey || '–'} · ${round.mode || '–'} · ${formatNumber(round.duration)} s · Sieger ${round.winnerType || '–'} · ${CONTROL_LABELS[round.controlSource] || round.controlSource}`));
        }
        if (rounds.length === 0) block.append(el('p', 'muted', 'keine Runden für diese Filter'));
        return block;
    }

    function render() {
        const overview = state.overview;
        renderFilters();
        if (!overview) return;
        const summaryValues = overview.summary || {};
        summary.textContent = `Telemetrie · ${summaryValues.rounds || 0} von ${overview.totalRounds} Runden`;
        body.replaceChildren(
            renderCards(summaryValues),
            renderBars('Karten', summaryValues.topMaps || []),
            renderBars('Modi', summaryValues.topModes || []),
            renderBars('Builds', summaryValues.topBuilds || []),
            renderRecent(overview.recentRounds || []),
        );
    }

    async function exportAs(format) {
        const value = await call('export', { format });
        if (value) setStatus(`${value.rounds} Runden exportiert: ${value.filePath}`, 'success');
    }

    refreshButton.addEventListener('click', () => void refresh());
    jsonButton.addEventListener('click', () => void exportAs('json'));
    csvButton.addEventListener('click', () => void exportAs('csv'));
    // Deleting asks with a second click on the same button, never with a Windows dialog.
    armConfirmButton(resetButton, {
        label: 'Daten löschen',
        confirmLabel: 'Wirklich alle Telemetriedaten löschen?',
        onConfirm: async () => {
            const value = await call('clear');
            if (value) {
                setStatus('Telemetriedaten gelöscht.', 'success');
                await refresh();
            }
        },
    });
    details.addEventListener('toggle', () => { if (details.open) void refresh(); });
    renderFilters();

    return { refresh };
}
