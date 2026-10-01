import assert from 'node:assert/strict';
import test from 'node:test';
import { showPropertyPanelView } from '../editor/js/ui/EditorUiViews.js';

test('property refresh preserves the focused group draft and updates it after blur', () => {
    const groupInput = { value: '', disabled: false };
    const editor = {
        dom: {
            propPanel: { style: {} },
            propY: {},
            propGroup: groupInput,
        },
        core: { objectsContainer: { children: [] } },
    };
    const object = {
        userData: { id: 'object-1', type: 'spawn', groupId: 'group-a' },
        position: { x: 0, y: 0, z: 0 },
        rotation: { y: 0 },
        scale: { x: 1 },
    };
    const previousDocument = globalThis.document;
    globalThis.document = { activeElement: groupInput };

    try {
        groupInput.value = 'unfinished draft';
        object.userData.groupId = 'group-b';
        showPropertyPanelView(editor, object);
        assert.equal(groupInput.value, 'unfinished draft');

        globalThis.document.activeElement = null;
        showPropertyPanelView(editor, object);
        assert.equal(groupInput.value, 'group-b');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
