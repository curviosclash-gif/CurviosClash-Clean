import { readPropertyFieldNumber } from './EditorFormState.js';

export function bindEditorPropertyControls(editor) {
    if (!editor) return;
    const dom = editor.dom;

    dom.propY?.addEventListener('change', () => {
        editor.executeHistoryMutation('Edit object Y', () => {
            if (!editor.selectedObject || !editor.isManagedObjectAlive(editor.selectedObject)) return;
            editor.selectedObject.position.y = readPropertyFieldNumber(editor, 'y', editor.selectedObject.position.y);
            if (editor.selectedObject.userData.type === 'tunnel') {
                editor.mapManager?.notifyObjectMutated?.(editor.selectedObject);
            }
            editor.showPropPanel(editor.selectedObject);
        });
    });

    dom.propSize?.addEventListener('change', () => {
        editor.executeHistoryMutation('Edit object size', () => {
            if (editor.selectedObject && editor.isManagedObjectAlive(editor.selectedObject)) {
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
            }
        });
    });

    const updateBoxScale = () => {
        editor.executeHistoryMutation('Resize block', () => {
            const selected = editor.selectedObject;
            if (!selected || !editor.isManagedObjectAlive(selected)) return;
            if (selected.userData.type !== 'hard' && selected.userData.type !== 'foam') return;

            const w = readPropertyFieldNumber(editor, 'width', selected.userData.sizeX || 0);
            const d = readPropertyFieldNumber(editor, 'depth', selected.userData.sizeZ || 0);
            const h = readPropertyFieldNumber(editor, 'height', selected.userData.sizeY || 0);

            selected.userData.sizeX = w;
            selected.userData.sizeZ = d;
            selected.userData.sizeY = h;
            selected.userData.sizeInfo = Math.max(w, d, h) * 0.5;
            selected.scale.set(w, h, d);
        });
    };

    dom.propWidth?.addEventListener('change', updateBoxScale);
    dom.propDepth?.addEventListener('change', updateBoxScale);
    dom.propHeight?.addEventListener('change', updateBoxScale);

    dom.propScale?.addEventListener('change', () => {
        editor.executeHistoryMutation('Scale aircraft', () => {
            const selected = editor.selectedObject;
            if (!selected || !editor.isManagedObjectAlive(selected)) return;
            if (selected.userData.type !== 'aircraft') return;

            const s = readPropertyFieldNumber(editor, 'scale', selected.userData.modelScale || 0);
            if (s > 0) {
                selected.userData.modelScale = s;
                selected.scale.set(s, s, s);
            }
        });
    });
}
