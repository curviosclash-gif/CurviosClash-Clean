import * as THREE from 'three';

export function isBuildObjectVisible(object) {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
}

function isPreview(object, preview) {
    for (let node = object; node; node = node.parent) if (node === preview) return true;
    return false;
}

function runtimeEditorObject(object, manager) {
    for (let node = object; node; node = node.parent) {
        const id = node.userData?.glbModelId;
        if (!id) continue;
        return manager.getObjectById(id) || manager.getObjectById(String(id).split('#').at(-1));
    }
    return null;
}

/** Runtime meshes decide visibility/occlusion. Authored geometry only resolves merged mesh identity. */
export function pickBuildTarget(raycaster, runtimeRoot, authoredRoot, manager, units, preview, authoredRay = new THREE.Raycaster(), bindings = null) {
    runtimeRoot.updateMatrixWorld(true);
    runtimeRoot.traverse((node) => {
        if (node.isSkinnedMesh && isBuildObjectVisible(node)) { node.computeBoundingSphere(); node.computeBoundingBox(); }
    });
    const visibleHit = raycaster.intersectObjects(runtimeRoot.children, true).find(({ object }) =>
        object.isMesh && isBuildObjectVisible(object) && !isPreview(object, preview)
        && (Array.isArray(object.material) ? object.material.some((material) => material.visible && !(material.transparent && !material.depthWrite))
            : object.material?.visible && !(object.material.transparent && !object.material.depthWrite)));
    if (!visibleHit) return null;
    const bound = bindings?.resolve(visibleHit.object, manager, visibleHit.instanceId);
    let object = bound?.object || runtimeEditorObject(visibleHit.object, manager);
    const modelRoot = findModelRoot(visibleHit.object);
    if (!object && !modelRoot.userData?.glbModelId) {
        authoredRoot.updateMatrixWorld(true);
        authoredRay.ray.copy(raycaster.ray);
        authoredRay.ray.origin.multiplyScalar(units);
        for (const hit of authoredRay.intersectObjects(authoredRoot.children, true)) {
            if (!hit.object.isMesh || hit.object.userData?.isSelectionOutline || !isBuildObjectVisible(hit.object)) continue;
            // Never select behind the first visible surface, including non-editable scenery.
            if (Math.abs(hit.distance / units - visibleHit.distance) > 0.05) continue;
            const managed = manager.resolveManagedObject(hit.object);
            if (managed && isBuildObjectVisible(managed)) { object = managed; break; }
        }
    }
    if (object && !isBuildObjectVisible(object)) object = null;
    const locked = !!(object?.userData.editorLocked || object?.userData.editorLayerLocked);
    return { object, visual: bound?.visual || (object && runtimeEditorObject(visibleHit.object, manager) ?
        findModelRoot(visibleHit.object) : visibleHit.object), locked,
    status: !object ? 'Nicht bearbeitbar' : locked ? 'Gesperrt' : 'Rechtsklick: auswählen' };
}

function findModelRoot(object) {
    for (let node = object; node; node = node.parent) if (node.userData?.glbModelId) return node;
    return object;
}

export class EditorBuildSelectionVisuals {
    constructor() {
        this.root = new THREE.Group();
        this.root.name = 'editor-build-selection';
        this.hover = new THREE.Box3Helper(new THREE.Box3(), 0x69dbff);
        this.selected = new THREE.Box3Helper(new THREE.Box3(), 0xffcc66);
        this.root.add(this.hover, this.selected);
        this.models = new Map();
        this.runtimeIds = new WeakMap();
        this.instances = new WeakMap();
        this.instanceMatrix = new THREE.Matrix4(); this.instanceBox = new THREE.Box3();
        this.clear();
    }
    bindWorld(root, manager) {
        this.models.clear();
        root.traverse((node) => {
            if (!node.userData?.glbModelId) return;
            const object = runtimeEditorObject(node, manager);
            if (object) this.models.set(object.userData.id, node);
        });
    }
    bind(root, id, manager) {
        if (!root || !manager.getObjectById(id)) return;
        if (root._components) {
            for (const component of root._components) {
                const mesh = component.batch.mesh;
                if (!mesh) continue;
                if (!this.instances.has(mesh)) this.instances.set(mesh, new Map());
                this.instances.get(mesh).set(component.instanceId, { id, visual: root });
            }
            this.models.set(id, root); return;
        }
        if (!root.isObject3D) return;
        this.runtimeIds.set(root, id); this.models.set(id, root);
    }
    bindItems(items, manager) {
        for (const item of items) this.bind(item.mesh, item.anchorKey, manager);
    }
    bindRuntime(runtime, manager) {
        for (const aircraft of runtime.arena._aircraftDecorations || []) this.bind(aircraft.root, aircraft.id, manager);
        for (const turret of runtime.staticTurrets?.turrets || []) this.bind(turret.root, turret.id, manager);
        for (const ring of runtime.arena.checkpointRings || []) this.bind(ring.mesh, ring.checkpointId, manager);
        for (const pair of runtime.arena.portals || []) {
            this.bind(pair.meshA, pair.sourceIdA, manager);
            this.bind(pair.meshB, pair.sourceIdB, manager);
        }
        this.bindItems(runtime.powerups?.items || [], manager);
    }
    resolve(object, manager, instanceId) {
        const instance = this.instances.get(object)?.get(instanceId);
        if (instance) return { object: manager.getObjectById(instance.id), visual: instance.visual };
        for (let node = object; node; node = node.parent) {
            const id = this.runtimeIds.get(node);
            if (id) return { object: manager.getObjectById(id), visual: node };
        }
        return null;
    }
    show(helper, target, units) {
        helper.visible = !!target?.object && isBuildObjectVisible(target.object)
            && (!target.visual || isBuildObjectVisible(target.visual));
        if (!helper.visible) return;
        if (target.visual?._components) {
            helper.box.makeEmpty();
            for (const component of target.visual._components) {
                const mesh = component.batch.mesh;
                if (!mesh?.visible) continue;
                if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
                mesh.getMatrixAt(component.instanceId, this.instanceMatrix);
                this.instanceMatrix.premultiply(mesh.matrixWorld);
                this.instanceBox.copy(mesh.geometry.boundingBox).applyMatrix4(this.instanceMatrix);
                helper.box.union(this.instanceBox);
            }
            helper.visible = !helper.box.isEmpty();
        } else if (target.visual?.userData?.glbModelId || this.runtimeIds.has(target.visual)) helper.box.setFromObject(target.visual, true);
        else {
            helper.box.setFromObject(target.object);
            helper.box.min.multiplyScalar(1 / units); helper.box.max.multiplyScalar(1 / units);
        }
    }
    clear() {
        this.hover.visible = false; this.selected.visible = false; this.root.removeFromParent();
        this.models.clear(); this.runtimeIds = new WeakMap();
        this.instances = new WeakMap();
    }
    dispose() {
        this.clear();
        for (const helper of [this.hover, this.selected]) { helper.geometry.dispose(); helper.material.dispose(); }
    }
}
