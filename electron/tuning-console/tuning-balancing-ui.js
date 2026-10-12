// "Karten-Balancing" in the F7 console: the balancing values of the map being played, with
// their origin, live changes in the running match and "Für diese Karte übernehmen", which
// writes data/balancing/maps/<map>.json (only from an unpacked repository).

const ORIGIN_LABELS = Object.freeze({
    mode: 'Modus',
    map: 'Karte',
    stage: 'Etappe',
});

const MODE_LABELS = Object.freeze({
    normal: 'Klassisch',
    fight: 'Kampf',
    arcade: 'Arcade',
});

function el(tagName, className = '', text = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function formatValue(row, value) {
    if (row.type === 'boolean') return value === true ? 'an' : 'aus';
    return value === null || value === undefined ? '–' : String(value);
}

/**
 * @param {{ tuningApi: any, container: HTMLElement, setStatus: (message: string, tone?: string) => void }} options
 */
export function createTuningBalancingUi({ tuningApi, container, setStatus }) {
    const state = { description: null, busy: false };
    if (!container || typeof tuningApi?.balancing !== 'function') {
        return { refresh: async () => {} };
    }

    const details = el('details', 'balancing-panel');
    const summary = el('summary', 'balancing-summary', 'Karten-Balancing');
    const meta = el('p', 'balancing-meta muted', 'Lade …');
    const actions = el('div', 'balancing-actions');
    const saveButton = el('button', 'balancing-save', 'Für diese Karte übernehmen');
    const discardButton = el('button', '', 'Verwerfen');
    const refreshButton = el('button', '', 'Aktualisieren');
    const authoritativeLabel = el('label', 'toggle-wrap');
    const authoritativeToggle = el('input');
    authoritativeToggle.type = 'checkbox';
    authoritativeLabel.append(authoritativeToggle, el('span', '', 'Kartenwerte im Match'));
    for (const button of [saveButton, discardButton, refreshButton]) button.type = 'button';
    actions.append(saveButton, discardButton, refreshButton, authoritativeLabel);
    const list = el('div', 'balancing-list');
    details.append(summary, meta, actions, list);
    container.replaceChildren(details);

    async function call(op, payload = {}) {
        if (state.busy) return null;
        state.busy = true;
        try {
            const result = await tuningApi.balancing(op, payload);
            if (!result || result.ok !== true) {
                setStatus(`Balancing ${op} fehlgeschlagen: ${result?.detail || result?.reason || 'unbekannt'}`, 'error');
                return null;
            }
            state.description = result.value;
            render();
            return result.value;
        } finally {
            state.busy = false;
        }
    }

    function renderMeta(description) {
        const changed = description.fields.filter((row) => row.mapValue !== null).length;
        summary.textContent = `Karten-Balancing · ${description.mapKey || '–'}${description.dirty ? ' · ungespeichert' : ''}`;
        const parts = [
            `Karte ${description.mapKey || '–'}`,
            `Modus ${MODE_LABELS[description.modePath] || description.modePath}`,
            `${changed} auf dieser Karte geändert`,
            description.inMatch ? 'Match läuft' : 'kein Match – Änderungen wirken ab dem nächsten Start',
        ];
        if (!description.authoritative) parts.push('Schalter aus: ohne Live-Änderung gelten die Spieler-Einstellungen');
        if (description.store && !description.store.writable) parts.push(description.store.message || 'Speichern nicht möglich');
        meta.textContent = parts.join(' · ');
        authoritativeToggle.checked = description.authoritative === true;
        saveButton.disabled = description.store?.writable !== true || !description.dirty;
        discardButton.disabled = !description.dirty;
    }

    function createControl(row) {
        if (row.type === 'boolean') {
            const toggle = el('input');
            toggle.type = 'checkbox';
            toggle.checked = row.value === true;
            toggle.addEventListener('change', () => void call('set-value', { key: row.key, value: toggle.checked }));
            return toggle;
        }
        const slider = el('input');
        slider.type = 'range';
        const number = el('input');
        number.type = 'number';
        for (const input of [slider, number]) {
            input.min = String(row.min);
            input.max = String(row.max);
            input.step = String(row.step);
            input.value = String(row.value ?? row.min);
        }
        // Moving the slider only previews the number; the match changes on release.
        slider.addEventListener('input', () => { number.value = slider.value; });
        const commit = (raw) => {
            const parsed = Number(raw);
            if (!Number.isFinite(parsed)) return;
            const value = row.integer ? Math.trunc(parsed) : parsed;
            void call('set-value', { key: row.key, value: Math.min(row.max, Math.max(row.min, value)) });
        };
        slider.addEventListener('change', () => commit(slider.value));
        number.addEventListener('change', () => commit(number.value));
        const wrap = el('div', 'param-controls');
        wrap.append(slider, number);
        return wrap;
    }

    function renderRow(row) {
        const item = el('div', `param-row balancing-row${row.origin === 'map' ? ' changed' : ''}`);
        item.title = row.help;
        const head = el('div', 'param-head');
        head.append(el('span', 'param-label', row.label));
        const origin = el('span', `badge balancing-origin origin-${row.origin || 'none'}`, ORIGIN_LABELS[row.origin] || '–');
        origin.title = row.origin === 'map'
            ? `Auf dieser Karte geändert; geerbt wäre ${formatValue(row, row.inherited)}`
            : 'Geerbt';
        head.append(origin);
        if (row.mapValue !== null) {
            const reset = el('button', 'param-reset', '↺ geerbt');
            reset.type = 'button';
            reset.title = `Zurück auf ${formatValue(row, row.inherited)}`;
            reset.addEventListener('click', () => void call('reset-value', { key: row.key }));
            head.append(reset);
        }
        item.append(head, createControl(row));
        return item;
    }

    function render() {
        const description = state.description;
        if (!description) return;
        renderMeta(description);
        const groups = [
            ['map', 'Karte'],
            ['bots', 'Bots'],
            ...(description.modePath === 'arcade' ? [['arcadeStage', 'Arcade-Etappe (noch ohne Wirkung)']] : []),
        ];
        const nodes = [];
        for (const [group, title] of groups) {
            nodes.push(el('h3', 'balancing-group', title));
            for (const row of description.fields.filter((entry) => entry.group === group)) nodes.push(renderRow(row));
        }
        list.replaceChildren(...nodes);
    }

    saveButton.addEventListener('click', async () => {
        const value = await call('save');
        if (value) setStatus(value.removed ? 'Kartendatei entfernt (keine Abweichung mehr).' : `Gespeichert: ${value.savedPath}`, 'success');
    });
    discardButton.addEventListener('click', () => void call('discard'));
    refreshButton.addEventListener('click', () => void call('describe'));
    authoritativeToggle.addEventListener('change', () => void call('set-authoritative', { enabled: authoritativeToggle.checked }));
    details.addEventListener('toggle', () => { if (details.open) void call('describe'); });

    return { refresh: () => call('describe') };
}
