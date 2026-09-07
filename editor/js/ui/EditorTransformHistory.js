export function captureEditorTransforms(editor) {
    return editor.core.objectsContainer.children.map((object) => ({
        id: object.userData.id,
        position: object.position.toArray(),
        quaternion: object.quaternion.toArray(),
        scale: object.scale.toArray(),
    }));
}

export function createEditorTransformCommand(editor, label, before, after) {
    if (!before || before.length !== after.length) return null;
    const previous = new Map(before.map((entry) => [entry.id, entry]));
    if (after.some((entry) => !previous.has(entry.id))) return null;
    const changed = after.filter((entry) => JSON.stringify(entry) !== JSON.stringify(previous.get(entry.id)));
    if (!changed.length) return null;
    const old = changed.map((entry) => previous.get(entry.id));
    const apply = (entries) => {
        const objects = entries.map((entry) => editor.mapManager.getObjectById(entry.id));
        if (objects.some((object) => !object)) throw new Error('Transformiertes Objekt fehlt im Arbeitsstand.');
        editor.mapManager.withSceneMutation(() => entries.forEach((entry, index) => {
            const object = objects[index];
            object.position.fromArray(entry.position);
            object.quaternion.fromArray(entry.quaternion);
            object.scale.fromArray(entry.scale);
            editor.mapManager.notifyObjectMutated(object);
        }));
        editor.syncTransformControlAttachment?.();
        if (editor.selectedObject) editor.showPropPanel?.(editor.selectedObject);
    };
    return { label, undo: () => apply(old), redo: () => apply(changed) };
}
