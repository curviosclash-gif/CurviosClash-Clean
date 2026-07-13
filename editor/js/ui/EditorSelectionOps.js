export function beforeManagedObjectsClearedSelectionState(editor) {
    editor.cancelHistoryGesture('transform');
    editor.clearDrawingState();
    editor.selectObject(null);
    editor.detachTransformControl();
}

export function onBeforeManagedObjectRemovedSelectionState(editor, object) {
    if (!object) return;

    if (editor.previewMesh === object) {
        editor.clearDrawingState();
    }

    if (editor.selectedObject === object) {
        editor.selectObject(null);
        return;
    }

    if (editor.core.transformControl.object === object) {
        editor.detachTransformControl();
    }
}

export function syncTransformControlAttachmentSelection(editor) {
    const selected = editor.isManagedObjectAlive(editor.selectedObject) ? editor.selectedObject : null;
    const flyMode = !!editor.flyModeEnabled;

    if (!selected || flyMode) {
        editor.detachTransformControl();
        return;
    }

    if (editor.core.transformControl.object !== selected) {
        editor.core.transformControl.attach(selected);
    }
}

export function getSelectionOutlinesForObject(editor, object) {
    const outlines = [];
    if (!object) return outlines;

    object.traverse((child) => {
        if (child.userData?.isSelectionOutline && child.material) outlines.push(child);
    });
    return outlines;
}

export function setSelectionOutlineForObject(editor, object, color = 0x000000, opacity = 0.2) {
    const outlines = getSelectionOutlinesForObject(editor, object);
    outlines.forEach((outline) => {
        outline.material.color.setHex(color);
        outline.material.opacity = opacity;
        outline.material.transparent = true;
        outline.material.needsUpdate = true;
    });
}

export function resolveSelectableManagedObject(editor, hitObject) {
    if (!hitObject) return null;
    if (editor.mapManager) {
        return editor.mapManager.resolveManagedObject(hitObject);
    }

    let node = hitObject;
    while (node && node.parent && node.parent !== editor.core.objectsContainer) {
        node = node.parent;
    }
    if (node && node.parent === editor.core.objectsContainer) return node;
    return null;
}

export function createClipboardPayloadFromObject(editor, object) {
    const payload = {
        ...object.userData,
        sourcePos: object.position.clone(),
        rotateY: object.rotation.y || 0
    };
    delete payload.id;
    delete payload.editorObjectId;
    delete payload.editorManagedRoot;
    if (payload.pointA?.isVector3) payload.pointA = payload.pointA.clone();
    if (payload.pointB?.isVector3) payload.pointB = payload.pointB.clone();
    return payload;
}

export function deleteSelectedManagedObject(editor) {
    if (!editor.selectedObject) return;
    if (!editor.isManagedObjectAlive(editor.selectedObject)) {
        editor.selectObject(null);
        return;
    }
    if (editor.mapManager) {
        editor.executeHistoryMutation('Delete object', () => {
            editor.mapManager.removeObject(editor.selectedObject);
        });
        return;
    }

    const removed = editor.selectedObject;
    editor.core.objectsContainer.remove(removed);
    editor.detachTransformControl();
    if (removed.userData.type === 'tunnel') editor.updateTunnelVisuals();
    editor.selectedObject = null;
    editor.hidePropPanel();
    editor.updateHudCount();
}

export function selectManagedObject(editor, obj) {
    const nextObject = editor.mapManager ? editor.mapManager.resolveManagedObject(obj) : obj;

    if (editor.selectedObject && !editor.isManagedObjectAlive(editor.selectedObject)) {
        editor.selectedObject = null;
    }

    if (editor.selectedObject) {
        editor.setSelectionOutline(editor.selectedObject, 0x000000, 0.2);
    }

    editor.selectedObject = nextObject && editor.isManagedObjectAlive(nextObject) ? nextObject : null;

    if (editor.selectedObject) {
        editor.setSelectionOutline(editor.selectedObject, 0xffffff, 0.8);
        editor.syncTransformControlAttachment();
        editor.showPropPanel(editor.selectedObject);
    } else {
        editor.detachTransformControl();
        editor.hidePropPanel();
    }
}

export function clearAllManagedObjects(editor) {
    if (editor.mapManager) {
        editor.mapManager.clearAllObjects();
        return;
    }

    while (editor.core.objectsContainer.children.length > 0) {
        editor.core.objectsContainer.remove(editor.core.objectsContainer.children[0]);
    }
    editor.selectObject(null);
    editor.updateTunnelVisuals();
    editor.updateHudCount();
}
