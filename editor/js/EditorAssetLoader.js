import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

export class EditorAssetLoader {
    constructor(options = {}) {
        this.loader = new OBJLoader();
        this.cache = new Map();
        this.loadStatus = new Map();
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

    _prepareLoadedObject(id, object) {
        const color = this.colors[id] || 0xdddddd;

        object.traverse((child) => {
            if (!child?.isMesh) return;
            child.material = new THREE.MeshLambertMaterial({ color });
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

    _loadModelWithTimeout(id, url) {
        return new Promise((resolve) => {
            let settled = false;
            let timedOut = false;

            const resolveLoaded = (object) => {
                this._prepareLoadedObject(id, object);
                this.cache.set(id, object);
                this.loadStatus.set(id, {
                    state: 'loaded',
                    url
                });
            };

            const resolveFailure = (status, error = null) => {
                const failureReason = status === 'timeout' ? 'timeout' : 'error';
                this._createAndCachePlaceholder(id, failureReason);
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
                    resolveLoaded(object);
                    resolve({ id, status: 'loaded' });
                    return;
                }
                resolveFailure(status, error);
                resolve({ id, status, error });
            };

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                finalize('timeout', null, new Error(`Asset load timeout after ${this.timeoutMs}ms`));
            }, this.timeoutMs);

            this.loader.load(
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
                    if (timedOut) return;
                    finalize('error', null, error);
                }
            );
        });
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
            if (!this.warnedMissingAssets.has(modelName)) {
                this.warnedMissingAssets.add(modelName);
                this._emitStatus('warn', `Asset "${modelName}" is not in cache. Using placeholder.`, { id: modelName });
            }
            this._createAndCachePlaceholder(modelName, 'missing');
        }

        const original = this.cache.get(modelName);
        if (!original) return null;
        return this._cloneAssetObject(original, modelName);
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
