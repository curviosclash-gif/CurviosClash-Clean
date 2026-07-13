import { createTranslator, normalizeLanguage, SECTIONS } from './settings-studio-i18n.js';
import {
    renderSectionForm,
    renderPresetsSection,
    renderLimitsSection,
    renderBrowserDemoPolicySection,
    countSectionDirtyFields,
} from './settings-studio-form-renderer.js';
import {
    createBrowserDemoSurfacePolicyOverrideDraft,
    mergeBrowserDemoSurfacePolicyWithOverride,
    validateBrowserDemoSurfacePolicyOverrideDraft,
} from '../../../src/shared/contracts/BrowserDemoSurfacePolicyOverrideContract.js';
import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
} from '../../../src/shared/contracts/PlatformCapabilityData.js';
import { PLATFORM_CAPABILITY_IDS } from '../../../src/shared/contracts/PlatformCapabilityContract.js';

const state = {
    language: 'de',
    draft: null,
    baseDraft: null,
    browserDemoPolicyDraft: null,
    browserDemoPolicyBaseDraft: null,
    browserDemoPolicyValidation: null,
    schema: null,
    validation: null,
    paths: null,
    backups: [],
    activeSection: 'baseSettings',
    activeInfoPath: null,
};

const refs = {
    body: document.querySelector('[data-bind="body"]'),
    title: document.querySelector('[data-bind="title"]'),
    languageLabel: document.querySelector('[data-bind="language-label"]'),
    languageSelect: document.querySelector('[data-bind="language-select"]'),
    sidebarNav: document.querySelector('[data-bind="sidebar-nav"]'),
    sectionTitle: document.querySelector('[data-bind="section-title"]'),
    sectionHint: document.querySelector('[data-bind="section-hint"]'),
    changeBadge: document.querySelector('[data-bind="change-count"]'),
    resetSectionBtn: document.querySelector('[data-action="reset-section"]'),
    resetAllBtn: document.querySelector('[data-action="reset-all"]'),
    validateBtn: document.querySelector('[data-action="validate"]'),
    saveBtn: document.querySelector('[data-action="save"]'),
    formContent: document.querySelector('[data-bind="form-content"]'),
    status: document.querySelector('[data-bind="status"]'),
    infoPanel: document.querySelector('[data-bind="info-panel"]'),
    infoPanelTitle: document.querySelector('[data-bind="info-panel-title"]'),
    infoPanelBody: document.querySelector('[data-bind="info-panel-body"]'),
    savePreviewModal: document.querySelector('[data-bind="save-preview-modal"]'),
    savePreviewTitle: document.querySelector('[data-bind="save-preview-title"]'),
    savePreviewBody: document.querySelector('[data-bind="save-preview-body"]'),
    savePreviewCancel: document.querySelector('[data-action="cancel-save"]'),
    savePreviewConfirm: document.querySelector('[data-action="confirm-save"]'),
};

let infoPanelReturnFocusEl = null;

const BROWSER_DEMO_POLICY_PREVIEW_FIELDS = Object.freeze([
    { key: 'allowedSessionTypes', labelKey: 'browserDemoSessionTypesLabel', riskLevel: 'high' },
    { key: 'allowedModePaths', labelKey: 'browserDemoModePathsLabel', riskLevel: 'high' },
    { key: 'allowedPresetIds', labelKey: 'browserDemoPresetIdsLabel', riskLevel: 'medium' },
    { key: 'allowedMultiplayerTransports', labelKey: 'browserDemoAllowedTransportsLabel', riskLevel: 'high' },
    { key: 'hostMultiplayerTransports', labelKey: 'browserDemoHostTransportsLabel', riskLevel: 'medium' },
    { key: 'joinMultiplayerTransports', labelKey: 'browserDemoJoinTransportsLabel', riskLevel: 'medium' },
]);

const BROWSER_DEMO_CAPABILITY_RISK_LEVELS = Object.freeze({
    discovery: 'medium',
    host: 'high',
    save: 'high',
    recording: 'medium',
});

function t(key, ...args) {
    return createTranslator(state.language)(key, ...args);
}

function setStatus(msg) {
    refs.status.textContent = typeof msg === 'string' ? msg : t(msg);
}

function publishDirtyState() {
    window.settingsStudioApi?.setDirtyState?.(isDraftDirty());
}

function deepClone(v) {
    return JSON.parse(JSON.stringify(v));
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function createBrowserDemoPolicySeed() {
    return deepClone(createBrowserDemoSurfacePolicyOverrideDraft());
}

function ensureBrowserDemoPolicyDraft() {
    if (!isPlainObject(state.browserDemoPolicyDraft)) {
        state.browserDemoPolicyDraft = createBrowserDemoPolicySeed();
    }
    if (!isPlainObject(state.browserDemoPolicyDraft.policy)) {
        state.browserDemoPolicyDraft.policy = {};
    }
    if (!isPlainObject(state.browserDemoPolicyDraft.capabilityFlags)) {
        state.browserDemoPolicyDraft.capabilityFlags = {};
    }
    return state.browserDemoPolicyDraft;
}

function createBrowserDemoValidationSnapshot(validationResult) {
    const result = validationResult || {};
    return {
        valid: result.valid === true,
        errors: Array.isArray(result.errors) ? result.errors : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
}

function formatTokenLabel(value) {
    return String(value || '')
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join('');
}

function resolveBrowserDemoEnumLabel(prefix, value) {
    const translationKey = `${prefix}${formatTokenLabel(value)}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : value;
}

function resolveBrowserDemoBaseProduct() {
    const product = PLATFORM_CAPABILITY_REGISTRY?.products?.[PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO] || {};
    return {
        surfacePolicy: isPlainObject(product.surfacePolicy) ? product.surfacePolicy : {},
        capabilities: isPlainObject(product.capabilities) ? product.capabilities : {},
    };
}

function resolveBrowserDemoMergedProjection(rawDraft) {
    const baseProduct = resolveBrowserDemoBaseProduct();
    return mergeBrowserDemoSurfacePolicyWithOverride(
        baseProduct.surfacePolicy,
        baseProduct.capabilities,
        rawDraft
    );
}

function validateBrowserDemoPolicyDraft() {
    const draft = ensureBrowserDemoPolicyDraft();
    const validation = validateBrowserDemoSurfacePolicyOverrideDraft(draft);
    state.browserDemoPolicyDraft = deepClone(validation.normalizedDraft);
    state.browserDemoPolicyValidation = createBrowserDemoValidationSnapshot(validation);
    return state.browserDemoPolicyValidation;
}

function countSectionDirty(sectionKey) {
    if (sectionKey === 'browserDemoPolicy') {
        return JSON.stringify(state.browserDemoPolicyDraft || {}) !== JSON.stringify(state.browserDemoPolicyBaseDraft || {}) ? 1 : 0;
    }
    return countSectionDirtyFields(sectionKey, state.schema, state.draft, state.baseDraft);
}

function readPath(obj, path) {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}

function writePath(obj, path, value) {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

function toFiniteNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
}

function nearlyEqualNumbers(a, b, epsilon = 1e-9) {
    if (a === b) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= epsilon;
}

function resolveLimitFallback(limitPath, limitKey) {
    const schemaFields = Array.isArray(state.schema?.fields) ? state.schema.fields : [];
    const field = schemaFields.find((entry) => entry?.path === limitPath && entry?.type === 'number');
    return toFiniteNumber(field?.limits?.[limitKey]);
}

function readValueFromTarget(target, explicitType = null) {
    const dataType = explicitType || target?.dataset?.type || 'string';
    if (dataType === 'boolean') {
        return Boolean(target?.checked);
    }
    if (dataType === 'number') {
        const rawValue = String(target?.value ?? '').trim();
        if (!rawValue) return null;
        const normalized = Number(rawValue);
        return Number.isFinite(normalized) ? normalized : undefined;
    }
    if (dataType === 'json') {
        try {
            return JSON.parse(target.value);
        } catch {
            return undefined;
        }
    }
    return target?.value ?? '';
}

function isDraftInputTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (target.dataset?.action === 'reset-field') return false;
    const tagName = String(target.tagName || '').toUpperCase();
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function renderStaticTexts() {
    refs.title.textContent = t('title');
    refs.languageLabel.textContent = t('languageLabel');
    refs.resetSectionBtn.textContent = t('buttonResetSection');
    refs.resetAllBtn.textContent = t('buttonResetAll');
    refs.validateBtn.textContent = t('buttonValidate');
    refs.saveBtn.textContent = t('buttonSave');
    if (refs.savePreviewCancel) refs.savePreviewCancel.textContent = t('savePreviewCancel');
    if (refs.savePreviewConfirm) refs.savePreviewConfirm.textContent = t('savePreviewConfirm');
    if (refs.savePreviewTitle) refs.savePreviewTitle.textContent = t('savePreviewTitle');
    if (refs.infoPanelTitle && !state.activeInfoPath) {
        refs.infoPanelTitle.textContent = t('infoPanelTitle');
    }
}

function renderBackupsList(backups, translator) {
    if (!Array.isArray(backups) || !backups.length) {
        return `<div class="field-group"><em>${translator('noBackups')}</em></div>`;
    }
    const rows = backups.map((b) => {
        const name = String(b.fileName || '');
        const date = b.createdAt ? new Date(b.createdAt).toLocaleString() : '';
        return `<div class="field-row" style="grid-template-columns:1fr auto auto"><span class="field-label" title="${name}">${name}</span><small style="color:var(--muted)">${date}</small><button class="btn btn--ghost" style="font-size:11px;height:24px;" data-action="restore-backup" data-backup-file="${name}">${translator('buttonRestore')}</button></div>`;
    });
    return `<div class="field-group">${rows.join('')}</div>`;
}

function renderSidebar() {
    const items = SECTIONS.map((section) => {
        const label = t(section.labelKey);
        const active = section.key === state.activeSection ? 'active' : '';
        const dirtyCount = !section.noDirty && state.draft && state.baseDraft
            ? countSectionDirty(section.key)
            : 0;
        const dirtyDot = dirtyCount > 0 ? '<span class="nav-dirty" aria-hidden="true"></span>' : '';
        const ariaSelected = section.key === state.activeSection ? 'true' : 'false';
        return `<li class="nav-item" role="presentation"><button class="nav-btn ${active}" data-nav-section="${section.key}" type="button" role="tab" aria-selected="${ariaSelected}">${label}${dirtyDot}</button></li>`;
    });
    refs.sidebarNav.innerHTML = items.join('');
}

function renderFormContent() {
    if (!state.draft || !state.schema) {
        refs.formContent.textContent = '';
        if (refs.sectionHint) refs.sectionHint.hidden = true;
        return;
    }

    const section = SECTIONS.find((s) => s.key === state.activeSection);
    refs.sectionTitle.textContent = section ? t(section.labelKey) : state.activeSection;
    const hintKeyBySection = {
        baseSettings: 'sectionHintBaseSettings',
        configShare: 'sectionHintConfigShare',
        limits: 'sectionHintLimits',
        browserDemoPolicy: 'sectionHintBrowserDemoPolicy',
    };
    const hintKey = hintKeyBySection[state.activeSection] || '';
    if (refs.sectionHint) {
        if (hintKey) {
            refs.sectionHint.textContent = t(hintKey);
            refs.sectionHint.hidden = false;
        } else {
            refs.sectionHint.hidden = true;
            refs.sectionHint.textContent = '';
        }
    }

    const translator = createTranslator(state.language);
    const validationErrors = state.validation?.errors || [];
    let html;
    if (state.activeSection === 'limits') {
        html = renderLimitsSection(state.schema, state.draft, state.baseDraft, translator);
    } else if (state.activeSection === 'browserDemoPolicy') {
        html = renderBrowserDemoPolicySection(
            state.browserDemoPolicyDraft,
            translator,
            state.browserDemoPolicyValidation
        );
    } else if (state.activeSection === 'fixedPresets') {
        html = renderPresetsSection(state.draft, state.baseDraft, translator);
    } else if (state.activeSection === 'backups') {
        html = renderBackupsList(state.backups, translator);
    } else {
        html = renderSectionForm(state.activeSection, state.schema, state.draft, state.baseDraft, translator, validationErrors);
    }

    refs.formContent.innerHTML = html;
    const backupsSectionActive = state.activeSection === 'backups';
    refs.validateBtn.disabled = backupsSectionActive;
    refs.saveBtn.disabled = backupsSectionActive;
    updateChangeBadge();
}

function updateChangeBadge() {
    if (!state.draft || !state.baseDraft) {
        refs.changeBadge.hidden = true;
        publishDirtyState();
        return;
    }
    const count = countSectionDirty(state.activeSection);
    if (count > 0) {
        refs.changeBadge.textContent = t('changeBadge', count);
        refs.changeBadge.hidden = false;
    } else {
        refs.changeBadge.hidden = true;
    }
    publishDirtyState();
}

function renderAll() {
    renderStaticTexts();
    renderSidebar();
    renderFormContent();
}

// ─── Info Panel ─────────────────────────────────────

function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resolveFieldEntry(path) {
    if (!state.schema?.fields) return null;
    return state.schema.fields.find((f) => f.path === path) || null;
}

function renderInfoPanelBody(field) {
    const lang = state.language === 'en' ? 'en' : 'de';
    const helpText = field.help?.[lang] || null;
    const impactText = field.impact?.[lang] || null;
    const example = field.example;
    const unit = field.unit;
    const defaultValue = field.defaultValue;
    const riskLevel = field.riskLevel || 'low';

    if (!helpText && !impactText && !example) {
        return `<p class="info-panel__no-info">${t('infoPanelNoInfo')}</p>`;
    }

    const riskLabel = t(`risk${riskLevel.charAt(0).toUpperCase()}${riskLevel.slice(1)}`);
    const riskClass = `risk-badge--${riskLevel}`;

    let html = `<div class="info-panel__section"><span class="risk-badge ${riskClass}">${esc(riskLabel)}</span></div>`;

    if (helpText) {
        html += `<div class="info-panel__section"><p class="info-panel__section-label">${t('infoPanelHelp')}</p><p class="info-panel__text">${esc(helpText)}</p></div>`;
    }

    if (impactText) {
        html += `<div class="info-panel__section"><p class="info-panel__section-label">${t('infoPanelImpact')}</p><p class="info-panel__text">${esc(impactText)}</p></div>`;
    }

    const metaRows = [];
    if (example != null) {
        metaRows.push(`<div class="info-panel__section"><p class="info-panel__section-label">${t('infoPanelExample')}</p><p class="info-panel__text"><span class="info-panel__example">${esc(String(example))}</span>${unit ? ` <span style="color:var(--muted)">${esc(unit)}</span>` : ''}</p></div>`);
    }
    if (defaultValue != null && defaultValue !== '') {
        metaRows.push(`<div class="info-panel__section"><p class="info-panel__section-label">${t('infoPanelDefault')}</p><p class="info-panel__text"><span class="info-panel__example">${esc(String(defaultValue))}</span>${unit ? ` <span style="color:var(--muted)">${esc(unit)}</span>` : ''}</p></div>`);
    }
    if (unit) {
        metaRows.push(`<div class="info-panel__section"><p class="info-panel__section-label">${t('infoPanelUnit')}</p><p class="info-panel__text">${esc(unit)}</p></div>`);
    }
    html += metaRows.join('');

    return html;
}

function showInfoPanel(path, triggerElement = null) {
    const field = resolveFieldEntry(path);
    if (!field) return;

    state.activeInfoPath = path;
    const selectorPath = String(path || '').replace(/"/g, '\\"');
    const fallbackTrigger = refs.formContent?.querySelector?.(`[data-action="show-info"][data-path="${selectorPath}"]`) || null;
    infoPanelReturnFocusEl = triggerElement && typeof triggerElement.focus === 'function'
        ? triggerElement
        : fallbackTrigger;

    const label = String(path.split('.').pop() || path).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

    refs.infoPanelTitle.textContent = label;
    refs.infoPanelBody.innerHTML = renderInfoPanelBody(field);
    refs.infoPanel.hidden = false;
    refs.body?.classList.add('info-panel-open');

    const closeBtn = refs.infoPanel.querySelector('[data-action="close-info"]');
    if (closeBtn) setTimeout(() => closeBtn.focus(), 50);
}

function closeInfoPanel() {
    const returnFocusEl = infoPanelReturnFocusEl;
    state.activeInfoPath = null;
    refs.infoPanel.hidden = true;
    refs.body?.classList.remove('info-panel-open');
    infoPanelReturnFocusEl = null;
    if (returnFocusEl && typeof returnFocusEl.focus === 'function' && document.contains(returnFocusEl)) {
        setTimeout(() => returnFocusEl.focus(), 0);
    }
}

// ─── Save Preview ────────────────────────────────────

function collectDirtyFields() {
    if (!state.draft || !state.baseDraft) return [];
    const dirty = [];
    const schemaFields = Array.isArray(state.schema?.fields) ? state.schema.fields : [];
    const schemaFieldByPath = new Map(schemaFields.map((field) => [field.path, field]));
    for (const field of schemaFields) {
        const current = readPath(state.draft, field.path);
        const base = readPath(state.baseDraft, field.path);
        if (JSON.stringify(current) !== JSON.stringify(base)) {
            dirty.push({ field, current, base });
        }
    }

    const draftLimitOverrides = state.draft.limitOverrides || {};
    const baseLimitOverrides = state.baseDraft.limitOverrides || {};
    const limitPaths = new Set([
        ...Object.keys(baseLimitOverrides),
        ...Object.keys(draftLimitOverrides),
    ]);
    const limitKeys = ['min', 'max', 'step'];

    for (const limitPath of limitPaths) {
        const currentOverride = draftLimitOverrides[limitPath] || {};
        const baseOverride = baseLimitOverrides[limitPath] || {};
        const fieldMeta = schemaFieldByPath.get(limitPath) || null;
        const baseLabel = String(limitPath.split('.').pop() || limitPath)
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (c) => c.toUpperCase());

        for (const limitKey of limitKeys) {
            const fallback = resolveLimitFallback(limitPath, limitKey);
            const hasCurrentOverride = Object.prototype.hasOwnProperty.call(currentOverride, limitKey);
            const hasBaseOverride = Object.prototype.hasOwnProperty.call(baseOverride, limitKey);
            const current = hasCurrentOverride ? currentOverride[limitKey] : fallback;
            const base = hasBaseOverride ? baseOverride[limitKey] : fallback;
            if (JSON.stringify(current) !== JSON.stringify(base)) {
                dirty.push({
                    field: {
                        path: `${limitPath}.${limitKey}`,
                        section: 'limits',
                        riskLevel: fieldMeta?.riskLevel || 'low',
                        previewLabel: `${baseLabel} (${limitKey})`,
                    },
                    current,
                    base,
                });
            }
        }
    }

    const browserDemoProjectionCurrent = resolveBrowserDemoMergedProjection(state.browserDemoPolicyDraft);
    const browserDemoProjectionBase = resolveBrowserDemoMergedProjection(state.browserDemoPolicyBaseDraft);
    const currentPolicy = browserDemoProjectionCurrent?.policy || {};
    const basePolicy = browserDemoProjectionBase?.policy || {};

    BROWSER_DEMO_POLICY_PREVIEW_FIELDS.forEach((meta) => {
        const current = currentPolicy[meta.key];
        const base = basePolicy[meta.key];
        if (JSON.stringify(current) === JSON.stringify(base)) {
            return;
        }
        dirty.push({
            field: {
                path: `browserDemoPolicy.policy.${meta.key}`,
                section: 'browserDemoPolicy',
                riskLevel: meta.riskLevel,
                previewLabel: t(meta.labelKey),
            },
            current,
            base,
        });
    });

    const currentCurated = isPlainObject(currentPolicy.curatedMapKeysByModePath)
        ? currentPolicy.curatedMapKeysByModePath
        : {};
    const baseCurated = isPlainObject(basePolicy.curatedMapKeysByModePath)
        ? basePolicy.curatedMapKeysByModePath
        : {};
    const curatedModePaths = new Set([...Object.keys(baseCurated), ...Object.keys(currentCurated)]);
    curatedModePaths.forEach((modePath) => {
        const current = Array.isArray(currentCurated[modePath]) ? currentCurated[modePath] : [];
        const base = Array.isArray(baseCurated[modePath]) ? baseCurated[modePath] : [];
        if (JSON.stringify(current) === JSON.stringify(base)) {
            return;
        }
        const modeLabel = resolveBrowserDemoEnumLabel('browserDemoModePath', modePath);
        dirty.push({
            field: {
                path: `browserDemoPolicy.policy.curatedMapKeysByModePath.${modePath}`,
                section: 'browserDemoPolicy',
                riskLevel: 'medium',
                previewLabel: t('browserDemoCuratedMapsLabel', modeLabel),
            },
            current,
            base,
        });
    });

    const currentCapabilities = browserDemoProjectionCurrent?.capabilityFlags || {};
    const baseCapabilities = browserDemoProjectionBase?.capabilityFlags || {};
    Object.values(PLATFORM_CAPABILITY_IDS).forEach((capabilityId) => {
        const current = currentCapabilities[capabilityId] === true;
        const base = baseCapabilities[capabilityId] === true;
        if (current === base) {
            return;
        }
        const labelKey = `browserDemoCapability${formatTokenLabel(capabilityId)}`;
        const translatedLabel = t(labelKey);
        dirty.push({
            field: {
                path: `browserDemoPolicy.capabilityFlags.${capabilityId}.enabled`,
                section: 'browserDemoPolicy',
                riskLevel: BROWSER_DEMO_CAPABILITY_RISK_LEVELS[capabilityId] || 'medium',
                previewLabel: translatedLabel !== labelKey ? translatedLabel : capabilityId,
            },
            current,
            base,
        });
    });

    return dirty;
}

function formatValue(value) {
    if (value === null || value === undefined) return '–';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function renderBrowserDemoPreviewHints(entries) {
    const highRiskCount = entries.filter((entry) => entry?.field?.riskLevel === 'high').length;
    const mediumRiskCount = entries.filter((entry) => entry?.field?.riskLevel === 'medium').length;

    if (!highRiskCount && !mediumRiskCount) {
        return '';
    }

    const hints = [];
    if (highRiskCount > 0) {
        hints.push(`<li>${esc(t('browserDemoRiskHintHigh', highRiskCount))}</li>`);
    }
    if (mediumRiskCount > 0) {
        hints.push(`<li>${esc(t('browserDemoRiskHintMedium', mediumRiskCount))}</li>`);
    }

    return `<div class="preview-section__hints">
        <p class="preview-section__hint-title">${esc(t('browserDemoRiskHintTitle'))}</p>
        <ul class="preview-section__hint-list">${hints.join('')}</ul>
    </div>`;
}

function renderSavePreviewBody(dirtyFields, paths, options = {}) {
    const { includeBackupNote = true } = options;
    if (!dirtyFields.length) {
        return `<p class="preview-no-changes">${t('savePreviewNoChanges')}</p>`;
    }

    const bySection = new Map();
    for (const entry of dirtyFields) {
        const sec = entry.field.section || 'other';
        if (!bySection.has(sec)) bySection.set(sec, []);
        bySection.get(sec).push(entry);
    }

    let html = '';
    for (const [sectionKey, entries] of bySection) {
        const sectionLabel = t(`section${sectionKey.charAt(0).toUpperCase()}${sectionKey.slice(1)}`) || sectionKey;
        html += `<div class="preview-section"><p class="preview-section__title">${esc(sectionLabel)}</p>`;
        if (sectionKey === 'browserDemoPolicy') {
            html += renderBrowserDemoPreviewHints(entries);
        }
        for (const { field, current, base } of entries) {
            const label = field.previewLabel
                || String(field.path.split('.').pop() || field.path).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
            const riskLevel = field.riskLevel || 'low';
            const riskClass = riskLevel !== 'low' ? ` preview-row--risk-${riskLevel}` : '';
            const riskBadge = riskLevel === 'high'
                ? `<span class="risk-badge risk-badge--high" title="${t('savePreviewRiskWarning')}">${t('riskHigh')}</span>`
                : riskLevel === 'medium'
                    ? `<span class="risk-badge risk-badge--medium">${t('riskMedium')}</span>`
                    : '';
            html += `<div class="preview-row${riskClass}">
                <span class="preview-field-name" title="${esc(field.path)}">${esc(label)}</span>
                <span class="preview-field-change">
                    <span class="preview-field-old">${esc(formatValue(base))}</span>
                    <span class="preview-arrow">→</span>
                    <span class="preview-field-new">${esc(formatValue(current))}</span>
                </span>
                ${riskBadge}
            </div>`;
        }
        html += '</div>';
    }

    if (includeBackupNote) {
        const backupNote = `<div class="preview-backup-note">${t('savePreviewBackupNote')}${paths?.backupDirectoryPath ? ` <small style="opacity:0.7">(${esc(paths.backupDirectoryPath)})</small>` : ''}</div>`;
        html += backupNote;
    }

    return html;
}

function showSavePreview() {
    syncRenderedFormDraft();
    const dirtyFields = collectDirtyFields();
    const includeBackupNote = JSON.stringify(state.draft) !== JSON.stringify(state.baseDraft);

    refs.savePreviewTitle.textContent = t('savePreviewTitle');
    refs.savePreviewCancel.textContent = t('savePreviewCancel');
    refs.savePreviewConfirm.textContent = t('savePreviewConfirm');
    refs.savePreviewBody.innerHTML = renderSavePreviewBody(
        dirtyFields,
        state.paths,
        { includeBackupNote }
    );

    refs.savePreviewModal.hidden = false;
    setTimeout(() => refs.savePreviewConfirm?.focus(), 50);
}

function closeSavePreview() {
    refs.savePreviewModal.hidden = true;
    refs.saveBtn?.focus();
}

// ─── State management ────────────────────────────────

async function loadState() {
    setStatus('statusLoading');
    const response = await window.settingsStudioApi.load();
    state.draft = response?.draft ? deepClone(response.draft) : null;
    state.baseDraft = response?.draft ? deepClone(response.draft) : null;
    state.schema = response?.schema || null;
    state.validation = response?.validation || null;
    state.paths = response?.paths || null;
    state.backups = Array.isArray(response?.backups) ? response.backups : [];

    const loadedBrowserDemoPolicy = response?.browserDemoPolicy || null;
    if (loadedBrowserDemoPolicy?.draft) {
        state.browserDemoPolicyDraft = deepClone(loadedBrowserDemoPolicy.draft);
        state.browserDemoPolicyValidation = createBrowserDemoValidationSnapshot(loadedBrowserDemoPolicy.validation);
    } else {
        state.browserDemoPolicyDraft = createBrowserDemoPolicySeed();
        state.browserDemoPolicyValidation = validateBrowserDemoPolicyDraft();
    }
    state.browserDemoPolicyBaseDraft = deepClone(state.browserDemoPolicyDraft);
    state.language = normalizeLanguage(state.draft?.language || state.language);
    refs.languageSelect.value = state.language;
    renderAll();
    setStatus(state.validation?.valid ? 'statusValid' : 'statusInvalid');

    if (response?.migration?.status && response.migration.status !== 'current') {
        const diagKey = response.migration.status === 'upgrade' ? 'diagMigrationUpgrade'
            : response.migration.status === 'fallback' ? 'diagMigrationFallback'
                : 'diagMigrationReject';
        setStatus(t(diagKey));
    }
}

async function validateState() {
    if (!state.draft) return;
    syncRenderedFormDraft();
    if (state.activeSection === 'browserDemoPolicy') {
        const browserDemoValidation = validateBrowserDemoPolicyDraft();
        renderFormContent();
        renderSidebar();
        setStatus(browserDemoValidation.valid ? 'statusValid' : 'statusInvalid');
        return;
    }
    setStatus('statusLoading');
    const response = await window.settingsStudioApi.validate(state.draft);
    state.validation = response?.validation || state.validation;
    if (response?.draft) state.draft = deepClone(response.draft);
    renderFormContent();
    setStatus(state.validation?.valid ? 'statusValid' : 'statusInvalid');
}

async function saveState() {
    if (!state.draft) return;
    syncRenderedFormDraft();

    const mainDraftDirty = JSON.stringify(state.draft) !== JSON.stringify(state.baseDraft);
    const browserDemoDirty = JSON.stringify(state.browserDemoPolicyDraft || {}) !== JSON.stringify(state.browserDemoPolicyBaseDraft || {});
    if (!mainDraftDirty && !browserDemoDirty) {
        setStatus('statusSaved');
        return;
    }

    setStatus('statusLoading');
    const apiResponse = await window.settingsStudioApi.save(state.draft, state.browserDemoPolicyDraft);
    if (apiResponse?.ok) {
        const savedDraft = apiResponse?.draft ? deepClone(apiResponse.draft) : deepClone(state.draft);
        state.draft = deepClone(savedDraft);
        state.baseDraft = deepClone(savedDraft);
        state.validation = apiResponse?.validation || state.validation;

        const savedBrowserDemoDraft = apiResponse?.browserDemoPolicy?.draft
            ? deepClone(apiResponse.browserDemoPolicy.draft)
            : deepClone(state.browserDemoPolicyDraft || createBrowserDemoPolicySeed());
        state.browserDemoPolicyDraft = savedBrowserDemoDraft;
        state.browserDemoPolicyBaseDraft = deepClone(savedBrowserDemoDraft);
        if (apiResponse?.browserDemoPolicy?.validation) {
            state.browserDemoPolicyValidation = createBrowserDemoValidationSnapshot(apiResponse.browserDemoPolicy.validation);
        }

        publishDirtyState();
        const listResponse = await window.settingsStudioApi.listBackups({}).catch(() => null);
        const backupsArr = Array.isArray(listResponse?.backups) ? listResponse.backups
            : (Array.isArray(listResponse) ? listResponse : null);
        if (backupsArr) state.backups = backupsArr;

        renderAll();
        const browserDemoOnlySave = browserDemoDirty && !mainDraftDirty;
        setStatus(browserDemoOnlySave ? 'statusSavedBrowserDemoPolicy' : 'statusSaved');
        return;
    }

    if (apiResponse?.draft) {
        state.draft = deepClone(apiResponse.draft);
    }
    state.validation = apiResponse?.validation || state.validation;
    if (apiResponse?.browserDemoPolicy?.draft) {
        state.browserDemoPolicyDraft = deepClone(apiResponse.browserDemoPolicy.draft);
    }
    if (apiResponse?.browserDemoPolicy?.validation) {
        state.browserDemoPolicyValidation = createBrowserDemoValidationSnapshot(apiResponse.browserDemoPolicy.validation);
    }
    renderAll();
    setStatus('statusInvalid');
}

function onFieldChange(eventOrTarget, options = {}) {
    const { updateUi = true } = options;
    const target = eventOrTarget?.target || eventOrTarget;
    if (!isDraftInputTarget(target)) return;
    const path = target.dataset?.path;
    if (!path || !state.draft) return;

    const value = readValueFromTarget(target);
    if (value === undefined) return;

    writePath(state.draft, path, value);

    const row = target.closest('.field-row');
    if (updateUi && row) {
        const isDirtyNow = JSON.stringify(readPath(state.draft, path)) !== JSON.stringify(readPath(state.baseDraft, path));
        row.classList.toggle('dirty', isDirtyNow);
        const resetBtn = row.querySelector('[data-action="reset-field"]');
        if (resetBtn) {
            if (isDirtyNow) resetBtn.setAttribute('data-dirty', 'true');
            else resetBtn.removeAttribute('data-dirty');
        }
        target.dataset.dirty = isDirtyNow ? 'true' : '';
    }

    if (updateUi) {
        updateChangeBadge();
        renderSidebar();
    }
}

function onLimitChange(eventOrTarget, options = {}) {
    const { updateUi = true } = options;
    const target = eventOrTarget?.target || eventOrTarget;
    const limitPath = target.dataset?.limitPath;
    const limitKey = target.dataset?.limitKey;
    if (!limitPath || !limitKey || !state.draft) return;

    if (!state.draft.limitOverrides) state.draft.limitOverrides = {};
    if (!state.draft.limitOverrides[limitPath]) state.draft.limitOverrides[limitPath] = {};

    const raw = String(target.value ?? '').trim();
    if (raw === '' || raw == null) {
        delete state.draft.limitOverrides[limitPath][limitKey];
        if (!Object.keys(state.draft.limitOverrides[limitPath]).length) {
            delete state.draft.limitOverrides[limitPath];
        }
    } else {
        const numericValue = Number(raw);
        if (!Number.isFinite(numericValue)) return;
        const baseOverride = state.baseDraft?.limitOverrides?.[limitPath] || {};
        const baseHasLimitOverride = Object.prototype.hasOwnProperty.call(baseOverride, limitKey);
        const fallbackValue = resolveLimitFallback(limitPath, limitKey);
        const useImplicitFallback = !baseHasLimitOverride
            && fallbackValue !== undefined
            && nearlyEqualNumbers(numericValue, fallbackValue);

        if (useImplicitFallback) {
            delete state.draft.limitOverrides[limitPath][limitKey];
            if (!Object.keys(state.draft.limitOverrides[limitPath]).length) {
                delete state.draft.limitOverrides[limitPath];
            }
        } else {
            state.draft.limitOverrides[limitPath][limitKey] = numericValue;
        }
    }

    const row = target.closest('tr');
    if (updateUi && row) {
        const override = state.draft.limitOverrides?.[limitPath] || {};
        const baseOverride = state.baseDraft?.limitOverrides?.[limitPath] || {};
        const dirty = JSON.stringify(override) !== JSON.stringify(baseOverride);
        row.classList.toggle('dirty', dirty);
    }

    if (updateUi) {
        updateChangeBadge();
        renderSidebar();
    }
}

function readBrowserDemoGroupSelection(group, modePath = '') {
    const modeSelector = modePath
        ? `[data-browser-demo-group="${group}"][data-browser-demo-mode-path="${modePath}"]`
        : `[data-browser-demo-group="${group}"]:not([data-browser-demo-mode-path])`;
    const targets = Array.from(refs.formContent.querySelectorAll(modeSelector));
    const allValues = targets.map((target) => String(target.dataset.browserDemoValue || '').trim().toLowerCase())
        .filter(Boolean);
    const selectedValues = targets
        .filter((target) => target.checked)
        .map((target) => String(target.dataset.browserDemoValue || '').trim().toLowerCase())
        .filter(Boolean);
    return { allValues, selectedValues };
}

function applyPolicyArrayOverride(policy, fieldName, allValues, selectedValues) {
    const normalizedAll = Array.from(new Set((allValues || []).filter(Boolean)));
    const normalizedSelected = Array.from(new Set((selectedValues || []).filter(Boolean)))
        .filter((value) => normalizedAll.includes(value));

    if (!normalizedAll.length || normalizedSelected.length === normalizedAll.length) {
        delete policy[fieldName];
        return;
    }
    policy[fieldName] = normalizedSelected;
}

function normalizeBrowserDemoDraftShape(draft) {
    if (!isPlainObject(draft.policy)) draft.policy = {};
    if (!isPlainObject(draft.capabilityFlags)) draft.capabilityFlags = {};
    if (!isPlainObject(draft.policy.curatedMapKeysByModePath)) {
        delete draft.policy.curatedMapKeysByModePath;
    }
    if (!Object.keys(draft.policy).length) {
        draft.policy = {};
    }
    if (!Object.keys(draft.capabilityFlags).length) {
        draft.capabilityFlags = {};
    }
}

function onBrowserDemoPolicyChange(eventOrTarget, options = {}) {
    const { updateUi = true } = options;
    const target = eventOrTarget?.target || eventOrTarget;
    if (!target || !state.browserDemoPolicyDraft) return;

    const draft = ensureBrowserDemoPolicyDraft();
    const policy = isPlainObject(draft.policy) ? draft.policy : (draft.policy = {});

    const sessionTypeSelection = readBrowserDemoGroupSelection('allowedSessionTypes');
    applyPolicyArrayOverride(
        policy,
        'allowedSessionTypes',
        sessionTypeSelection.allValues,
        sessionTypeSelection.selectedValues
    );

    const modePathSelection = readBrowserDemoGroupSelection('allowedModePaths');
    applyPolicyArrayOverride(
        policy,
        'allowedModePaths',
        modePathSelection.allValues,
        modePathSelection.selectedValues
    );

    const presetSelection = readBrowserDemoGroupSelection('allowedPresetIds');
    applyPolicyArrayOverride(
        policy,
        'allowedPresetIds',
        presetSelection.allValues,
        presetSelection.selectedValues
    );

    const allowedTransportSelection = readBrowserDemoGroupSelection('allowedMultiplayerTransports');
    applyPolicyArrayOverride(
        policy,
        'allowedMultiplayerTransports',
        allowedTransportSelection.allValues,
        allowedTransportSelection.selectedValues
    );

    const allowedTransportSet = new Set(allowedTransportSelection.selectedValues);
    const hostTransportSelection = readBrowserDemoGroupSelection('hostMultiplayerTransports');
    applyPolicyArrayOverride(
        policy,
        'hostMultiplayerTransports',
        hostTransportSelection.allValues.filter((value) => allowedTransportSet.has(value)),
        hostTransportSelection.selectedValues.filter((value) => allowedTransportSet.has(value))
    );

    const joinTransportSelection = readBrowserDemoGroupSelection('joinMultiplayerTransports');
    applyPolicyArrayOverride(
        policy,
        'joinMultiplayerTransports',
        joinTransportSelection.allValues.filter((value) => allowedTransportSet.has(value)),
        joinTransportSelection.selectedValues.filter((value) => allowedTransportSet.has(value))
    );

    const modePathSet = new Set(modePathSelection.selectedValues);
    const curatedTargets = Array.from(refs.formContent.querySelectorAll('[data-browser-demo-group="curatedMapKeysByModePath"][data-browser-demo-mode-path]'));
    const modePaths = Array.from(new Set(curatedTargets
        .map((entry) => String(entry.dataset.browserDemoModePath || '').trim().toLowerCase())
        .filter(Boolean)));
    const curatedMapOverrides = {};
    for (const modePath of modePaths) {
        if (!modePathSet.has(modePath)) continue;
        const mapSelection = readBrowserDemoGroupSelection('curatedMapKeysByModePath', modePath);
        const normalizedAll = Array.from(new Set(mapSelection.allValues.filter(Boolean)));
        const normalizedSelected = Array.from(new Set(mapSelection.selectedValues.filter(Boolean)))
            .filter((value) => normalizedAll.includes(value));
        if (!normalizedAll.length || normalizedSelected.length === normalizedAll.length) {
            continue;
        }
        curatedMapOverrides[modePath] = normalizedSelected;
    }
    if (Object.keys(curatedMapOverrides).length) {
        policy.curatedMapKeysByModePath = curatedMapOverrides;
    } else {
        delete policy.curatedMapKeysByModePath;
    }

    const capabilityFlags = {};
    const capabilityTargets = Array.from(refs.formContent.querySelectorAll('[data-browser-demo-capability]'));
    capabilityTargets.forEach((entry) => {
        const capabilityId = String(entry.dataset.browserDemoCapability || '').trim().toLowerCase();
        if (!capabilityId) return;
        const baseEnabled = String(entry.dataset.browserDemoBaseEnabled || '').trim().toLowerCase() === 'true';
        if (!baseEnabled || entry.checked) return;
        capabilityFlags[capabilityId] = { enabled: false };
    });
    draft.capabilityFlags = capabilityFlags;
    normalizeBrowserDemoDraftShape(draft);
    state.browserDemoPolicyValidation = null;

    if (updateUi) {
        renderFormContent();
        renderSidebar();
    }
}

function onResetField(target) {
    const path = target.dataset?.path;
    if (!path || !state.draft || !state.baseDraft) return;

    const baseValue = readPath(state.baseDraft, path);
    writePath(state.draft, path, baseValue != null ? deepClone(baseValue) : baseValue);

    const row = target.closest('.field-row');
    if (row) {
        row.classList.remove('dirty');
        target.removeAttribute('data-dirty');
        const input = row.querySelector('[data-path]');
        if (input) {
            if (input.type === 'checkbox') input.checked = !!baseValue;
            else if (input.tagName === 'TEXTAREA') input.value = JSON.stringify(baseValue, null, 2);
            else input.value = baseValue ?? '';
            input.removeAttribute('data-dirty');
        }
    }

    updateChangeBadge();
    renderSidebar();
}

function onResetSection() {
    if (!state.draft || !state.baseDraft) return;
    const sectionKey = state.activeSection;

    if (sectionKey === 'limits') {
        state.draft.limitOverrides = deepClone(state.baseDraft.limitOverrides || {});
    } else if (sectionKey === 'browserDemoPolicy') {
        state.browserDemoPolicyDraft = deepClone(state.browserDemoPolicyBaseDraft || createBrowserDemoPolicySeed());
        state.browserDemoPolicyValidation = null;
    } else if (sectionKey === 'fixedPresets') {
        state.draft.fixedPresets = deepClone(state.baseDraft.fixedPresets || []);
    } else {
        if (state.baseDraft[sectionKey] !== undefined) {
            state.draft[sectionKey] = deepClone(state.baseDraft[sectionKey]);
        }
    }

    renderFormContent();
    renderSidebar();
}

function onResetAll() {
    if (!state.baseDraft) return;
    state.draft = deepClone(state.baseDraft);
    state.browserDemoPolicyDraft = deepClone(state.browserDemoPolicyBaseDraft || createBrowserDemoPolicySeed());
    state.browserDemoPolicyValidation = null;
    renderAll();
}

function onNavSection(sectionKey) {
    state.activeSection = sectionKey;
    renderSidebar();
    renderFormContent();
}

async function onLanguageChange(event) {
    const nextLanguage = normalizeLanguage(event?.target?.value || 'de');
    state.language = nextLanguage;
    if (state.draft && typeof state.draft === 'object') state.draft.language = nextLanguage;
    if (state.baseDraft && typeof state.baseDraft === 'object') state.baseDraft.language = nextLanguage;
    await window.settingsStudioApi.setLanguage(nextLanguage).catch(() => null);
    renderAll();
    setStatus('statusReady');
}

function onPresetFieldChange(eventOrTarget, options = {}) {
    const { updateUi = true } = options;
    const target = eventOrTarget?.target || eventOrTarget;
    if (!isDraftInputTarget(target)) return;
    const path = target.dataset?.path;
    if (!path || !state.draft) return;

    const value = readValueFromTarget(
        target,
        target.type === 'checkbox'
            ? 'boolean'
            : (target.type === 'number' ? 'number' : 'string')
    );
    if (value === undefined) return;

    const parts = path.split('.');
    const idx = parseInt(parts[1], 10);
    const key = parts[2];
    if (!isNaN(idx) && key && Array.isArray(state.draft.fixedPresets)) {
        state.draft.fixedPresets[idx][key] = value;
        if (updateUi) {
            updateChangeBadge();
            renderSidebar();
        }
    }
}

function syncRenderedFormDraft() {
    if (!state.draft) return;
    const fieldTargets = refs.formContent.querySelectorAll('input[data-path], textarea[data-path], select[data-path]');
    for (const target of fieldTargets) {
        if (target.closest('.preset-body')) {
            onPresetFieldChange(target, { updateUi: false });
            continue;
        }
        onFieldChange(target, { updateUi: false });
    }
}

async function onRestoreBackup(backupFileName) {
    if (!backupFileName) return;
    if (!window.confirm(t('restoreConfirm'))) return;
    setStatus('statusLoading');
    const response = await window.settingsStudioApi.restoreBackup(backupFileName);
    if (response?.ok && response.draft) {
        state.draft = deepClone(response.draft);
        state.baseDraft = deepClone(response.draft);
        state.validation = response?.validation || null;
        const listResponse = await window.settingsStudioApi.listBackups({}).catch(() => null);
        const backupsArr = Array.isArray(listResponse?.backups) ? listResponse.backups
            : (Array.isArray(listResponse) ? listResponse : null);
        if (backupsArr) state.backups = backupsArr;
        renderAll();
        setStatus('statusSaved');
    } else {
        state.validation = response?.validation || state.validation;
        setStatus('statusInvalid');
    }
}

function bindEvents() {
    const handleFormMutation = (event) => {
        if (event.target.dataset?.browserDemoGroup || event.target.dataset?.browserDemoCapability) {
            return onBrowserDemoPolicyChange(event);
        }
        if (event.target.dataset?.limitPath) return onLimitChange(event);
        if (event.target.closest('.preset-body')) return onPresetFieldChange(event);
        onFieldChange(event);
    };

    refs.formContent.addEventListener('input', handleFormMutation);
    refs.formContent.addEventListener('change', handleFormMutation);

    refs.formContent.addEventListener('click', (event) => {
        const resetBtn = event.target.closest('[data-action="reset-field"]');
        if (resetBtn) { onResetField(resetBtn); return; }

        const infoBtn = event.target.closest('[data-action="show-info"]');
        if (infoBtn) {
            const path = infoBtn.dataset?.path;
            if (path) showInfoPanel(path, infoBtn);
            return;
        }

        const restoreBtn = event.target.closest('[data-action="restore-backup"]');
        if (restoreBtn) {
            void onRestoreBackup(restoreBtn.dataset.backupFile).catch((err) => setStatus(`${t('statusError')}: ${err.message}`));
        }
    });

    // Info panel close
    refs.infoPanel?.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="close-info"]')) closeInfoPanel();
    });

    // Escape key closes info panel or modal
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (!refs.savePreviewModal?.hidden) {
                closeSavePreview();
                return;
            }
            if (!refs.infoPanel?.hidden) {
                closeInfoPanel();
            }
        }
    });

    refs.sidebarNav.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-nav-section]');
        if (btn) onNavSection(btn.dataset.navSection);
    });

    refs.resetSectionBtn.addEventListener('click', onResetSection);
    refs.resetAllBtn.addEventListener('click', onResetAll);

    refs.validateBtn.addEventListener('click', () => {
        void validateState().catch((err) => setStatus(`${t('statusError')}: ${err.message}`));
    });

    refs.saveBtn.addEventListener('click', () => {
        showSavePreview();
    });

    refs.savePreviewConfirm?.addEventListener('click', () => {
        closeSavePreview();
        void saveState().catch((err) => setStatus(`${t('statusError')}: ${err.message}`));
    });

    refs.savePreviewCancel?.addEventListener('click', () => {
        closeSavePreview();
    });

    refs.languageSelect.addEventListener('change', (event) => {
        void onLanguageChange(event).catch((err) => setStatus(`${t('statusError')}: ${err.message}`));
    });

    // Trap focus inside modal when open
    document.addEventListener('keydown', (event) => {
        if (refs.savePreviewModal?.hidden === false && event.key === 'Tab') {
            const focusable = refs.savePreviewModal.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
}

function isDraftDirty() {
    if (!state.draft || !state.baseDraft) return false;
    const mainDraftDirty = JSON.stringify(state.draft) !== JSON.stringify(state.baseDraft);
    const browserDemoDirty = JSON.stringify(state.browserDemoPolicyDraft || {}) !== JSON.stringify(state.browserDemoPolicyBaseDraft || {});
    return mainDraftDirty || browserDemoDirty;
}

function bootstrap() {
    renderStaticTexts();
    setStatus('statusReady');
    bindEvents();
    void loadState().catch((err) => setStatus(`${t('statusError')}: ${err.message}`));
}

bootstrap();
