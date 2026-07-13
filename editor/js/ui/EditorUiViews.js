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
        propY
    } = editor.dom;

    if (!propPanel || !propY) {
        hidePropertyPanelView(editor);
        return;
    }

    propPanel.style.display = "block";
    writePropertyFieldValue(editor, 'y', Math.round(obj.position.y));

    const u = obj.userData;

    if (propSizeRow) propSizeRow.style.display = "none";
    if (propWidthRow) propWidthRow.style.display = "none";
    if (propDepthRow) propDepthRow.style.display = "none";
    if (propHeightRow) propHeightRow.style.display = "none";
    if (propScaleRow) propScaleRow.style.display = "none";

    if (u.type === 'hard' || u.type === 'foam') {
        if (propWidthRow) propWidthRow.style.display = "flex";
        if (propDepthRow) propDepthRow.style.display = "flex";
        if (propHeightRow) propHeightRow.style.display = "flex";
        writePropertyFieldValue(editor, 'width', u.sizeX || u.sizeInfo * 2);
        writePropertyFieldValue(editor, 'depth', u.sizeZ || u.sizeInfo * 2);
        writePropertyFieldValue(editor, 'height', u.sizeY || u.sizeInfo * 2);
    } else if (u.type === 'tunnel' || u.type === 'portal') {
        if (propSizeRow) propSizeRow.style.display = "flex";
        writePropertyFieldValue(editor, 'size', u.radius || u.sizeInfo);
    } else if (u.type === 'aircraft') {
        if (propScaleRow) propScaleRow.style.display = "flex";
        writePropertyFieldValue(editor, 'scale', u.modelScale || 50);
    }
}

export function hidePropertyPanelView(editor) {
    if (editor.dom.propPanel) editor.dom.propPanel.style.display = "none";
}
