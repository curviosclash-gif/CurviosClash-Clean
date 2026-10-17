import { MAP_BALANCING_FIELDS } from '../../../src/shared/contracts/MapBalancingContract.js';
import { fieldPresentation } from './settings-studio-field-catalog.js';
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

function createElement(tagName, className = '', text = '') {
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
 * @param {{ api: any, onDirtyChange?: () => void, onSaved?: () => void, getLanguage?: () => string }} options
 */
export function createStudioBalancingSection({ api, onDirtyChange = () => {}, onSaved = () => {}, getLanguage = () => 'de' }) {
    const en = () => getLanguage() === 'en';
    const words = {
        'Klassisch': 'Classic', 'Kampf': 'Fight', 'Modus': 'Mode', 'Karte': 'Map', 'Etappe': 'Stage',
        'Kartenwerte': 'Map values', 'Bot-Anzahl': 'Bot count', 'Arcade-Etappe (noch ohne Wirkung)': 'Arcade stage (not active yet)',
        'Prüfen': 'Validate', 'Für Karte speichern': 'Save this map', 'Verwerfen': 'Discard',
        'Für normales Spiel übernehmen': 'Apply to regular games', 'Übernahme zurücknehmen': 'Retract approval',
        'ungespeichert': 'unsaved', '↺ geerbt': '↺ inherit', 'Wert': 'Setting', 'Einstellung': 'Value', 'Grenzen': 'Range', 'Herkunft': 'Source', 'geerbt': 'Inherited',
        'an': 'on', 'aus': 'off', ' nur Karten mit Abweichung': ' only maps with overrides',
        'Noch keine Kartendatei: alle Werte sind geerbt.': 'No map file yet: all values are inherited.',
        'Karte links auswählen. Jede Karte erbt die Grundwerte ihres Modus und hält nur Abweichungen fest.': 'Choose a map. Each map inherits its mode defaults and only stores overrides.',
        'Übernommen. Ab dem nächsten Spielstart gelten diese Kartenwerte in lokalen Spielen. Die Projektdatei ist für Commit und Push nach GitHub bereit.': 'Approved. These map values take effect in local games on the next game start. The release snapshot is also saved in the project.',
        'Übernahme zurückgenommen. Ab dem nächsten Spielstart gelten wieder die Spieleinstellungen.': 'Approval retracted. Game settings take effect again on the next game start.',
        'Neu laden': 'Reload',
    };
    const makeElement = createElement;
    const localize = (text) => en() ? words[text] || text : text;
    const el = (tag, className = '', text = '') => makeElement(tag, className, localize(text));

    /** @type {Map<string, { savedValues: Record<string, unknown>, draftValues: Record<string, unknown>, rawValues?: Record<string, string>, savedRevision?: string }>} */
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
        rawValues: {},
        description: null,
        message: '',
        errors: [],
        busy: false,
        loading: false,
        savedRevision: undefined,
    };
    let root = null;
    let selectionGeneration = 0;

    async function call(op, payload = {}) {
        let response;
        try { response = await api.mapBalancing(op, { ...payload, op }); }
        catch (error) { state.message = error.message; return null; }
        state.status = response?.status || state.status;
        if (!response || response.ok !== true) {
            state.message = response?.detail || response?.status?.message || `Fehler: ${response?.reason || 'unbekannt'}`;
            return null;
        }
        return response;
    }

    const isDirty = () => Object.keys(state.rawValues).length > 0 || !sameValues(state.savedValues, state.draftValues);

    async function describe() {
        if (!state.mapKey) return;
        const { mapKey, modePath, draftValues } = state;
        const response = await call('describe', {
            mapKey,
            modePath,
            layer: { values: draftValues },
        });
        if (response && state.mapKey === mapKey && state.modePath === modePath && state.draftValues === draftValues) {
            state.description = response.description;
        }
        render();
    }

    function rememberDraft() {
        if (!state.mapKey) return;
        if (isDirty()) drafts.set(state.mapKey, { savedValues: state.savedValues, draftValues: state.draftValues, rawValues: state.rawValues, savedRevision: state.savedRevision });
        else drafts.delete(state.mapKey);
    }

    async function selectMap(mapKey) {
        if (state.busy) return;
        const selection = ++selectionGeneration;
        rememberDraft();
        state.mapKey = mapKey;
        state.description = null;
        state.loading = true;
        state.errors = [];
        state.message = '';
        render();
        const kept = drafts.get(mapKey);
        if (kept) {
            // The open map's draft lives in state; the list only holds the other maps.
            drafts.delete(mapKey);
            state.savedValues = kept.savedValues;
            state.savedRevision = kept.savedRevision;
            state.draftValues = kept.draftValues;
            state.rawValues = kept.rawValues || {};
            await describe();
            if (selection === selectionGeneration) { state.loading = false; render(); }
            return;
        }
        const response = await call('describe', { mapKey, modePath: state.modePath });
        if (selection !== selectionGeneration) return;
        state.loading = false;
        if (!response) { render(); return; }
        state.description = response.description;
        state.savedRevision = response.description.revision;
        const fileValues = {};
        for (const row of response.description.fields) if (row.mapValue !== null) fileValues[row.key] = row.mapValue;
        state.savedValues = fileValues;
        state.draftValues = { ...fileValues };
        state.rawValues = {};
        render();
    }

    function setDraftValue(key, value, control) {
        if (state.busy) return;
        state.draftValues = { ...state.draftValues, [key]: value };
        delete state.rawValues[key];
        state.errors = [];
        const row = control?.closest?.('tr');
        const reset = row?.querySelector('.map-balancing__reset');
        if (reset) reset.disabled = false;
        const origin = row?.querySelector('.map-balancing__origin');
        if (origin) { origin.textContent = localize('Karte'); origin.className = 'map-balancing__origin origin-map'; }
        updateDraftControls();
    }

    function updateDraftControls() {
        onDirtyChange();
        renderMapList();
        if (!root) return;
        const dirtyLabel = root.querySelector('.map-balancing__dirty');
        if (dirtyLabel) dirtyLabel.textContent = isDirty() ? localize('ungespeichert') : '';
        const saveButton = root.querySelector('[data-map-action="save"]');
        const discardButton = root.querySelector('[data-map-action="discard"]');
        if (saveButton) saveButton.disabled = state.busy || !isDirty();
        if (discardButton) discardButton.disabled = state.busy || !isDirty();
        for (const button of root.querySelectorAll('[data-map-action="apply"],[data-map-action="retract"]')) button.disabled = state.busy || isDirty() || (button.dataset.mapAction === 'apply' ? state.description?.appliedState?.matches === true : state.description?.appliedState?.enabled !== true);
    }

    function resetDraftValue(key) {
        if (state.busy) return;
        const next = { ...state.draftValues };
        delete next[key];
        delete state.rawValues[key];
        state.draftValues = next;
        state.errors = [];
        void describe();
    }

    async function validate() {
        if (Object.keys(state.rawValues).length) {
            state.errors = [en() ? 'Enter a finite number in every marked field.' : 'In jedem markierten Feld eine gültige Zahl eingeben.'];
            state.message = en() ? 'Validation failed.' : 'Prüfung fehlgeschlagen.';
            render();
            return false;
        }
        const response = await call('validate', { mapKey: state.mapKey, layer: { values: state.draftValues } });
        if (response) {
            state.errors = response.validation.errors;
            state.message = response.validation.ok ? (en() ? 'Validation passed.' : 'Prüfung bestanden.') : (en() ? 'Validation failed.' : 'Prüfung fehlgeschlagen.');
        }
        render();
        return response?.validation?.ok === true;
    }

    async function save() {
        if (state.busy) return;
        state.busy = true;
        try {
        if (!(await validate())) return;
        const response = await call('save', { mapKey: state.mapKey, layer: { values: state.draftValues }, expectedRevision: state.savedRevision });
        if (response) {
            const { saved } = response;
            state.savedRevision = saved.revision;
            state.savedValues = { ...saved.layer.values };
            state.draftValues = { ...saved.layer.values };
            state.message = saved.removed
                ? (en() ? 'No overrides remain: map file removed.' : 'Keine Abweichung mehr: Kartendatei entfernt.')
                : `${en() ? 'Saved' : 'Gespeichert'}: ${saved.path}${saved.backupPath ? ` (Sicherung: ${saved.backupPath})` : ''}`;
            const list = await call('list-maps');
            if (list) state.maps = list.maps;
            onSaved();
        }
        await describe();
        } finally { state.busy = false; render(); }
    }

    async function applyToGame(op) {
        if (state.busy || isDirty() || state.description?.mapKey !== state.mapKey
            || state.description?.modePath !== state.modePath) return;
        state.busy = true;
        const expectedValues = Object.fromEntries(state.description.fields
            .filter((field) => field.group !== 'arcadeStage').map((field) => [field.key, field.value]));
        render();
        try {
            const response = await call(op, { mapKey: state.mapKey, modePath: state.modePath, expectedValues });
            if (response) state.message = op === 'apply'
                ? 'Übernommen. Ab dem nächsten Spielstart gelten diese Kartenwerte in lokalen Spielen. Die Projektdatei ist für Commit und Push nach GitHub bereit.'
                : 'Übernahme zurückgenommen. Ab dem nächsten Spielstart gelten wieder die Spieleinstellungen.';
            await describe();
        } catch (error) {
            state.message = `Übernahme fehlgeschlagen: ${error.message}`;
        } finally {
            state.busy = false;
            render();
        }
    }

    function renderToolbar() {
        const bar = el('div', 'map-balancing__bar');
        const search = el('input', 'map-balancing__search');
        search.type = 'search';
        search.placeholder = en() ? 'Search maps …' : 'Karte suchen …';
        search.ariaLabel = search.placeholder;
        search.value = state.filter;
        search.addEventListener('input', () => { state.filter = search.value; renderMapList(); });
        const mode = el('select', 'map-balancing__mode');
        mode.ariaLabel = en() ? 'Map mode' : 'Kartenmodus';
        mode.disabled = state.busy || state.loading;
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
        onlyChanged.append(checkbox, localize(' nur Karten mit Abweichung'));
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
                button.disabled = state.busy;
                button.append(el('span', '', entry.name), el('small', '', entry.mapKey));
                const unsaved = entry.mapKey === state.mapKey ? isDirty() : drafts.has(entry.mapKey);
                if (unsaved) button.append(el('span', 'map-balancing__dot is-unsaved', '✎'));
                else if (entry.hasMapFile) button.append(el('span', 'map-balancing__dot', '●'));
                button.title = unsaved ? (en() ? 'unsaved draft' : 'ungespeicherter Entwurf') : (entry.hasMapFile ? (en() ? 'has overrides' : 'hat Abweichungen') : (en() ? 'all values inherited' : 'alle Werte geerbt'));
                button.addEventListener('click', () => void selectMap(entry.mapKey));
                const item = el('li');
                item.append(button);
                return item;
            });
        list.replaceChildren(...items);
    }

    function renderControl(row) {
        const draftValue = Object.hasOwn(state.draftValues, row.key) ? state.draftValues[row.key] : row.value;
        const label = en() ? MAP_BALANCING_FIELDS.find((field) => field.key === row.key)?.label?.en || row.key : row.label;
        if (row.type === 'boolean') {
            const toggle = el('input');
            toggle.type = 'checkbox';
            toggle.ariaLabel = label;
            toggle.disabled = state.busy;
            toggle.checked = draftValue === true;
            toggle.addEventListener('change', () => setDraftValue(row.key, toggle.checked, toggle));
            return toggle;
        }
        const input = el('input', 'map-balancing__number');
        input.type = 'number';
        input.ariaLabel = label;
        input.disabled = state.busy;
        input.min = String(row.min);
        input.max = String(row.max);
        input.step = String(row.step);
        input.dataset.mapField = row.key;
        input.value = state.rawValues[row.key] ?? String(draftValue ?? '');
        input.setAttribute('aria-invalid', String(Object.hasOwn(state.rawValues, row.key)));
        input.addEventListener('input', () => {
            const parsed = Number(input.value);
            const valid = input.value.trim() !== '' && Number.isFinite(parsed);
            if (valid) setDraftValue(row.key, parsed, input);
            else { state.rawValues[row.key] = input.value; updateDraftControls(); }
            input.setAttribute('aria-invalid', String(!valid));
            const reset = input.closest?.('tr')?.querySelector('.map-balancing__reset');
            if (reset) reset.disabled = state.busy || (!Object.hasOwn(state.draftValues, row.key) && !Object.hasOwn(state.rawValues, row.key));
        });
        return input;
    }

    function renderRow(row) {
        const tr = el('tr', row.origin === 'map' ? 'is-map' : '');
        const label = el('td', 'map-balancing__label', en() ? MAP_BALANCING_FIELDS.find((field) => field.key === row.key)?.label?.en || fieldPresentation({ path: row.key }, 'en').label : row.label);
        label.title = en() ? fieldPresentation({ path: row.key }, 'en').help : row.help;
        const range = row.type === 'boolean' ? '' : `${row.min}–${row.max}`;
        const origin = el('span', `map-balancing__origin origin-${row.origin || 'none'}`, ORIGIN_LABELS[row.origin] || '–');
        const reset = el('button', 'btn btn--ghost map-balancing__reset', '↺ geerbt');
        reset.type = 'button';
        reset.disabled = state.busy || (!Object.hasOwn(state.draftValues, row.key) && !Object.hasOwn(state.rawValues, row.key));
        reset.title = `${en() ? 'Use inherited value' : 'Zurück auf den geerbten Wert'} ${formatValue(row, row.inherited)}`;
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
        const modeName = localize(MODES.find(([id]) => id === state.modePath)?.[1] || state.modePath);
        const applied = description.appliedState;
        detail.append(el('p', 'map-balancing__hint', applied?.enabled
            ? (en() ? `Approved for ${modeName}.${applied.matches ? '' : ' Current edits are not approved yet.'}` : `Für ${modeName} übernommen.${applied.matches ? '' : ' Die aktuellen Änderungen sind noch nicht übernommen.'}`)
            : (en() ? `Not yet approved for ${modeName}. Test first; approval takes effect on the next local game start.` : `Für ${modeName} noch nicht übernommen. Erst nach dem Test übernehmen; wirksam in lokalen Spielen ab dem nächsten Spielstart.`)));
        detail.append(el('p', 'map-balancing__hint', description.hasMapFile
            ? `${en() ? 'File' : 'Datei'}: ${description.path}`
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
        saveButton.dataset.mapAction = 'save'; discardButton.dataset.mapAction = 'discard';
        for (const button of [validateButton, saveButton, discardButton]) button.type = 'button';
        saveButton.disabled = state.busy || !isDirty();
        discardButton.disabled = state.busy || !isDirty();
        validateButton.disabled = state.busy;
        validateButton.addEventListener('click', () => void validate());
        saveButton.addEventListener('click', () => void save());
        discardButton.addEventListener('click', () => { state.draftValues = { ...state.savedValues }; state.rawValues = {}; state.errors = []; void describe(); });
        const reloadButton = el('button', 'btn btn--ghost', 'Neu laden');
        reloadButton.type = 'button';
        reloadButton.addEventListener('click', () => { if (!isDirty() || reloadButton.dataset.confirm === 'yes') { drafts.delete(state.mapKey); state.draftValues = { ...state.savedValues }; state.rawValues = {}; void selectMap(state.mapKey); } else { reloadButton.dataset.confirm = 'yes'; reloadButton.textContent = en() ? 'Discard draft and reload?' : 'Entwurf verwerfen und neu laden?'; } });
        actions.append(validateButton, saveButton, discardButton, reloadButton);
        const applyButton = el('button', 'btn btn--primary', 'Für normales Spiel übernehmen');
        const retractButton = el('button', 'btn btn--ghost', 'Übernahme zurücknehmen');
        applyButton.type = retractButton.type = 'button';
        applyButton.dataset.mapAction = 'apply'; retractButton.dataset.mapAction = 'retract';
        const ready = description.mapKey === state.mapKey && description.modePath === state.modePath;
        applyButton.disabled = state.busy || isDirty() || !ready || applied?.matches === true;
        retractButton.disabled = state.busy || isDirty() || !ready || applied?.enabled !== true;
        applyButton.addEventListener('click', () => void applyToGame('apply'));
        retractButton.addEventListener('click', () => void applyToGame('retract'));
        actions.append(applyButton, retractButton);
        actions.append(el('span', 'map-balancing__dirty', isDirty() ? 'ungespeichert' : ''));
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

    function getChanges() {
        const all = new Map(drafts);
        if (state.mapKey && isDirty()) all.set(state.mapKey, { savedValues: state.savedValues, draftValues: { ...state.draftValues, ...state.rawValues } });
        return [...all].flatMap(([mapKey, entry]) => [...new Set([...Object.keys(entry.savedValues), ...Object.keys(entry.draftValues)])].filter((key) => JSON.stringify(entry.savedValues[key]) !== JSON.stringify(entry.draftValues[key])).map((key) => ({
            id: `map:${mapKey}:${key}`, path: key, section: 'mapBalancing', mapKey,
            label: `${state.maps.find((map) => map.mapKey === mapKey)?.name || mapKey}: ${fieldPresentation({ path: key }, getLanguage()).label}`,
            base: entry.savedValues[key] ?? (en() ? 'inherited' : 'geerbt'), value: entry.draftValues[key] ?? (en() ? 'inherited' : 'geerbt'),
        })));
    }
    return {
        getChanges,
        getErrors: () => state.errors.map((message, index) => ({ id: `map-error:${index}`, path: state.mapKey, mapKey: state.mapKey, section: 'mapBalancing', label: state.mapKey, help: message })),
        getSearchItems: () => state.maps.map((map) => ({ id: `map:${map.mapKey}`, path: map.mapKey, mapKey: map.mapKey, section: 'mapBalancing', label: map.name, help: en() ? 'Map balancing' : 'Karten-Balancing' })),
        snapshotDrafts: () => JSON.parse(JSON.stringify({ entries: [...drafts], mapKey: state.mapKey, modePath: state.modePath, savedValues: state.savedValues, draftValues: state.draftValues, rawValues: state.rawValues, savedRevision: state.savedRevision })),
        async restoreDrafts(snapshot) { drafts.clear(); for (const [key, value] of snapshot.entries) drafts.set(key, value); Object.assign(state, { mapKey: snapshot.mapKey, modePath: snapshot.modePath, savedValues: snapshot.savedValues, draftValues: snapshot.draftValues, rawValues: snapshot.rawValues || {}, savedRevision: snapshot.savedRevision }); if (state.mapKey) await describe(); else render(); },
        discardAll() { drafts.clear(); state.draftValues = { ...state.savedValues }; state.rawValues = {}; state.errors = []; if (root) void describe(); onDirtyChange(); },
        async prepare() { if (!state.maps.length) { const response = await call('list-maps'); if (response) state.maps = response.maps; } },
        selectMap,
        isDirty: () => isDirty() || drafts.size > 0 || state.busy,
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
