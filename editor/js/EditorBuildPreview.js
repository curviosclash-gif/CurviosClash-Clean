import * as THREE from 'three';
import { createEditorMesh } from './EditorMeshFactory.js';
import { getCurrentToolSubtype } from './ui/EditorFormState.js';
import { getEditorTurretAuthoringScale } from './ui/EditorTurretProperties.js';
import { normalizeStaticTurretDefinition } from '../../src/shared/contracts/MapSinglePlayerScenarioContract.js';

/** Unregistered authoring mesh: its transform is the exact placement contract. */
export class EditorBuildPreview {
    constructor(editor, host) {
        this.editor = editor;
        this.host = host;
        this.root = new THREE.Group();
        this.root.name = 'editorBuildPreview';
        this.bounds = new THREE.Box3();
        this.sphere = new THREE.Sphere();
        this.mesh = null;
        this.movingId = null;
        this.materials = [];
        this.changedProperties = new Set();
    }

    clear() {
        if (!this.mesh) return;
        for (const [id, clones] of this.editor.mapManager.assetLoader?.pendingCloneHydrations || []) {
            clones.delete(this.mesh);
            if (!clones.size) this.editor.mapManager.assetLoader.pendingCloneHydrations.delete(id);
        }
        this.root.remove(this.mesh);
        if (!this.borrowedGeometry) this.editor.mapManager.disposeObjectResources(this.mesh);
        this.materials.forEach((material) => material.dispose());
        this.materials = [];
        this.mesh = null;
    }

    attach(mesh, borrowedGeometry = false) {
        this.clear();
        this.borrowedGeometry = borrowedGeometry;
        this.mesh = mesh;
        this.changedProperties.clear();
        if (!mesh) return;
        // Geometry and textures belong to the catalog. Only preview materials are owned here.
        const replaced = new Set();
        mesh.traverse((node) => {
            if (!node.material) return;
            const clone = (material) => {
                const owned = material.clone();
                owned.userData = { ...owned.userData, editorOwnedResource: false };
                if (['hard', 'foam', 'tunnel'].includes(mesh.userData.type)) {
                    owned.transparent = false; owned.opacity = 1;
                }
                this.materials.push(owned);
                if (!borrowedGeometry && material.userData?.editorOwnedResource && !replaced.has(material)) {
                    replaced.add(material);
                    material.dispose();
                }
                return owned;
            };
            node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
        });
        mesh.position.set(0, 0, 0);
        this.root.add(mesh);
        this.renderProperties();
    }

    chooseCatalog() {
        this.movingId = null;
        const { editor } = this;
        const tool = editor.currentTool;
        const subType = getCurrentToolSubtype(editor);
        this.attach(tool === 'select' ? null : createEditorMesh(editor.mapManager, tool, subType, 0, 0, 0, 0,
            { ...(tool === 'turret' ? { turretAuthoringScale: getEditorTurretAuthoringScale(editor) } : {}) },
            { register: false, attachSelectionOutlines: false }));
        if (!this.mesh) this.host.textContent = 'Ein Bauteil im Katalog auswählen.';
    }

    beginMove(object) {
        if (!object || object.userData.editorLocked || object.userData.editorLayerLocked) return false;
        const copy = object.clone(true);
        const outlines = [];
        copy.traverse((node) => { if (node.userData?.isSelectionOutline) outlines.push(node); });
        outlines.forEach((node) => node.removeFromParent());
        copy.userData = { ...object.userData };
        copy.traverse((node) => {
            delete node.userData.id;
            delete node.userData.editorObjectId;
            delete node.userData.editorManagedRoot;
        });
        this.movingId = object.userData.id;
        this.attach(copy, true);
        return true;
    }

    update(position, units) {
        this.refreshLoadedAsset();
        this.root.position.copy(position).multiplyScalar(1 / units);
        this.root.scale.setScalar(1 / units);
        this.root.updateMatrixWorld(true);
    }

    refreshLoadedAsset() {
        const mesh = this.mesh;
        if (!mesh?.userData.isEditorPlaceholder) return;
        const asset = this.editor.mapManager.assetLoader?.cache?.get(mesh.userData.subType);
        if (!asset || asset.userData?.isEditorPlaceholder) return;
        const data = mesh.userData;
        const next = createEditorMesh(this.editor.mapManager, data.type, data.subType, 0, 0, 0, data.sizeInfo,
            { ...data, rotateX: mesh.rotation.x, rotateY: mesh.rotation.y, rotateZ: mesh.rotation.z },
            { register: false, attachSelectionOutlines: false });
        this.attach(next);
    }

    getRadius() {
        if (!this.mesh) return 0;
        this.bounds.setFromObject(this.root).getBoundingSphere(this.sphere);
        return this.sphere.radius;
    }

    confirm(position) {
        if (!this.mesh || this.editor.isActiveLayerLocked?.()) return false;
        const { editor, mesh } = this;
        const manager = editor.mapManager;
        const moving = this.movingId ? manager.getObjectById(this.movingId) : null;
        if (this.movingId && (!moving || moving.userData.editorLocked || moving.userData.editorLayerLocked)) return false;
        let result = null;
        editor.executeHistoryMutation(moving ? 'Move build object' : 'Place build object', () => {
            if (moving) {
                moving.position.copy(position);
                moving.quaternion.copy(mesh.quaternion);
                moving.scale.copy(mesh.scale);
                this.applyProperties(moving);
                manager.syncObjectScaleMetadata(moving);
                manager.syncObjectOrientationMetadata(moving);
                this.syncTunnel(moving);
                manager.notifyObjectMutated(moving);
                result = moving;
            } else {
                const props = { ...mesh.userData, rotateX: mesh.rotation.x, rotateY: mesh.rotation.y, rotateZ: mesh.rotation.z };
                delete props.id; delete props.editorObjectId; delete props.editorManagedRoot;
                delete props.pointA; delete props.pointB;
                result = manager.createMesh(props.type, props.subType, ...position.toArray(), props.sizeInfo, props);
                if (result) {
                    result.scale.copy(mesh.scale);
                    result.quaternion.copy(mesh.quaternion);
                    this.applyProperties(result);
                    manager.syncObjectScaleMetadata(result);
                    manager.syncObjectOrientationMetadata(result);
                    this.syncTunnel(result);
                    manager.notifyObjectMutated(result);
                }
            }
        });
        if (result) editor.selectObject(result);
        this.movingId = null;
        this.renderProperties();
        return !!result;
    }

    syncTunnel(mesh) {
        if (mesh.userData.type !== 'tunnel') return;
        const offset = new THREE.Vector3(0, mesh.scale.y / 2, 0).applyQuaternion(mesh.quaternion);
        mesh.userData.pointA = mesh.position.clone().sub(offset);
        mesh.userData.pointB = mesh.position.clone().add(offset);
        mesh.userData.radius = mesh.scale.x;
    }

    applyProperties(object) {
        const { editor, mesh } = this;
        for (const key of this.changedProperties) {
            if (key !== 'portalPartnerId') object.userData[key] = mesh.userData[key];
        }
        if (this.changedProperties.has('portalPartnerId')) editor.setPortalPartner?.(object, mesh.userData.portalPartnerId);
        const orderKey = object.userData.type === 'checkpoint' ? 'checkpointOrder' : 'escortOrder';
        if (this.changedProperties.has(orderKey)) {
            const route = editor.core.objectsContainer.children.filter((entry) =>
                entry.userData.type === object.userData.type && entry !== object)
                .sort((a, b) => (Number(a.userData[orderKey]) || 0) - (Number(b.userData[orderKey]) || 0));
            route.splice(Math.min(route.length, Math.max(0, Number(mesh.userData[orderKey]) || 0)), 0, object);
            if (orderKey === 'checkpointOrder') editor.normalizeCheckpointOrder?.(route);
            else editor.normalizeEscortOrder?.(route);
        }
    }

    renderProperties() {
        this.host.replaceChildren();
        const { mesh, editor } = this;
        if (!mesh) return;
        const heading = document.createElement('h3');
        heading.textContent = this.movingId ? 'Objekt bewegen – Enter bestätigt' : 'Bauteileigenschaften';
        this.host.append(heading);
        const control = (label, input) => {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;margin:8px 0';
            row.append(document.createTextNode(label), input);
            input.style.width = '110px'; this.host.append(row);
        };
        const field = (label, value, apply, min = null) => {
            const input = document.createElement('input');
            input.type = 'number'; input.step = 'any'; input.value = String(value);
            if (min !== null) input.min = String(min);
            input.addEventListener('change', () => {
                const number = input.value.trim() ? Number(input.value) : NaN;
                if (!Number.isFinite(number) || (min !== null && number < min)) { input.value = String(value); return; }
                apply(number);
            });
            control(label, input);
        };
        const rotationAxes = ['portal', 'checkpoint', 'glb', 'tunnel'].includes(mesh.userData.type)
            ? ['x', 'y', 'z'] : (['hard', 'foam', 'item', 'aircraft'].includes(mesh.userData.type) ? ['y'] : []);
        for (const axis of rotationAxes) {
            field(`Drehung ${axis.toUpperCase()} (°)`, THREE.MathUtils.radToDeg(mesh.rotation[axis]), (value) => {
                mesh.rotation[axis] = THREE.MathUtils.degToRad(value);
                editor.mapManager.syncObjectOrientationMetadata(mesh);
            });
        }
        if (editor.mapManager.canScaleObject(mesh)) {
            const type = mesh.userData.type;
            if (['hard', 'foam', 'tunnel'].includes(type)) {
                const axes = type === 'tunnel' ? ['x', 'y'] : ['x', 'y', 'z'];
                axes.forEach((axis) => field(type === 'tunnel' ? (axis === 'x' ? 'Radius' : 'Länge') : `Größe ${axis.toUpperCase()}`,
                    mesh.scale[axis], (value) => {
                        mesh.scale[axis] = value;
                        editor.mapManager.syncObjectScaleMetadata(mesh, axis.toUpperCase());
                    }, 1));
            } else {
                field('Skalierung', mesh.scale.x, (value) => {
                    mesh.scale.setScalar(value);
                    editor.mapManager.syncObjectScaleMetadata(mesh);
                }, type === 'portal' ? 1 : 0.1);
            }
        }
        const setProperty = (key, value) => { mesh.userData[key] = value; this.changedProperties.add(key); };
        const group = document.createElement('input');
        group.type = 'text'; group.value = mesh.userData.groupId || '';
        group.addEventListener('change', () => setProperty('groupId', group.value.trim()));
        control('Gruppe', group);
        const select = (label, key, choices) => {
            const input = document.createElement('select');
            for (const [value, title] of choices) {
                const option = document.createElement('option'); option.value = value; option.textContent = title;
                input.append(option);
            }
            input.value = mesh.userData[key] || '';
            input.addEventListener('change', () => setProperty(key, input.value));
            control(label, input);
        };
        if (mesh.userData.type === 'portal') {
            select('Portal-Partner', 'portalPartnerId', [['', 'Ohne Partner'],
                ...editor.core.objectsContainer.children.filter((object) => object.userData.type === 'portal'
                    && object.userData.id !== this.movingId).map((object) => [object.userData.id, object.userData.id])]);
        }
        if (['checkpoint', 'escort_waypoint'].includes(mesh.userData.type) && !['finish', 'start', 'goal'].includes(mesh.userData.subType)) {
            const key = mesh.userData.type === 'checkpoint' ? 'checkpointOrder' : 'escortOrder';
            field('Routen-Reihenfolge', mesh.userData[key] || 0, (value) => setProperty(key, Math.floor(value)), 0);
        }
        if (mesh.userData.type === 'turret') {
            const scale = getEditorTurretAuthoringScale(editor);
            for (const [key, label] of [['range', 'Reichweite (Spieleinheiten)'], ['cooldown', 'Schussintervall (s)'], ['maxHp', 'Maximale HP']]) {
                field(label, mesh.userData[key] / (key === 'range' ? scale : 1), (value) => {
                    const normalized = normalizeStaticTurretDefinition({ ...mesh.userData,
                        [key]: value * (key === 'range' ? scale : 1) }, 0, { spatialScale: scale });
                    setProperty(key, normalized[key]);
                }, 0.01);
            }
            select('Raketenstufe', 'rocketType', [['ROCKET_WEAK', 'S'], ['ROCKET_MEDIUM', 'M'], ['ROCKET_HEAVY', 'L']]);
        }
    }

    dispose() { this.clear(); this.root.removeFromParent(); this.host.replaceChildren(); }
}
