import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLB_GALLERY_MAPS } from '../../src/core/config/maps/presets/glb_gallery.js';

export class EditorAssetLoader {
    constructor(options = {}) {
        this.loader = new OBJLoader();
        this.glbLoader = new GLTFLoader();
        this.cache = new Map();
        this.loadStatus = new Map();
        this.pendingLoads = new Map();
        this.pendingCloneHydrations = new Map();
        this.onCloneHydration = null;
        this.warnedMissingAssets = new Set();
        this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;
        this.maxConcurrentLoads = Number.isFinite(options.maxConcurrentLoads) && options.maxConcurrentLoads > 0
            ? Math.max(1, Math.trunc(options.maxConcurrentLoads))
            : 8;
        this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

        // Items & Categories that have an OBJ model
        this.modelsToLoad = [
            'item_arrow', 'item_capsule', 'item_coin', 'item_crate', 'item_crystal',
            'item_gem', 'item_health', 'item_orb', 'item_pyramid', 'item_ring',
            'item_rocket', 'item_shield', 'item_sphere', 'item_star', 'item_torus',
            'item_battery', 'item_box'
        ];

        // Jet / Aircraft models (from CONFIG.PLAYER.AIRCRAFT_OPTIONS)
        this.jetsToLoad = [
            { id: 'jet_wwi', file: '../assets/models/jets/cc0/WWIairplane.obj' },
            { id: 'jet_funky_low', file: '../assets/models/jets/cc0/funky_aircraft_low.obj' },
            { id: 'jet_funky_high', file: '../assets/models/jets/cc0/funky_aircraft_high.obj' },
            { id: 'jet_funky_control', file: '../assets/models/jets/cc0/funky_aircraft_control.obj' },
            { id: 'jet_pinnace_lo', file: '../assets/models/jets/cc0/pinnace_lo.obj' },
            { id: 'jet_ship1', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship1.obj' },
            { id: 'jet_ship2', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship2.obj' },
            { id: 'jet_ship3', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship3.obj' },
            { id: 'jet_ship4', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship4.obj' },
            { id: 'jet_ship5', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship5.obj' },
            { id: 'jet_ship6', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship6.obj' },
            { id: 'jet_ship7', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship7.obj' },
            { id: 'jet_ship8', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship8.obj' },
            { id: 'jet_ship9', file: '../assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship9.obj' },
        ];

        this.portalModelsToLoad = [
            'portal_cross', 'portal_diamond', 'portal_hex', 'portal_octagon',
            'portal_ring', 'portal_square', 'portal_star', 'portal_triangle'
        ];

        this.trailModelsToLoad = [
            'trail_arrow', 'trail_segment'
        ];

        this.glbModels = GLB_GALLERY_MAPS.glb_gallery.glbModels.map((model) => ({
            id: model.id,
            url: model.url,
            loadUrl: `../${model.url}`,
        }));
        this.glbModelById = new Map(this.glbModels.map((model) => [model.id, model]));
        this.glbModels.forEach((model) => this.loadStatus.set(model.id, {
            state: 'idle',
            url: model.url,
        }));

        // Specific colors per item to distinguish them in the editor before textures
        this.colors = {
            item_arrow: 0xff0000,
            item_capsule: 0x14b8a6,
            item_coin: 0xeab308,
            item_crate: 0x8b5a2b,
            item_crystal: 0x34d399,
            item_gem: 0xec4899,
            item_health: 0xffffff,
            item_orb: 0x818cf8,
            item_pyramid: 0xf472b6,
            item_ring: 0xfcd34d,
            item_rocket: 0x94a3b8,
            item_shield: 0x38bdf8,
            item_sphere: 0x64748b,
            item_star: 0xfbbf24,
            item_torus: 0xf87171,
            item_battery: 0xfb7185,
            item_box: 0xa78bfa,
            // Jet colors
            jet_wwi: 0xc8a86e,
            jet_funky_low: 0x60a5fa,
            jet_funky_high: 0x34d399,
            jet_funky_control: 0xfbbf24,
            jet_pinnace_lo: 0xa78bfa,
            jet_ship1: 0x94a3b8,
            jet_ship2: 0x818cf8,
            jet_ship3: 0xf472b6,
            jet_ship4: 0x38bdf8,
            jet_ship5: 0xe5e7eb,
            jet_ship6: 0xfb7185,
            jet_ship7: 0x14b8a6,
            jet_ship8: 0xec4899,
            jet_ship9: 0xfcd34d,
            // Portal colors
            portal_cross: 0xc084fc,
            portal_diamond: 0xe879f9,
            portal_hex: 0xa78bfa,
            portal_octagon: 0x8b5cf6,
            portal_ring: 0xd8b4fe,
            portal_square: 0xbfdbfe,
            portal_star: 0xfde68a,
            portal_triangle: 0xf9a8d4,
            // Trail colors
            trail_arrow: 0x60a5fa,
            trail_segment: 0x34d399,
        };
    }

    setStatusHandler(handler) {
        this.onStatus = typeof handler === 'function' ? handler : null;
    }

    setCloneHydrationHandler(handler) {
        this.onCloneHydration = typeof handler === 'function' ? handler : null;
    }

    _emitStatus(level, message, extra = {}) {
        const payload = { level, message, ...extra };

        if (level === 'error') {
            console.error(`[EditorAssetLoader] ${message}`, extra);
        } else if (level === 'warn') {
            console.warn(`[EditorAssetLoader] ${message}`, extra);
        } else {
            console.info(`[EditorAssetLoader] ${message}`, extra);
        }

        if (this.onStatus) {
            try {
                this.onStatus(payload);
            } catch (callbackError) {
                console.warn('[EditorAssetLoader] Status handler failed:', callbackError);
            }
        }
    }

    _markOwnedResource(resource) {
        if (!resource || typeof resource !== 'object') return resource;
        resource.userData = {
            ...(resource.userData || {}),
            editorOwnedResource: true
        };
        return resource;
    }

    _createPlaceholderModel(id, reason = 'missing') {
        const color = this.colors[id] || 0x64748b;
        const group = new THREE.Group();
        group.name = `placeholder_${id}`;
        group.userData = {
            editorAssetId: id,
            isEditorPlaceholder: true,
            placeholderReason: reason
        };

        const boxGeo = this._markOwnedResource(new THREE.BoxGeometry(1, 1, 1));
        const boxMat = this._markOwnedResource(new THREE.MeshLambertMaterial({
            color,
            transparent: true,
            opacity: 0.55
        }));
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.castShadow = true;
        box.receiveShadow = true;
        group.add(box);

        const edgeGeo = this._markOwnedResource(new THREE.EdgesGeometry(boxGeo));
        const edgeMat = this._markOwnedResource(new THREE.LineBasicMaterial({ color: 0xffffff }));
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        group.add(edges);

        return group;
    }

    _prepareLoadedObject(id, object, options = {}) {
        const color = this.colors[id] || 0xdddddd;

        object.traverse((child) => {
            if (!child?.isMesh) return;
            if (options.preserveMaterials !== true) {
                child.material = new THREE.MeshLambertMaterial({ color });
            }
            child.castShadow = true;
            child.receiveShadow = true;
            child.userData = {
                ...(child.userData || {}),
                editorAssetId: id
            };
        });

        object.userData = {
            ...(object.userData || {}),
            editorAssetId: id,
            isEditorPlaceholder: false
        };
    }

    _prepareGLBScene(id, gltf) {
        const scene = gltf?.scene || gltf?.scenes?.[0];
        if (!scene) throw new Error(`GLB asset "${id}" has no root scene.`);

        scene.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(scene);
        const boundValues = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
        if (bounds.isEmpty() || !boundValues.every(Number.isFinite)) {
            throw new Error(`GLB asset "${id}" has invalid geometry bounds.`);
        }
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);

        const root = new THREE.Group();
        const normalizer = new THREE.Group();
        const offset = new THREE.Group();
        normalizer.scale.setScalar(1 / maxDimension);
        offset.position.set(-center.x, -bounds.min.y, -center.z);
        offset.add(scene);
        normalizer.add(offset);
        root.add(normalizer);
        this._prepareLoadedObject(id, root, { preserveMaterials: true });
        return root;
    }

    _cloneAssetObject(object, id) {
        const clone = object.clone(true);

        clone.traverse((child) => {
            if (child.geometry?.isBufferGeometry) {
                child.geometry = this._markOwnedResource(child.geometry.clone());
            }

            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat) => this._markOwnedResource(mat.clone()));
            } else if (child.material) {
                child.material = this._markOwnedResource(child.material.clone());
            }

            child.userData = {
                ...(child.userData || {}),
                editorAssetId: id,
                editorCloneNode: true
            };

            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        clone.userData = {
            ...(clone.userData || {}),
            editorAssetId: id,
            editorCloneRoot: true,
            isEditorPlaceholder: !!object.userData?.isEditorPlaceholder
        };

        return clone;
    }

    _createAndCachePlaceholder(id, reason) {
        const placeholder = this._createPlaceholderModel(id, reason);
        this.cache.set(id, placeholder);
        this.loadStatus.set(id, {
            state: 'placeholder',
            reason
        });
        return placeholder;
    }

    _hydratePendingClones(id, object) {
        const pendingClones = this.pendingCloneHydrations.get(id);
        if (!pendingClones) return;
        this.pendingCloneHydrations.delete(id);
        if (!this.onCloneHydration) return;
        for (const target of pendingClones) {
            const replacement = this._cloneAssetObject(object, id);
            this.onCloneHydration?.(target, replacement);
        }
    }

    _loadModelWithTimeout(id, url, options = {}) {
        const loader = options.loader || this.loader;
        const prepare = typeof options.prepare === 'function' ? options.prepare : (value) => value;
        return new Promise((resolve) => {
            let settled = false;
            let timedOut = false;

            const resolveLoaded = (loadedValue) => {
                let object;
                try {
                    object = prepare(loadedValue);
                    if (options.preserveMaterials !== true) this._prepareLoadedObject(id, object);
                } catch (error) {
                    resolveFailure('error', error);
                    return false;
                }
                this.cache.set(id, object);
                this.loadStatus.set(id, {
                    state: 'loaded',
                    url
                });
                this._hydratePendingClones(id, object);
                return true;
            };

            const resolveFailure = (status, error = null) => {
                const failureReason = status === 'timeout' ? 'timeout' : 'error';
                this._createAndCachePlaceholder(id, failureReason);
                if (status !== 'timeout') this.pendingCloneHydrations.delete(id);
                this.loadStatus.set(id, {
                    state: status,
                    url,
                    error: error?.message || String(error || '')
                });

                const msg = status === 'timeout'
                    ? `Timeout while loading "${id}" (${this.timeoutMs}ms). Placeholder is used.`
                    : `Failed to load "${id}" from "${url}". Placeholder is used.`;
                this._emitStatus('warn', msg, { id, url, error: error?.message || String(error || '') });
            };

            const finalize = (status, object = null, error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutHandle);
                if (status === 'loaded' && object) {
                    const loaded = resolveLoaded(object);
                    resolve({ id, status: loaded ? 'loaded' : 'error' });
                    return;
                }
                resolveFailure(status, error);
                resolve({ id, status, error });
            };

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                finalize('timeout', null, new Error(`Asset load timeout after ${this.timeoutMs}ms`));
            }, this.timeoutMs);

            loader.load(
                url,
                (object) => {
                    if (timedOut) {
                        // Soft timeouts stay non-fatal: a late success must replace placeholder cache state.
                        resolveLoaded(object);
                        return;
                    }
                    finalize('loaded', object);
                },
                undefined,
                (error) => {
                    if (timedOut) {
                        this.pendingCloneHydrations.delete(id);
                        return;
                    }
                    finalize('error', null, error);
                }
            );
        });
    }

    loadAsset(id) {
        const model = this.glbModelById.get(String(id || ''));
        if (!model) return Promise.resolve({ id, status: 'missing' });
        if (this.loadStatus.get(model.id)?.state === 'loaded') {
            return Promise.resolve({ id: model.id, status: 'loaded' });
        }
        if (this.pendingLoads.has(model.id)) return this.pendingLoads.get(model.id);

        this.loadStatus.set(model.id, { state: 'loading', url: model.url });
        const pending = this._loadModelWithTimeout(model.id, model.loadUrl, {
            loader: this.glbLoader,
            prepare: (gltf) => this._prepareGLBScene(model.id, gltf),
            preserveMaterials: true,
        }).finally(() => this.pendingLoads.delete(model.id));
        this.pendingLoads.set(model.id, pending);
        return pending;
    }

    async _runWithConcurrency(entries, task) {
        const safeEntries = Array.isArray(entries) ? entries : [];
        if (safeEntries.length === 0) return [];
        const workerCount = Math.max(1, Math.min(this.maxConcurrentLoads, safeEntries.length));
        const results = new Array(safeEntries.length);
        let cursor = 0;

        const worker = async () => {
            while (true) {
                const currentIndex = cursor;
                if (currentIndex >= safeEntries.length) return;
                cursor += 1;
                results[currentIndex] = await task(safeEntries[currentIndex], currentIndex);
            }
        };

        const workers = new Array(workerCount).fill(null).map(() => worker());
        await Promise.all(workers);
        return results;
    }

    async loadAll() {
        const allEntries = [
            ...this.modelsToLoad.map((modelName) => ({ id: modelName, url: `../assets/items/${modelName}.obj` })),
            ...this.jetsToLoad.map((jet) => ({ id: jet.id, url: jet.file })),
            ...this.portalModelsToLoad.map((modelName) => ({ id: modelName, url: `../assets/portals/${modelName}.obj` })),
            ...this.trailModelsToLoad.map((modelName) => ({ id: modelName, url: `../assets/trails/${modelName}.obj` }))
        ];

        for (const entry of allEntries) {
            this.loadStatus.set(entry.id, {
                state: 'loading',
                url: entry.url
            });
        }

        this._emitStatus('info', `Loading ${allEntries.length} 3D assets...`);
        const results = await this._runWithConcurrency(
            allEntries,
            (entry) => this._loadModelWithTimeout(entry.id, entry.url)
        );

        const loaded = results.filter((entry) => entry.status === 'loaded').length;
        const timedOut = results.filter((entry) => entry.status === 'timeout').length;
        const failed = results.filter((entry) => entry.status === 'error').length;
        const placeholders = timedOut + failed;

        if (placeholders > 0) {
            this._emitStatus('warn', `${placeholders} asset(s) use placeholders (${failed} failed, ${timedOut} timeout).`, {
                loaded,
                failed,
                timedOut
            });
        } else {
            this._emitStatus('info', 'All 3D assets loaded successfully.', { loaded });
        }

        return { loaded, failed, timedOut, total: allEntries.length };
    }

    getClone(modelName) {
        if (!this.cache.has(modelName)) {
            if (this.glbModelById.has(modelName)) {
                this._createAndCachePlaceholder(modelName, 'loading');
                this.loadStatus.set(modelName, {
                    state: 'loading',
                    url: this.glbModelById.get(modelName).url,
                });
                void this.loadAsset(modelName);
            } else {
                if (!this.warnedMissingAssets.has(modelName)) {
                    this.warnedMissingAssets.add(modelName);
                    this._emitStatus('warn', `Asset "${modelName}" is not in cache. Using placeholder.`, { id: modelName });
                }
                this._createAndCachePlaceholder(modelName, 'missing');
            }
        }

        const original = this.cache.get(modelName);
        if (!original) return null;
        const clone = this._cloneAssetObject(original, modelName);
        if (this.glbModelById.has(modelName) && original.userData?.isEditorPlaceholder) {
            if (!this.pendingCloneHydrations.has(modelName)) this.pendingCloneHydrations.set(modelName, new Set());
            this.pendingCloneHydrations.get(modelName).add(clone);
        }
        return clone;
    }

    getAssetUrl(modelName) {
        return this.glbModelById.get(String(modelName || ''))?.url || '';
    }

    getLoadStatus(modelName) {
        const normalizedName = String(modelName || '').trim();
        if (!normalizedName) {
            return { state: 'builtin', id: null };
        }

        const status = this.loadStatus.get(normalizedName);
        if (!status) {
            return {
                state: 'idle',
                id: normalizedName
            };
        }

        return {
            id: normalizedName,
            ...status
        };
    }
}
