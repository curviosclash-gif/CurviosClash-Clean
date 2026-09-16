import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStandardMaterial } from './powerup/PowerupSharedMaterials.js';
import {
    LEGACY_PICKUP_MODEL_TYPES,
    resolveLegacyPickupModelUrl,
} from './powerup/PowerupVisualCatalog.js';

const PICKUP_LIBRARY_URL = new URL('../../assets/items/glb/pickup_library.glb', import.meta.url).href;
const PICKUP_MODEL_PREFIX = 'pickup_';

export function resolveAuthoredItemModelUrl(modelType) {
    return resolveLegacyPickupModelUrl(modelType);
}

export function resolvePickupLibraryUrl() {
    return PICKUP_LIBRARY_URL;
}

function materialRoleForNode(node) {
    const fromExtras = String(node?.userData?.pickupMaterialRole || '').trim().toLowerCase();
    if (fromExtras) return fromExtras;
    const materialName = String(node?.material?.name || '').trim().toLowerCase();
    if (materialName.includes('glow')) return 'glow';
    if (materialName.includes('accent')) return 'accent';
    if (materialName.includes('frame')) return 'frame';
    return 'metal';
}

function pickupMaterial(role, color) {
    if (role === 'frame') {
        return createStandardMaterial(0xdbe5ea, {
            emissiveIntensity: 0.015, roughness: 0.38, metalness: 0.08,
        });
    }
    if (role === 'metal') {
        return createStandardMaterial(0x526477, {
            emissiveIntensity: 0.015, roughness: 0.35, metalness: 0.35,
        });
    }
    if (role === 'matte') {
        return createStandardMaterial(color, {
            emissiveIntensity: 0.01, roughness: 0.72, metalness: 0.04,
        });
    }
    if (role === 'glow') {
        return createStandardMaterial(color, {
            emissiveIntensity: 0.6, roughness: 0.24, metalness: 0.08,
        });
    }
    return createStandardMaterial(color, {
        emissiveIntensity: 0.08, roughness: 0.32, metalness: 0.15,
    });
}

export class PowerupAuthoredModelCache {
    constructor(size = 1.5, options = {}) {
        this.size = Math.max(0.5, Number(size) || 1.5);
        this.loader = options.loader || new GLTFLoader();
        this.libraryUrl = options.libraryUrl || PICKUP_LIBRARY_URL;
        this.templates = new Map();
        this.pendingLoad = null;
        this.disposed = false;
        this._libraryRoot = null;
        this._sourceMaterials = new Set();
        this._geometries = new Set();
    }

    async createModel(modelIdentifier, color = 0xffffff, metadata = {}) {
        const normalized = String(modelIdentifier || '').trim();
        if (!normalized || this.disposed) return null;
        const template = await this._loadLibrary().then(() => this.templates.get(normalized) || null);
        if (!template || this.disposed) return null;

        const clone = template.clone(true);
        const materialColor = Number(color) || 0xffffff;
        clone.scale.multiplyScalar(this.size / 1.5);
        clone.userData.blenderPickupModel = normalized.startsWith(PICKUP_MODEL_PREFIX)
            ? normalized.slice(PICKUP_MODEL_PREFIX.length)
            : normalized;
        clone.userData.authoredItemModel = String(metadata.authoredItemModel || '').trim().toLowerCase();
        if (metadata.rocketTier) clone.userData.rocketTier = String(metadata.rocketTier);
        if (Number.isFinite(Number(metadata.fanProjectiles))) {
            const count = Number(metadata.fanProjectiles);
            clone.userData.fanProjectiles = count;
            clone.userData.markerText = `×${count}`;
        }
        clone.traverse((node) => {
            if (!node?.isMesh) return;
            node.castShadow = false;
            node.receiveShadow = false;
            node.material = pickupMaterial(node.userData.pickupMaterialRole, materialColor);
        });
        return clone;
    }

    async _loadLibrary() {
        if (this.disposed) return null;
        if (this._libraryRoot) return this._libraryRoot;
        if (this.pendingLoad) return this.pendingLoad;

        this.pendingLoad = this.loader.loadAsync(this.libraryUrl)
            .then((gltf) => {
                this.pendingLoad = null;
                const root = gltf?.scene || null;
                if (!root) return null;
                if (this.disposed) {
                    this._disposeLoadedRoot(root);
                    return null;
                }
                this._prepareLibrary(root);
                this._libraryRoot = root;
                return root;
            })
            .catch(() => {
                this.pendingLoad = null;
                return null;
            });
        return this.pendingLoad;
    }

    _prepareLibrary(root) {
        root.traverse((node) => {
            if (!node?.isMesh) return;
            if (node.geometry) this._geometries.add(node.geometry);
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) if (material) this._sourceMaterials.add(material);
            node.userData.pickupMaterialRole = materialRoleForNode(node);
            node.material = null;
        });
        for (const material of this._sourceMaterials) material.dispose?.();
        this._sourceMaterials.clear();

        root.traverse((node) => {
            if (node?.name?.startsWith(PICKUP_MODEL_PREFIX)) this.templates.set(node.name, node);
        });
    }

    _disposeLoadedRoot(root) {
        const geometries = new Set();
        const materials = new Set();
        root?.traverse?.((node) => {
            if (node?.geometry) geometries.add(node.geometry);
            const entries = Array.isArray(node?.material) ? node.material : [node?.material];
            for (const material of entries) if (material) materials.add(material);
        });
        for (const geometry of geometries) geometry.dispose?.();
        for (const material of materials) material.dispose?.();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const geometry of this._geometries) geometry.dispose?.();
        for (const material of this._sourceMaterials) material.dispose?.();
        this._geometries.clear();
        this._sourceMaterials.clear();
        this.templates.clear();
        this._libraryRoot = null;
        this.loader = null;
    }
}

export { LEGACY_PICKUP_MODEL_TYPES };
