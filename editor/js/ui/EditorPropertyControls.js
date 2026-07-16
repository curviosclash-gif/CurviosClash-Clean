import { readPropertyFieldNumber } from './EditorFormState.js';

export function bindEditorPropertyControls(editor) {
    if (!editor) return;
    const dom = editor.dom;
    const isLocked = (object) => editor.isObjectLocked(object);

    const updateTransformField = (field, label, applyValue) => {
        dom[field]?.addEventListener('change', () => {
            editor.executeHistoryMutation(label, () => {
                const selected = editor.selectedObject;
                if (!selected || !editor.isManagedObjectAlive(selected) || isLocked(selected)) return;
                applyValue(selected);
                editor.mapManager?.notifyObjectMutated?.(selected);
                editor.showPropPanel(selected);
            });
        });
    };

    updateTransformField('propX', 'Edit object X', (selected) => {
        selected.position.x = readPropertyFieldNumber(editor, 'x', selected.position.x);
    });

    updateTransformField('propZ', 'Edit object Z', (selected) => {
        selected.position.z = readPropertyFieldNumber(editor, 'z', selected.position.z);
    });

    updateTransformField('propRotationY', 'Rotate object', (selected) => {
        const degrees = readPropertyFieldNumber(editor, 'rotationY', selected.rotation.y * 180 / Math.PI);
        selected.rotation.y = degrees * Math.PI / 180;
    });

    dom.propY?.addEventListener('change', () => {
        editor.executeHistoryMutation('Edit object Y', () => {
            if (!editor.selectedObject || !editor.isManagedObjectAlive(editor.selectedObject) || isLocked(editor.selectedObject)) return;
            editor.selectedObject.position.y = readPropertyFieldNumber(editor, 'y', editor.selectedObject.position.y);
            editor.mapManager?.notifyObjectMutated?.(editor.selectedObject);
            editor.showPropPanel(editor.selectedObject);
        });
    });

    dom.propSize?.addEventListener('change', () => {
        editor.executeHistoryMutation('Edit object size', () => {
            if (editor.selectedObject && editor.isManagedObjectAlive(editor.selectedObject) && !isLocked(editor.selectedObject)) {
                const val = readPropertyFieldNumber(editor, 'size', editor.selectedObject.userData.sizeInfo || 0);
                const userData = editor.selectedObject.userData;
                userData.sizeInfo = val;

                if (userData.type === 'tunnel') {
                    userData.radius = val;
                    if (userData.pointA && userData.pointB) {
                        editor.mapManager.alignTunnelSegment(editor.selectedObject, userData.pointA, userData.pointB, val);
                        editor.mapManager?.notifyObjectMutated?.(editor.selectedObject);
                    }
                } else if (userData.type === 'portal') {
                    editor.selectedObject.scale.set(val, val, val);
                    userData.radius = val;
                }
                editor.mapManager?.notifyObjectMutated?.(editor.selectedObject);
            }
        });
    });

    const updateBoxScale = () => {
        editor.executeHistoryMutation('Resize block', () => {
            const selected = editor.selectedObject;
            if (!selected || !editor.isManagedObjectAlive(selected) || isLocked(selected)) return;
            if (selected.userData.type !== 'hard' && selected.userData.type !== 'foam') return;

            const w = readPropertyFieldNumber(editor, 'width', selected.userData.sizeX || 0);
            const d = readPropertyFieldNumber(editor, 'depth', selected.userData.sizeZ || 0);
            const h = readPropertyFieldNumber(editor, 'height', selected.userData.sizeY || 0);

            selected.userData.sizeX = w;
            selected.userData.sizeZ = d;
            selected.userData.sizeY = h;
            selected.userData.sizeInfo = Math.max(w, d, h) * 0.5;
            selected.scale.set(w, h, d);
            editor.mapManager?.notifyObjectMutated?.(selected);
        });
    };

    dom.propWidth?.addEventListener('change', updateBoxScale);
    dom.propDepth?.addEventListener('change', updateBoxScale);
    dom.propHeight?.addEventListener('change', updateBoxScale);

    dom.propScale?.addEventListener('change', () => {
        editor.executeHistoryMutation('Scale model', () => {
            const selected = editor.selectedObject;
            if (!selected || !editor.isManagedObjectAlive(selected) || isLocked(selected)) return;
            if (selected.userData.type !== 'aircraft' && selected.userData.type !== 'glb') return;

            const scaleField = selected.userData.type === 'glb' ? 'targetSize' : 'modelScale';
            const s = readPropertyFieldNumber(editor, 'scale', selected.userData[scaleField] || 0);
            if (s > 0) {
                selected.userData[scaleField] = s;
                selected.scale.set(s, s, s);
                editor.mapManager?.notifyObjectMutated?.(selected);
            }
        });
    });

    dom.propGroup?.addEventListener('change', () => {
        editor.executeHistoryMutation('Edit object group', () => {
            const selected = editor.selectedObject;
            if (!selected || !editor.isManagedObjectAlive(selected) || isLocked(selected)) return;
            selected.userData.groupId = String(dom.propGroup.value || '').trim();
            editor.mapManager?.notifyObjectMutated?.(selected);
            editor.showPropPanel(selected);
        });
    });
}
