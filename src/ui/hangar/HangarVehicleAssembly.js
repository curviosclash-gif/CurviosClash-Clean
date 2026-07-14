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
        const variant = String(part.appearance?.variant || '');
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
            if (variant === 'swift') {
                add(this._geometry('part-core-swift', () => new THREE.OctahedronGeometry(0.34, 0)), [0, 0.03, 0], [0.72 * tierScale, 1.42 * tierScale, 0.72 * tierScale]);
                add(this._geometry('part-core-swift-fin', () => new THREE.ConeGeometry(0.09, 0.42, 3)), [-0.3, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
                add(this._geometry('part-core-swift-fin', () => new THREE.ConeGeometry(0.09, 0.42, 3)), [0.3, 0, 0], [1, 1, 1], [0, 0, -Math.PI / 2]);
            } else if (variant === 'reactor') {
                add(this._geometry('part-core-reactor', () => new THREE.SphereGeometry(0.24, 14, 10)), [0, 0, 0], [tierScale, tierScale, tierScale]);
                add(this._geometry('part-core-reactor-ring', () => new THREE.TorusGeometry(0.43, 0.045, 8, 24)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
                add(this._geometry('part-core-reactor-ring', () => new THREE.TorusGeometry(0.43, 0.045, 8, 24)), [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
            } else if (variant === 'bastion') {
                add(this._geometry('part-core-bastion', () => new THREE.DodecahedronGeometry(0.38, 0)), [0, 0.02, 0], [1.2 * tierScale, 0.88 * tierScale, 1.2 * tierScale]);
                add(this._geometry('part-core-bastion-armor', () => new THREE.BoxGeometry(0.76, 0.12, 0.24)), [0, -0.18, 0]);
                add(this._geometry('part-core-bastion-armor', () => new THREE.BoxGeometry(0.76, 0.12, 0.24)), [0, -0.18, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
            } else {
                add(this._geometry('part-core-aegis', () => new THREE.OctahedronGeometry(0.34, 1)), [0, 0, 0], [tierScale, tierScale, tierScale]);
                add(this._geometry('part-core-aegis-ring', () => new THREE.TorusGeometry(0.38, 0.035, 8, 24)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            }
            if (part.tier !== 'T1') add(this._geometry('part-core-tier-ring', () => new THREE.TorusGeometry(0.49, 0.025, 6, 20)), [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
            if (part.tier === 'T3') add(this._geometry('part-core-tier-ring', () => new THREE.TorusGeometry(0.49, 0.025, 6, 20)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
        } else if (part.visual === 'nose') {
            if (variant === 'razor') {
                add(this._geometry('part-nose-razor', () => new THREE.ConeGeometry(0.25, 0.82, 3)), [0, 0, 0], [0.72 * tierScale, tierScale, 1.15 * tierScale]);
                add(this._geometry('part-nose-razor-blade', () => new THREE.BoxGeometry(0.04, 0.5, 0.42)), [0, -0.08, 0.08]);
            } else if (variant === 'bulwark') {
                add(this._geometry('part-nose-bulwark', () => new THREE.ConeGeometry(0.36, 0.56, 4)), [0, 0, 0], [1.2 * tierScale, 0.9 * tierScale, 1.2 * tierScale]);
                add(this._geometry('part-nose-bulwark-plate', () => new THREE.BoxGeometry(0.68, 0.13, 0.48)), [0, -0.16, 0]);
                add(this._geometry('part-nose-bulwark-brow', () => new THREE.BoxGeometry(0.5, 0.12, 0.18)), [0, 0.16, 0.06]);
            } else if (variant === 'phantom') {
                add(this._geometry('part-nose-phantom-prong', () => new THREE.ConeGeometry(0.1, 0.78, 8)), [-0.17, 0.04, 0], [tierScale, 1.2 * tierScale, tierScale]);
                add(this._geometry('part-nose-phantom-prong', () => new THREE.ConeGeometry(0.1, 0.78, 8)), [0.17, 0.04, 0], [tierScale, 1.2 * tierScale, tierScale]);
                add(this._geometry('part-nose-phantom-bridge', () => new THREE.BoxGeometry(0.46, 0.12, 0.22)), [0, -0.25, 0]);
            } else {
                add(this._geometry('part-nose-vector', () => new THREE.ConeGeometry(0.22, 0.58, 16)), [0, 0, 0], [tierScale, tierScale, tierScale]);
                add(this._geometry('part-nose-vector-fin', () => new THREE.BoxGeometry(0.07, 0.22, 0.34)), [0, -0.05, 0.08]);
            }
            if (part.tier !== 'T1') add(this._geometry('part-nose-tier-fin', () => new THREE.BoxGeometry(0.38, 0.06, 0.18)), [0, -0.12, 0.12]);
            if (part.tier === 'T3') add(this._geometry('part-nose-tier-fin', () => new THREE.BoxGeometry(0.38, 0.06, 0.18)), [0, 0.12, 0.12]);
        } else if (part.visual === 'wing') {
            if (variant === 'kestrel') {
                add(this._geometry('part-wing-kestrel', () => new THREE.ConeGeometry(0.24, 0.92, 3)), [0.02, 0, 0], [0.75 * tierScale, tierScale, 1.5 * tierScale], [0, 0, -Math.PI / 2]);
                add(this._geometry('part-wing-kestrel-tail', () => new THREE.BoxGeometry(0.42, 0.05, 0.18)), [-0.25, 0.03, 0.19], [1, 1, 1], [0, -0.35, 0]);
            } else if (variant === 'guardian') {
                add(this._geometry('part-wing-guardian', () => new THREE.BoxGeometry(0.8, 0.16, 0.5)), [0, 0, 0], [tierScale, 1, tierScale]);
                add(this._geometry('part-wing-guardian-pod', () => new THREE.SphereGeometry(0.18, 10, 8)), [-0.18, 0.13, 0], [1.55, 0.75, 1.1]);
                add(this._geometry('part-wing-guardian-rail', () => new THREE.BoxGeometry(0.82, 0.06, 0.08)), [0, 0.13, -0.2]);
            } else if (variant === 'specter') {
                add(this._geometry('part-wing-specter-blade', () => new THREE.BoxGeometry(0.92, 0.045, 0.16)), [0.04, 0, -0.15], [tierScale, 1, tierScale], [0, 0.18, 0]);
                add(this._geometry('part-wing-specter-blade', () => new THREE.BoxGeometry(0.92, 0.045, 0.16)), [0.04, 0, 0.15], [tierScale, 1, tierScale], [0, -0.18, 0]);
                add(this._geometry('part-wing-specter-bridge', () => new THREE.BoxGeometry(0.34, 0.08, 0.44)), [-0.3, 0, 0]);
            } else {
                add(this._geometry('part-wing-falcon', () => new THREE.BoxGeometry(0.78, 0.08, 0.38)), [0, 0, 0], [tierScale, 1, tierScale]);
                add(this._geometry('part-wing-falcon-tip', () => new THREE.ConeGeometry(0.09, 0.34, 8)), [0.36, 0.07, 0], [1, 1, 1], [0, 0, -Math.PI / 2]);
            }
            if (part.tier !== 'T1') add(this._geometry('part-wing-tier-tip', () => new THREE.ConeGeometry(0.07, 0.3, 6)), [-0.28, 0.08, 0.15], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (part.tier === 'T3') add(this._geometry('part-wing-tier-tip', () => new THREE.ConeGeometry(0.07, 0.3, 6)), [-0.28, 0.08, -0.15], [1, 1, 1], [-Math.PI / 2, 0, 0]);
        } else if (part.visual === 'engine') {
            if (variant === 'eco') {
                add(this._geometry('part-engine-eco', () => new THREE.CylinderGeometry(0.11, 0.15, 0.62, 12)), [-0.14, 0, 0], [tierScale, tierScale, tierScale]);
                add(this._geometry('part-engine-eco', () => new THREE.CylinderGeometry(0.11, 0.15, 0.62, 12)), [0.14, 0, 0], [tierScale, tierScale, tierScale]);
                add(this._geometry('part-engine-eco-bridge', () => new THREE.BoxGeometry(0.42, 0.22, 0.18)), [0, 0.08, 0]);
            } else if (variant === 'vector') {
                add(this._geometry('part-engine-vector', () => new THREE.CylinderGeometry(0.16, 0.22, 0.58, 10)), [0, 0.04, 0], [tierScale, 1.15 * tierScale, tierScale]);
                add(this._geometry('part-engine-vector-nozzle', () => new THREE.ConeGeometry(0.13, 0.34, 8)), [-0.18, -0.3, 0], [1, 1, 1], [0, 0, -0.22]);
                add(this._geometry('part-engine-vector-nozzle', () => new THREE.ConeGeometry(0.13, 0.34, 8)), [0.18, -0.3, 0], [1, 1, 1], [0, 0, 0.22]);
            } else if (variant === 'nova') {
                add(this._geometry('part-engine-nova', () => new THREE.CylinderGeometry(0.16, 0.34, 0.66, 16)), [0, 0, 0], [1.15 * tierScale, 1.2 * tierScale, 1.15 * tierScale]);
                add(this._geometry('part-engine-nova-ring', () => new THREE.TorusGeometry(0.36, 0.06, 8, 20)), [0, -0.36, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
                add(this._geometry('part-engine-nova-core', () => new THREE.SphereGeometry(0.16, 12, 8)), [0, -0.42, 0]);
            } else {
                add(this._geometry('part-engine-ion', () => new THREE.CylinderGeometry(0.2, 0.25, 0.54, 16)), [0, 0, 0], [tierScale, tierScale, tierScale]);
                add(this._geometry('part-engine-ion-nozzle', () => new THREE.TorusGeometry(0.21, 0.045, 8, 18)), [0, -0.28, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            }
            if (part.tier !== 'T1') add(this._geometry('part-engine-tier-ring', () => new THREE.TorusGeometry(0.29, 0.025, 8, 18)), [0, 0.18, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (part.tier === 'T3') add(this._geometry('part-engine-tier-ring', () => new THREE.TorusGeometry(0.29, 0.025, 8, 18)), [0, -0.18, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
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
            if (variant === 'flux') {
                add(this._geometry('part-utility-flux-ring', () => new THREE.TorusGeometry(0.31, 0.035, 8, 20)));
                add(this._geometry('part-utility-flux-ring', () => new THREE.TorusGeometry(0.31, 0.035, 8, 20)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
                add(this._geometry('part-utility-flux-orb', () => new THREE.SphereGeometry(0.12, 12, 8)));
            } else if (variant === 'shield') {
                add(this._geometry('part-utility-shield-dome', () => new THREE.SphereGeometry(0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), [0, -0.08, 0], [1.2, 0.8, 1.2]);
                add(this._geometry('part-utility-shield-base', () => new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16)), [0, -0.1, 0]);
            } else if (variant === 'overclock') {
                add(this._geometry('part-utility-overclock-core', () => new THREE.CylinderGeometry(0.11, 0.11, 0.58, 10)));
                add(this._geometry('part-utility-overclock-ring', () => new THREE.TorusGeometry(0.29, 0.035, 8, 18)), [0, -0.2, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
                add(this._geometry('part-utility-overclock-ring', () => new THREE.TorusGeometry(0.29, 0.035, 8, 18)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
                add(this._geometry('part-utility-overclock-ring', () => new THREE.TorusGeometry(0.29, 0.035, 8, 18)), [0, 0.2, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            } else {
                add(this._geometry('part-utility-pulse', () => new THREE.TorusGeometry(0.25, 0.07, 8, 20)));
                add(this._geometry('part-utility-pulse-orb', () => new THREE.SphereGeometry(0.11, 12, 8)));
            }
            if (part.tier !== 'T1') add(this._geometry('part-utility-tier-ring', () => new THREE.TorusGeometry(0.4, 0.022, 6, 18)), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
            if (part.tier === 'T3') add(this._geometry('part-utility-tier-ring', () => new THREE.TorusGeometry(0.4, 0.022, 6, 18)), [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
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
