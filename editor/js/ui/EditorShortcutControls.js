import * as THREE from 'three';
import { getYLayerValue, isYLayerEnabled } from './EditorFormState.js';

export function bindEditorShortcutControls(editor) {
    if (!editor) return;
    const dom = editor.dom;

    editor.core.container.addEventListener('keyup', (e) => {
        if (e.ctrlKey) return; // handled by document keydown shortcuts
        if (e.key === 'Delete' || e.key === 'Backspace') {
            dom.btnDelSelected?.click();
        }
    });

    const shouldIgnoreGlobalShortcut = (target) => {
        if (!(target instanceof Element)) return false;
        if (target.closest('#editorModalBackdrop')) return true;
        const tagName = target.tagName.toLowerCase();
        return tagName === 'input'
            || tagName === 'textarea'
            || tagName === 'select'
            || target.isContentEditable;
    };

    const transformButtons = Array.from(document.querySelectorAll('[data-transform-mode]'));
    const syncTransformModeUi = () => {
        const selected = editor.isManagedObjectAlive(editor.selectedObject) ? editor.selectedObject : null;
        const attached = !!selected && editor.core.transformControl.object === selected;
        const mode = editor.core.transformControl.mode;
        transformButtons.forEach((button) => {
            const buttonMode = button.dataset.transformMode;
            button.disabled = !attached || (buttonMode === 'scale' && !editor.mapManager?.canScaleObject?.(selected));
            button.classList.toggle('active', attached && buttonMode === mode);
            button.setAttribute('aria-pressed', String(attached && buttonMode === mode));
        });
    };
    const setTransformMode = (mode) => {
        const selected = editor.isManagedObjectAlive(editor.selectedObject) ? editor.selectedObject : null;
        if (!selected || editor.core.transformControl.object !== selected) return false;
        if (mode === 'scale' && !editor.mapManager?.canScaleObject?.(selected)) {
            editor.notify?.('Dieser Objekttyp besitzt keine speicherbare Skalierung.', 'warn');
            syncTransformModeUi();
            return false;
        }
        editor.core.transformControl.setMode(mode);
        const rotate = mode === 'rotate';
        editor.core.transformControl.showX = !rotate;
        editor.core.transformControl.showY = true;
        editor.core.transformControl.showZ = !rotate;
        syncTransformModeUi();
        return true;
    };
    editor.setTransformMode = setTransformMode;
    editor.syncTransformModeUi = syncTransformModeUi;
    transformButtons.forEach((button) => {
        button.addEventListener('click', () => setTransformMode(button.dataset.transformMode));
    });
    syncTransformModeUi();

    document.addEventListener('keydown', (e) => {
        if (shouldIgnoreGlobalShortcut(e.target)) return;

        const lowerKey = e.key.toLowerCase();

        if (e.ctrlKey && lowerKey === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                editor.redo();
            } else {
                editor.undo();
            }
            return;
        }
        if (e.ctrlKey && lowerKey === 'y') {
            e.preventDefault();
            editor.redo();
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            editor.deleteSelectedObject();
        }

        if (!e.ctrlKey && !e.metaKey && lowerKey === 'r') setTransformMode('rotate');
        if (!e.ctrlKey && !e.metaKey && lowerKey === 't') setTransformMode('translate');
        if (!e.ctrlKey && !e.metaKey && lowerKey === 's') setTransformMode('scale');
        if (lowerKey === 'f' && !e.ctrlKey) {
            editor.core.focusObject?.(editor.selectedObject);
        }

        if (e.ctrlKey && lowerKey === 'c') {
            if (editor.selectedObject && editor.isManagedObjectAlive(editor.selectedObject)) {
                editor.clipboardData = editor.createClipboardPayload(editor.selectedObject);
            }
        }

        if (e.ctrlKey && lowerKey === 'v') {
            if (!editor.clipboardData) return;

            editor.executeHistoryMutation('Paste object', () => {
                editor.raycaster.setFromCamera(editor.mouse, editor.core.camera);

                const useYLayer = isYLayerEnabled(editor);
                const targetMesh = useYLayer ? editor.core.yGroundMesh : editor.core.groundMesh;
                const intersectsGround = editor.raycaster.intersectObject(targetMesh);

                let targetPos = new THREE.Vector3(0, editor.clipboardData.sourcePos?.y ?? editor.ARENA_H * 0.55, 0);

                if (intersectsGround.length > 0) {
                    targetPos.x = intersectsGround[0].point.x;
                    targetPos.z = intersectsGround[0].point.z;
                    if (editor.useSnap) {
                        targetPos.x = Math.round(targetPos.x / editor.snapSize) * editor.snapSize;
                        targetPos.z = Math.round(targetPos.z / editor.snapSize) * editor.snapSize;
                    }
                }

                if (useYLayer) {
                    const baseY = getYLayerValue(editor);
                    targetPos.y = baseY;
                    if (editor.clipboardData.type === 'hard' || editor.clipboardData.type === 'foam') {
                        const sy = editor.clipboardData.sizeY || (editor.clipboardData.sizeInfo * 2);
                        targetPos.y = baseY + sy / 2;
                    }
                } else if (editor.clipboardData.type === 'hard' || editor.clipboardData.type === 'foam') {
                    targetPos.y = editor.ARENA_H * 0.35;
                }

                const extraProps = { ...editor.clipboardData };
                delete extraProps.sourcePos;
                if (extraProps.pointA?.isVector3) extraProps.pointA = extraProps.pointA.clone();
                if (extraProps.pointB?.isVector3) extraProps.pointB = extraProps.pointB.clone();

                if (editor.clipboardData.type === 'tunnel' && editor.clipboardData.pointA && editor.clipboardData.pointB) {
                    const sourcePos = editor.clipboardData.sourcePos?.isVector3
                        ? editor.clipboardData.sourcePos
                        : editor.clipboardData.pointA.clone().lerp(editor.clipboardData.pointB, 0.5);
                    const diff = targetPos.clone().sub(sourcePos);
                    extraProps.pointA = editor.clipboardData.pointA.clone().add(diff);
                    extraProps.pointB = editor.clipboardData.pointB.clone().add(diff);
                }

                const mesh = editor.mapManager.createMesh(
                    editor.clipboardData.type,
                    editor.clipboardData.subType,
                    targetPos.x, targetPos.y, targetPos.z,
                    editor.clipboardData.sizeInfo,
                    extraProps
                );
                if (mesh) editor.selectObject(mesh);
            });
        }
    });
}
