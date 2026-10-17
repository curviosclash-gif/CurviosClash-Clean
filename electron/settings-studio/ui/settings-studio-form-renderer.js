import { fieldPresentation, groupLabel } from './settings-studio-field-catalog.js';
import { categoryLabel, translateValidationError } from './settings-studio-i18n.js';
import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
} from '../../../src/shared/contracts/PlatformCapabilityData.js';
import { PLATFORM_CAPABILITY_IDS } from '../../../src/shared/contracts/PlatformCapabilityContract.js';

function readPath(obj, path) {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}

function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function toUniqueStringArray(values) {
    if (!Array.isArray(values)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    values.forEach((entry) => {
        const value = String(entry ?? '').trim().toLowerCase();
        if (!value || seen.has(value)) return;
        seen.add(value);
        normalized.push(value);
    });
    return normalized;
}

function resolveEffectiveSelection(baseValues, overrideValues) {
    const base = toUniqueStringArray(baseValues);
    if (!Array.isArray(overrideValues)) {
        return base;
    }
    const allowed = new Set(toUniqueStringArray(overrideValues));
    return base.filter((entry) => allowed.has(entry));
}

function formatTokenLabel(value) {
    return String(value || '')
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join('');
}

function resolveEnumLabel(prefix, value, t) {
    const key = `${prefix}${formatTokenLabel(value)}`;
    const label = t(key);
    return label !== key ? label : value;
}

function resolveCapabilityBaseEnabled(spec) {
    if (isPlainObject(spec)) {
        if (Object.prototype.hasOwnProperty.call(spec, 'enabled')) {
            return spec.enabled === true;
        }
        return String(spec.available || 'unavailable').toLowerCase() !== 'unavailable';
    }
    return String(spec || 'unavailable').toLowerCase() !== 'unavailable';
}

function renderPolicyCheckboxRow({
    group,
    value,
    checked,
    label,
    disabled = false,
    modePath = '',
}) {
    const modeAttr = modePath ? ` data-browser-demo-mode-path="${esc(modePath)}"` : '';
    const checkedAttr = checked ? ' checked' : '';
    const disabledAttr = disabled ? ' disabled' : '';
    return `<label class="browser-demo-checkbox"><input type="checkbox" data-browser-demo-group="${esc(group)}" data-browser-demo-value="${esc(value)}"${modeAttr}${checkedAttr}${disabledAttr} /><span>${esc(label)}</span></label>`;
}

function renderBrowserDemoPolicyGroup({ title, group, baseValues, selectedValues, t, labelPrefix }) {
    const selectedSet = new Set(selectedValues);
    const rows = baseValues.map((value) => renderPolicyCheckboxRow({
        group,
        value,
        checked: selectedSet.has(value),
        label: resolveEnumLabel(labelPrefix, value, t),
    }));
    return `<div class="browser-demo-group"><h4 class="browser-demo-group__title">${esc(title)}</h4><div class="browser-demo-checkbox-list">${rows.join('')}</div></div>`;
}

function renderBrowserDemoCapabilityGroup(baseCapabilities, draftCapabilityFlags, t) {
    const capabilities = Object.values(PLATFORM_CAPABILITY_IDS);
    const rows = capabilities.map((capabilityId) => {
        const baseEnabled = resolveCapabilityBaseEnabled(baseCapabilities[capabilityId]);
        const overrideEntry = isPlainObject(draftCapabilityFlags?.[capabilityId]) ? draftCapabilityFlags[capabilityId] : null;
        const checked = baseEnabled && overrideEntry?.enabled !== false;
        const label = t(`browserDemoCapability${formatTokenLabel(capabilityId)}`);
        const lockText = !baseEnabled ? `<small class="browser-demo-lock-note">${esc(t('browserDemoLockedByBase'))}</small>` : '';
        return `<label class="browser-demo-checkbox browser-demo-checkbox--capability">
            <input type="checkbox" data-browser-demo-capability="${esc(capabilityId)}" data-browser-demo-base-enabled="${baseEnabled ? 'true' : 'false'}" ${checked ? 'checked' : ''} ${baseEnabled ? '' : 'disabled'} />
            <span>${esc(label !== `browserDemoCapability${formatTokenLabel(capabilityId)}` ? label : capabilityId)}</span>
            ${lockText}
        </label>`;
    });
    return `<div class="browser-demo-group"><h4 class="browser-demo-group__title">${esc(t('browserDemoCapabilitySection'))}</h4><div class="browser-demo-checkbox-list">${rows.join('')}</div></div>`;
}

function renderBrowserDemoCuratedMapsGroup({
    baseModePaths,
    selectedModePaths,
    baseCuratedMaps,
    draftCuratedMaps,
    t,
}) {
    const selectedModeSet = new Set(selectedModePaths);
    const modeGroups = baseModePaths.map((modePath) => {
        const modeLabel = resolveEnumLabel('browserDemoModePath', modePath, t);
        const mapKeys = toUniqueStringArray(baseCuratedMaps?.[modePath]);
        if (!mapKeys.length) {
            return `<div class="browser-demo-group browser-demo-group--curated">
                <h4 class="browser-demo-group__title">${esc(t('browserDemoCuratedMapsLabel', modeLabel))}</h4>
                <p class="browser-demo-note">${esc(t('browserDemoNoCuratedMaps'))}</p>
            </div>`;
        }
        const selectedMapKeys = resolveEffectiveSelection(mapKeys, draftCuratedMaps?.[modePath]);
        const selectedSet = new Set(selectedMapKeys);
        const modeEnabled = selectedModeSet.has(modePath);
        const rows = mapKeys.map((mapKey) => renderPolicyCheckboxRow({
            group: 'curatedMapKeysByModePath',
            modePath,
            value: mapKey,
            checked: selectedSet.has(mapKey),
            disabled: !modeEnabled,
            label: mapKey,
        }));
        return `<div class="browser-demo-group browser-demo-group--curated">
            <h4 class="browser-demo-group__title">${esc(t('browserDemoCuratedMapsLabel', modeLabel))}</h4>
            <div class="browser-demo-checkbox-list">${rows.join('')}</div>
        </div>`;
    });
    return `<div class="browser-demo-card">
        <h3 class="browser-demo-card__title">${esc(t('browserDemoCuratedMapsSection'))}</h3>
        ${modeGroups.join('')}
    </div>`;
}

function renderBrowserDemoValidationSummary(validation, t) {
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];
    const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
    if (!errors.length && !warnings.length) {
        return '';
    }

    const errorItems = errors
        .map((entry) => `<span class="field-error">${esc(translateValidationError(entry, t))}</span>`)
        .join('');
    const warningItems = warnings
        .map((entry) => `<span class="field-error browser-demo-validation__warning">${esc(translateValidationError(entry, t))}</span>`)
        .join('');

    const errorBlock = errors.length
        ? `<div class="browser-demo-validation__block">
            <p class="browser-demo-validation__label">${esc(t('browserDemoValidationErrors'))}</p>
            <div class="field-error-list">${errorItems}</div>
        </div>`
        : '';
    const warningBlock = warnings.length
        ? `<div class="browser-demo-validation__block">
            <p class="browser-demo-validation__label">${esc(t('browserDemoValidationWarnings'))}</p>
            <div class="field-error-list">${warningItems}</div>
        </div>`
        : '';

    return `<div class="browser-demo-validation">
        <p class="browser-demo-validation__title">${esc(t('browserDemoValidationTitle'))}</p>
        ${errorBlock}
        ${warningBlock}
    </div>`;
}

function isDirty(draft, baseDraft, path) {
    const a = readPath(draft, path);
    const b = readPath(baseDraft, path);
    if (a === b) return false;
    if (typeof a === 'object' || typeof b === 'object') {
        return JSON.stringify(a) !== JSON.stringify(b);
    }
    return true;
}

function resolveFieldLimits(field, draft) {
    if (!field || field.type !== 'number') return field?.limits || null;
    const fallback = field.limits && typeof field.limits === 'object' ? field.limits : null;
    const override = draft?.limitOverrides?.[field.path];
    if (!override || typeof override !== 'object') {
        return fallback;
    }
    return {
        ...fallback,
        ...override,
    };
}

function renderFieldInput(field, value, dirty, resolvedLimits = null) {
    const { path, type } = field;
    const limits = resolvedLimits;
    const dirtyAttr = dirty ? 'data-dirty="true"' : '';

    if (type === 'boolean') {
        const checked = value ? 'checked' : '';
        return `<input class="field-input field-input--check" type="checkbox" data-path="${esc(path)}" data-type="boolean" ${checked} ${dirtyAttr} />`;
    }

    if (type === 'number' && !field.options?.length) {
        const min = limits?.min != null ? `min="${esc(limits.min)}"` : '';
        const max = limits?.max != null ? `max="${esc(limits.max)}"` : '';
        const step = limits?.step != null ? `step="${esc(limits.step)}"` : 'step="any"';
        if (field.control === 'range') {
            return `<span class="field-range"><input class="field-input field-input--range" type="range" data-path="${esc(path)}" data-type="number" value="${esc(value ?? '')}" ${min} ${max} ${step} ${dirtyAttr} /><output data-range-output="${esc(path)}">${esc(value ?? '')}</output></span>`;
        }
        return `<input class="field-input" type="number" data-path="${esc(path)}" data-type="number" value="${esc(value ?? '')}" ${min} ${max} ${step} ${dirtyAttr} />`;
    }

    if (Array.isArray(field.options) && field.options.length) {
        const options = field.options.includes(value) ? field.options : [value, ...field.options];
        return `<select class="field-input" data-path="${esc(path)}" data-type="${esc(type)}">${options.map((option) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
    }

    if (type === 'string') {
        return `<input class="field-input" type="text" data-path="${esc(path)}" data-type="string" value="${esc(value ?? '')}" ${dirtyAttr} />`;
    }

    const jsonValue = value != null ? JSON.stringify(value, null, 2) : '';
    return `<textarea class="field-input field-input--textarea" data-path="${esc(path)}" data-type="json" ${dirtyAttr}>${esc(jsonValue)}</textarea>`;
}

function renderFieldError(fieldErrors, t) {
    if (!fieldErrors || !fieldErrors.length) return '';
    const messages = fieldErrors.map((e) => `<span class="field-error">${esc(translateValidationError(e, t))}</span>`).join('');
    return `<div class="field-error-list">${messages}</div>`;
}

function renderFieldRow(field, draft, baseDraft, t, validationErrors) {
    const value = readPath(draft, field.path);
    const dirty = isDirty(draft, baseDraft, field.path);
    const resolvedLimits = resolveFieldLimits(field, draft);
    const fieldErrors = Array.isArray(validationErrors)
        ? validationErrors.filter((e) => e.path === field.path)
        : [];
    const hasError = fieldErrors.length > 0;
    const presentation = fieldPresentation(field, t.language);
    const label = presentation.label;
    const inputId = `studio-${encodeURIComponent(field.path)}`;
    const errorId = `${inputId}-error`;
    const helpId = `${inputId}-help`;
    const input = renderFieldInput(field, value, dirty, resolvedLimits).replace(/<(input|select|textarea)\b/, `$& id="${inputId}" aria-describedby="${helpId} ${errorId}" aria-invalid="${hasError}"`);
    const riskClass = field.riskLevel === 'high' ? ' field-row--risk-high' : '';
    const classes = ['field-row', dirty ? 'dirty' : '', hasError ? 'has-error' : ''].filter(Boolean).join(' ') + riskClass;
    const resetBtn = `<button class="field-reset-btn" data-action="reset-field" data-path="${esc(field.path)}" ${dirty ? 'data-dirty="true"' : ''} aria-label="${esc(label)} zurücksetzen">${t('buttonResetField')}</button>`;
    const infoBtn = `<button class="field-info-btn" data-action="show-info" data-path="${esc(field.path)}" type="button" aria-label="${esc(label)} - Informationen anzeigen" tabindex="0">${t('buttonInfo')}</button>`;
    const errorHtml = renderFieldError(fieldErrors, t);
    return `<div class="${classes}" data-field-category="${esc(presentation.category)}"><div class="field-description"><label class="field-label" for="${inputId}">${esc(label)}</label><p id="${helpId}" class="field-help">${esc(presentation.help)}</p><details class="field-source"><summary>${t('fieldCompare')}</summary><small>${t('fieldProduct')}: ${esc(JSON.stringify(field.defaultValue))} · ${t('fieldSaved')}: ${esc(JSON.stringify(readPath(baseDraft, field.path)))}<br>${esc(field.path)}</small></details></div><div class="field-control">${input}${presentation.unit ? `<span class="field-unit">${esc(presentation.unit)}</span>` : ''}${resolvedLimits ? `<small class="field-bounds">${esc(resolvedLimits.min ?? '–')} … ${esc(resolvedLimits.max ?? '–')} · ${t('limitsColStep')}: ${esc(resolvedLimits.step ?? '–')}</small>` : ''}</div>${resetBtn}${infoBtn}<div id="${errorId}" class="field-feedback">${errorHtml}</div></div>`;
}

function renderFieldGroup(category, fields, draft, baseDraft, t, validationErrors) {
    const rows = fields.map((f) => renderFieldRow(f, draft, baseDraft, t, validationErrors)).join('');
    const title = groupLabel(category, t.language, categoryLabel(category, t));
    return `<div class="field-group"><h3 class="field-group__title">${esc(title)}</h3>${rows}</div>`;
}

export function renderSectionForm(sectionKey, schema, draft, baseDraft, t, validationErrors) {
    const fields = Array.isArray(schema?.fields)
        ? schema.fields.filter((f) => f.section === sectionKey)
        : [];

    if (!fields.length) {
        const sectionValue = draft ? draft[sectionKey] : null;
        if (sectionValue != null) {
            const jsonStr = JSON.stringify(sectionValue, null, 2);
            const dirty = isDirty(draft, baseDraft, sectionKey);
            const dirtyAttr = dirty ? 'data-dirty="true"' : '';
            return `<div class="field-group"><textarea class="field-input field-input--textarea"  data-path="${esc(sectionKey)}" data-type="json" ${dirtyAttr}>${esc(jsonStr)}</textarea></div>`;
        }
        return `<div class="field-group"><em>${esc(t('noFields'))}</em></div>`;
    }

    const groups = new Map();
    for (const field of fields) {
        const cat = fieldPresentation(field, t.language).category || sectionKey;
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(field);
    }

    return [...groups.entries()].sort(([a], [b]) => { const order = ['match','flight','weapons','trails','players','botBridge','botHeuristicTuning','cameraPerspective','graphics','audio','hud','controls','hunt','arcade','recording','technical']; return order.indexOf(a) - order.indexOf(b); })
        .map(([cat, catFields]) => renderFieldGroup(cat, catFields, draft, baseDraft, t, validationErrors))
        .join('');
}

export function renderPresetsSection(draft, baseDraft, t, schema = null, validationErrors = []) {
    const presets = Array.isArray(draft?.fixedPresets) ? draft.fixedPresets : [];
    const basePresets = baseDraft?.fixedPresets || [];
    return `<div class="preset-list">${presets.map((preset, idx) => {
        const title = preset.name || preset.id;
        const properties = ['id', 'name', 'description'].map((key) => `<label class="preset-property">${t(`preset${key}`)}<input class="field-input" data-path="fixedPresets.${idx}.${key}" data-type="string" value="${esc(preset[key] || '')}"></label>`).join('');
        const values = Object.entries(preset.values || {}).map(([key, value]) => {
            const descriptor = schema?.fields?.find((field) => field.path === (key.startsWith('localSettings.') ? key : `baseSettings.${key}`));
            const field = { ...(descriptor || {}), path: `fixedPresets.${idx}.values.${key}`, type: descriptor?.type || typeof value, defaultValue: basePresets[idx]?.values?.[key] ?? value };
            const meta = fieldPresentation({ ...field, path: descriptor?.path || key }, t.language);
            const label = meta.label;
            const errors = validationErrors.filter((error) => error.path === field.path);
            const input = renderFieldInput(field, value, false, descriptor?.limits).replace(/<(input|select|textarea)\b/, `$& aria-invalid="${errors.length > 0}"`);
            return `<div class="preset-field-row"><label class="field-label" for="preset-${idx}-${esc(key)}">${esc(label)}<small>${esc(key)}</small></label>${input.replace(/<(input|select|textarea)\b/, `$& id="preset-${idx}-${esc(key)}"`)}<label class="preset-lock"><input type="checkbox" data-path="fixedPresets.${idx}.lockedFields" data-preset-lock-key="${esc(key)}" ${(preset.lockedFields || []).includes(key) ? 'checked' : ''}>${t('presetLocked')}</label>${renderFieldError(errors, t)}</div>`;
        }).join('');
        return `<section class="preset-item ${JSON.stringify(preset) !== JSON.stringify(basePresets[idx]) ? 'dirty' : ''}"><header class="preset-header"><h3>${esc(title)}</h3><button class="btn" type="button" data-action="duplicate-preset" data-preset-index="${idx}">${t('presetDuplicate')}</button></header><div class="preset-body">${renderFieldError(validationErrors.filter((error) => error.path === `fixedPresets.${idx}` || error.path === `fixedPresets.${idx}.lockedFields`), t)}${properties}<h4>${t('presetRules')}</h4>${values}</div></section>`;
    }).join('')}</div>`;
}

export function renderLimitsSection(schema, draft, baseDraft, t, validationErrors = []) {
    const fields = Array.isArray(schema?.fields)
        ? schema.fields.filter((f) => f.type === 'number')
        : [];

    if (!fields.length) return '<em>Keine numerischen Felder.</em>';

    const overrides = draft?.limitOverrides || {};
    const baseOverrides = baseDraft?.limitOverrides || {};

    const rows = fields.map((field) => {
        const override = overrides[field.path] || {};
        const baseOverride = baseOverrides[field.path] || {};
        const def = field.limits || {};

        const activeMin = override.min != null ? override.min : (def.min ?? '');
        const activeMax = override.max != null ? override.max : (def.max ?? '');
        const activeStep = override.step != null ? override.step : (def.step ?? '');

        const dirty = JSON.stringify(override) !== JSON.stringify(baseOverride);
        const errors = validationErrors.filter((entry) => entry.path === field.path || entry.path.startsWith(`${field.path}.`));
        const rowClass = `${dirty ? 'dirty' : ''} ${errors.length ? 'has-error' : ''}`;

        const minInput = `<input class="limits-input" type="number" step="any" data-limit-path="${esc(field.path)}" aria-label="${esc(fieldPresentation(field, t.language).label)} – min" aria-invalid="${errors.length > 0}" data-limit-key="min" value="${esc(activeMin)}" />`;
        const maxInput = `<input class="limits-input" type="number" step="any" data-limit-path="${esc(field.path)}" aria-label="${esc(fieldPresentation(field, t.language).label)} – max" aria-invalid="${errors.length > 0}" data-limit-key="max" value="${esc(activeMax)}" />`;
        const stepInput = `<input class="limits-input" type="number" step="any" min="0" data-limit-path="${esc(field.path)}" aria-label="${esc(fieldPresentation(field, t.language).label)} – step" aria-invalid="${errors.length > 0}" data-limit-key="step" value="${esc(activeStep)}" />`;

        const defStr = `${def.min ?? '?'} / ${def.max ?? '?'} / ${def.step ?? '?'}`;
        return `<tr class="${rowClass}"><td title="${esc(field.path)}">${esc(fieldPresentation(field, t.language).label)}</td><td><small class="muted-text">${esc(defStr)}</small></td><td>${minInput}</td><td>${maxInput}</td><td>${stepInput}</td></tr>`;
    });

    return `<table class="limits-table"><thead><tr><th>${t('limitsColField')}</th><th>${t('limitsColDefault')}</th><th>${t('limitsColMin')}</th><th>${t('limitsColMax')}</th><th>${t('limitsColStep')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function renderBrowserDemoPolicySection(browserDemoDraft, t, validation = null) {
    const browserProduct = PLATFORM_CAPABILITY_REGISTRY?.products?.[PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO] || {};
    const basePolicy = isPlainObject(browserProduct.surfacePolicy) ? browserProduct.surfacePolicy : {};
    const baseCapabilities = isPlainObject(browserProduct.capabilities) ? browserProduct.capabilities : {};
    const draftPolicy = isPlainObject(browserDemoDraft?.policy) ? browserDemoDraft.policy : {};
    const draftCapabilityFlags = isPlainObject(browserDemoDraft?.capabilityFlags) ? browserDemoDraft.capabilityFlags : {};

    const sessionTypes = toUniqueStringArray(basePolicy.allowedSessionTypes);
    const modePaths = toUniqueStringArray(basePolicy.allowedModePaths);
    const presetIds = toUniqueStringArray(basePolicy.allowedPresetIds);
    const allowedTransports = toUniqueStringArray(basePolicy.allowedMultiplayerTransports);
    const hostTransportsBase = toUniqueStringArray(basePolicy.hostMultiplayerTransports)
        .filter((transport) => allowedTransports.includes(transport));
    const joinTransportsBase = toUniqueStringArray(basePolicy.joinMultiplayerTransports)
        .filter((transport) => allowedTransports.includes(transport));

    const selectedSessionTypes = resolveEffectiveSelection(sessionTypes, draftPolicy.allowedSessionTypes);
    const selectedModePaths = resolveEffectiveSelection(modePaths, draftPolicy.allowedModePaths);
    const selectedPresetIds = resolveEffectiveSelection(presetIds, draftPolicy.allowedPresetIds);
    const selectedAllowedTransports = resolveEffectiveSelection(allowedTransports, draftPolicy.allowedMultiplayerTransports);

    const hostBaseWithinAllowed = hostTransportsBase.filter((transport) => selectedAllowedTransports.includes(transport));
    const joinBaseWithinAllowed = joinTransportsBase.filter((transport) => selectedAllowedTransports.includes(transport));
    const selectedHostTransports = resolveEffectiveSelection(hostBaseWithinAllowed, draftPolicy.hostMultiplayerTransports);
    const selectedJoinTransports = resolveEffectiveSelection(joinBaseWithinAllowed, draftPolicy.joinMultiplayerTransports);

    const policyGroups = [
        renderBrowserDemoPolicyGroup({
            title: t('browserDemoSessionTypesLabel'),
            group: 'allowedSessionTypes',
            baseValues: sessionTypes,
            selectedValues: selectedSessionTypes,
            t,
            labelPrefix: 'browserDemoSessionType',
        }),
        renderBrowserDemoPolicyGroup({
            title: t('browserDemoModePathsLabel'),
            group: 'allowedModePaths',
            baseValues: modePaths,
            selectedValues: selectedModePaths,
            t,
            labelPrefix: 'browserDemoModePath',
        }),
        renderBrowserDemoPolicyGroup({
            title: t('browserDemoPresetIdsLabel'),
            group: 'allowedPresetIds',
            baseValues: presetIds,
            selectedValues: selectedPresetIds,
            t,
            labelPrefix: 'browserDemoPresetId',
        }),
        renderBrowserDemoPolicyGroup({
            title: t('browserDemoAllowedTransportsLabel'),
            group: 'allowedMultiplayerTransports',
            baseValues: allowedTransports,
            selectedValues: selectedAllowedTransports,
            t,
            labelPrefix: 'browserDemoTransport',
        }),
        renderBrowserDemoPolicyGroup({
            title: t('browserDemoHostTransportsLabel'),
            group: 'hostMultiplayerTransports',
            baseValues: hostBaseWithinAllowed,
            selectedValues: selectedHostTransports,
            t,
            labelPrefix: 'browserDemoTransport',
        }),
        renderBrowserDemoPolicyGroup({
            title: t('browserDemoJoinTransportsLabel'),
            group: 'joinMultiplayerTransports',
            baseValues: joinBaseWithinAllowed,
            selectedValues: selectedJoinTransports,
            t,
            labelPrefix: 'browserDemoTransport',
        }),
    ];

    const curatedMaps = renderBrowserDemoCuratedMapsGroup({
        baseModePaths: modePaths,
        selectedModePaths,
        baseCuratedMaps: basePolicy.curatedMapKeysByModePath,
        draftCuratedMaps: draftPolicy.curatedMapKeysByModePath,
        t,
    });
    const validationSummary = renderBrowserDemoValidationSummary(validation, t);

    return `<div class="browser-demo-editor">
        <div class="browser-demo-note browser-demo-note--guardrail">${esc(t('browserDemoGuardrailNote'))}</div>
        <div class="browser-demo-note">${esc(t('browserDemoConstraintNote'))}</div>
        ${validationSummary}
        <div class="browser-demo-card">
            <h3 class="browser-demo-card__title">${esc(t('browserDemoPolicySection'))}</h3>
            ${policyGroups.join('')}
        </div>
        ${renderBrowserDemoCapabilityGroup(baseCapabilities, draftCapabilityFlags, t)}
        ${curatedMaps}
    </div>`;
}

export function countSectionDirtyFields(sectionKey, schema, draft, baseDraft) {
    if (sectionKey === 'limits') {
        const overrides = draft?.limitOverrides || {};
        const baseOverrides = baseDraft?.limitOverrides || {};
        return Object.keys(overrides).filter(
            (k) => JSON.stringify(overrides[k]) !== JSON.stringify(baseOverrides[k])
        ).length;
    }
    if (sectionKey === 'fixedPresets') {
        const a = draft?.fixedPresets;
        const b = baseDraft?.fixedPresets;
        return JSON.stringify(a) !== JSON.stringify(b) ? 1 : 0;
    }
    const fields = Array.isArray(schema?.fields)
        ? schema.fields.filter((f) => f.section === sectionKey)
        : [];
    if (!fields.length) {
        return isDirty(draft, baseDraft, sectionKey) ? 1 : 0;
    }
    return fields.filter((f) => isDirty(draft, baseDraft, f.path)).length;
}
