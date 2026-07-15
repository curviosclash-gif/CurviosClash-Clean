import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const AUTHORED_ITEM_MODEL_URLS = Object.freeze({
    item_arrow: new URL('../../assets/items/item_arrow.obj', import.meta.url).href,
    item_battery: new URL('../../assets/items/item_battery.obj', import.meta.url).href,
    item_box: new URL('../../assets/items/item_box.obj', import.meta.url).href,
    item_capsule: new URL('../../assets/items/item_capsule.obj', import.meta.url).href,
    item_coin: new URL('../../assets/items/item_coin.obj', import.meta.url).href,
    item_crate: new URL('../../assets/items/item_crate.obj', import.meta.url).href,
    item_crystal: new URL('../../assets/items/item_crystal.obj', import.meta.url).href,
    item_gem: new URL('../../assets/items/item_gem.obj', import.meta.url).href,
    item_health: new URL('../../assets/items/item_health.obj', import.meta.url).href,
    item_orb: new URL('../../assets/items/item_orb.obj', import.meta.url).href,
    item_pyramid: new URL('../../assets/items/item_pyramid.obj', import.meta.url).href,
    item_ring: new URL('../../assets/items/item_ring.obj', import.meta.url).href,
    item_rocket: new URL('../../assets/items/item_rocket.obj', import.meta.url).href,
    item_shield: new URL('../../assets/items/item_shield.obj', import.meta.url).href,
    item_sphere: new URL('../../assets/items/item_sphere.obj', import.meta.url).href,
    item_star: new URL('../../assets/items/item_star.obj', import.meta.url).href,
    item_torus: new URL('../../assets/items/item_torus.obj', import.meta.url).href,
});

function disposeMaterial(material) {
    if (Array.isArray(material)) {
        material.forEach((entry) => entry?.dispose?.());
        return;
    }
    material?.dispose?.();
}

export function resolveAuthoredItemModelUrl(modelType) {
    const normalized = String(modelType || '').trim().toLowerCase();
    return AUTHORED_ITEM_MODEL_URLS[normalized] || null;
}

export class PowerupAuthoredModelCache {
    constructor(size = 1.5) {
        this.size = Math.max(0.5, Number(size) || 1.5);
        this.loader = new OBJLoader();
        this.templates = new Map();
        this.pendingLoads = new Map();
        this.disposed = false;
    }

    async createModel(modelType, color = 0xffffff) {
        const template = await this._loadTemplate(modelType);
        if (!template || this.disposed) return null;

        const clone = template.clone(true);
        const materialColor = Number(color) || 0xffffff;
        clone.scale.setScalar(this.size);
        clone.userData.authoredItemModel = String(modelType || '').trim().toLowerCase();
        clone.traverse((node) => {
            if (!node?.isMesh) return;
            node.castShadow = false;
            node.receiveShadow = false;
            node.material = new THREE.MeshStandardMaterial({
                color: materialColor,
                emissive: materialColor,
                emissiveIntensity: 0.35,
                roughness: 0.32,
                metalness: 0.55,
            });
        });
        return clone;
    }

    async _loadTemplate(modelType) {
        const normalized = String(modelType || '').trim().toLowerCase();
        const url = resolveAuthoredItemModelUrl(normalized);
        if (!url || this.disposed) return null;
        if (this.templates.has(normalized)) return this.templates.get(normalized);
        if (this.pendingLoads.has(normalized)) return this.pendingLoads.get(normalized);

        const pending = this.loader.loadAsync(url)
            .then((template) => {
                this.pendingLoads.delete(normalized);
                if (this.disposed) {
                    this._disposeTemplate(template);
                    return null;
                }
                this.templates.set(normalized, template);
                return template;
            })
            .catch(() => {
                this.pendingLoads.delete(normalized);
                return null;
            });
        this.pendingLoads.set(normalized, pending);
        return pending;
    }

    _disposeTemplate(template) {
        template?.traverse?.((node) => {
            if (!node?.isMesh) return;
            node.geometry?.dispose?.();
            disposeMaterial(node.material);
        });
    }

    dispose() {
        this.disposed = true;
        for (const template of this.templates.values()) {
            this._disposeTemplate(template);
        }
        this.templates.clear();
        this.pendingLoads.clear();
        this.loader = null;
    }
}
