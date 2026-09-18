import { captureEditorTransforms, createEditorTransformCommand } from './EditorTransformHistory.js';
import { SnapshotCommand } from '../EditorCommandHistory.js';

export function isHistoryRecordingSuspended(editor) {
    return editor.historySuspendDepth > 0 || editor.commandHistory?.isApplying?.();
}

export function withHistorySuspended(editor, fn) {
    editor.historySuspendDepth += 1;
    try {
        return fn();
    } finally {
        editor.historySuspendDepth = Math.max(0, editor.historySuspendDepth - 1);
    }
}

export function captureHistorySnapshot(editor) {
    if (!editor.mapManager) return null;

    let json = '';
    try {
        json = editor.mapManager.generateJSONExport(editor.getArenaSizeForExport());
    } catch (error) {
        console.warn('[EditorUI] Failed to capture history snapshot:', error);
        return null;
    }

    const selectedObjectId = (editor.selectedObject && editor.isManagedObjectAlive(editor.selectedObject))
        ? (editor.selectedObject.userData?.id || null)
        : null;
    const hasPlayerSpawnObject = editor.core.objectsContainer.children.some((obj) => (
        obj?.userData?.type === 'spawn' && obj?.userData?.subType === 'player'
    ));

    return {
        json,
        selectedObjectId,
        hasPlayerSpawnObject,
        workspaceMetadata: editor.captureWorkspaceMetadata?.() || {},
        layerState: editor.captureLayerState?.() || null
    };
}

export function applyHistorySnapshot(editor, snapshot) {
    if (!snapshot || !editor.mapManager) return;
    const syncArenaValues = editor.syncArenaValues || (() => { });

    withHistorySuspended(editor, () => {
        editor.mapManager.importFromJSON(snapshot.json, {
            onArenaSize: (arenaSize) => {
                editor.setArenaSizeInputs(arenaSize);
                syncArenaValues();
            }
        });
        if (snapshot.hasPlayerSpawnObject === false) {
            const playerSpawns = [...editor.core.objectsContainer.children].filter((obj) => (
                obj?.userData?.type === 'spawn' && obj?.userData?.subType === 'player'
            ));
            playerSpawns.forEach((obj) => editor.mapManager.removeObject(obj));
        }
        editor.applyWorkspaceMetadata?.(snapshot.workspaceMetadata);
        editor.applyLayerState?.(snapshot.layerState);
        const selected = snapshot.selectedObjectId ? editor.mapManager.getObjectById(snapshot.selectedObjectId) : null;
        editor.selectObject(selected || null);
    });
}

export function pushSnapshotHistoryCommand(editor, label, beforeSnapshot, afterSnapshot) {
    if (!beforeSnapshot || !afterSnapshot) return false;
    if (
        beforeSnapshot.json === afterSnapshot.json &&
        beforeSnapshot.hasPlayerSpawnObject === afterSnapshot.hasPlayerSpawnObject &&
        JSON.stringify(beforeSnapshot.workspaceMetadata || {}) === JSON.stringify(afterSnapshot.workspaceMetadata || {}) &&
        JSON.stringify(beforeSnapshot.layerState || {}) === JSON.stringify(afterSnapshot.layerState || {})
    ) {
        return false;
    }

    return editor.commandHistory.push(new SnapshotCommand({
        label,
        before: beforeSnapshot,
        after: afterSnapshot,
        applySnapshot: (snapshot) => applyHistorySnapshot(editor, snapshot)
    }));
}

export function executeHistoryMutation(editor, label, mutateFn) {
    if (typeof mutateFn !== 'function') return undefined;
    if (!editor.mapManager || isHistoryRecordingSuspended(editor)) {
        return mutateFn();
    }

    const beforeSnapshot = captureHistorySnapshot(editor);
    let result;
    try {
        result = mutateFn();
    } catch (error) {
        if (beforeSnapshot) {
            try {
                applyHistorySnapshot(editor, beforeSnapshot);
            } catch (rollbackError) {
                console.error(`[EditorUI] Rollback failed after "${label}":`, rollbackError);
            }
        }
        throw error;
    }
    const afterSnapshot = captureHistorySnapshot(editor);
    const changed = pushSnapshotHistoryCommand(editor, label, beforeSnapshot, afterSnapshot);
    if (changed) {
        editor.authoringTelemetry?.recordCounter?.('edit');
        editor.markDirty?.(`${label}.`);
    }
    return result;
}

export function beginHistoryGesture(editor, key, label) {
    if (!key || !editor.mapManager || isHistoryRecordingSuspended(editor)) return;
    if (editor.pendingHistoryGestures.has(key)) return;

    const snapshot = captureHistorySnapshot(editor);
    if (!snapshot) return;

    editor.pendingHistoryGestures.set(key, {
        label: String(label || 'Change'),
        before: snapshot,
        transforms: key === 'transform' ? captureEditorTransforms(editor) : null
    });
}

export function commitHistoryGesture(editor, key, labelOverride = null) {
    if (!key) return false;

    const pending = editor.pendingHistoryGestures.get(key);
    if (!pending) return false;
    editor.pendingHistoryGestures.delete(key);

    if (!editor.mapManager || isHistoryRecordingSuspended(editor)) return false;

    const afterSnapshot = captureHistorySnapshot(editor);
    const label = labelOverride || pending.label;
    const transformCommand = pending.transforms
        ? createEditorTransformCommand(editor, label, pending.transforms, captureEditorTransforms(editor))
        : null;
    const changed = transformCommand
        ? editor.commandHistory.push(transformCommand)
        : pushSnapshotHistoryCommand(editor, label, pending.before, afterSnapshot);
    if (changed) {
        editor.authoringTelemetry?.recordCounter?.('edit');
        editor.markDirty?.(`${label}.`);
    }
    return changed;
}

export function cancelHistoryGesture(editor, key) {
    if (!key) return;
    editor.pendingHistoryGestures.delete(key);
}

export function undoHistory(editor) {
    if (!editor.commandHistory) return false;
    try {
        const changed = editor.commandHistory.undo();
        if (changed) {
            editor.authoringTelemetry?.recordCounter?.('undo');
            if (typeof editor.reconcileDirtyState === 'function') editor.reconcileDirtyState('Undo ausgeführt.');
            else editor.markDirty?.('Undo ausgeführt.');
        }
        return changed;
    } catch (error) {
        editor.notify?.(`Undo fehlgeschlagen: ${error.message}`, 'error');
        return false;
    }
}

export function redoHistory(editor) {
    if (!editor.commandHistory) return false;
    try {
        const changed = editor.commandHistory.redo();
        if (changed) {
            editor.authoringTelemetry?.recordCounter?.('redo');
            if (typeof editor.reconcileDirtyState === 'function') editor.reconcileDirtyState('Redo ausgeführt.');
            else editor.markDirty?.('Redo ausgeführt.');
        }
        return changed;
    } catch (error) {
        editor.notify?.(`Redo fehlgeschlagen: ${error.message}`, 'error');
        return false;
    }
}
