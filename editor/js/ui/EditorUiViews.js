import { writePropertyFieldValue } from './EditorFormState.js';

export function updateUndoRedoButtonsView(editor, state = null) {
    const historyState = state || editor.commandHistory?.getState?.();
    if (!historyState) return;

    const { btnUndo, btnRedo } = editor.dom;

    if (btnUndo) {
        btnUndo.disabled = !historyState.canUndo;
        btnUndo.title = historyState.undoLabel
            ? `Undo: ${historyState.undoLabel} (Strg+Z)`
            : 'Undo (Strg+Z)';
    }
    if (btnRedo) {
        btnRedo.disabled = !historyState.canRedo;
        btnRedo.title = historyState.redoLabel
            ? `Redo: ${historyState.redoLabel} (Strg+Y / Strg+Shift+Z)`
            : 'Redo (Strg+Y / Strg+Shift+Z)';
    }
}

export function updateHudCountView(editor) {
    const count = editor.mapManager?.getObjectCount?.() ?? editor.core.objectsContainer.children.length;
    if (editor.dom.hudObjCount) {
        editor.dom.hudObjCount.textContent = `Objekte: ${count}`;
    }
}

export function showPropertyPanelView(editor, obj) {
    if (!obj || !obj.userData) {
        hidePropertyPanelView(editor);
        return;
    }

    const {
        propPanel,
        propSizeRow,
        propWidthRow,
        propDepthRow,
        propHeightRow,
        propScaleRow,
        propY,
        propObjectId,
        propObjectType,
        propGroup,
        propContextRow,
        propContext
    } = editor.dom;

    if (!propPanel || !propY) {
        hidePropertyPanelView(editor);
        return;
    }

    propPanel.style.display = "block";
    if (propObjectId) propObjectId.value = String(obj.userData?.id || '');
    if (propObjectType) propObjectType.value = String(obj.userData?.subType || obj.userData?.type || '');
    if (propGroup) propGroup.value = String(obj.userData?.groupId || '');
    writePropertyFieldValue(editor, 'x', Math.round(obj.position.x));
    writePropertyFieldValue(editor, 'y', Math.round(obj.position.y));
    writePropertyFieldValue(editor, 'z', Math.round(obj.position.z));
    writePropertyFieldValue(editor, 'rotationY', Math.round((obj.rotation.y || 0) * 180 / Math.PI));

    const u = obj.userData;
    editor.populateRelationshipFields?.(obj);
    if (propContextRow) propContextRow.style.display = 'none';
    if (propContext) propContext.value = '';
    if (u.type === 'portal' && propContextRow && propContext) {
        const partner = editor.mapManager?.getObjectById?.(String(u.portalPartnerId || '')) || null;
        propContextRow.style.display = 'grid';
        propContext.value = partner?.userData?.id || 'Noch ohne Partner';
    } else if (u.type === 'checkpoint' && propContextRow && propContext) {
        const checkpoints = Array.from(editor.core.objectsContainer.children).filter((entry) => entry.userData?.type === 'checkpoint');
        propContextRow.style.display = 'grid';
        propContext.value = u.subType === 'finish' ? 'Parcours-Finish' : `Checkpoint ${(Number(u.checkpointOrder) || checkpoints.indexOf(obj)) + 1}`;
    }
    const locked = u.editorLocked === true || u.editorLayerLocked === true;
    [editor.dom.propX, editor.dom.propY, editor.dom.propZ, editor.dom.propRotationY,
        editor.dom.propSize, editor.dom.propWidth, editor.dom.propDepth, editor.dom.propHeight,
        editor.dom.propScale, editor.dom.propGroup, editor.dom.propPortalPartner, editor.dom.propCheckpointOrder].forEach((input) => {
        if (input) input.disabled = locked;
    });

    if (propSizeRow) propSizeRow.style.display = "none";
    if (propWidthRow) propWidthRow.style.display = "none";
    if (propDepthRow) propDepthRow.style.display = "none";
    if (propHeightRow) propHeightRow.style.display = "none";
    if (propScaleRow) propScaleRow.style.display = "none";

    if (u.type === 'hard' || u.type === 'foam') {
        if (propWidthRow) propWidthRow.style.display = "grid";
        if (propDepthRow) propDepthRow.style.display = "grid";
        if (propHeightRow) propHeightRow.style.display = "grid";
        writePropertyFieldValue(editor, 'width', u.sizeX || u.sizeInfo * 2);
        writePropertyFieldValue(editor, 'depth', u.sizeZ || u.sizeInfo * 2);
        writePropertyFieldValue(editor, 'height', u.sizeY || u.sizeInfo * 2);
    } else if (u.type === 'tunnel' || u.type === 'portal') {
        if (propSizeRow) propSizeRow.style.display = "grid";
        writePropertyFieldValue(editor, 'size', u.radius || u.sizeInfo);
    } else if (u.type === 'aircraft') {
        if (propScaleRow) propScaleRow.style.display = "grid";
        writePropertyFieldValue(editor, 'scale', u.modelScale || 50);
    }
}

export function hidePropertyPanelView(editor) {
    if (editor.dom.propPanel) editor.dom.propPanel.style.display = "none";
}
