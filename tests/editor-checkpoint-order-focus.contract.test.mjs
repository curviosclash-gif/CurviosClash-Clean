import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { bindEditorRelationshipControls } from '../editor/js/ui/EditorRelationshipControls.js';

function createEditorHarness() {
    const core = {
        scene: new THREE.Scene(),
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    };
    core.scene.add(core.objectsContainer);
    const mapManager = new EditorMapManager(core, {
        getClone() { return null; },
        setCloneHydrationHandler() {},
    });
    const checkpointOrder = {
        value: '',
        addEventListener() {},
    };
    const editor = {
        core,
        mapManager,
        selectedObject: null,
        dom: {
            propCheckpointOrderRow: { style: {} },
            propCheckpointOrder: checkpointOrder,
            propPortalPartnerRow: { style: {} },
            propPortalPartner: { addEventListener() {} },
        },
        isManagedObjectAlive: (object) => mapManager.isRegisteredObject(object),
        executeHistoryMutation(_label, apply) { apply(); },
        showPropPanel() {},
    };
    return { core, editor, mapManager, checkpointOrder };
}

test('checkpoint and escort order refresh preserve a focused draft and sync after blur', () => {
    const previousDocument = globalThis.document;
    const documentRef = { activeElement: null };
    globalThis.document = documentRef;

    const { editor, mapManager, checkpointOrder } = createEditorHarness();
    const checkpoint = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, {
        id: 'checkpoint-1',
        checkpointOrder: 0,
    });
    const escortWaypoint = mapManager.createMesh('escort_waypoint', 'waypoint', 100, 100, 0, 4, {
        id: 'escort-1',
        escortOrder: 0,
    });
    bindEditorRelationshipControls(editor);

    try {
        checkpoint.userData.checkpointOrder = 3;
        documentRef.activeElement = checkpointOrder;
        checkpointOrder.value = '7';
        editor.populateRelationshipFields(checkpoint);
        assert.equal(checkpointOrder.value, '7');
        documentRef.activeElement = null;
        editor.populateRelationshipFields(checkpoint);
        assert.equal(checkpointOrder.value, '3');

        escortWaypoint.userData.escortOrder = 5;
        documentRef.activeElement = checkpointOrder;
        checkpointOrder.value = '9';
        editor.populateRelationshipFields(escortWaypoint);
        assert.equal(checkpointOrder.value, '9');
        documentRef.activeElement = null;
        editor.populateRelationshipFields(escortWaypoint);
        assert.equal(checkpointOrder.value, '5');
    } finally {
        mapManager.clearAllObjects();
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
