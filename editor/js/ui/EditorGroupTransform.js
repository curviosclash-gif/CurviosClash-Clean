import * as THREE from 'three';

export function bindEditorGroupTransform(editor, getObjects) {
    const pivot = new THREE.Object3D();
    pivot.userData.editorGroupPivot = true;
    editor.core.scene.add(pivot);
    const control = editor.core.transformControl;
    let gesture = null;
    const offset = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);

    editor.syncGroupTransform = () => {
        if (gesture || control.dragging) return control.object === pivot;
        const objects = getObjects();
        if (objects.length < 2 || objects.some((object) => editor.isObjectLocked(object) || !object.visible)) {
            if (control.object === pivot) control.detach();
            return false;
        }
        pivot.position.set(0, 0, 0);
        objects.forEach((object) => pivot.position.add(object.position));
        pivot.position.divideScalar(objects.length);
        pivot.rotation.set(0, 0, 0);
        pivot.scale.setScalar(1);
        control.attach(pivot);
        editor.syncTransformModeUi?.();
        return true;
    };

    editor.beginGroupTransform = () => {
        if (control.object !== pivot) return false;
        editor.beginHistoryGesture('transform', 'Transform group');
        gesture = { center: pivot.position.clone(), objects: getObjects().map((object) => ({
            object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
        })) };
        return true;
    };

    editor.applyGroupTransform = () => {
        if (control.object !== pivot) return false;
        if (!gesture) return true;
        // Axis handles control one uniform group scale; object types without scale
        // still move relative to the shared center, retaining their own dimensions.
        const scaleAxis = String(control.axis || 'XYZ');
        const scale = scaleAxis.includes('X') ? pivot.scale.x : scaleAxis.includes('Y') ? pivot.scale.y : pivot.scale.z;
        if (!(scale > 0)) return true;
        rotation.setFromAxisAngle(axis, pivot.rotation.y);
        editor.mapManager.withSceneMutation(() => {
            for (const saved of gesture.objects) {
                const object = saved.object;
                if (!editor.isManagedObjectAlive(object) || editor.isObjectLocked(object)) continue;
                offset.copy(saved.position).sub(gesture.center).multiplyScalar(scale).applyQuaternion(rotation);
                object.position.copy(pivot.position).add(offset);
                object.quaternion.copy(saved.quaternion).premultiply(rotation);
                if (editor.mapManager.canScaleObject(object)) object.scale.copy(saved.scale).multiplyScalar(scale);
                editor.mapManager.notifyObjectMutated(object, { workspace: false });
            }
        });
        return true;
    };

    editor.endGroupTransform = () => { gesture = null; };
    editor.disposeGroupTransform = () => {
        gesture = null;
        if (control.object === pivot) control.detach();
        pivot.removeFromParent();
    };
}
