import * as THREE from 'three';
import { isFlyModeChecked } from './EditorFormState.js';

export function bindEditorViewportControls(editor, { syncArenaValues } = {}) {
    if (!editor || typeof syncArenaValues !== 'function') return;
    const dom = editor.dom;

    dom.numArenaW?.addEventListener('change', () => {
        editor.executeHistoryMutation('Resize arena', syncArenaValues);
    });
    dom.numArenaD?.addEventListener('change', () => {
        editor.executeHistoryMutation('Resize arena', syncArenaValues);
    });
    dom.numArenaH?.addEventListener('change', () => {
        editor.executeHistoryMutation('Resize arena', syncArenaValues);
    });

    dom.chkYLayer?.addEventListener('change', (e) => {
        editor.core.yGridHelper.visible = e.target.checked;
    });
    dom.numYLayer?.addEventListener('change', (e) => {
        const y = parseFloat(e.target.value);
        editor.core.yGridHelper.position.y = y;
        editor.core.yGroundMesh.position.y = y;
    });

    const flyCheckbox = dom.chkFly;
    editor.flyModeEnabled = isFlyModeChecked(editor);
    flyCheckbox?.addEventListener('change', (e) => {
        const isFly = e.target.checked;
        editor.flyModeEnabled = isFly;
        const rightClickRotate = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
        };

        if (isFly) {
            editor.core.orbit.mouseButtons = rightClickRotate;
            if (editor.selectedObject) editor.detachTransformControl();
        } else {
            editor.core.orbit.mouseButtons = rightClickRotate;
            if (editor.selectedObject) editor.syncTransformControlAttachment();
        }
    });

    dom.chkSnap?.addEventListener('change', (e) => {
        editor.useSnap = e.target.checked;
        editor.core.transformControl.setTranslationSnap(editor.useSnap ? editor.snapSize : null);
    });
    dom.numGrid?.addEventListener('change', (e) => {
        editor.snapSize = parseFloat(e.target.value);
        if (editor.useSnap) editor.core.transformControl.setTranslationSnap(editor.snapSize);
    });
}
