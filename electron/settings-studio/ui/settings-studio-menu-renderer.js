function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatValue(value) {
    return value == null
        ? '—'
        : (typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function writePath(target, path, value) {
    const segments = String(path || '').split('.');
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
        cursor = cursor[segment];
    }
    cursor[segments.at(-1)] = value;
}

export function applyMenuEditorItemValue({ draft, textOverrides, item, value }) {
    if (!item?.editable) return false;
    if (item.kind === 'text') {
        const normalized = String(value || '').trim();
        if (normalized) textOverrides[item.textId] = normalized;
        else delete textOverrides[item.textId];
        return true;
    }
    let normalized = value;
    if (item.fieldType === 'number') {
        normalized = Number(value);
        if (!Number.isFinite(normalized)) return false;
        if (Number.isFinite(item.limits?.min)) normalized = Math.max(item.limits.min, normalized);
        if (Number.isFinite(item.limits?.max)) normalized = Math.min(item.limits.max, normalized);
    } else if (item.fieldType === 'boolean') {
        if (typeof value !== 'boolean') return false;
    } else if (item.fieldType === 'enum') {
        normalized = item.options.find((option) => String(option) === String(value));
        if (normalized === undefined) return false;
    } else if (item.fieldType === 'string') {
        normalized = String(value ?? '');
    } else {
        return false;
    }
    writePath(draft, item.settingsPath, normalized);
    return true;
}

export function resetMenuEditorItems({ draft, textOverrides, items }) {
    for (const item of items || []) {
        if (item.kind === 'text') {
            delete textOverrides[item.textId];
        } else if (item.editable) {
            writePath(draft, item.settingsPath, JSON.parse(JSON.stringify(item.defaultValue)));
        }
    }
}

function renderSettingInput(item) {
    const path = esc(item.settingsPath);
    const value = item.effectiveValue;
    if (!item.editable) {
        return `<output class="menu-editor-readonly">${esc(formatValue(value))}</output>`;
    }
    if (item.fieldType === 'boolean') {
        return `<input type="checkbox" data-menu-setting-path="${path}" data-type="boolean" ${value ? 'checked' : ''}>`;
    }
    if (item.fieldType === 'enum' && item.options.length) {
        const options = item.options.map((option) => (
            `<option value="${esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${esc(option)}</option>`
        )).join('');
        return `<select data-menu-setting-path="${path}" data-type="string">${options}</select>`;
    }
    if (item.fieldType === 'number') {
        const limits = item.limits || {};
        const min = Number.isFinite(limits.min) ? ` min="${limits.min}"` : '';
        const max = Number.isFinite(limits.max) ? ` max="${limits.max}"` : '';
        const step = Number.isFinite(limits.step) ? ` step="${limits.step}"` : '';
        return `<input type="number" data-menu-setting-path="${path}" data-type="number" value="${esc(value)}"${min}${max}${step}>`;
    }
    return `<input type="text" data-menu-setting-path="${path}" data-type="string" value="${esc(value)}">`;
}

function renderProperties(item, language) {
    if (!item) {
        return '<p class="menu-editor-empty">Wähle links oder in der Vorschau einen Eintrag.</p>';
    }
    const help = item.help?.[language] || item.help?.de || '';
    if (item.kind === 'text') {
        return `
            <div class="menu-property-grid">
                <label>Standardbeschriftung<output>${esc(item.defaultLabel)}</output></label>
                <label>Override<input type="text" data-menu-text-id="${esc(item.textId)}" value="${esc(item.activeTextOverride)}" placeholder="${esc(item.defaultLabel)}"></label>
                <label>Effektive Beschriftung<output>${esc(item.effectiveLabel)}</output></label>
            </div>
            <dl class="menu-property-meta">
                <dt>Text-ID</dt><dd>${esc(item.textId)}</dd>
                <dt>Risikostufe</dt><dd>${esc(item.riskLevel)}</dd>
            </dl>
            <button class="btn btn--ghost" type="button" data-menu-action="reset-item" data-menu-item-id="${esc(item.id)}">Beschriftung zurücksetzen</button>`;
    }
    return `
        <div class="menu-property-grid">
            <label>Standardwert<output>${esc(formatValue(item.defaultValue))}</output></label>
            <label>Override${renderSettingInput(item)}</label>
            <label>Effektiver Wert<output>${esc(formatValue(item.effectiveValue))}</output></label>
        </div>
        <dl class="menu-property-meta">
            <dt>Settings-Pfad</dt><dd>${esc(item.settingsPath)}</dd>
            <dt>Feldtyp</dt><dd>${esc(item.fieldType)}</dd>
            <dt>Risikostufe</dt><dd>${esc(item.riskLevel)}</dd>
            ${item.limits ? `<dt>Limits</dt><dd>${esc(formatValue(item.limits))}</dd>` : ''}
        </dl>
        ${help ? `<p class="menu-property-help">${esc(help)}</p>` : ''}
        <button class="btn btn--ghost" type="button" data-menu-action="reset-item" data-menu-item-id="${esc(item.id)}">Wert zurücksetzen</button>`;
}

export function countMenuPanelDirty(model, panelId, draft, baseDraft, textOverrides, baseTextOverrides) {
    return model.items.filter((item) => {
        if (item.panelId !== panelId) return false;
        if (item.kind === 'text') {
            return String(textOverrides?.[item.textId] || '') !== String(baseTextOverrides?.[item.textId] || '');
        }
        const read = (source) => String(item.settingsPath || '').split('.')
            .reduce((value, segment) => value?.[segment], source);
        return JSON.stringify(read(draft)) !== JSON.stringify(read(baseDraft));
    }).length;
}

export function renderMenuEditor({
    model,
    draft,
    baseDraft,
    textOverrides,
    baseTextOverrides,
    activePanelId,
    selectedItemId,
    searchQuery = '',
    language = 'de',
}) {
    const normalizedQuery = String(searchQuery || '').trim().toLocaleLowerCase();
    const activePanel = model.panels.find((panel) => panel.id === activePanelId) || model.panels[0];
    const panelItems = model.items.filter((item) => item.panelId === activePanel?.id);
    const matches = (panel) => {
        if (!normalizedQuery) return true;
        if ([panel.id, panel.textId, panel.defaultLabel, panel.effectiveLabel]
            .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery))) return true;
        return model.items.some((item) => item.panelId === panel.id && [
            item.id,
            item.textId,
            item.settingsPath,
            item.defaultLabel,
            item.effectiveLabel,
        ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)));
    };
    const nav = model.panels.filter(matches).map((panel) => {
        const dirty = countMenuPanelDirty(
            model,
            panel.id,
            draft,
            baseDraft,
            textOverrides,
            baseTextOverrides
        );
        return `<button type="button" class="menu-tree-item ${panel.id === activePanel?.id ? 'active' : ''}" data-menu-panel-id="${esc(panel.id)}">
            <span>${esc(panel.effectiveLabel)}</span><small>${dirty}</small>
        </button>`;
    }).join('');
    const visiblePanelItems = normalizedQuery
        ? panelItems.filter((item) => [
            item.id,
            item.textId,
            item.settingsPath,
            item.defaultLabel,
            item.effectiveLabel,
        ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)))
        : panelItems;
    const previewItems = visiblePanelItems.map((item) => (
        `<button type="button" class="menu-preview-item ${item.id === selectedItemId ? 'active' : ''}" data-menu-item-id="${esc(item.id)}">
            <span>${esc(item.effectiveLabel)}</span>
            ${item.kind === 'setting' ? `<strong>${esc(formatValue(item.effectiveValue))}</strong>` : ''}
        </button>`
    )).join('');
    const selectedItem = model.items.find((item) => item.id === selectedItemId)
        || panelItems[0]
        || null;

    return `
        <div class="menu-editor-toolbar">
            <input type="search" data-menu-search value="${esc(searchQuery)}" placeholder="Menüpunkt, Text-ID, Settings-Pfad oder Beschriftung suchen">
            <button class="btn btn--ghost" type="button" data-menu-action="reset-panel">Panel zurücksetzen</button>
            <button class="btn btn--ghost" type="button" data-menu-action="reset-menu">Spielmenü zurücksetzen</button>
        </div>
        <div class="menu-editor-layout">
            <section class="menu-editor-navigation" aria-label="Menünavigation">${nav || '<p>Keine Treffer.</p>'}</section>
            <section class="menu-editor-preview" aria-label="Menüvorschau">
                <div class="menu-preview-shell">
                    <span class="menu-preview-kicker">Curvios Clash // Desktop</span>
                    <h3>${esc(activePanel?.effectiveLabel || 'Spielmenü')}</h3>
                    <div class="menu-preview-list">${previewItems || '<p>Keine Einträge.</p>'}</div>
                </div>
            </section>
            <section class="menu-editor-properties" aria-label="Eigenschaften-Editor">
                <h3>Eigenschaften</h3>
                ${renderProperties(selectedItem, language)}
            </section>
        </div>`;
}
