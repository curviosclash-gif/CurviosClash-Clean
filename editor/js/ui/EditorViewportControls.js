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
        const parsed = Number.parseFloat(e.target.value);
        const y = Number.isFinite(parsed) ? Math.max(0, Math.min(editor.ARENA_H, parsed)) : 0;
        e.target.value = String(y);
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
            MIDDLE: THREE.MOUSE.PAN,
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

    const syncTransformSnapping = () => {
        editor.core.transformControl.setTranslationSnap(editor.useSnap ? editor.snapSize : null);
        editor.core.transformControl.setRotationSnap(editor.useSnap ? THREE.MathUtils.degToRad(editor.rotationSnap) : null);
        editor.core.transformControl.setScaleSnap(editor.useSnap ? editor.scaleSnap : null);
    };

    dom.chkSnap?.addEventListener('change', (e) => {
        editor.useSnap = e.target.checked;
        syncTransformSnapping();
    });
    dom.numGrid?.addEventListener('change', (e) => {
        const parsed = Number.parseFloat(e.target.value);
        editor.snapSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
        e.target.value = String(editor.snapSize);
        syncTransformSnapping();
    });
    dom.numRotationSnap?.addEventListener('change', (e) => {
        const parsed = Number.parseFloat(e.target.value);
        editor.rotationSnap = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
        e.target.value = String(editor.rotationSnap);
        syncTransformSnapping();
    });
    dom.numScaleSnap?.addEventListener('change', (e) => {
        const parsed = Number.parseFloat(e.target.value);
        editor.scaleSnap = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        e.target.value = String(editor.scaleSnap);
        syncTransformSnapping();
    });
}
