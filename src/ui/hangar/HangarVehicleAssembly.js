import * as THREE from 'three';
import { createVehicleMesh } from '../../entities/vehicle-registry.js';
import { resolveHangarPart, resolveVehicleHardpoints } from './HangarPartCatalog.js';

const _bounds = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

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
        const color = ghost ? (valid ? 0x34d399 : 0xfb4558) : ({ T1: 0x6aaeea, T2: 0x9b7cff, T3: 0xf4b942 }[part.tier] || 0x6aaeea);
        const material = this._material(color, {
            transparent: ghost,
            opacity: ghost ? 0.48 : 0.92,
            emissive: ghost ? color : 0x07111c,
            emissiveIntensity: ghost ? 0.65 : 0.18,
        });
        let geometry;
        if (part.visual === 'core') geometry = this._geometry('part-core', () => new THREE.OctahedronGeometry(0.34, 1));
        else if (part.visual === 'nose') geometry = this._geometry('part-nose', () => new THREE.ConeGeometry(0.22, 0.58, 16));
        else if (part.visual === 'wing') geometry = this._geometry('part-wing', () => new THREE.BoxGeometry(0.78, 0.08, 0.38));
        else if (part.visual === 'engine') geometry = this._geometry('part-engine', () => new THREE.CylinderGeometry(0.2, 0.25, 0.54, 16));
        else geometry = this._geometry('part-utility', () => new THREE.TorusGeometry(0.25, 0.07, 8, 20));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.hangarPartId = part.id;
        mesh.userData.hangarGhost = ghost;
        return mesh;
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

    setVehicle(vehicleId, color = '#66b6ff') {
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase() || 'ship5';
        if (normalizedVehicleId === this.vehicleId && this.vehicleNode) return;
        if (this.vehicleNode) {
            this.baseVehicleRoot.remove(this.vehicleNode);
            disposeExternalVehicle(this.vehicleNode);
        }
        this.vehicleId = normalizedVehicleId;
        this.hardpoints = new Map(resolveVehicleHardpoints(normalizedVehicleId).map((point) => [point.id, point]));
        this.vehicleNode = createVehicleMesh(normalizedVehicleId, color);
        this.baseVehicleRoot.add(this.vehicleNode);
        _bounds.setFromObject(this.vehicleNode);
        _bounds.getSize(_size);
        _bounds.getCenter(_center);
        const longest = Math.max(0.001, _size.x, _size.y, _size.z);
        const scale = Math.min(1.45, Math.max(0.55, 3 / longest));
        this.vehicleNode.position.copy(_center).multiplyScalar(-1);
        this.baseVehicleRoot.scale.setScalar(scale);
        this.baseVehicleRoot.position.y = -0.05;
    }

    setBuild(build) {
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
            this._applyHardpointTransform(node, hardpoint);
            this.partsRoot.add(node);
            this.partNodes.set(slotId, node);
        }
        this.setSelectedSlot(this.selectedSlotId);
    }

    setSelectedSlot(slotId) {
        this.selectedSlotId = String(slotId || '');
        for (const [id, node] of this.partNodes.entries()) {
            const selected = id === this.selectedSlotId;
            if (node.material?.emissive) {
                node.material.emissive.setHex(selected ? 0x36a9ff : 0x07111c);
                node.material.emissiveIntensity = selected ? 0.85 : 0.18;
            }
        }
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
        if (this.vehicleNode) disposeExternalVehicle(this.vehicleNode);
        this.vehicleNode = null;
        this.geometryCache.forEach((geometry) => geometry.dispose());
        this.geometryCache.clear();
        this.materials.forEach((material) => material.dispose());
        this.materials.clear();
        this.group.removeFromParent();
    }
}
