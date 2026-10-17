import { fieldPresentation } from './settings-studio-field-catalog.js';
import { PLATFORM_CAPABILITY_REGISTRY, PLATFORM_PRODUCT_SURFACE_IDS } from '../../../src/shared/contracts/PlatformCapabilityRegistry.js';
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export function createStudioWorkspace({ state, refs, maps, t, navigate, render, dirtyFields }) {
    const undo = [], redo = [];
    let query = '', filter = 'all', lastKey = '', lastTime = 0;
    const searchInput = /** @type {HTMLInputElement} */ (document.querySelector('[data-global-search]'));
    const viewFilter = /** @type {HTMLSelectElement} */ (document.querySelector('[data-global-filter]'));
    state.rawInputs = {};
    const rawErrors = () => Object.entries(state.rawInputs).map(([path, entry]) => ({ path, code: 'FIELD_NUMBER_INVALID', message: entry.message }));
    const snapshot = () => clone({ draft: state.draft, policy: state.browserDemoPolicyDraft, texts: state.menuTextOverrides, raw: state.rawInputs, ranges: state.menuRangeInputs, rangeErrors: state.menuRangeErrors, maps: maps.snapshotDrafts() });
    function remember(key, coalesce = false) {
        if (!state.draft) return;
        const now = Date.now();
        if (!coalesce || key !== lastKey || now - lastTime > 800) { undo.push(snapshot()); if (undo.length > 100) undo.shift(); }
        lastKey = key; lastTime = now; redo.length = 0;
        refresh();
    }
    function clearHistory() { undo.length = 0; redo.length = 0; lastKey = ''; refresh(); }
    async function restore(from, to) {
        if (!from.length) return;
        to.push(snapshot()); const entry = from.pop();
        state.draft = entry.draft; state.browserDemoPolicyDraft = entry.policy; state.menuTextOverrides = entry.texts; state.rawInputs = entry.raw;
        state.menuRangeInputs = entry.ranges || {}; state.menuRangeErrors = entry.rangeErrors || {}; state.validation = null;
        await maps.restoreDrafts(entry.maps);
        render(); refresh();
    }
    function items() {
        const entries = (state.schema?.fields || []).filter((field) => field.path !== 'fixedPresets').map((field) => ({
            ...field, ...fieldPresentation(field, state.language), id: field.path, value: read(state.draft, field.path), base: read(state.baseDraft, field.path),
        }));
        for (const [index, preset] of (state.draft?.fixedPresets || []).entries()) {
            for (const [key, value] of Object.entries(preset.values || {})) {
                const descriptor = state.schema.fields.find((field) => field.path === (key.startsWith('localSettings.') ? key : `baseSettings.${key}`));
                entries.push({ id: `fixedPresets.${index}.values.${key}`, path: `fixedPresets.${index}.values.${key}`, section: 'fixedPresets', label: `${preset.name}: ${fieldPresentation(descriptor || { path: key }, state.language).label}`, help: key, value, base: state.baseDraft.fixedPresets[index]?.values?.[key] });
            }
        }
        for (const [id, text] of Object.entries(state.menuTextOverrides || {})) {
            if (entries.some((entry) => entry.id === `text:${id}`)) continue;
            entries.push({ id: `text:${id}`, path: id, section: 'gameMenu', label: text, help: id, value: text, base: state.menuTextOverridesBase[id] });
        }
        for (const item of state.menuEditorModel?.items || []) {
            if (item.kind !== 'text' || entries.some((entry) => entry.id === item.id)) continue;
            entries.push({ id: item.id, path: item.textId, section: 'gameMenu', label: state.menuTextOverrides[item.textId] || item.defaultLabel, help: item.textId, value: state.menuTextOverrides[item.textId], base: state.menuTextOverridesBase[item.textId] });
        }
        entries.push(...maps.getSearchItems());
        const product = PLATFORM_CAPABILITY_REGISTRY.products[PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO];
        for (const [key, value] of Object.entries(product.surfacePolicy)) {
            entries.push({ id: `browserDemoPolicy.policy.${key}`, path: `browserDemoPolicy.policy.${key}`, section: 'browserDemoPolicy', label: `${state.language === 'en' ? 'Browser demo policy' : 'Browser-Demo-Regeln'}: ${key}`, help: JSON.stringify(value), value: state.browserDemoPolicyDraft?.policy?.[key] ?? value, base: state.browserDemoPolicyBaseDraft?.policy?.[key] ?? value });
        }
        for (const key of Object.keys(product.capabilities)) entries.push({ id: `browserDemoPolicy.capabilityFlags.${key}.enabled`, path: `browserDemoPolicy.capabilityFlags.${key}.enabled`, section: 'browserDemoPolicy', label: `${state.language === 'en' ? 'Browser demo feature' : 'Browser-Demo-Funktion'}: ${key}`, help: key });
        return entries;
    }
    function changed() {
        const values = dirtyFields().filter((entry) => entry.field.path !== 'fixedPresets').map((entry) => ({ ...entry.field, id: entry.field.path, value: entry.current, base: entry.base, label: entry.field.previewLabel || fieldPresentation(entry.field, state.language).label }));
        for (const [index, preset] of (state.draft?.fixedPresets || []).entries()) {
            const base = state.baseDraft.fixedPresets[index];
            for (const key of ['id', 'name', 'description', 'lockedFields']) {
                if (!equal(base?.[key], preset[key])) values.push({ id: `fixedPresets.${index}.${key}`, path: `fixedPresets.${index}.${key}`, section: 'fixedPresets', label: `${preset.name}: ${key}`, value: preset[key], base: base?.[key] });
            }
        }
        values.push(...items().filter((entry) => entry.section === 'fixedPresets' && !equal(entry.base, entry.value)));
        for (const error of rawErrors()) if (!values.some((entry) => entry.path === error.path)) values.push({ ...error, id: error.path, section: error.path.split('.')[0], label: error.path, value: state.rawInputs[error.path].raw, base: read(state.baseDraft, error.path) });
        values.push(...maps.getChanges());
        return values;
    }
    function showRaw(input) {
        const path = input.dataset.path;
        const entry = state.rawInputs[path];
        input.setAttribute('aria-invalid', String(!!entry || (state.validation?.errors || []).some((error) => error.path === path)));
        const row = input.closest('.field-row,.preset-field-row');
        if (!row) return;
        row.classList.toggle('has-error', !!entry);
        let message = row.querySelector('[data-raw-error]');
        if (entry && !message) { message = document.createElement('p'); message.dataset.rawError = ''; message.className = 'field-error'; row.append(message); }
        if (entry) message.textContent = entry.message; else message?.remove();
    }
    function decorate() {
        for (const input of refs.formContent.querySelectorAll('input[data-path],textarea[data-path],select[data-path]')) {
            const raw = state.rawInputs[input.dataset.path];
            if (raw) { input.value = raw.raw; showRaw(input); }
        }
    }
    async function jump(item) {
        query = ''; filter = 'all'; searchInput.value = ''; viewFilter.value = 'all';
        navigate(item.section);
        if (item.mapKey) { await maps.selectMap(item.mapKey); return; }
        if (item.section === 'limits') {
            const path = item.path.replace(/\.(min|max|step)$/, '');
            const key = item.path.slice(path.length + 1);
            navigate('limits');
            const input = [...refs.formContent.querySelectorAll('[data-limit-path]')].find((element) => element.dataset.limitPath === path && (!key || element.dataset.limitKey === key)); input?.scrollIntoView({ block: 'center' }); input?.focus(); return;
        }
        if (item.section === 'browserDemoPolicy') {
            const key = item.path.replace(/^browserDemoPolicy\.(policy|capabilityFlags)\./, '').split('.')[0];
            const input = [...refs.formContent.querySelectorAll('[data-browser-demo-group],[data-browser-demo-capability]')].find((element) => element.dataset.browserDemoGroup === key || element.dataset.browserDemoCapability === key);
            input?.scrollIntoView({ block: 'center' }); input?.focus(); return;
        }
        if (item.menuSettingPath) {
            const menu = state.menuEditorModel?.items.find((entry) => entry.settingsPath === item.menuSettingPath);
            if (menu) {
                state.activeMenuPanelId = menu.panelId; state.selectedMenuItemId = menu.id; state.menuPreviewRoot = false; render();
                const input = [...refs.formContent.querySelectorAll('[data-menu-range-path]')].find((element) => element.dataset.menuRangePath === item.menuSettingPath && element.dataset.menuRangeComponent === item.component);
                input?.focus();
            }
            return;
        }
        if (item.section === 'gameMenu' && !item.id.startsWith('text:')) item.id = `text:${item.id}`;
        if (item.id.startsWith('text:')) {
            const menu = state.menuEditorModel?.items.find((entry) => entry.id === item.id);
            if (menu) { state.activeMenuPanelId = menu.panelId; state.selectedMenuItemId = menu.id; state.menuPreviewRoot = false; render(); }
            return;
        }
        const input = [...refs.formContent.querySelectorAll('input[data-path],textarea[data-path],select[data-path]')].find((entry) => entry.dataset.path === item.path || (/^fixedPresets\.\d+$/.test(item.path) && entry.dataset.path === `${item.path}.id`) || (item.path.endsWith('.lockedFields') && entry.dataset.path.startsWith(item.path)));
        input?.scrollIntoView({ block: 'center' }); input?.focus();
    }
    function renderResults() {
        if (!query && filter === 'all') return;
        const needle = query.toLocaleLowerCase();
        let results = filter === 'changed' ? changed() : items();
        if (filter === 'errors') results = [...(state.validation?.errors || []), ...rawErrors(), ...(state.browserDemoPolicyValidation?.errors || [])].map((error) => {
            const known = results.find((entry) => entry.path === error.path);
            const browser = /^(policy|capabilityFlags)\./.test(error.path);
            return { ...known, id: error.path, path: browser ? `browserDemoPolicy.${error.path}` : error.path, section: browser ? 'browserDemoPolicy' : error.code?.startsWith('LIMIT_') ? 'limits' : known?.section || error.path.split('.')[0], label: known?.label || error.path, help: error.message };
        });
        if (filter === 'errors') {
            for (const [identity, errors] of Object.entries(state.menuRangeErrors || {})) {
                const [path, component] = identity.split(':');
                results.push({ id: identity, path, menuSettingPath: path, component, section: 'gameMenu', label: fieldPresentation({ path }, state.language).label, help: errors.map((error) => error.message).join(' ') });
            }
            results.push(...maps.getErrors());
        }
        results = results.filter((entry) => `${entry.label} ${entry.english || ''} ${entry.path} ${entry.help || ''}`.toLocaleLowerCase().includes(needle));
        refs.sectionTitle.textContent = `${t('searchResults')} (${results.length})`;
        refs.sectionHint.textContent = state.language === 'en' ? 'Choose a result to open its setting. Product defaults and saved values remain distinct.' : 'Treffer auswählen, um die Einstellung zu öffnen. Produktstandard und gespeicherter Stand bleiben getrennt.';
        refs.sectionHint.hidden = false;
        refs.formContent.innerHTML = results.map((entry, index) => `<button class="search-result" type="button" data-search-result="${index}"><strong>${esc(entry.label)}</strong><span>${esc(entry.help || entry.path)}</span><small>${esc(document.querySelector(`[data-nav-section="${entry.section}"] .nav-caption`)?.textContent || entry.section)} · ${esc(entry.path)} · ${esc(entry.base === undefined ? '' : JSON.stringify(entry.base))}${!equal(entry.base, entry.value) ? ` → ${esc(JSON.stringify(entry.value))}` : ''}</small></button>`).join('') || `<p class="empty-state">${t('noResults')}</p>`;
        refs.formContent.querySelectorAll('[data-search-result]').forEach((button) => button.addEventListener('click', () => { void jump(results[Number(button.dataset.searchResult)]); }));
    }
    function refresh() {
        const search = searchInput;
        search.placeholder = t('globalSearch'); search.setAttribute('aria-label', t('searchLabel'));
        for (const [value, key] of [['all','filterAll'],['changed','filterChanged'],['errors','filterErrors']]) document.querySelector(`[data-global-filter] option[value="${value}"]`).textContent = t(key);
        for (const [action, key] of [['undo','undo'],['redo','redo'],['review-changes','reviewChanges'],['reload','compareReload']]) document.querySelector(`[data-action="${action}"]`).textContent = t(key);
        (/** @type {HTMLButtonElement} */ (document.querySelector('[data-action="undo"]'))).disabled = !undo.length;
        (/** @type {HTMLButtonElement} */ (document.querySelector('[data-action="redo"]'))).disabled = !redo.length;
        document.querySelector('[data-bind="scope"]').textContent = `${t('scope')}: ${refs.sectionTitle.textContent}`;
    }
    function attach() {
        document.addEventListener('change', (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
            if (input.matches?.('[data-browser-demo-group],[data-browser-demo-capability]')) remember(input.dataset.browserDemoGroup || input.dataset.browserDemoCapability);
        }, true);
        document.addEventListener('input', (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
            if (input.matches?.('[data-path],[data-limit-path],[data-menu-range-path],[data-menu-setting-path],[data-menu-text-id],.map-balancing__number,.map-balancing__table input')) {
                remember(input.dataset.presetLockKey || input.dataset.mapField || input.dataset.path || (input.dataset.limitPath ? `${input.dataset.limitPath}:${input.dataset.limitKey}` : '') || input.dataset.menuRangePath || input.dataset.menuSettingPath || input.dataset.menuTextId || 'map-value', input.type !== 'checkbox');
            }
            if (input.dataset?.path) state.validation = null;
            if (!input.dataset?.path || !input.matches('input,textarea,select')) return;
            const type = input.dataset.type;
            let valid = true;
            if (type === 'json') { try { JSON.parse(input.value); } catch { valid = false; } }
            if (type === 'number') valid = input.value.trim() !== '' && Number.isFinite(Number(input.value));
            if (valid) delete state.rawInputs[input.dataset.path];
            else state.rawInputs[input.dataset.path] = { raw: input.value, message: t('rawInvalid') };
            showRaw(input);
        }, true);
        document.addEventListener('click', (event) => {
            if (!(event.target instanceof Element)) return;
            const action = event.target.closest('[data-action],[data-menu-action],.map-balancing__reset');
            if (!(action instanceof HTMLElement)) return;
            if (action && (/reset|duplicate-preset/.test(action.dataset.action || action.dataset.menuAction || '') || action.matches('.map-balancing__reset'))) remember('action');
        }, true);
        searchInput.addEventListener('input', (event) => { query = searchInput.value.trim(); render(); renderResults(); });
        viewFilter.addEventListener('change', (event) => { filter = viewFilter.value; render(); renderResults(); });
        document.querySelector('[data-action="review-changes"]').addEventListener('click', () => { query = ''; filter = 'changed'; searchInput.value = ''; viewFilter.value = filter; renderResults(); });
        document.querySelector('[data-action="undo"]').addEventListener('click', () => { void restore(undo, redo); });
        document.querySelector('[data-action="redo"]').addEventListener('click', () => { void restore(redo, undo); });
        document.addEventListener('keydown', (event) => {
            if (state.saving) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); }
            if ((event.ctrlKey || event.metaKey) && ['z','y'].includes(event.key.toLowerCase()) && refs.savePreviewModal.hidden) {
                event.preventDefault(); void restore(event.key.toLowerCase() === 'y' || event.shiftKey ? redo : undo, event.key.toLowerCase() === 'y' || event.shiftKey ? undo : redo);
            }
        });
    }
    return { attach, refresh, decorate, renderResults, changed, rawErrors, clearHistory,
        navigating() { query = ''; filter = 'all'; searchInput.value = ''; viewFilter.value = 'all'; },
        discardRaw() { state.rawInputs = {}; },
        invalid() { if (!rawErrors().length) return false; const path = rawErrors()[0].path; void jump({ path, id: path, section: path.split('.')[0] }); return true; },
    };
}
