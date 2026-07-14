import * as THREE from 'three';
import { createVehicleMesh } from '../../entities/vehicle-registry.js';
import { resolveHangarPart, resolveVehicleHardpoints } from './HangarPartCatalog.js';

const _bounds = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const HANGAR_VEHICLE_TARGET_SIZE = 4.1;

function disposeExternalVehicle(node) {
    if (!node) return;
    if (typeof node.dispose === 'function') {
        try { node.dispose(); } catch { /* external vehicle cleanup is best effort */ }
        return;
    }
    node.traverse?.((child) => {
        child.geometry?.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach((material) => material.dispose?.());
    });
}

export class HangarVehicleAssembly {
    constructor(sceneRoot) {
        this.group = new THREE.Group();
        this.group.name = 'HangarVehicleAssembly';
        sceneRoot.add(this.group);
        this.baseVehicleRoot = new THREE.Group();
        this.partsRoot = new THREE.Group();
        this.ghostRoot = new THREE.Group();
        this.group.add(this.baseVehicleRoot, this.partsRoot, this.ghostRoot);
        this.geometryCache = new Map();
        this.materials = new Set();
        this.partNodes = new Map();
        this.hardpoints = new Map();
        this.vehicleNode = null;
        this.vehicleLoadedHandler = null;
        this.vehicleId = '';
        this.selectedSlotId = '';
    }

    _geometry(key, factory) {
        if (!this.geometryCache.has(key)) this.geometryCache.set(key, factory());
        return this.geometryCache.get(key);
    }

    _material(color, options = {}) {
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: options.roughness ?? 0.32,
            metalness: options.metalness ?? 0.68,
            transparent: options.transparent === true,
            opacity: options.opacity ?? 1,
            emissive: options.emissive ?? 0x000000,
            emissiveIntensity: options.emissiveIntensity ?? 0,
        });
        this.materials.add(material);
        return material;
    }

    _createPartNode(part, { ghost = false, valid = true } = {}) {
        const style = String(part.appearance?.style || 'standard');
        const color = ghost
            ? (valid ? 0x34d399 : 0xfb4558)
            : (Number(part.appearance?.color) || ({ T1: 0x6aaeea, T2: 0x9b7cff, T3: 0xf4b942 }[part.tier] || 0x6aaeea));
        const material = this._material(color, {
            transparent: ghost,
            opacity: ghost ? 0.48 : 0.92,
            emissive: ghost ? color : 0x07111c,
            emissiveIntensity: ghost ? 0.65 : (style === 'experimental' ? 0.42 : 0.18),
        });
        const root = new THREE.Group();
        const light = style === 'light';
        const reinforced = style === 'reinforced';
        const experimental = style === 'experimental';
        const add = (geometry, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.fromArray(position);
            mesh.scale.fromArray(scale);
            mesh.rotation.fromArray(rotation);
            mesh.userData.hangarPartId = part.id;
            mesh.userData.hangarGhost = ghost;
            root.add(mesh);
            return mesh;
        };
        const tierScale = part.tier === 'T3' ? 1.18 : (part.tier === 'T2' ? 1.08 : 1);
        if (part.visual === 'core') {
            const bodyScale = light ? [0.78, 1.12, 0.78] : (reinforced ? [1.2, 1, 1.2] : [1, 1, 1]);
            add(this._geometry('part-core', () => new THREE.OctahedronGeometry(0.34, 1)), [0, 0, 0], bodyScale.map((value) => value * tierScale));
            add(this._geometry('part-core-ring', () => new THREE.TorusGeometry(0.38, 0.035, 8, 24)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (reinforced) add(this._geometry('part-core-armor', () => new THREE.BoxGeometry(0.62, 0.18, 0.62)), [0, -0.16, 0]);
            if (experimental) add(this._geometry('part-core-reactor-ring', () => new THREE.TorusGeometry(0.48, 0.045, 8, 24)), [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
        } else if (part.visual === 'nose') {
            const noseScale = light ? [0.72, 1.28, 0.72] : (reinforced ? [1.28, 0.9, 1.28] : (experimental ? [0.82, 1.5, 0.82] : [1, 1, 1]));
            add(this._geometry('part-nose', () => new THREE.ConeGeometry(0.22, 0.58, 16)), [0, 0, 0], noseScale.map((value) => value * tierScale));
            add(this._geometry('part-nose-fin', () => new THREE.BoxGeometry(0.07, 0.22, 0.34)), [0, -0.05, 0.08]);
            if (reinforced) add(this._geometry('part-nose-armor', () => new THREE.BoxGeometry(0.5, 0.16, 0.34)), [0, 0.18, 0]);
            if (experimental) add(this._geometry('part-nose-blade', () => new THREE.BoxGeometry(0.46, 0.05, 0.28)), [0, -0.1, 0.08]);
        } else if (part.visual === 'wing') {
            const wingScale = light ? [1.12, 0.7, 0.72] : (reinforced ? [1.1, 1.6, 1.18] : (experimental ? [1.28, 0.72, 0.88] : [1, 1, 1]));
            add(this._geometry('part-wing', () => new THREE.BoxGeometry(0.78, 0.08, 0.38)), [0, 0, 0], [wingScale[0] * tierScale, wingScale[1], wingScale[2] * tierScale]);
            add(this._geometry('part-wing-tip', () => new THREE.ConeGeometry(0.09, 0.34, 8)), [0.36, 0.07, 0], [1, 1, 1], [0, 0, -Math.PI / 2]);
            if (reinforced) add(this._geometry('part-wing-armor', () => new THREE.BoxGeometry(0.48, 0.12, 0.5)), [-0.08, 0.08, 0]);
            if (experimental) add(this._geometry('part-wing-rear-fin', () => new THREE.ConeGeometry(0.08, 0.3, 8)), [-0.3, 0.08, 0.12], [1, 1, 1], [Math.PI / 2, 0, 0]);
        } else if (part.visual === 'engine') {
            const engineScale = light ? [0.82, 1.08, 0.82] : (reinforced ? [1.14, 1.12, 1.14] : (experimental ? [1.18, 1.38, 1.18] : [1, 1, 1]));
            add(this._geometry('part-engine', () => new THREE.CylinderGeometry(0.2, 0.25, 0.54, 16)), [0, 0, 0], engineScale.map((value) => value * tierScale));
            add(this._geometry('part-engine-nozzle', () => new THREE.TorusGeometry(0.21, 0.045, 8, 18)), [0, -0.28, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (reinforced) add(this._geometry('part-engine-vector-ring', () => new THREE.TorusGeometry(0.29, 0.035, 8, 18)), [0, 0.1, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (experimental) add(this._geometry('part-engine-nova-ring', () => new THREE.TorusGeometry(0.31, 0.055, 8, 18)), [0, -0.34, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
        } else if (part.visual === 'lab') {
            const size = part.appearance?.size || [1, 1, 1];
            const shape = part.appearance?.geometry;
            const geometry = shape === 'sphere'
                ? this._geometry('lab-sphere', () => new THREE.SphereGeometry(0.28, 16, 10))
                : shape === 'cylinder'
                    ? this._geometry('lab-cylinder', () => new THREE.CylinderGeometry(0.22, 0.22, 0.5, 14))
                    : this._geometry('lab-box', () => new THREE.BoxGeometry(0.52, 0.24, 0.42));
            add(geometry, [0, 0, 0], size.map((value) => Math.max(0.35, Math.min(1.4, Number(value) || 1))));
        } else {
            add(this._geometry('part-utility', () => new THREE.TorusGeometry(0.25, 0.07, 8, 20)));
            add(this._geometry('part-utility-orb', () => new THREE.SphereGeometry(0.11, 12, 8)));
            if (light) add(this._geometry('part-utility-light-ring', () => new THREE.TorusGeometry(0.34, 0.025, 8, 20)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (reinforced) add(this._geometry('part-utility-shield', () => new THREE.SphereGeometry(0.22, 12, 8)), [0, 0, 0], [1.2, 0.45, 1.2]);
            if (experimental) add(this._geometry('part-utility-overclock', () => new THREE.TorusGeometry(0.37, 0.04, 8, 20)), [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
        }
        root.userData.hangarPartId = part.id;
        root.userData.hangarGhost = ghost;
        return root;
    }

    _applyHardpointTransform(node, hardpoint) {
        node.position.fromArray(hardpoint.position);
        node.rotation.fromArray(hardpoint.rotation);
        node.scale.setScalar(hardpoint.scale);
    }

    _disposeNodeMaterials(root) {
        root.traverse((node) => {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.filter(Boolean).forEach((material) => {
                material.dispose();
                this.materials.delete(material);
            });
        });
    }

    _detachVehicleLoadedHandler() {
        if (!this.vehicleNode || !this.vehicleLoadedHandler) return;
        this.vehicleNode.removeEventListener?.('loaded', this.vehicleLoadedHandler);
        this.vehicleLoadedHandler = null;
    }

    _normalizeVehicleNode(vehicleNode) {
        if (!vehicleNode || vehicleNode !== this.vehicleNode) return false;
        this.baseVehicleRoot.scale.setScalar(1);
        this.baseVehicleRoot.position.set(0, 0, 0);
        vehicleNode.position.set(0, 0, 0);
        vehicleNode.updateWorldMatrix?.(true, true);
        _bounds.setFromObject(vehicleNode);
        if (_bounds.isEmpty()) return false;
        _bounds.getSize(_size);
        _bounds.getCenter(_center);
        const longest = Math.max(0.001, _size.x, _size.y, _size.z);
        const scale = Math.min(1.45, Math.max(0.55, HANGAR_VEHICLE_TARGET_SIZE / longest));
        vehicleNode.position.copy(_center).multiplyScalar(-1);
        this.baseVehicleRoot.scale.setScalar(scale);
        this.baseVehicleRoot.position.y = -0.05;
        return true;
    }

    setVehicle(vehicleId, color = '#66b6ff') {
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase() || 'ship5';
        if (normalizedVehicleId === this.vehicleId && this.vehicleNode) return;
        if (this.vehicleNode) {
            this._detachVehicleLoadedHandler();
            this.baseVehicleRoot.remove(this.vehicleNode);
            disposeExternalVehicle(this.vehicleNode);
        }
        this.vehicleId = normalizedVehicleId;
        this.hardpoints = new Map(resolveVehicleHardpoints(normalizedVehicleId).map((point) => [point.id, point]));
        this.vehicleNode = createVehicleMesh(normalizedVehicleId, color);
        this.baseVehicleRoot.add(this.vehicleNode);
        this._normalizeVehicleNode(this.vehicleNode);
        if (this.vehicleNode._loadingPromise && this.vehicleNode._loaded !== true) {
            const pendingVehicle = this.vehicleNode;
            this.vehicleLoadedHandler = () => {
                pendingVehicle.removeEventListener?.('loaded', this.vehicleLoadedHandler);
                this.vehicleLoadedHandler = null;
                this._normalizeVehicleNode(pendingVehicle);
            };
            pendingVehicle.addEventListener?.('loaded', this.vehicleLoadedHandler);
        }
    }

    setBuild(build, options = {}) {
        this._disposeNodeMaterials(this.partsRoot);
        this.partsRoot.clear();
        this.partNodes.clear();
        const slots = build?.slots && typeof build.slots === 'object' ? build.slots : {};
        for (const [slotId, partId] of Object.entries(slots)) {
            const part = resolveHangarPart(partId);
            const hardpoint = this.hardpoints.get(slotId);
            if (!part || !hardpoint) continue;
            const node = this._createPartNode(part);
            node.userData.hangarSlotId = slotId;
            node.traverse((child) => { child.userData.hangarSlotId = slotId; });
            this._applyHardpointTransform(node, hardpoint);
            if (options.changedSlots?.includes(slotId)) {
                node.userData.snapStartedAtMs = performance.now();
                node.userData.targetScale = hardpoint.scale;
                node.scale.setScalar(hardpoint.scale * 0.55);
            }
            this.partsRoot.add(node);
            this.partNodes.set(slotId, node);
        }
        this.setSelectedSlot(this.selectedSlotId);
    }

    setSelectedSlot(slotId) {
        this.selectedSlotId = String(slotId || '');
        for (const [id, node] of this.partNodes.entries()) {
            const selected = id === this.selectedSlotId;
            node.traverse((child) => {
                if (!child.material?.emissive) return;
                child.material.emissive.setHex(selected ? 0x36a9ff : 0x07111c);
                child.material.emissiveIntensity = selected ? 0.85 : 0.18;
            });
        }
    }

    setComparison(compareBuild) {
        const compareSlots = compareBuild?.slots || {};
        for (const [slotId, node] of this.partNodes) {
            const changed = compareBuild && compareSlots[slotId] !== node.userData.hangarPartId;
            node.traverse((child) => {
                if (!child.material?.emissive || slotId === this.selectedSlotId) return;
                child.material.emissive.setHex(changed ? 0xf59e0b : 0x07111c);
                child.material.emissiveIntensity = changed ? 0.72 : 0.18;
            });
        }
    }

    updateAnimations(nowMs) {
        for (const node of this.partNodes.values()) {
            const started = Number(node.userData.snapStartedAtMs);
            if (!started) continue;
            const progress = Math.min(1, (nowMs - started) / 180);
            const eased = 1 - Math.pow(1 - progress, 3);
            node.scale.setScalar(node.userData.targetScale * (0.55 + 0.45 * eased));
            if (progress >= 1) delete node.userData.snapStartedAtMs;
        }
    }

    getRaycastObjects() {
        return [...this.partNodes.values()];
    }

    showGhost(partId, slotId, valid = true) {
        this.clearGhost();
        const part = resolveHangarPart(partId);
        const hardpoint = this.hardpoints.get(slotId);
        if (!part || !hardpoint) return;
        const node = this._createPartNode(part, { ghost: true, valid });
        this._applyHardpointTransform(node, hardpoint);
        this.ghostRoot.add(node);
    }

    clearGhost() {
        this._disposeNodeMaterials(this.ghostRoot);
        this.ghostRoot.clear();
    }

    getHardpoint(slotId) {
        const point = this.hardpoints.get(slotId);
        return point ? { ...point, position: [...point.position], rotation: [...point.rotation] } : null;
    }

    copyHardpointPosition(slotId, target) {
        const point = this.hardpoints.get(slotId);
        if (!point || !target) return false;
        target.fromArray(point.position);
        return true;
    }

    dispose() {
        this.clearGhost();
        this._detachVehicleLoadedHandler();
        if (this.vehicleNode) disposeExternalVehicle(this.vehicleNode);
        this.vehicleNode = null;
        this.geometryCache.forEach((geometry) => geometry.dispose());
        this.geometryCache.clear();
        this.materials.forEach((material) => material.dispose());
        this.materials.clear();
        this.group.removeFromParent();
    }
}
