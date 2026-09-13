const OBJECT_ID_PREFIX = Object.freeze({
    hard: 'hard',
    foam: 'foam',
    tunnel: 'tunnel',
    portal: 'portal',
    spawn: 'spawn',
    item: 'item',
    aircraft: 'aircraft',
    turret: 'turret',
});

export class EditorObjectRegistry {
    constructor(core) {
        this.core = core;
        this.objectsById = new Map();
        this.nextObjectIdCounter = 1;
        this.spatialCellSize = 500;
        this.spatialCells = new Map();
        this.objectSpatialKeys = new Map();
    }

    getObjectCount() {
        return this.objectsById.size;
    }

    getObjectById(id) {
        if (typeof id !== 'string') return null;
        return this.objectsById.get(id) || null;
    }

    hasObjectId(id) {
        return this.objectsById.has(id);
    }

    isRegisteredObject(object) {
        if (!object || !object.userData?.id) return false;
        return this.objectsById.get(object.userData.id) === object;
    }

    resolveManagedObject(object) {
        if (!object) return null;

        if (this.isRegisteredObject(object)) {
            return object;
        }

        const objectId = object.userData?.editorObjectId || object.userData?.id;
        if (typeof objectId === 'string') {
            const registered = this.objectsById.get(objectId);
            if (registered) return registered;
        }

        let node = object;
        while (node && node.parent && node.parent !== this.core.objectsContainer) {
            node = node.parent;
        }
        if (node && node.parent === this.core.objectsContainer && this.isRegisteredObject(node)) {
            return node;
        }

        return null;
    }

    normalizeRequestedId(requestedId) {
        if (typeof requestedId !== 'string') return null;
        const normalized = requestedId.trim();
        return normalized.length > 0 ? normalized : null;
    }

    generateObjectId(type) {
        const prefix = OBJECT_ID_PREFIX[type] || 'obj';
        let candidate = '';
        do {
            candidate = `${prefix}_${this.nextObjectIdCounter++}`;
        } while (this.objectsById.has(candidate));
        return candidate;
    }

    allocateObjectId(type, requestedId = null) {
        const normalizedRequestedId = this.normalizeRequestedId(requestedId);
        if (!normalizedRequestedId) {
            return this.generateObjectId(type);
        }

        if (!this.objectsById.has(normalizedRequestedId)) {
            return normalizedRequestedId;
        }

        const replacement = this.generateObjectId(type);
        console.warn(`[EditorMapManager] Duplicate object id "${normalizedRequestedId}" detected. Replaced with "${replacement}".`);
        return replacement;
    }

    markManagedHierarchy(rootObject, objectId) {
        rootObject.traverse((node) => {
            node.userData = {
                ...(node.userData || {}),
                editorObjectId: objectId
            };
        });
        rootObject.userData.editorManagedRoot = true;
    }

    getSpatialKeysForObject(object) {
        const position = object?.position || {};
        const data = object?.userData || {};
        let minX = Number(position.x) || 0;
        let maxX = minX;
        let minZ = Number(position.z) || 0;
        let maxZ = minZ;
        if (data.type === 'hard' || data.type === 'foam') {
            const halfX = Math.max(0, Number(data.sizeX) || 0) * 0.5;
            const halfZ = Math.max(0, Number(data.sizeZ) || 0) * 0.5;
            const rotationY = Number(object.rotation?.y) || 0;
            const cosine = Math.abs(Math.cos(rotationY));
            const sine = Math.abs(Math.sin(rotationY));
            const extentX = cosine * halfX + sine * halfZ;
            const extentZ = sine * halfX + cosine * halfZ;
            minX -= extentX; maxX += extentX; minZ -= extentZ; maxZ += extentZ;
        } else if (data.type === 'tunnel' && data.pointA && data.pointB) {
            const radius = Math.max(0, Number(data.radius) || 0);
            minX = Math.min(data.pointA.x, data.pointB.x) - radius;
            maxX = Math.max(data.pointA.x, data.pointB.x) + radius;
            minZ = Math.min(data.pointA.z, data.pointB.z) - radius;
            maxZ = Math.max(data.pointA.z, data.pointB.z) + radius;
        } else {
            const radius = Math.max(0, Number(data.radius) || Number(data.sizeInfo) || 100);
            minX -= radius; maxX += radius; minZ -= radius; maxZ += radius;
        }
        const minCellX = Math.floor(minX / this.spatialCellSize);
        const maxCellX = Math.floor(maxX / this.spatialCellSize);
        const minCellZ = Math.floor(minZ / this.spatialCellSize);
        const maxCellZ = Math.floor(maxZ / this.spatialCellSize);
        const keys = new Set();
        for (let x = minCellX; x <= maxCellX; x += 1) {
            for (let z = minCellZ; z <= maxCellZ; z += 1) keys.add(`${x}:${z}`);
        }
        return keys;
    }

    updateObjectSpatial(object) {
        const objectId = object?.userData?.id;
        if (!objectId) return;
        const nextKeys = this.getSpatialKeysForObject(object);
        const previousKeys = this.objectSpatialKeys.get(objectId) || new Set();
        const unchanged = nextKeys.size === previousKeys.size && [...nextKeys].every((key) => previousKeys.has(key));
        if (unchanged) return;
        for (const previousKey of previousKeys) {
            const previousCell = this.spatialCells.get(previousKey);
            previousCell?.delete(objectId);
            if (previousCell?.size === 0) this.spatialCells.delete(previousKey);
        }
        for (const nextKey of nextKeys) {
            if (!this.spatialCells.has(nextKey)) this.spatialCells.set(nextKey, new Set());
            this.spatialCells.get(nextKey).add(objectId);
        }
        this.objectSpatialKeys.set(objectId, nextKeys);
    }

    queryNear(position, radius = 750) {
        const cellRadius = Math.max(1, Math.ceil(Math.max(0, radius) / this.spatialCellSize));
        const centerX = Math.floor((Number(position?.x) || 0) / this.spatialCellSize);
        const centerZ = Math.floor((Number(position?.z) || 0) / this.spatialCellSize);
        const result = [];
        const seen = new Set();
        for (let x = centerX - cellRadius; x <= centerX + cellRadius; x += 1) {
            for (let z = centerZ - cellRadius; z <= centerZ + cellRadius; z += 1) {
                for (const id of this.spatialCells.get(`${x}:${z}`) || []) {
                    if (seen.has(id)) continue;
                    const object = this.objectsById.get(id);
                    if (object) result.push(object);
                    seen.add(id);
                }
            }
        }
        return result;
    }

    registerObject(mesh, { requestedId = null } = {}) {
        if (!mesh) return null;

        const objectType = mesh.userData?.type || 'obj';
        const objectId = this.allocateObjectId(objectType, requestedId ?? mesh.userData?.id);

        mesh.userData = {
            ...(mesh.userData || {}),
            id: objectId,
            editorObjectId: objectId,
            editorManagedRoot: true
        };

        this.markManagedHierarchy(mesh, objectId);
        this.objectsById.set(objectId, mesh);
        this.core.objectsContainer.add(mesh);
        this.updateObjectSpatial(mesh);
        return mesh;
    }

    unregisterObjectById(objectId) {
        if (typeof objectId !== 'string') return false;
        const spatialKeys = this.objectSpatialKeys.get(objectId) || [];
        for (const spatialKey of spatialKeys) {
            const cell = this.spatialCells.get(spatialKey);
            cell?.delete(objectId);
            if (cell?.size === 0) this.spatialCells.delete(spatialKey);
        }
        this.objectSpatialKeys.delete(objectId);
        return this.objectsById.delete(objectId);
    }
}
