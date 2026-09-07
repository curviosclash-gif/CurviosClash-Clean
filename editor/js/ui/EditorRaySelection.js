// Picking follows the camera ray, including objects far above the ground plane.
// Run only on clicks; the spatial ground index is not a conservative ray query.
export function pickEditorObject(editor) {
    const candidates = editor.core.objectsContainer.children.filter((object) => object.visible !== false);
    for (const hit of editor.raycaster.intersectObjects(candidates, true)) {
        let visible = true;
        for (let node = hit.object; node; node = node.parent) {
            if (node.visible === false || node.userData?.isSelectionOutline) { visible = false; break; }
        }
        if (!visible) continue;
        const object = editor.resolveSelectableObject(hit.object);
        if (object) return object;
    }
    return null;
}
