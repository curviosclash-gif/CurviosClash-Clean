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
        hasPlayerSpawnObject
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
        const selected = snapshot.selectedObjectId ? editor.mapManager.getObjectById(snapshot.selectedObjectId) : null;
        editor.selectObject(selected || null);
    });
}

export function pushSnapshotHistoryCommand(editor, label, beforeSnapshot, afterSnapshot) {
    if (!beforeSnapshot || !afterSnapshot) return false;
    if (
        beforeSnapshot.json === afterSnapshot.json &&
        beforeSnapshot.hasPlayerSpawnObject === afterSnapshot.hasPlayerSpawnObject
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
    const result = mutateFn();
    const afterSnapshot = captureHistorySnapshot(editor);
    pushSnapshotHistoryCommand(editor, label, beforeSnapshot, afterSnapshot);
    return result;
}

export function beginHistoryGesture(editor, key, label) {
    if (!key || !editor.mapManager || isHistoryRecordingSuspended(editor)) return;
    if (editor.pendingHistoryGestures.has(key)) return;

    const snapshot = captureHistorySnapshot(editor);
    if (!snapshot) return;

    editor.pendingHistoryGestures.set(key, {
        label: String(label || 'Change'),
        before: snapshot
    });
}

export function commitHistoryGesture(editor, key, labelOverride = null) {
    if (!key) return false;

    const pending = editor.pendingHistoryGestures.get(key);
    if (!pending) return false;
    editor.pendingHistoryGestures.delete(key);

    if (!editor.mapManager || isHistoryRecordingSuspended(editor)) return false;

    const afterSnapshot = captureHistorySnapshot(editor);
    return pushSnapshotHistoryCommand(editor, labelOverride || pending.label, pending.before, afterSnapshot);
}

export function cancelHistoryGesture(editor, key) {
    if (!key) return;
    editor.pendingHistoryGestures.delete(key);
}

export function undoHistory(editor) {
    if (!editor.commandHistory) return false;
    try {
        return editor.commandHistory.undo();
    } catch (error) {
        alert(`Undo fehlgeschlagen: ${error.message}`);
        return false;
    }
}

export function redoHistory(editor) {
    if (!editor.commandHistory) return false;
    try {
        return editor.commandHistory.redo();
    } catch (error) {
        alert(`Redo fehlgeschlagen: ${error.message}`);
        return false;
    }
}
