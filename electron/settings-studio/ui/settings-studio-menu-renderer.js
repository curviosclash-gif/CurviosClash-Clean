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

function normalizeSearchQuery(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function searchableValues(entry) {
    return [
        entry?.id,
        entry?.textId,
        entry?.settingsPath,
        entry?.defaultLabel,
        entry?.effectiveLabel,
    ];
}

function matchesSearch(entry, normalizedQuery) {
    return !normalizedQuery || searchableValues(entry).some((value) => (
        String(value || '').toLocaleLowerCase().includes(normalizedQuery)
    ));
}

function highlight(value, normalizedQuery) {
    const source = String(value || '');
    if (!normalizedQuery) return esc(source);
    const index = source.toLocaleLowerCase().indexOf(normalizedQuery);
    if (index < 0) return esc(source);
    return `${esc(source.slice(0, index))}<mark>${esc(source.slice(index, index + normalizedQuery.length))}</mark>${esc(source.slice(index + normalizedQuery.length))}`;
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
        const rawValue = String(value || '');
        if (rawValue.trim()) textOverrides[item.textId] = rawValue;
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

export function isMenuEditorItemDirty(item, draft, baseDraft, textOverrides, baseTextOverrides) {
    if (!item) return false;
    if (item.kind === 'text') {
        return String(textOverrides?.[item.textId] || '') !== String(baseTextOverrides?.[item.textId] || '');
    }
    const read = (source) => String(item.settingsPath || '').split('.')
        .reduce((value, segment) => value?.[segment], source);
    return JSON.stringify(read(draft)) !== JSON.stringify(read(baseDraft));
}

export function isMenuEditorItemResettable(item) {
    return item?.kind === 'text'
        ? Boolean(item.activeTextOverride)
        : item?.currentOverride !== null;
}

export function countMenuResettableItems(model, panelId = null) {
    return model.items.filter((item) => (!panelId || item.panelId === panelId)
        && isMenuEditorItemResettable(item)).length;
}

function renderProperties(item, language, t, dirty) {
    if (!item) {
        return `<p class="menu-editor-empty">${esc(t('menuSelectItem'))}</p>`;
    }
    const help = item.help?.[language] || item.help?.de || '';
    const dirtyState = dirty
        ? `<span class="menu-item-dirty-state">${esc(t('menuChanged'))}</span>`
        : '';
    const resetDisabled = isMenuEditorItemResettable(item) ? '' : ' disabled';
    const risk = `<span class="risk-badge risk-badge--${esc(item.riskLevel)}">${esc(t(`risk${item.riskLevel.charAt(0).toUpperCase()}${item.riskLevel.slice(1)}`))}</span>`;
    if (item.kind === 'text') {
        return `
            ${dirtyState}
            <div class="menu-property-grid">
                <label>${esc(t('menuDefaultLabel'))}<output>${esc(item.defaultLabel)}</output></label>
                <label>${esc(t('menuOverride'))}<input type="text" data-menu-text-id="${esc(item.textId)}" value="${esc(item.activeTextOverride)}" placeholder="${esc(item.defaultLabel)}"></label>
                <label>${esc(t('menuEffectiveLabel'))}<output>${esc(item.effectiveLabel)}</output></label>
            </div>
            <dl class="menu-property-meta">
                <dt>${esc(t('menuTextId'))}</dt><dd>${esc(item.textId)}</dd>
                <dt>${esc(t('menuRiskLevel'))}</dt><dd>${risk}</dd>
            </dl>
            <button class="btn btn--ghost" type="button" data-menu-action="reset-item" data-menu-item-id="${esc(item.id)}"${resetDisabled}>${esc(t('menuResetLabel'))}</button>`;
    }
    return `
        ${dirtyState}
        <div class="menu-property-grid">
            <label>${esc(t('menuDefaultValue'))}<output>${esc(formatValue(item.defaultValue))}</output></label>
            <label>${esc(t('menuOverride'))}${renderSettingInput(item)}</label>
            <label>${esc(t('menuEffectiveValue'))}<output>${esc(formatValue(item.effectiveValue))}</output></label>
        </div>
        <dl class="menu-property-meta">
            <dt>${esc(t('menuSettingsPath'))}</dt><dd>${esc(item.settingsPath)}</dd>
            <dt>${esc(t('menuFieldType'))}</dt><dd>${esc(item.fieldType)}</dd>
            <dt>${esc(t('menuRiskLevel'))}</dt><dd>${risk}</dd>
            ${item.limits ? `<dt>${esc(t('menuLimits'))}</dt><dd>${esc(formatValue(item.limits))}</dd>` : ''}
        </dl>
        ${help ? `<p class="menu-property-help">${esc(help)}</p>` : ''}
        <button class="btn btn--ghost" type="button" data-menu-action="reset-item" data-menu-item-id="${esc(item.id)}"${resetDisabled}>${esc(t('menuResetValue'))}</button>`;
}

export function countMenuPanelDirty(model, panelId, draft, baseDraft, textOverrides, baseTextOverrides) {
    return model.items.filter((item) => item.panelId === panelId
        && isMenuEditorItemDirty(item, draft, baseDraft, textOverrides, baseTextOverrides)).length;
}

export function captureMenuEditorFocus(root) {
    const target = root?.ownerDocument?.activeElement;
    if (!target || !root.contains(target)) return null;
    const identity = ['menuSearch', 'menuTextId', 'menuSettingPath']
        .find((key) => target.dataset?.[key] !== undefined);
    if (!identity) return null;
    return {
        identity,
        value: target.dataset[identity],
        selectionStart: Number.isInteger(target.selectionStart) ? target.selectionStart : null,
        selectionEnd: Number.isInteger(target.selectionEnd) ? target.selectionEnd : null,
    };
}

export function restoreMenuEditorFocus(root, snapshot) {
    if (!root || !snapshot) return false;
    const target = Array.from(root.querySelectorAll('input, select')).find((entry) => (
        entry.dataset?.[snapshot.identity] === snapshot.value
    ));
    if (!target) return false;
    target.focus();
    if (snapshot.selectionStart != null && typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
    return true;
}

function renderPreviewItem(item, options) {
    const {
        selectedItemId,
        normalizedQuery,
        draft,
        baseDraft,
        textOverrides,
        baseTextOverrides,
        t,
    } = options;
    const dirty = isMenuEditorItemDirty(item, draft, baseDraft, textOverrides, baseTextOverrides);
    const matchedMetadata = normalizedQuery
        ? [item.settingsPath, item.textId, item.id]
            .find((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery))
        : '';
    return `<button type="button" class="menu-preview-item ${item.id === selectedItemId ? 'active' : ''} ${dirty ? 'dirty' : ''}" data-menu-item-id="${esc(item.id)}" aria-pressed="${item.id === selectedItemId ? 'true' : 'false'}">
        <span>${highlight(item.effectiveLabel, normalizedQuery)}</span>
        ${matchedMetadata ? `<em class="menu-preview-match">${highlight(matchedMetadata, normalizedQuery)}</em>` : ''}
        ${item.kind === 'setting' ? `<strong>${highlight(formatValue(item.effectiveValue), normalizedQuery)}</strong>` : ''}
        ${dirty ? `<i aria-label="${esc(t('menuChanged'))}"></i>` : ''}
    </button>`;
}

function renderSearchResults(model, matchingItems, options, t) {
    const groups = model.panels.map((panel) => ({
        panel,
        items: matchingItems.filter((item) => item.panelId === panel.id),
    })).filter((group) => group.items.length);
    if (!groups.length) return `<p class="menu-preview-empty">${esc(t('menuNoResults'))}</p>`;
    return groups.map(({ panel, items }) => `
        <section class="menu-search-group">
            <button type="button" class="menu-search-group__title" data-menu-preview-panel-id="${esc(panel.id)}">
                ${highlight(panel.effectiveLabel, options.normalizedQuery)}
                <small>${items.length}</small>
            </button>
            <div class="menu-preview-list">${items.map((item) => renderPreviewItem(item, options)).join('')}</div>
        </section>`).join('');
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
    previewRoot = false,
    t = (key) => key,
}) {
    const normalizedQuery = normalizeSearchQuery(searchQuery);
    const activePanel = model.panels.find((panel) => panel.id === activePanelId) || model.panels[0];
    const panelItems = model.items.filter((item) => item.panelId === activePanel?.id);
    const matches = (panel) => {
        if (!normalizedQuery) return true;
        if (matchesSearch(panel, normalizedQuery)) return true;
        return model.items.some((item) => item.panelId === panel.id && matchesSearch(item, normalizedQuery));
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
        return `<button type="button" class="menu-tree-item ${panel.id === activePanel?.id && !previewRoot ? 'active' : ''} ${dirty ? 'dirty' : ''}" data-menu-panel-id="${esc(panel.id)}" aria-current="${panel.id === activePanel?.id && !previewRoot ? 'true' : 'false'}">
            <span>${highlight(panel.effectiveLabel, normalizedQuery)}</span>${dirty ? `<small aria-label="${esc(t('menuChangedCount', dirty))}">${dirty}</small>` : ''}
        </button>`;
    }).join('');
    const matchingItems = normalizedQuery
        ? model.items.filter((item) => matchesSearch(item, normalizedQuery))
        : panelItems;
    const previewOptions = {
        selectedItemId,
        normalizedQuery,
        draft,
        baseDraft,
        textOverrides,
        baseTextOverrides,
        t,
    };
    let previewTitle;
    let previewBody;
    if (normalizedQuery) {
        previewTitle = t('menuSearchResults', matchingItems.length);
        previewBody = renderSearchResults(model, matchingItems, previewOptions, t);
    } else if (previewRoot) {
        previewTitle = t('sectionGameMenu');
        previewBody = `<div class="menu-preview-panel-grid">${model.panels
            .filter((panel) => panel.visibility !== 'hidden')
            .map((panel) => {
                const dirty = countMenuPanelDirty(
                    model,
                    panel.id,
                    draft,
                    baseDraft,
                    textOverrides,
                    baseTextOverrides
                );
                return `<button type="button" class="menu-preview-panel ${dirty ? 'dirty' : ''}" data-menu-preview-panel-id="${esc(panel.id)}">
                    <span>${esc(panel.effectiveLabel)}</span>
                    <small>${dirty ? esc(t('menuChangedCount', dirty)) : esc(t('menuOpenPanel'))}</small>
                </button>`;
            }).join('')}</div>`;
    } else {
        previewTitle = activePanel?.effectiveLabel || t('sectionGameMenu');
        previewBody = `<div class="menu-preview-list">${panelItems
            .map((item) => renderPreviewItem(item, previewOptions)).join('')
            || `<p class="menu-preview-empty">${esc(t('menuNoEntries'))}</p>`}</div>`;
    }
    const selectedItem = previewRoot && !normalizedQuery
        ? null
        : model.items.find((item) => item.id === selectedItemId)
            || (normalizedQuery ? matchingItems[0] : panelItems[0])
            || null;
    const selectedDirty = isMenuEditorItemDirty(
        selectedItem,
        draft,
        baseDraft,
        textOverrides,
        baseTextOverrides
    );

    return `
        <div class="menu-editor-toolbar">
            <input type="search" data-menu-search value="${esc(searchQuery)}" placeholder="${esc(t('menuSearchPlaceholder'))}" aria-label="${esc(t('menuSearchLabel'))}">
            ${!previewRoot && !normalizedQuery ? `<button class="btn btn--ghost" type="button" data-menu-action="reset-panel">${esc(t('menuResetPanel'))}</button>` : ''}
        </div>
        <div class="menu-editor-layout">
            <section class="menu-editor-navigation" aria-label="${esc(t('menuNavigation'))}">
                <button type="button" class="menu-tree-root ${previewRoot && !normalizedQuery ? 'active' : ''}" data-menu-preview-root>${esc(t('sectionGameMenu'))}</button>
                ${nav || `<p>${esc(t('menuNoResults'))}</p>`}
            </section>
            <section class="menu-editor-preview" aria-label="${esc(t('menuPreview'))}">
                <div class="menu-preview-shell">
                    <span class="menu-preview-kicker">Curvios Clash // Desktop</span>
                    ${!previewRoot && !normalizedQuery ? `<button type="button" class="menu-preview-back" data-menu-preview-root>← ${esc(t('menuBack'))}</button>` : ''}
                    <h3>${esc(previewTitle)}</h3>
                    ${previewBody}
                </div>
            </section>
            <section class="menu-editor-properties" aria-label="${esc(t('menuPropertiesEditor'))}">
                <h3>${esc(t('menuProperties'))}</h3>
                ${renderProperties(selectedItem, language, t, selectedDirty)}
            </section>
        </div>`;
}
