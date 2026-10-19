// The export dialog judged the map once, when it opened. An asset that finished loading or a
// scene edit while the dialog stayed open left its error list and the export button on that old
// result, so a fixed map stayed blocked and a newly broken one could still be exported.

import assert from 'node:assert/strict';
import test from 'node:test';

import { bindEditorSessionControls } from '../editor/js/ui/EditorSessionControls.js';

/** Stands for the DOM nodes the session controls touch: events, text, attributes, children. */
class FakeElement extends EventTarget {
    constructor() {
        super();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.value = '';
        this.textContent = '';
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.open = false;
    }

    append(...nodes) { this.children.push(...nodes); }

    appendChild(node) { this.children.push(node); return node; }

    replaceChildren(...nodes) { this.children = nodes.flatMap((node) => node.isFragment ? node.children : [node]); }

    removeAttribute() {}

    setAttribute() {}

    focus() {}

    showModal() { this.open = true; }

    close() { this.open = false; }
}

function installGlobals() {
    const previous = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
    globalThis.document = /** @type {any} */ ({
        createElement: () => new FakeElement(),
        createDocumentFragment: () => Object.assign(new FakeElement(), { isFragment: true }),
        getElementById: () => null,
    });
    // A desktop bridge whose map list never answers keeps the test away from fetch.
    globalThis.window = /** @type {any} */ ({ __CURVIOS_EDITOR_DISK__: {
        saveMap: () => new Promise(() => {}), listMaps: () => new Promise(() => {}), openMapsFolder: () => new Promise(() => {}),
    } });
    globalThis.localStorage = /** @type {any} */ ({ getItem: () => null, setItem() {} });
    return () => Object.assign(globalThis, previous);
}

const DOM_KEYS = ['exportDialog', 'exportForm', 'exportFormView', 'exportResultView', 'exportMapName', 'exportTarget',
    'exportConflictMode', 'exportConflictModeRow', 'exportKeyPreview', 'exportFilePreview', 'exportConflictNotice',
    'exportWarningAcknowledgeRow', 'exportWarningAcknowledge', 'btnExportConfirm', 'exportValidationList',
    'exportValidationSummary', 'btnSaveToGame'];

const MISSING_SPAWN = Object.freeze({ ok: false, severity: 'error', code: 'spawn', label: 'Spieler-Spawn fehlt' });
const LOW_RING = Object.freeze({ ok: false, severity: 'warning', code: 'ring', label: 'Checkpoint sehr tief' });

/**
 * Stands for the editor: renderWorkspaceValidation behaves like EditorWorkspaceControls'
 * renderValidation, which reports every new result through onWorkspaceValidated.
 */
function createEditor(initialItems) {
    const dom = Object.fromEntries(DOM_KEYS.map((key) => [key, new FakeElement()]));
    dom.exportTarget.value = 'install';
    dom.exportConflictMode.value = 'update';
    let items = initialItems;
    const editor = {
        dom,
        mapManager: { generateJSONExport: () => '{}', lastSchemaWarnings: [] },
        getArenaSizeForExport: () => ({ width: 400, height: 200, depth: 400 }),
        renderWorkspaceValidation() {
            editor.onWorkspaceValidated?.(items);
            return items;
        },
    };
    const revalidate = (next) => { items = next; editor.renderWorkspaceValidation(); };
    return { editor, dom, revalidate };
}

test('an open export dialog follows a validation that changes while it is open', () => {
    const restore = installGlobals();
    try {
        const { editor, dom, revalidate } = createEditor([MISSING_SPAWN]);
        bindEditorSessionControls(editor);
        dom.btnSaveToGame.dispatchEvent(new Event('click'));
        assert.equal(dom.exportDialog.open, true);
        assert.equal(dom.btnExportConfirm.disabled, true, 'a missing spawn blocks the export');

        // The spawn asset finished loading, or the author placed the spawn behind the dialog.
        revalidate([]);
        assert.equal(dom.exportValidationSummary.textContent, 'Map bereit', 'the dialog shows the new result');
        assert.equal(dom.btnExportConfirm.disabled, false, 'the fixed map can be exported');

        revalidate([MISSING_SPAWN]);
        assert.equal(dom.btnExportConfirm.disabled, true, 'a map broken again is blocked again');
    } finally {
        restore();
    }
});

test('a new warning in an open dialog asks for a fresh acknowledgement', () => {
    const restore = installGlobals();
    try {
        const { editor, dom, revalidate } = createEditor([]);
        bindEditorSessionControls(editor);
        dom.btnSaveToGame.dispatchEvent(new Event('click'));
        revalidate([LOW_RING]);
        assert.equal(dom.btnExportConfirm.disabled, true, 'an unacknowledged warning blocks the export');
        dom.exportWarningAcknowledge.checked = true;
        dom.exportWarningAcknowledge.dispatchEvent(new Event('change'));
        assert.equal(dom.btnExportConfirm.disabled, false);

        revalidate([LOW_RING]);
        assert.equal(dom.exportWarningAcknowledge.checked, true, 'the same warning stays acknowledged');
        revalidate([LOW_RING, { ...LOW_RING, code: 'portal', label: 'Portal ohne Partner' }]);
        assert.equal(dom.exportWarningAcknowledge.checked, false, 'a warning the author has not seen is not acknowledged');
        assert.equal(dom.btnExportConfirm.disabled, true);
    } finally {
        restore();
    }
});
