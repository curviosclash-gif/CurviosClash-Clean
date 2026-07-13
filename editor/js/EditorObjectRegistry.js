const OBJECT_ID_PREFIX = Object.freeze({
    hard: 'hard',
    foam: 'foam',
    tunnel: 'tunnel',
    portal: 'portal',
    spawn: 'spawn',
    item: 'item',
    aircraft: 'aircraft',
});

export class EditorObjectRegistry {
    constructor(core) {
        this.core = core;
        this.objectsById = new Map();
        this.nextObjectIdCounter = 1;
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
        return mesh;
    }

    unregisterObjectById(objectId) {
        if (typeof objectId !== 'string') return false;
        return this.objectsById.delete(objectId);
    }
}
