import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
    createSettingsOverrideDraft,
    createSettingsOverrideFieldRegistry,
    validateSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';
import { createMenuEditorModel } from '../src/ui/menu/MenuEditorModel.js';
import { createMenuSchema } from '../src/ui/menu/MenuSchema.js';
import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';
import { MenuTextRuntime } from '../src/ui/menu/MenuTextRuntime.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    applyMenuEditorItemValue,
    captureMenuEditorFocus,
    countMenuPanelDirty,
    renderMenuEditor,
    resetMenuEditorItems,
    restoreMenuEditorFocus,
} from '../electron/settings-studio/ui/settings-studio-menu-renderer.js';
import { createTranslator } from '../electron/settings-studio/ui/settings-studio-i18n.js';

function createFixture() {
    const draft = createSettingsOverrideDraft();
    const baseDraft = structuredClone(draft);
    const model = createMenuEditorModel({
        fields: createSettingsOverrideFieldRegistry(),
        draft,
        textOverrides: {},
    });
    return { draft, baseDraft, model };
}

test('menu editor model contains every MenuSchema panel and registered field exactly once', () => {
    const { model } = createFixture();
    const schema = createMenuSchema();
    assert.deepEqual(
        model.panels.map((panel) => panel.id).sort(),
        schema.panels.map((panel) => panel.id).sort()
    );

    const expectedPaths = createSettingsOverrideFieldRegistry().map((field) => field.path);
    const actualPaths = model.items.filter((item) => item.kind === 'setting').map((item) => item.settingsPath);
    assert.equal(new Set(actualPaths).size, actualPaths.length);
    assert.deepEqual(actualPaths.sort(), expectedPaths.sort());
});

test('every editable caption has a known unique text ID and static menu IDs exist in the catalog', async () => {
    const { model } = createFixture();
    const editableTextItems = model.items.filter((item) => item.kind === 'text' && item.editable);
    editableTextItems.forEach((item) => assert.equal(
        Object.prototype.hasOwnProperty.call(MENU_TEXT_CATALOG, item.textId),
        true,
        item.textId
    ));

    const catalogSource = await fs.readFile(
        new URL('../src/ui/menu/MenuTextCatalog.js', import.meta.url),
        'utf8'
    );
    const declaredIds = Array.from(catalogSource.matchAll(/^\s*'([^']+)':/gmu), (match) => match[1]);
    assert.equal(new Set(declaredIds).size, declaredIds.length);

    const gameHtml = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
    const staticIds = Array.from(gameHtml.matchAll(/data-menu-text-id="([^"]+)"/gu), (match) => match[1]);
    staticIds.forEach((textId) => assert.equal(
        Object.prototype.hasOwnProperty.call(MENU_TEXT_CATALOG, textId),
        true,
        textId
    ));
});

test('dynamic menu copy resolves through the shared text contract', async () => {
    const files = [
        '../src/ui/menu/CameraPerspectiveUiSync.js',
        '../src/ui/menu/MenuSurfacePolicyUiSync.js',
        '../src/ui/arcade/ArcadeMenuSurface.js',
    ];
    for (const relativePath of files) {
        const source = await fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
        assert.match(source, /resolveMenu(?:CatalogText|Text)/u, relativePath);
        const referencedIds = Array.from(
            source.matchAll(/resolveMenu(?:CatalogText|Text)\(\s*['"](menu\.[a-z0-9_.-]+)['"]/giu),
            (match) => match[1]
        );
        referencedIds.forEach((textId) => assert.equal(
            Object.prototype.hasOwnProperty.call(MENU_TEXT_CATALOG, textId),
            true,
            `${relativePath}: ${textId}`
        ));
    }
});

test('menu editor renders typed controls and preview buttons contain no product actions', () => {
    const { draft, baseDraft, model } = createFixture();
    for (const fieldType of ['boolean', 'enum', 'number', 'string']) {
        const item = model.items.find((entry) => entry.kind === 'setting'
            && entry.editable
            && entry.fieldType === fieldType
            && (fieldType !== 'enum' || entry.options.length));
        assert.ok(item, `missing ${fieldType} item`);
        const html = renderMenuEditor({
            model,
            draft,
            baseDraft,
            textOverrides: {},
            baseTextOverrides: {},
            activePanelId: item.panelId,
            selectedItemId: item.id,
        });
        const expected = fieldType === 'boolean' ? 'type="checkbox"'
            : fieldType === 'enum' ? '<select'
                : fieldType === 'number' ? 'type="number"'
                    : 'type="text"';
        assert.match(html, new RegExp(expected));
        assert.doesNotMatch(html, /data-menu-action="(?:start|save|host|join|delete)/u);
    }
});

test('menu editor localizes its chrome and renders safe hierarchical navigation', () => {
    const { draft, baseDraft, model } = createFixture();
    const html = renderMenuEditor({
        model,
        draft,
        baseDraft,
        textOverrides: {},
        baseTextOverrides: {},
        activePanelId: model.panels[0].id,
        selectedItemId: '',
        previewRoot: true,
        language: 'en',
        t: createTranslator('en'),
    });

    assert.match(html, />Game Menu</u);
    assert.match(html, /aria-label="Menu navigation"/u);
    assert.match(html, /aria-label="Properties editor"/u);
    assert.match(html, /data-menu-preview-root/u);
    assert.match(html, /data-menu-preview-panel-id=/u);
    assert.doesNotMatch(html, /data-menu-action="reset-menu"/u);
    assert.doesNotMatch(html, />Eigenschaften</u);
});

test('menu editor search groups and highlights matches from every panel', () => {
    const { draft, baseDraft, model } = createFixture();
    const activePanel = model.panels[0];
    const remoteItem = model.items.find((item) => item.panelId !== activePanel.id
        && item.settingsPath);
    assert.ok(remoteItem);
    const query = remoteItem.settingsPath.split('.').at(-1);
    const html = renderMenuEditor({
        model,
        draft,
        baseDraft,
        textOverrides: {},
        baseTextOverrides: {},
        activePanelId: activePanel.id,
        selectedItemId: '',
        searchQuery: query,
        t: createTranslator('en'),
    });

    assert.match(html, /search result/u);
    assert.match(html, new RegExp(`data-menu-preview-panel-id="${remoteItem.panelId}"`, 'u'));
    assert.match(html, new RegExp(`data-menu-item-id="${remoteItem.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'u'));
    assert.match(html, /<mark>/u);
    assert.doesNotMatch(html, /<small>0<\/small>/u);
});

test('menu editor focus snapshot restores the active property input and selection', () => {
    const original = {
        dataset: { menuTextId: 'menu.level3.start.label' },
        selectionStart: 4,
        selectionEnd: 7,
    };
    const replacement = {
        dataset: { menuTextId: 'menu.level3.start.label' },
        focusCalled: false,
        selection: null,
        focus() {
            this.focusCalled = true;
        },
        setSelectionRange(start, end) {
            this.selection = [start, end];
        },
    };
    const root = {
        ownerDocument: { activeElement: original },
        contains: (entry) => entry === original,
        querySelectorAll: () => [replacement],
    };

    const snapshot = captureMenuEditorFocus(root);
    assert.deepEqual(snapshot, {
        identity: 'menuTextId',
        value: 'menu.level3.start.label',
        selectionStart: 4,
        selectionEnd: 7,
    });
    assert.equal(restoreMenuEditorFocus(root, snapshot), true);
    assert.equal(replacement.focusCalled, true);
    assert.deepEqual(replacement.selection, [4, 7]);
});

test('menu editor enforces values, dirty state, and single/panel/all reset operations', () => {
    const { draft, baseDraft, model } = createFixture();
    const numberItem = model.items.find((item) => item.kind === 'setting'
        && item.fieldType === 'number'
        && Number.isFinite(item.limits?.max));
    const enumItem = model.items.find((item) => item.fieldType === 'enum' && item.options.length);
    const textItem = model.items.find((item) => item.kind === 'text');
    const overrides = {};

    assert.equal(applyMenuEditorItemValue({
        draft,
        textOverrides: overrides,
        item: numberItem,
        value: numberItem.limits.max + 100,
    }), true);
    assert.equal(
        numberItem.settingsPath.split('.').reduce((value, key) => value?.[key], draft),
        numberItem.limits.max
    );
    assert.equal(applyMenuEditorItemValue({
        draft,
        textOverrides: overrides,
        item: enumItem,
        value: '__invalid__',
    }), false);
    const invalidDraft = structuredClone(draft);
    enumItem.settingsPath.split('.').reduce((cursor, key, index, segments) => {
        if (index === segments.length - 1) cursor[key] = '__invalid__';
        return cursor[key];
    }, invalidDraft);
    assert.equal(
        validateSettingsOverrideDraft(invalidDraft).errors.some((error) => error.code === 'FIELD_ENUM_INVALID'),
        true
    );
    assert.equal(applyMenuEditorItemValue({
        draft,
        textOverrides: overrides,
        item: textItem,
        value: 'Neue Beschriftung ',
    }), true);
    assert.equal(overrides[textItem.textId], 'Neue Beschriftung ');
    const spacedTextModel = createMenuEditorModel({
        fields: createSettingsOverrideFieldRegistry(),
        draft,
        textOverrides: overrides,
    });
    assert.equal(
        spacedTextModel.items.find((item) => item.id === textItem.id).activeTextOverride,
        'Neue Beschriftung '
    );

    const dirtyModel = createMenuEditorModel({
        fields: createSettingsOverrideFieldRegistry(),
        draft,
        textOverrides: overrides,
    });
    assert.ok(countMenuPanelDirty(
        dirtyModel,
        textItem.panelId,
        draft,
        baseDraft,
        overrides,
        {}
    ) > 0);

    resetMenuEditorItems({ draft, textOverrides: overrides, items: [textItem] });
    assert.equal(overrides[textItem.textId], undefined);
    resetMenuEditorItems({
        draft,
        textOverrides: overrides,
        items: dirtyModel.items.filter((item) => item.panelId === numberItem.panelId),
    });
    resetMenuEditorItems({ draft, textOverrides: overrides, items: dirtyModel.items });
    assert.equal(validateSettingsOverrideDraft(draft).valid, true);
});

test('desktop restart snapshot seeds the shared text store and runtime uses the saved caption', () => {
    const records = new Map();
    const storage = {
        getItem: (key) => records.get(key) ?? null,
        setItem: (key, value) => records.set(key, String(value)),
        removeItem: (key) => records.delete(key),
    };
    const textId = 'menu.level3.start.label';
    const runtimeGlobal = {
        curviosApp: {
            contracts: {
                settingsDefaults: {
                    getOverrideSnapshot: () => ({
                        draft: null,
                        menuTextOverrides: {
                            exists: true,
                            overrides: { [textId]: 'Desktop-Start' },
                        },
                    }),
                },
            },
        },
    };
    const manager = new SettingsManager({ runtimeGlobal, storage });
    const runtime = new MenuTextRuntime({ overridePort: manager.getMenuTextOverridePort() });

    assert.equal(manager.listMenuTextOverrides()[textId], 'Desktop-Start');
    assert.equal(runtime.resolveText(textId, {
        developerFeatureEnabled: true,
        developerModeEnabled: false,
    }), 'Desktop-Start');
});
