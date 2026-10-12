// Settings Studio section "Karten-Balancing": map list, the balancing values of one map with
// their origin (Modus/Karte), reset to the inherited value, validation and saving to
// data/balancing/maps/<map>.json with a backup. Edits stay a draft until "Für Karte speichern".

const MODES = Object.freeze([
    ['normal', 'Klassisch'],
    ['fight', 'Kampf'],
    ['arcade', 'Arcade'],
]);

const ORIGIN_LABELS = Object.freeze({ mode: 'Modus', map: 'Karte', stage: 'Etappe' });
const GROUP_TITLES = Object.freeze({ map: 'Kartenwerte', bots: 'Bot-Anzahl', arcadeStage: 'Arcade-Etappe (noch ohne Wirkung)' });

function el(tagName, className = '', text = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
}

function formatValue(row, value) {
    if (value === null || value === undefined) return '–';
    if (row.type === 'boolean') return value ? 'an' : 'aus';
    return String(value);
}

function sameValues(a, b) {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

/**
 * Unsaved drafts are kept per map, so switching maps never needs a confirmation dialog.
 * @param {{ api: any, onDirtyChange?: () => void }} options
 */
export function createStudioBalancingSection({ api, onDirtyChange = () => {} }) {
    /** @type {Map<string, { savedValues: Record<string, unknown>, draftValues: Record<string, unknown> }>} */
    const drafts = new Map();
    const state = {
        status: null,
        maps: [],
        filter: '',
        onlyChanged: false,
        modePath: 'fight',
        mapKey: '',
        savedValues: {},
        draftValues: {},
        description: null,
        message: '',
        errors: [],
    };
    let root = null;

    async function call(op, payload = {}) {
        const response = await api.mapBalancing(op, { ...payload, op });
        state.status = response?.status || state.status;
        if (!response || response.ok !== true) {
            state.message = response?.detail || response?.status?.message || `Fehler: ${response?.reason || 'unbekannt'}`;
            return null;
        }
        return response;
    }

    const isDirty = () => !sameValues(state.savedValues, state.draftValues);

    async function describe() {
        if (!state.mapKey) return;
        const response = await call('describe', {
            mapKey: state.mapKey,
            modePath: state.modePath,
            layer: { values: state.draftValues },
        });
        if (response) state.description = response.description;
        render();
    }

    function rememberDraft() {
        if (!state.mapKey) return;
        if (isDirty()) drafts.set(state.mapKey, { savedValues: state.savedValues, draftValues: state.draftValues });
        else drafts.delete(state.mapKey);
    }

    async function selectMap(mapKey) {
        rememberDraft();
        state.mapKey = mapKey;
        state.errors = [];
        state.message = '';
        const kept = drafts.get(mapKey);
        if (kept) {
            // The open map's draft lives in state; the list only holds the other maps.
            drafts.delete(mapKey);
            state.savedValues = kept.savedValues;
            state.draftValues = kept.draftValues;
            await describe();
            return;
        }
        const response = await call('describe', { mapKey, modePath: state.modePath });
        if (!response) { render(); return; }
        state.description = response.description;
        const fileValues = {};
        for (const row of response.description.fields) if (row.mapValue !== null) fileValues[row.key] = row.mapValue;
        state.savedValues = fileValues;
        state.draftValues = { ...fileValues };
        render();
    }

    function setDraftValue(key, value) {
        state.draftValues = { ...state.draftValues, [key]: value };
        state.errors = [];
        void describe();
    }

    function resetDraftValue(key) {
        const next = { ...state.draftValues };
        delete next[key];
        state.draftValues = next;
        state.errors = [];
        void describe();
    }

    async function validate() {
        const response = await call('validate', { mapKey: state.mapKey, layer: { values: state.draftValues } });
        if (response) {
            state.errors = response.validation.errors;
            state.message = response.validation.ok ? 'Prüfung bestanden.' : 'Prüfung fehlgeschlagen.';
        }
        render();
        return response?.validation?.ok === true;
    }

    async function save() {
        if (!(await validate())) return;
        const response = await call('save', { mapKey: state.mapKey, layer: { values: state.draftValues } });
        if (response) {
            const { saved } = response;
            state.savedValues = { ...saved.layer.values };
            state.draftValues = { ...saved.layer.values };
            state.message = saved.removed
                ? 'Keine Abweichung mehr: Kartendatei entfernt.'
                : `Gespeichert: ${saved.path}${saved.backupPath ? ` (Sicherung: ${saved.backupPath})` : ''}`;
            const list = await call('list-maps');
            if (list) state.maps = list.maps;
        }
        await describe();
    }

    function renderToolbar() {
        const bar = el('div', 'map-balancing__bar');
        const search = el('input', 'map-balancing__search');
        search.type = 'search';
        search.placeholder = 'Karte suchen …';
        search.value = state.filter;
        search.addEventListener('input', () => { state.filter = search.value; renderMapList(); });
        const mode = el('select', 'map-balancing__mode');
        for (const [value, label] of MODES) {
            const option = el('option', '', label);
            option.value = value;
            option.selected = value === state.modePath;
            mode.append(option);
        }
        mode.addEventListener('change', () => { state.modePath = mode.value; void describe(); });
        const onlyChanged = el('label', 'map-balancing__only-changed');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.onlyChanged;
        checkbox.addEventListener('change', () => { state.onlyChanged = checkbox.checked; renderMapList(); });
        onlyChanged.append(checkbox, ' nur Karten mit Abweichung');
        bar.append(search, mode, onlyChanged);
        return bar;
    }

    function renderMapList() {
        const list = root?.querySelector('.map-balancing__maps');
        if (!list) return;
        const needle = state.filter.trim().toLowerCase();
        const items = state.maps
            .filter((entry) => !state.onlyChanged || entry.hasMapFile)
            .filter((entry) => !needle || `${entry.name} ${entry.mapKey}`.toLowerCase().includes(needle))
            .map((entry) => {
                const button = el('button', `map-balancing__map${entry.mapKey === state.mapKey ? ' is-active' : ''}`);
                button.type = 'button';
                button.append(el('span', '', entry.name), el('small', '', entry.mapKey));
                const unsaved = entry.mapKey === state.mapKey ? isDirty() : drafts.has(entry.mapKey);
                if (unsaved) button.append(el('span', 'map-balancing__dot is-unsaved', '✎'));
                else if (entry.hasMapFile) button.append(el('span', 'map-balancing__dot', '●'));
                button.title = unsaved ? 'ungespeicherter Entwurf' : (entry.hasMapFile ? 'hat Abweichungen' : 'alle Werte geerbt');
                button.addEventListener('click', () => void selectMap(entry.mapKey));
                const item = el('li');
                item.append(button);
                return item;
            });
        list.replaceChildren(...items);
    }

    function renderControl(row) {
        const draftValue = Object.hasOwn(state.draftValues, row.key) ? state.draftValues[row.key] : row.value;
        if (row.type === 'boolean') {
            const toggle = el('input');
            toggle.type = 'checkbox';
            toggle.checked = draftValue === true;
            toggle.addEventListener('change', () => setDraftValue(row.key, toggle.checked));
            return toggle;
        }
        const input = el('input', 'map-balancing__number');
        input.type = 'number';
        input.min = String(row.min);
        input.max = String(row.max);
        input.step = String(row.step);
        input.value = String(draftValue ?? '');
        input.addEventListener('change', () => {
            const parsed = Number(input.value);
            if (Number.isFinite(parsed)) setDraftValue(row.key, parsed);
        });
        return input;
    }

    function renderRow(row) {
        const tr = el('tr', row.origin === 'map' ? 'is-map' : '');
        const label = el('td', 'map-balancing__label', row.label);
        label.title = row.help;
        const range = row.type === 'boolean' ? '' : `${row.min}–${row.max}`;
        const origin = el('span', `map-balancing__origin origin-${row.origin || 'none'}`, ORIGIN_LABELS[row.origin] || '–');
        const reset = el('button', 'btn btn--ghost map-balancing__reset', '↺ geerbt');
        reset.type = 'button';
        reset.disabled = !Object.hasOwn(state.draftValues, row.key);
        reset.title = `Zurück auf den geerbten Wert ${formatValue(row, row.inherited)}`;
        reset.addEventListener('click', () => resetDraftValue(row.key));
        const cells = [label, el('td'), el('td', 'map-balancing__range', range), el('td'), el('td', 'map-balancing__inherited', formatValue(row, row.inherited)), el('td')];
        cells[1].append(renderControl(row));
        cells[3].append(origin);
        cells[5].append(reset);
        tr.append(...cells);
        return tr;
    }

    function renderDetail() {
        const detail = el('div', 'map-balancing__detail');
        const description = state.description;
        if (!state.mapKey || !description) {
            detail.append(el('p', 'map-balancing__hint', 'Karte links auswählen. Jede Karte erbt die Grundwerte ihres Modus und hält nur Abweichungen fest.'));
            return detail;
        }
        const mapEntry = state.maps.find((entry) => entry.mapKey === state.mapKey);
        detail.append(el('h3', 'map-balancing__title', `${mapEntry?.name || state.mapKey} (${state.mapKey})`));
        detail.append(el('p', 'map-balancing__hint', description.hasMapFile
            ? `Datei: ${description.path}`
            : 'Noch keine Kartendatei: alle Werte sind geerbt.'));
        const table = el('table', 'map-balancing__table');
        const head = el('tr');
        for (const title of ['Wert', 'Einstellung', 'Grenzen', 'Herkunft', 'geerbt', '']) head.append(el('th', '', title));
        table.append(head);
        for (const group of ['map', 'bots', 'arcadeStage']) {
            if (group === 'arcadeStage' && description.modePath !== 'arcade') continue;
            const groupRow = el('tr', 'map-balancing__group');
            const cell = el('th', '', GROUP_TITLES[group]);
            cell.colSpan = 6;
            groupRow.append(cell);
            table.append(groupRow);
            for (const row of description.fields.filter((entry) => entry.group === group)) table.append(renderRow(row));
        }
        detail.append(table);
        const actions = el('div', 'map-balancing__actions');
        const validateButton = el('button', 'btn', 'Prüfen');
        const saveButton = el('button', 'btn btn--primary', 'Für Karte speichern');
        const discardButton = el('button', 'btn btn--ghost', 'Verwerfen');
        for (const button of [validateButton, saveButton, discardButton]) button.type = 'button';
        saveButton.disabled = !isDirty();
        discardButton.disabled = !isDirty();
        validateButton.addEventListener('click', () => void validate());
        saveButton.addEventListener('click', () => void save());
        discardButton.addEventListener('click', () => { state.draftValues = { ...state.savedValues }; state.errors = []; void describe(); });
        actions.append(validateButton, saveButton, discardButton);
        if (isDirty()) actions.append(el('span', 'map-balancing__dirty', 'ungespeichert'));
        detail.append(actions);
        if (state.errors.length > 0) {
            const errors = el('ul', 'map-balancing__errors');
            for (const error of state.errors) errors.append(el('li', '', error));
            detail.append(errors);
        }
        return detail;
    }

    function render() {
        onDirtyChange();
        if (!root) return;
        if (state.status && state.status.writable !== true) {
            root.replaceChildren(el('p', 'map-balancing__hint', state.status.message || 'Kartenwerte sind hier nicht bearbeitbar.'));
            return;
        }
        const body = el('div', 'map-balancing__body');
        body.append(el('ul', 'map-balancing__maps'), renderDetail());
        root.replaceChildren(renderToolbar(), body, el('p', 'map-balancing__status', state.message));
        renderMapList();
    }

    return {
        isDirty: () => isDirty() || drafts.size > 0,
        /** Called whenever the section becomes visible; the first call loads the map list. */
        async mount(container) {
            root ||= el('div', 'map-balancing');
            container.replaceChildren(root);
            if (state.maps.length === 0) {
                const response = await call('list-maps');
                if (response) state.maps = response.maps;
            }
            render();
        },
    };
}
