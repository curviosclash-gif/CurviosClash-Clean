import {
    SETTINGS_FIELD_NORMALIZERS,
    getSettingsFieldDescriptorForOverridePath,
} from '../SettingsFieldRegistry.js';
import { createMenuSchema } from './MenuSchema.js';
import { MENU_TEXT_CATALOG } from './MenuTextCatalog.js';

export const MENU_EDITOR_MODEL_VERSION = 'menu-editor-model.v1';

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readPath(source, path) {
    let cursor = source;
    for (const segment of String(path || '').split('.')) {
        if (!cursor || typeof cursor !== 'object'
            || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
            return undefined;
        }
        cursor = cursor[segment];
    }
    return cursor;
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

function equal(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function formatPathLabel(path) {
    const leaf = String(path || '').split('.').at(-1) || String(path || '');
    return leaf
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/^./, (character) => character.toUpperCase());
}

function findRuntimeFieldDescriptor(path) {
    return getSettingsFieldDescriptorForOverridePath(path);
}

function findPanelIdBySemanticId(schema, semanticId, fallbackId) {
    return schema.panels.find((panel) => panel.semanticId === semanticId)?.id
        || schema.panels.find((panel) => panel.id === fallbackId)?.id
        || schema.panels[0]?.id
        || '';
}

function resolveTextPanelId(textId, schema) {
    if (textId.startsWith('menu.level2.') || textId.startsWith('menu.arcade.')) {
        return findPanelIdBySemanticId(schema, 'path', 'submenu-custom');
    }
    if (textId.startsWith('menu.level1.') || textId.startsWith('menu.brand.')) {
        return findPanelIdBySemanticId(schema, 'session_type', 'main-menu');
    }
    if (textId.startsWith('menu.level3.')) {
        return findPanelIdBySemanticId(schema, 'start_setup', 'submenu-game');
    }
    if (textId.startsWith('menu.multiplayer.')) {
        return findPanelIdBySemanticId(schema, 'multiplayer', 'submenu-multiplayer');
    }
    if (textId.startsWith('menu.level4.controls.')) {
        return findPanelIdBySemanticId(schema, 'controls', 'submenu-controls');
    }
    if (textId.startsWith('menu.level4.tools.')) {
        return findPanelIdBySemanticId(schema, 'profiles', 'submenu-profiles');
    }
    if (textId.startsWith('menu.level4.advanced_map.') || textId.startsWith('menu.tools.')) {
        return findPanelIdBySemanticId(schema, 'portals', 'submenu-portals');
    }
    if (textId.startsWith('menu.developer.') || textId.startsWith('menu.debug.')
        || textId.startsWith('menu.panels.expert.')) {
        return findPanelIdBySemanticId(schema, 'expert', 'submenu-expert');
    }
    if (textId.startsWith('menu.panels.controls.')) {
        return findPanelIdBySemanticId(schema, 'controls', 'submenu-controls');
    }
    if (textId.startsWith('menu.panels.profiles.')) {
        return findPanelIdBySemanticId(schema, 'profiles', 'submenu-profiles');
    }
    if (textId.startsWith('menu.panels.portals.')) {
        return findPanelIdBySemanticId(schema, 'portals', 'submenu-portals');
    }
    return findPanelIdBySemanticId(schema, 'settings', 'submenu-settings');
}

function resolveSettingsPanelId(field, schema) {
    const path = String(field.path || '');
    if (path.startsWith('fixedPresets.')) {
        return findPanelIdBySemanticId(schema, 'profiles', 'submenu-profiles');
    }
    if (path.startsWith('configShare.') || path.includes('.portal') || path.includes('.planar')) {
        return findPanelIdBySemanticId(schema, 'portals', 'submenu-portals');
    }
    if (path.includes('.controls.') || path.includes('.mouseSteering') || path.includes('.gamepadVibration')
        || path.includes('.invertPitch') || path.includes('.mobileControls.')) {
        return findPanelIdBySemanticId(schema, 'controls', 'submenu-controls');
    }
    if (path.startsWith('localSettings.') || field.category === 'recording'
        || field.category === 'cameraPerspective') {
        return findPanelIdBySemanticId(schema, 'settings', 'submenu-settings');
    }
    return findPanelIdBySemanticId(schema, 'start_setup', 'submenu-game');
}

function createTextItem(textId, defaultText, overrides, schema, order) {
    const rawOverride = String(overrides?.[textId] || '');
    const activeOverride = rawOverride.trim() ? rawOverride : '';
    return Object.freeze({
        id: `text:${textId}`,
        kind: 'text',
        panelId: resolveTextPanelId(textId, schema),
        parentId: resolveTextPanelId(textId, schema),
        order,
        textId,
        defaultLabel: defaultText,
        activeTextOverride: activeOverride,
        effectiveLabel: activeOverride || defaultText,
        settingsPath: null,
        fieldType: 'string',
        defaultValue: defaultText,
        currentOverride: activeOverride || null,
        effectiveValue: activeOverride || defaultText,
        options: [],
        limits: null,
        help: null,
        riskLevel: 'low',
        editable: true,
        visibility: 'visible',
    });
}

function createSettingsItem(field, draft, schema, order) {
    const descriptor = findRuntimeFieldDescriptor(field.path);
    const currentValue = readPath(draft, field.path);
    const defaultValue = clone(field.defaultValue);
    const normalizer = descriptor?.normalizer || null;
    const fieldType = normalizer === SETTINGS_FIELD_NORMALIZERS.ENUM
        ? 'enum'
        : field.type;
    const panelId = resolveSettingsPanelId(field, schema);
    const label = formatPathLabel(field.path);
    const limitOverride = field.type === 'number' && draft?.limitOverrides?.[field.path]
        ? draft.limitOverrides[field.path]
        : {};
    const productLimits = field.type === 'number' ? (field.limits || {}) : {};
    const valueRange = field.type === 'number' && field.limits
        ? Object.freeze({
            product: Object.freeze({
                default: defaultValue,
                min: productLimits.min ?? null,
                max: productLimits.max ?? null,
                step: productLimits.step ?? null,
            }),
            override: Object.freeze({
                default: equal(currentValue, defaultValue) ? null : clone(currentValue),
                min: Object.prototype.hasOwnProperty.call(limitOverride, 'min') ? limitOverride.min : null,
                max: Object.prototype.hasOwnProperty.call(limitOverride, 'max') ? limitOverride.max : null,
                step: Object.prototype.hasOwnProperty.call(limitOverride, 'step') ? limitOverride.step : null,
            }),
            effective: Object.freeze({
                default: clone(currentValue === undefined ? defaultValue : currentValue),
                min: limitOverride.min ?? productLimits.min ?? null,
                max: limitOverride.max ?? productLimits.max ?? null,
                step: limitOverride.step ?? productLimits.step ?? null,
            }),
            integer: productLimits.integer === true,
        })
        : null;
    return Object.freeze({
        id: `setting:${field.path}`,
        kind: 'setting',
        panelId,
        parentId: panelId,
        order,
        textId: null,
        defaultLabel: label,
        activeTextOverride: '',
        effectiveLabel: label,
        settingsPath: field.path,
        fieldType,
        defaultValue,
        currentOverride: equal(currentValue, defaultValue) ? null : clone(currentValue),
        effectiveValue: clone(currentValue === undefined ? defaultValue : currentValue),
        options: clone(field.options || descriptor?.options || []),
        limits: clone(field.limits),
        valueRange,
        help: clone(field.help),
        riskLevel: field.riskLevel || 'low',
        editable: ['boolean', 'enum', 'number', 'string'].includes(fieldType),
        visibility: 'visible',
    });
}

function createRangeError(component, code) {
    return Object.freeze({ component, code });
}

export function validateMenuEditorNumericRange(range) {
    const errors = [];
    if (!range) return errors;
    const { default: defaultValue, min, max, step } = range.effective || {};
    if (!Number.isFinite(min)) errors.push(createRangeError('min', 'LIMIT_MIN_INVALID'));
    if (!Number.isFinite(max)) errors.push(createRangeError('max', 'LIMIT_MAX_INVALID'));
    if (!Number.isFinite(step)) errors.push(createRangeError('step', 'LIMIT_STEP_INVALID'));
    if (Number.isFinite(step) && step <= 0) {
        errors.push(createRangeError('step', 'LIMIT_STEP_NON_POSITIVE'));
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        errors.push(createRangeError('min', 'LIMIT_RANGE_INVALID'));
        errors.push(createRangeError('max', 'LIMIT_RANGE_INVALID'));
    }
    if (!Number.isFinite(defaultValue)) {
        errors.push(createRangeError('default', 'FIELD_NUMBER_INVALID'));
    } else {
        if (Number.isFinite(min) && defaultValue < min) {
            errors.push(createRangeError('default', 'FIELD_NUMBER_BELOW_MIN'));
        }
        if (Number.isFinite(max) && defaultValue > max) {
            errors.push(createRangeError('default', 'FIELD_NUMBER_ABOVE_MAX'));
        }
        if (Number.isFinite(min) && Number.isFinite(step) && step > 0) {
            const steps = (defaultValue - min) / step;
            if (Math.abs(steps - Math.round(steps)) > 1e-6) {
                errors.push(createRangeError('default', 'FIELD_NUMBER_STEP_MISALIGN'));
            }
        }
    }
    if (range.integer) {
        for (const component of ['default', 'min', 'max', 'step']) {
            if (Number.isFinite(range.effective?.[component])
                && !Number.isInteger(range.effective[component])) {
                errors.push(createRangeError(
                    component,
                    component === 'default' ? 'FIELD_INTEGER_REQUIRED' : 'LIMIT_INTEGER_REQUIRED'
                ));
            }
        }
    }
    return errors;
}

export function applyMenuEditorNumericRangeValue({ draft, item, component, value }) {
    if (!draft || item?.fieldType !== 'number' || !item.valueRange
        || !['default', 'min', 'max', 'step'].includes(component)) {
        return { valid: false, errors: [createRangeError(component, 'FIELD_NUMBER_INVALID')] };
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return {
            valid: false,
            errors: [createRangeError(
                component,
                component === 'default'
                    ? 'FIELD_NUMBER_INVALID'
                    : `LIMIT_${component.toUpperCase()}_INVALID`
            )],
        };
    }
    const effective = { ...item.valueRange.effective, [component]: numericValue };
    const errors = validateMenuEditorNumericRange({ ...item.valueRange, effective });
    if (errors.length) return { valid: false, errors };

    if (component === 'default') {
        writePath(draft, item.settingsPath, numericValue);
    } else {
        if (!draft.limitOverrides || typeof draft.limitOverrides !== 'object') {
            draft.limitOverrides = {};
        }
        const productValue = item.valueRange.product[component];
        if (numericValue === productValue) {
            delete draft.limitOverrides[item.settingsPath]?.[component];
        } else {
            if (!draft.limitOverrides[item.settingsPath]) draft.limitOverrides[item.settingsPath] = {};
            draft.limitOverrides[item.settingsPath][component] = numericValue;
        }
        if (draft.limitOverrides[item.settingsPath]
            && !Object.keys(draft.limitOverrides[item.settingsPath]).length) {
            delete draft.limitOverrides[item.settingsPath];
        }
    }
    return { valid: true, errors: [] };
}

export function resetMenuEditorNumericRangeComponent({ draft, item, component }) {
    if (!draft || item?.fieldType !== 'number' || !item.valueRange) return false;
    if (component === 'default') {
        writePath(draft, item.settingsPath, clone(item.valueRange.product.default));
        return true;
    }
    if (component === 'range') {
        if (draft.limitOverrides) delete draft.limitOverrides[item.settingsPath];
        return true;
    }
    if (!['min', 'max', 'step'].includes(component)) return false;
    if (draft.limitOverrides?.[item.settingsPath]) {
        delete draft.limitOverrides[item.settingsPath][component];
        if (!Object.keys(draft.limitOverrides[item.settingsPath]).length) {
            delete draft.limitOverrides[item.settingsPath];
        }
    }
    return true;
}

export function createMenuEditorModel(options = {}) {
    const schema = options.menuSchema || createMenuSchema(options);
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const draft = options.draft && typeof options.draft === 'object' ? options.draft : {};
    const textOverrides = options.textOverrides && typeof options.textOverrides === 'object'
        ? options.textOverrides
        : {};
    const textItems = Object.entries(MENU_TEXT_CATALOG)
        .map(([textId, defaultText], index) => createTextItem(textId, defaultText, textOverrides, schema, index));
    const settingsItems = fields.map((field, index) => (
        createSettingsItem(field, draft, schema, textItems.length + index)
    ));
    const items = Object.freeze([...textItems, ...settingsItems]);
    const panels = Object.freeze(
        schema.panels
            .slice()
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
            .map((panel) => {
                const defaultLabel = MENU_TEXT_CATALOG[panel.textId] || panel.label;
                const rawOverride = String(textOverrides?.[panel.textId] || '');
                const activeOverride = rawOverride.trim() ? rawOverride : '';
                const panelItems = items.filter((item) => item.panelId === panel.id);
                return Object.freeze({
                    id: panel.id,
                    semanticId: panel.semanticId,
                    parentId: 'game-menu',
                    order: panel.order,
                    textId: panel.textId || null,
                    defaultLabel,
                    activeTextOverride: activeOverride,
                    effectiveLabel: activeOverride || defaultLabel,
                    visibility: panel.visibility,
                    editable: false,
                    itemIds: Object.freeze(panelItems.map((item) => item.id)),
                });
            })
    );

    return Object.freeze({
        contractVersion: MENU_EDITOR_MODEL_VERSION,
        schemaVersion: schema.schemaVersion,
        root: Object.freeze({
            id: 'game-menu',
            parentId: null,
            order: 0,
            effectiveLabel: 'Spielmenü',
            visibility: 'visible',
            editable: false,
        }),
        panels,
        items,
    });
}
