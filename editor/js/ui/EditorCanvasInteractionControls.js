import * as THREE from 'three';
import { getCurrentToolSubtype, getYLayerValue, isYLayerEnabled } from './EditorFormState.js';

export function bindEditorCanvasInteractionControls(editor) {
    if (!editor) return;

    let isDraggingTransform = false;

    editor.core.transformControl.addEventListener('dragging-changed', (e) => {
        isDraggingTransform = e.value;
        if (e.value) {
            const activeObject = editor.core.transformControl.object;
            const managed = editor.mapManager?.resolveManagedObject?.(activeObject) || activeObject;
            if (managed && editor.isManagedObjectAlive(managed)) {
                editor.beginHistoryGesture('transform', `Transform ${managed.userData?.type || 'object'}`);
            }
        } else {
            editor.commitHistoryGesture('transform');
        }
    });

    editor.core.transformControl.addEventListener('objectChange', () => {
        const activeObject = editor.core.transformControl.object;
        if (!activeObject) return;

        const managedObject = editor.mapManager?.notifyObjectMutated?.(activeObject) || activeObject;
        if (!editor.isManagedObjectAlive(managedObject)) {
            editor.detachTransformControl();
            if (editor.selectedObject && !editor.isManagedObjectAlive(editor.selectedObject)) {
                editor.selectObject(null);
            }
            return;
        }

        if (managedObject === editor.selectedObject) {
            editor.showPropPanel(managedObject);
        }
    });

    const getGroundPos = (e) => {
        const rect = editor.core.container.getBoundingClientRect();
        editor.mouse.x = ((e.clientX - rect.left) / editor.core.container.clientWidth) * 2 - 1;
        editor.mouse.y = -((e.clientY - rect.top) / editor.core.container.clientHeight) * 2 + 1;
        editor.raycaster.setFromCamera(editor.mouse, editor.core.camera);

        const useYLayer = isYLayerEnabled(editor);
        const targetMesh = useYLayer ? editor.core.yGroundMesh : editor.core.groundMesh;

        const intersectsGround = editor.raycaster.intersectObject(targetMesh);
        if (intersectsGround.length > 0) {
            const p = intersectsGround[0].point;
            if (editor.useSnap) {
                p.x = Math.round(p.x / editor.snapSize) * editor.snapSize;
                p.z = Math.round(p.z / editor.snapSize) * editor.snapSize;
            }
            return p;
        }
        return null;
    };

    editor.core.container.addEventListener('pointerdown', (e) => {
        if (isDraggingTransform) return;
        if (e.button !== 0) return;

        const rect = editor.core.container.getBoundingClientRect();
        editor.mouse.x = ((e.clientX - rect.left) / editor.core.container.clientWidth) * 2 - 1;
        editor.mouse.y = -((e.clientY - rect.top) / editor.core.container.clientHeight) * 2 + 1;
        editor.raycaster.setFromCamera(editor.mouse, editor.core.camera);

        if (editor.currentTool === "select") {
            const intersects = editor.raycaster.intersectObjects(editor.core.objectsContainer.children, true);
            if (intersects.length > 0) {
                editor.selectObject(editor.resolveSelectableObject(intersects[0].object));
            } else {
                editor.selectObject(null);
            }
            return;
        }

        const p = getGroundPos(e);
        if (!p) return;

        editor.selectObject(null);
        editor.beginHistoryGesture('draw', `Create ${editor.currentTool}`);
        editor.isDrawing = true;

        const useYLayer = isYLayerEnabled(editor);
        let y = useYLayer
            ? getYLayerValue(editor)
            : ((editor.currentTool === 'hard' || editor.currentTool === 'foam') ? editor.ARENA_H * 0.35 : editor.ARENA_H * 0.55);

        if (useYLayer && (editor.currentTool === 'hard' || editor.currentTool === 'foam')) {
            y += (editor.ARENA_H * 0.7) / 2;
        }

        editor.drawStartPos = { x: p.x, y, z: p.z };

        const subType = getCurrentToolSubtype(editor);

        editor.previewMesh = editor.mapManager.createMesh(editor.currentTool, subType, p.x, y, p.z, 0, {
            sizeX: editor.snapSize,
            sizeZ: editor.snapSize,
            sizeY: editor.ARENA_H * 0.7,
            pointA: new THREE.Vector3(p.x, y, p.z),
            pointB: new THREE.Vector3(p.x, y, p.z)
        });

        if (editor.previewMesh) {
            editor.setSelectionOutline(editor.previewMesh, 0xffff00, 0.65);
        } else {
            editor.cancelHistoryGesture('draw');
        }
    });

    editor.core.container.addEventListener('pointermove', (e) => {
        if (!editor.isDrawing || !editor.previewMesh) return;
        if (!editor.isManagedObjectAlive(editor.previewMesh)) {
            editor.cancelHistoryGesture('draw');
            editor.clearDrawingState();
            return;
        }

        const curr = getGroundPos(e);
        if (!curr) return;

        const start = editor.drawStartPos;
        const tool = editor.previewMesh.userData.type;

        if (tool === 'hard' || tool === 'foam') {
            const minSize = editor.useSnap ? editor.snapSize : 10;
            const w = Math.max(minSize, Math.abs(curr.x - start.x));
            const d = Math.max(minSize, Math.abs(curr.z - start.z));
            const cx = (start.x + curr.x) / 2;
            const cz = (start.z + curr.z) / 2;

            editor.previewMesh.position.set(cx, start.y, cz);
            editor.previewMesh.scale.set(w, editor.ARENA_H * 0.7, d);
            editor.previewMesh.userData.sizeX = w;
            editor.previewMesh.userData.sizeZ = d;
            editor.previewMesh.userData.sizeY = editor.ARENA_H * 0.7;
            editor.previewMesh.userData.sizeInfo = Math.max(w, d, editor.ARENA_H * 0.7) * 0.5;
        } else if (tool === 'tunnel') {
            const pA = new THREE.Vector3(start.x, start.y, start.z);
            const pB = new THREE.Vector3(curr.x, start.y, curr.z);
            if (pA.distanceTo(pB) > 0.1) {
                editor.mapManager.alignTunnelSegment(editor.previewMesh, pA, pB, 160);
            }
        } else {
            editor.previewMesh.position.set(curr.x, start.y, curr.z);
        }
    });

    editor.core.container.addEventListener('pointerup', () => {
        if (!editor.isDrawing || !editor.previewMesh) return;

        editor.isDrawing = false;
        if (editor.isManagedObjectAlive(editor.previewMesh)) {
            editor.setSelectionOutline(editor.previewMesh, 0x000000, 0.2);
            editor.selectObject(editor.previewMesh);
        }
        editor.previewMesh = null;
        editor.drawStartPos = null;
        editor.commitHistoryGesture('draw');
    });
}
