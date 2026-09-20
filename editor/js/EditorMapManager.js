import * as THREE from 'three';
import { createEditorMesh, alignTunnelSegment as alignTunnelSegmentMesh } from './EditorMeshFactory.js';
import { EditorObjectRegistry } from './EditorObjectRegistry.js';
import { generateJSONExport, importFromJSON } from './EditorMapSerializer.js';

const SCALABLE_OBJECT_TYPES = new Set(['hard', 'foam', 'tunnel', 'portal', 'aircraft', 'glb', 'checkpoint', 'escort_waypoint']);
const CHECKPOINT_SCALE_FACTOR = 14;

/**
 * @typedef {{
 *   onTunnelVisualsChanged?: (...args: any[]) => void,
 *   onHudCountChanged?: (...args: any[]) => void,
 *   onSceneChanged?: (...args: any[]) => void,
 *   onObjectCreationRejected?: (...args: any[]) => void,
 *   onBeforeManagedObjectRemoved?: (...args: any[]) => void,
 *   onBeforeManagedObjectsCleared?: (...args: any[]) => void,
 * }} EditorMapCallbacks
 */

export class EditorMapManager {
    constructor(core, assetLoader, options = {}) {
        this.core = core;
        this.assetLoader = assetLoader;
        /** @type {EditorMapCallbacks} */
        this.callbacks = {
            onTunnelVisualsChanged: null,
            onHudCountChanged: null,
            onSceneChanged: null,
            onObjectCreationRejected: null,
            onBeforeManagedObjectRemoved: null,
            onBeforeManagedObjectsCleared: null
        };

        this.registry = new EditorObjectRegistry(core);

        this._sceneMutationDepth = 0;
        this._pendingHudRefresh = false;
        this._pendingTunnelVisualRefresh = false;
        this._pendingSceneRefresh = false;
        this.mapDocumentMeta = {};
        this.lastSchemaWarnings = [];
        this.authoringMetadataProvider = null;
        this._orientationForward = new THREE.Vector3();

        this.setCallbacks(options?.callbacks || options);
        this.setupPrimitives();
        this.assetLoader?.setCloneHydrationHandler?.((target, replacement) => {
            this.hydrateAssetClone(target, replacement);
        });
    }

    /** @param {EditorMapCallbacks} [callbacks] */
    setCallbacks(callbacks = {}) {
        if (!callbacks || typeof callbacks !== 'object') return;

        if (typeof callbacks.onTunnelVisualsChanged === 'function') {
            this.callbacks.onTunnelVisualsChanged = callbacks.onTunnelVisualsChanged;
        }
        if (typeof callbacks.onHudCountChanged === 'function') {
            this.callbacks.onHudCountChanged = callbacks.onHudCountChanged;
        }
        if (typeof callbacks.onSceneChanged === 'function') {
            this.callbacks.onSceneChanged = callbacks.onSceneChanged;
        }
        if (typeof callbacks.onObjectCreationRejected === 'function') {
            this.callbacks.onObjectCreationRejected = callbacks.onObjectCreationRejected;
        }
        if (typeof callbacks.onBeforeManagedObjectRemoved === 'function') {
            this.callbacks.onBeforeManagedObjectRemoved = callbacks.onBeforeManagedObjectRemoved;
        }
        if (typeof callbacks.onBeforeManagedObjectsCleared === 'function') {
            this.callbacks.onBeforeManagedObjectsCleared = callbacks.onBeforeManagedObjectsCleared;
        }
    }

    setupPrimitives() {
        this.blockGeo = new THREE.BoxGeometry(1, 1, 1);
        this.sphereGeo = new THREE.SphereGeometry(1, 16, 16);
        this.cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
        this.torusGeo = new THREE.TorusGeometry(1, 0.3, 16, 32);
        this.torusKnotGeo = new THREE.TorusKnotGeometry(1, 0.3, 64, 8);
        this.coneGeo = new THREE.ConeGeometry(1, 2, 8);

        this.mats = {
            hard: new THREE.MeshLambertMaterial({ color: 0xf97373, transparent: true, opacity: 0.8 }),
            foam: new THREE.MeshLambertMaterial({ color: 0x34d399, transparent: true, opacity: 0.8 }),
            tunnel: new THREE.MeshLambertMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.5 }),
            portal: new THREE.MeshLambertMaterial({ color: 0xc084fc }),
            playerSpawn: new THREE.MeshLambertMaterial({ color: 0xeab308 }),
            botSpawn: new THREE.MeshLambertMaterial({ color: 0xef4444 }),
            item_fallback: new THREE.MeshLambertMaterial({ color: 0x64748b }),
            aircraft_fallback: new THREE.MeshLambertMaterial({ color: 0xc084fc }),
            checkpoint: new THREE.MeshLambertMaterial({ color: 0xaaff00, transparent: true, opacity: 0.7 }),
            checkpoint_finish: new THREE.MeshLambertMaterial({ color: 0xffd700, transparent: true, opacity: 0.7 }),
            escort_waypoint: new THREE.MeshLambertMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.78 }),
            escort_checkpoint: new THREE.MeshLambertMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 }),
            escort_goal: new THREE.MeshLambertMaterial({ color: 0x70ff45, transparent: true, opacity: 0.9 }),
        };
    }

    beginSceneMutation() {
        this._sceneMutationDepth += 1;
    }

    endSceneMutation() {
        this._sceneMutationDepth = Math.max(0, this._sceneMutationDepth - 1);
        if (this._sceneMutationDepth === 0) {
            this.flushSceneUiRefresh();
        }
    }

    withSceneMutation(fn) {
        this.beginSceneMutation();
        try {
            return fn();
        } finally {
            this.endSceneMutation();
        }
    }

    queueSceneUiRefresh({ tunnelVisuals = false, workspace = true } = {}) {
        this._pendingHudRefresh = true;
        this._pendingSceneRefresh = this._pendingSceneRefresh || workspace;
        this._pendingTunnelVisualRefresh = this._pendingTunnelVisualRefresh || tunnelVisuals;

        if (this._sceneMutationDepth === 0) {
            this.flushSceneUiRefresh();
        }
    }

    flushSceneUiRefresh() {
        if (this._pendingTunnelVisualRefresh) {
            this.callbacks.onTunnelVisualsChanged?.();
        }
        if (this._pendingHudRefresh) {
            this.callbacks.onHudCountChanged?.();
        }
        if (this._pendingSceneRefresh) {
            this.callbacks.onSceneChanged?.();
        }

        this._pendingHudRefresh = false;
        this._pendingTunnelVisualRefresh = false;
        this._pendingSceneRefresh = false;
    }

    getObjectCount() {
        return this.registry.getObjectCount();
    }

    getObjectById(id) {
        return this.registry.getObjectById(id);
    }

    queryObjectsNear(position, radius) {
        return this.registry.queryNear(position, radius);
    }

    setAuthoringMetadataProvider(provider) {
        this.authoringMetadataProvider = typeof provider === 'function' ? provider : null;
    }

    hasObjectId(id) {
        return this.registry.hasObjectId(id);
    }

    isRegisteredObject(object) {
        return this.registry.isRegisteredObject(object);
    }

    resolveManagedObject(object) {
        return this.registry.resolveManagedObject(object);
    }

    normalizeRequestedId(requestedId) {
        return this.registry.normalizeRequestedId(requestedId);
    }

    generateObjectId(type) {
        return this.registry.generateObjectId(type);
    }

    allocateObjectId(type, requestedId = null) {
        return this.registry.allocateObjectId(type, requestedId);
    }

    markManagedHierarchy(rootObject, objectId) {
        this.registry.markManagedHierarchy(rootObject, objectId);
    }

    markOwnedResource(resource) {
        if (!resource || typeof resource !== 'object') return resource;
        resource.userData = {
            ...(resource.userData || {}),
            editorOwnedResource: true
        };
        return resource;
    }

    createTunnelTrailMesh(subType) {
        if (typeof subType !== 'string' || !subType.startsWith('trail_')) return null;
        const asset = this.assetLoader?.getClone?.(subType);
        if (!asset) return null;

        // Trail OBJ meshes are modeled along Z; rotate to Y so alignTunnelSegment() can orient/stretch them.
        asset.rotation.x = -Math.PI / 2;

        // Normalize base dimensions so wrapper scaling maps roughly to radius/length semantics.
        if (subType === 'trail_segment') {
            asset.scale.set(1, 1, 0.4);
        } else if (subType === 'trail_arrow') {
            asset.scale.set(0.625, 0.625, 0.2);
        }

        const wrapper = new THREE.Group();
        wrapper.name = `tunnel_${subType}`;
        wrapper.add(asset);
        return wrapper;
    }

    createSelectionOutline(geometry) {
        const outlineGeometry = this.markOwnedResource(new THREE.EdgesGeometry(geometry));
        const outlineMaterial = this.markOwnedResource(new THREE.LineBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.2
        }));

        const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
        outline.userData = {
            ...(outline.userData || {}),
            isSelectionOutline: true
        };
        return outline;
    }

    attachSelectionOutlines(object) {
        object.traverse((child) => {
            if (!child?.isMesh || !child.geometry) return;
            child.add(this.createSelectionOutline(child.geometry));
        });
    }

    registerObject(mesh, { requestedId = null, updateUi = true } = {}) {
        const registered = this.registry.registerObject(mesh, { requestedId });
        if (!registered) return null;

        if (updateUi) {
            this.queueSceneUiRefresh({ tunnelVisuals: registered.userData.type === 'tunnel' });
        }

        return registered;
    }

    shouldDisposeGeometry(node) {
        return !!(node?.userData?.isSelectionOutline || node?.geometry?.userData?.editorOwnedResource);
    }

    shouldDisposeMaterial(node, material) {
        return !!(node?.userData?.isSelectionOutline || material?.userData?.editorOwnedResource);
    }

    disposeObjectResources(rootObject) {
        if (!rootObject) return;

        const disposedGeometries = new Set();
        const disposedMaterials = new Set();

        rootObject.traverse((node) => {
            if (node.geometry && this.shouldDisposeGeometry(node) && !disposedGeometries.has(node.geometry)) {
                disposedGeometries.add(node.geometry);
                node.geometry.dispose?.();
            }

            const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
            for (const material of materials) {
                if (!material || disposedMaterials.has(material) || !this.shouldDisposeMaterial(node, material)) continue;
                disposedMaterials.add(material);
                material.dispose?.();
            }
        });
    }

    hydrateAssetClone(target, replacement) {
        const rootObject = this.resolveManagedObject(target);
        if (!rootObject || rootObject !== target) {
            this.disposeObjectResources(replacement);
            return false;
        }

        const userData = { ...target.userData };
        this.disposeObjectResources(target);
        target.clear();
        while (replacement.children.length > 0) {
            target.add(replacement.children[0]);
        }
        target.userData = {
            ...userData,
            ...replacement.userData,
            isEditorPlaceholder: false,
        };
        this.attachSelectionOutlines(target);
        this.markManagedHierarchy(target, target.userData.id);
        this.notifyObjectMutated(target);
        return true;
    }

    removeObject(object, { updateUi = true } = {}) {
        const rootObject = this.resolveManagedObject(object);
        if (!rootObject) return false;

        const objectId = rootObject.userData?.id;
        const isTunnel = rootObject.userData?.type === 'tunnel';

        this.callbacks.onBeforeManagedObjectRemoved?.(rootObject);

        if (this.core.transformControl.object === rootObject) {
            this.core.transformControl.detach();
        }

        if (rootObject.parent) {
            rootObject.parent.remove(rootObject);
        }

        if (typeof objectId === 'string') {
            this.registry.unregisterObjectById(objectId);
        }

        this.disposeObjectResources(rootObject);

        if (updateUi) {
            this.queueSceneUiRefresh({ tunnelVisuals: isTunnel });
        }

        return true;
    }

    clearAllObjects() {
        this.withSceneMutation(() => {
            this.callbacks.onBeforeManagedObjectsCleared?.();
            this.mapDocumentMeta = {};
            this.lastSchemaWarnings = [];

            const objects = [...this.core.objectsContainer.children];
            for (const object of objects) {
                this.removeObject(object, { updateUi: false });
            }

            // Ensure visuals are fully reset even if no tunnel object existed in the registry.
            this.queueSceneUiRefresh({ tunnelVisuals: true });
        });
    }

    notifyObjectMutated(object, options = {}) {
        const rootObject = this.resolveManagedObject(object);
        if (!rootObject) return null;
        this.syncObjectScaleMetadata(rootObject, options.scaleAxis);
        this.syncObjectOrientationMetadata(rootObject);

        if (rootObject.userData?.type === 'tunnel') {
            this.syncTunnelEndpointsFromMesh(rootObject);
            this.registry.updateObjectSpatial(rootObject);
            this.queueSceneUiRefresh({ tunnelVisuals: true, workspace: options.workspace !== false });
        } else {
            this.registry.updateObjectSpatial(rootObject);
            this.queueSceneUiRefresh({ workspace: options.workspace !== false });
        }

        return rootObject;
    }

    canScaleObject(object) {
        const rootObject = this.resolveManagedObject(object) || object;
        return SCALABLE_OBJECT_TYPES.has(rootObject?.userData?.type);
    }

    syncObjectScaleMetadata(object, scaleAxis = '') {
        const rootObject = this.resolveManagedObject(object) || object;
        if (!this.canScaleObject(rootObject)) return;

        const userData = rootObject.userData;
        const axisValue = scaleAxis === 'Y'
            ? rootObject.scale.y
            : (scaleAxis === 'Z' ? rootObject.scale.z : rootObject.scale.x);

        if (userData.type === 'hard' || userData.type === 'foam') {
            rootObject.scale.set(
                Math.max(1, rootObject.scale.x),
                Math.max(1, rootObject.scale.y),
                Math.max(1, rootObject.scale.z),
            );
            userData.sizeX = rootObject.scale.x;
            userData.sizeY = rootObject.scale.y;
            userData.sizeZ = rootObject.scale.z;
            userData.sizeInfo = Math.max(userData.sizeX, userData.sizeY, userData.sizeZ) * 0.5;
        } else if (userData.type === 'tunnel') {
            const radius = Math.max(1, scaleAxis === 'Z' ? rootObject.scale.z : rootObject.scale.x);
            rootObject.scale.set(radius, Math.max(1, rootObject.scale.y), radius);
            userData.radius = radius;
            userData.sizeInfo = radius;
        } else {
            const minimum = userData.type === 'portal' ? 1 : 0.1;
            const scalar = Math.max(minimum, axisValue);
            rootObject.scale.setScalar(scalar);
            if (userData.type === 'portal') {
                userData.radius = scalar;
                userData.sizeInfo = scalar;
            } else if (userData.type === 'aircraft') {
                userData.modelScale = scalar;
            } else if (userData.type === 'glb') {
                if (Number(userData.targetSize) > 0) userData.targetSize = scalar;
                else userData.glbScale = scalar;
            } else if (userData.type === 'checkpoint') {
                userData.cpRadius = scalar / CHECKPOINT_SCALE_FACTOR;
            } else if (userData.type === 'escort_waypoint') {
                userData.routeRadius = scalar / 10;
            }
        }
    }

    syncObjectOrientationMetadata(object) {
        const rootObject = this.resolveManagedObject(object) || object;
        const type = rootObject?.userData?.type;
        if (type !== 'portal' && type !== 'checkpoint') return;

        const forward = this._orientationForward
            .set(0, 0, 1)
            .applyQuaternion(rootObject.quaternion)
            .normalize()
            .toArray();
        if (type === 'portal') rootObject.userData.forward = forward;
        else rootObject.userData.cpForward = forward;
    }

    createMesh(type, subType, x, y, z, sizeInfo, extraProps = {}, options = {}) {
        const singletonObject = this.core.objectsContainer.children.find((object) => (
            (type === 'spawn' && subType === 'player' && object.userData?.type === 'spawn' && object.userData?.subType === 'player')
            || (type === 'checkpoint' && subType === 'finish' && object.userData?.type === 'checkpoint' && object.userData?.subType === 'finish')
            || (type === 'escort_waypoint' && ['start', 'goal'].includes(subType)
                && object.userData?.type === 'escort_waypoint' && object.userData?.subType === subType)
        ));
        if (singletonObject) {
            this.callbacks.onObjectCreationRejected?.({ type, subType, existingObject: singletonObject });
            return null;
        }
        const authoringMetadata = this.authoringMetadataProvider?.(type, subType) || {};
        const routeMetadata = type === 'escort_waypoint' && !Number.isFinite(Number(extraProps?.escortOrder))
            ? { escortOrder: this.core.objectsContainer.children.filter((object) => object.userData?.type === 'escort_waypoint').length }
            : {};
        return createEditorMesh(this, type, subType, x, y, z, sizeInfo, {
            ...authoringMetadata,
            ...routeMetadata,
            ...extraProps,
        }, options);
    }

    alignTunnelSegment(mesh, pA, pB, radius) {
        alignTunnelSegmentMesh(mesh, pA, pB, radius);
    }

    syncTunnelEndpointsFromMesh(mesh) {
        const rootObject = this.resolveManagedObject(mesh) || mesh;
        if (!rootObject || rootObject.userData?.type !== 'tunnel') return;

        const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(rootObject.quaternion).normalize();
        const halfLength = Math.max(0, rootObject.scale.y * 0.5);
        const center = rootObject.position.clone();

        rootObject.userData.pointA = center.clone().addScaledVector(direction, -halfLength);
        rootObject.userData.pointB = center.clone().addScaledVector(direction, halfLength);
        rootObject.userData.radius = rootObject.scale.x || rootObject.userData.radius || 160;
    }

    generateJSONExport(arenaSize) {
        return generateJSONExport(this, arenaSize);
    }

    importFromJSON(jsonString, options = {}) {
        importFromJSON(this, jsonString, options);
    }
}
