import * as THREE from 'three';
import { EditorCommandHistory } from './EditorCommandHistory.js';
import { bindEditorToolPaletteControls } from './ui/EditorToolPaletteControls.js';
import { bindEditorCanvasInteractionControls } from './ui/EditorCanvasInteractionControls.js';
import { bindEditorPropertyControls } from './ui/EditorPropertyControls.js';
import { bindEditorShortcutControls } from './ui/EditorShortcutControls.js';
import { bindEditorViewportControls } from './ui/EditorViewportControls.js';
import { bindEditorSessionControls } from './ui/EditorSessionControls.js';
import { createEditorDomRefs } from './ui/EditorDomRefs.js';
import { bindEditorLayoutControls } from './ui/EditorLayoutControls.js';
import { bindEditorWorkspaceControls } from './ui/EditorWorkspaceControls.js';
import { bindEditorLayerControls } from './ui/EditorLayerControls.js';
import { bindEditorRelationshipControls } from './ui/EditorRelationshipControls.js';
import { isFlyModeChecked, readArenaSizeInputs, writeArenaSizeInputs } from './ui/EditorFormState.js';
import {
    setupEditorSceneVisuals,
    updateArenaBoundsVisual,
    updateTunnelSegmentLineVisuals
} from './ui/EditorSceneVisualOps.js';
import {
    applyHistorySnapshot,
    beginHistoryGesture,
    cancelHistoryGesture,
    captureHistorySnapshot,
    commitHistoryGesture,
    executeHistoryMutation,
    isHistoryRecordingSuspended,
    pushSnapshotHistoryCommand,
    redoHistory,
    undoHistory,
    withHistorySuspended
} from './ui/EditorHistoryOps.js';
import {
    beforeManagedObjectsClearedSelectionState,
    clearAllManagedObjects,
    createClipboardPayloadFromObject,
    deleteSelectedManagedObject,
    getSelectionOutlinesForObject,
    onBeforeManagedObjectRemovedSelectionState,
    resolveSelectableManagedObject,
    selectManagedObject,
    setSelectionOutlineForObject,
    syncTransformControlAttachmentSelection
} from './ui/EditorSelectionOps.js';
import {
    hidePropertyPanelView,
    showPropertyPanelView,
    updateHudCountView,
    updateUndoRedoButtonsView
} from './ui/EditorUiViews.js';

export class EditorUI {
    constructor(core) {
        this.core = core;
        this.mapManager = null; // Injected later

        this.currentTool = "select";
        this.toolDockState = null;
        this.selectedObject = null;
        this.clipboardData = null;
        this.syncArenaValues = null;

        this.useSnap = false;
        this.snapSize = 50;
        this.rotationSnap = 15;
        this.scaleSnap = 1;
        this.flyModeEnabled = false;
        this.ARENA_W = 2800;
        this.ARENA_D = 2400;
        this.ARENA_H = 950;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.isDrawing = false;
        this.drawStartPos = null;
        this.previewMesh = null;

        this.commandHistory = new EditorCommandHistory({
            limit: 100,
            onChange: (state) => this.updateUndoRedoUi(state)
        });
        this.historySuspendDepth = 0;
        this.pendingHistoryGestures = new Map();
        this.dom = createEditorDomRefs(document);

        this.core.setRuntimeStateAccessors?.({
            isFlyModeEnabled: () => this.flyModeEnabled,
            getArenaHeight: () => this.ARENA_H
        });

        this.setupVisuals();
        this.setupEventListeners();
    }

    setMapManager(mana) {
        this.mapManager = mana;
        if (!this.authoringControlsBound) {
            bindEditorLayerControls(this);
            bindEditorRelationshipControls(this);
            this.authoringControlsBound = true;
        }
        this.initializeSavedState?.();
        this.restorePlaytestReturnIfRequested?.();
        this.updateUndoRedoUi();
        this.refreshToolDock?.();
        this.refreshWorkspace?.();
    }

    detachTransformControl() {
        if (this.core.transformControl.object) {
            this.core.transformControl.detach();
        }
    }

    isManagedObjectAlive(object) {
        if (!object) return false;
        if (!this.mapManager) return object.parent === this.core.objectsContainer;
        return this.mapManager.isRegisteredObject(object);
    }

    isObjectLocked(object) {
        return object?.userData?.editorLocked === true || object?.userData?.editorLayerLocked === true;
    }

    clearDrawingState() {
        this.cancelHistoryGesture('draw');
        this.isDrawing = false;
        this.drawStartPos = null;
        this.previewMesh = null;
    }

    getArenaSizeForExport() {
        return {
            width: this.ARENA_W,
            height: this.ARENA_H,
            depth: this.ARENA_D
        };
    }

    setArenaSizeInputs(arenaSize) {
        writeArenaSizeInputs(this, arenaSize);
    }

    isHistoryRecordingSuspended() {
        return isHistoryRecordingSuspended(this);
    }

    withHistorySuspended(fn) {
        return withHistorySuspended(this, fn);
    }

    captureHistorySnapshot() {
        return captureHistorySnapshot(this);
    }

    applyHistorySnapshot(snapshot) {
        applyHistorySnapshot(this, snapshot);
    }

    pushSnapshotHistoryCommand(label, beforeSnapshot, afterSnapshot) {
        return pushSnapshotHistoryCommand(this, label, beforeSnapshot, afterSnapshot);
    }

    executeHistoryMutation(label, mutateFn) {
        return executeHistoryMutation(this, label, mutateFn);
    }

    beginHistoryGesture(key, label) {
        beginHistoryGesture(this, key, label);
    }

    commitHistoryGesture(key, labelOverride = null) {
        return commitHistoryGesture(this, key, labelOverride);
    }

    cancelHistoryGesture(key) {
        cancelHistoryGesture(this, key);
    }

    undo() {
        return undoHistory(this);
    }

    redo() {
        return redoHistory(this);
    }

    updateUndoRedoUi(state = null) {
        updateUndoRedoButtonsView(this, state);
    }

    beforeManagedObjectsCleared() {
        beforeManagedObjectsClearedSelectionState(this);
    }

    onBeforeManagedObjectRemoved(object) {
        onBeforeManagedObjectRemovedSelectionState(this, object);
    }

    syncTransformControlAttachment() {
        syncTransformControlAttachmentSelection(this);
    }

    setupVisuals() {
        setupEditorSceneVisuals(this);
    }

    updateArenaVisual() {
        updateArenaBoundsVisual(this);
    }

    updateTunnelVisuals() {
        updateTunnelSegmentLineVisuals(this);
    }

    updateHudCount() {
        updateHudCountView(this);
    }

    getSelectionOutlines(object) {
        return getSelectionOutlinesForObject(this, object);
    }

    setSelectionOutline(object, color = 0x000000, opacity = 0.2) {
        setSelectionOutlineForObject(this, object, color, opacity);
    }

    resolveSelectableObject(hitObject) {
        return resolveSelectableManagedObject(this, hitObject);
    }

    createClipboardPayload(object) {
        return createClipboardPayloadFromObject(this, object);
    }

    deleteSelectedObject() {
        deleteSelectedManagedObject(this);
    }

    selectObject(obj) {
        selectManagedObject(this, obj);
    }

    clearAllObjects() {
        clearAllManagedObjects(this);
    }

    showPropPanel(obj) {
        showPropertyPanelView(this, obj);
    }

    hidePropPanel() {
        hidePropertyPanelView(this);
    }

    setupEventListeners() {
        this.flyModeEnabled = isFlyModeChecked(this);

        bindEditorLayoutControls(this);
        bindEditorWorkspaceControls(this);

        bindEditorToolPaletteControls(this);

        bindEditorCanvasInteractionControls(this);

        bindEditorShortcutControls(this);

        bindEditorPropertyControls(this);

        // Arena resize
        const syncArenaValues = () => {
            const arenaSize = readArenaSizeInputs(this, {
                width: this.ARENA_W,
                depth: this.ARENA_D,
                height: this.ARENA_H
            });
            writeArenaSizeInputs(this, arenaSize);
            this.ARENA_W = arenaSize.width;
            this.ARENA_D = arenaSize.depth;
            this.ARENA_H = arenaSize.height;
            if (this.dom.numYLayer) {
                const yLayer = Math.max(0, Math.min(this.ARENA_H, Number.parseFloat(this.dom.numYLayer.value) || 0));
                this.dom.numYLayer.value = String(yLayer);
                this.core.yGridHelper.position.y = yLayer;
                this.core.yGroundMesh.position.y = yLayer;
            }
            this.updateArenaVisual();
        };
        this.syncArenaValues = syncArenaValues;

        bindEditorViewportControls(this, { syncArenaValues });
        bindEditorSessionControls(this, { syncArenaValues });

        this.updateUndoRedoUi();
    }
}

