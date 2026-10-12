// Cancelling the confirm dialog must keep the author's map. The editor dialog resolves null on
// Cancel, Escape or a click beside it, not false.

import assert from 'node:assert/strict';
import test from 'node:test';

import { bindEditorBackdropControls } from '../editor/js/ui/EditorBackdropControls.js';

function createEditorStub(confirmResult) {
    const calls = { mutations: 0, confirms: 0 };
    const editor = {
        core: { objectsContainer: { children: [] } },
        dom: {},
        mapManager: { getObjectCount: () => 3 },
        isDirty: () => true,
        confirmAction: async () => { calls.confirms += 1; return confirmResult; },
        executeHistoryMutation: () => { calls.mutations += 1; },
        notify: () => {},
    };
    return { editor, calls };
}

for (const [label, result] of [['Cancel', null], ['an explicit no', false], ['no answer', undefined]]) {
    test(`loading a backdrop over a map stops on ${label} in the confirm dialog`, async () => {
        const previousDocument = globalThis.document;
        globalThis.document = { createElement: () => ({}) };
        try {
            const { editor, calls } = createEditorStub(result);
            bindEditorBackdropControls(editor);
            const loaded = await editor.loadBackdrop('toybox_titan');
            assert.equal(calls.confirms, 1);
            assert.equal(loaded, false);
            assert.equal(calls.mutations, 0, 'the map was replaced although the author cancelled');
        } finally {
            globalThis.document = previousDocument;
        }
    });
}
