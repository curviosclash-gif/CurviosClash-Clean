import { showEditorTurretProperties, clearEditorTurretRange } from './EditorTurretProperties.js';
import { writePropertyFieldValue } from './EditorFormState.js';

const OBJECT_TYPE_LABELS = Object.freeze({
    hard: 'Hartblock',
    foam: 'Schaumblock',
    tunnel: 'Tunnel',
    portal: 'Portal',
    spawn: 'Spawn',
    item: 'Pickup',
    aircraft: 'Flugobjekt',
    glb: 'GLB-Modell',
    checkpoint: 'Parcours',
    turret: 'Geschütz',
});

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
        propSizeLabel,
        propWidthRow,
        propDepthRow,
        propHeightRow,
        propScaleRow,
        propY,
        propObjectId,
        propObjectType,
        propObjectSubtypeRow,
        propObjectSubtype,
        propGroup,
        propContextRow,
        propContext,
        selectionEmpty,
        selectionTabBadge,
        editorTabSelection
    } = editor.dom;

    if (!propPanel || !propY) {
        hidePropertyPanelView(editor);
        return;
    }

    propPanel.style.display = "block";
    if (selectionEmpty) selectionEmpty.hidden = true;
    if (selectionTabBadge) selectionTabBadge.hidden = false;
    if (propObjectId) propObjectId.value = String(obj.userData?.id || '');
    if (propObjectType) propObjectType.value = OBJECT_TYPE_LABELS[obj.userData?.type] || String(obj.userData?.type || '');
    if (propObjectSubtypeRow) propObjectSubtypeRow.style.display = obj.userData?.subType ? 'grid' : 'none';
    if (propObjectSubtype) propObjectSubtype.value = String(obj.userData?.subType || '');
    if (editorTabSelection) {
        editorTabSelection.setAttribute('aria-label', `Auswahl: ${obj.userData?.id || 'Objekt'}`);
    }
    if (propGroup) propGroup.value = String(obj.userData?.groupId || '');
    writePropertyFieldValue(editor, 'x', Math.round(obj.position.x));
    writePropertyFieldValue(editor, 'y', Math.round(obj.position.y));
    writePropertyFieldValue(editor, 'z', Math.round(obj.position.z));
    writePropertyFieldValue(editor, 'rotationY', Math.round((obj.rotation.y || 0) * 180 / Math.PI));

    const u = obj.userData;
    showEditorTurretProperties(editor, obj);
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
    } else if (u.type === 'escort_waypoint' && propContextRow && propContext) {
        propContextRow.style.display = 'grid';
        propContext.value = `Escort ${String(u.subType || 'waypoint')} · Punkt ${(Number(u.escortOrder) || 0) + 1}`;
    }
    const locked = u.editorLocked === true || u.editorLayerLocked === true;
    [editor.dom.propX, editor.dom.propY, editor.dom.propZ, editor.dom.propRotationY,
        editor.dom.propSize, editor.dom.propWidth, editor.dom.propDepth, editor.dom.propHeight,
        editor.dom.propScale, editor.dom.propGroup, editor.dom.propPortalPartner, editor.dom.propCheckpointOrder].forEach((input) => {
        if (input) input.disabled = locked;
    });
    if (editor.dom.propCheckpointOrder && u.type === 'checkpoint' && u.subType === 'finish') {
        editor.dom.propCheckpointOrder.disabled = true;
    }

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
    } else if (u.type === 'tunnel' || u.type === 'portal' || u.type === 'checkpoint' || u.type === 'escort_waypoint') {
        if (propSizeRow) propSizeRow.style.display = "grid";
        if (propSizeLabel) {
            propSizeLabel.textContent = u.type === 'tunnel'
                ? 'Radius (X/Z; Länge über Y-Gizmo)'
                : 'Größe / Radius (gleichmäßig)';
        }
        writePropertyFieldValue(editor, 'size', u.type === 'checkpoint'
            ? (u.cpRadius || 5.5)
            : (u.type === 'escort_waypoint' ? (u.routeRadius || 4.5) : (u.radius || u.sizeInfo)));
    } else if (u.type === 'aircraft' || u.type === 'glb') {
        if (propScaleRow) propScaleRow.style.display = "grid";
        writePropertyFieldValue(editor, 'scale', u.type === 'glb'
            ? (Number(u.targetSize) > 0 ? u.targetSize : (u.glbScale || obj.scale.x || 1))
            : (u.modelScale || 50));
    }
}

export function hidePropertyPanelView(editor) {
    clearEditorTurretRange(editor);
    if (editor.dom.propPanel) editor.dom.propPanel.style.display = "none";
    if (editor.dom.selectionEmpty) editor.dom.selectionEmpty.hidden = false;
    if (editor.dom.selectionTabBadge) editor.dom.selectionTabBadge.hidden = true;
    if (editor.dom.editorTabSelection) {
        editor.dom.editorTabSelection.setAttribute('aria-label', 'Auswahl: kein Objekt');
    }
}
