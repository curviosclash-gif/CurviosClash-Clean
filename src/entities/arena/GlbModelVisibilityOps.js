/**
 * Switching whole GLB models - and single pieces inside them - on and off at runtime.
 *
 * A collection map places every model in its own slot group (`glb-slot-<id>`), and every
 * collider the loader produced remembers which model it came from. Together that is enough to
 * take a model out of the world completely: hide its slot so it is no longer drawn, and drop
 * its colliders out of the arena's obstacle list so shots and ships fly through where it was.
 *
 * That is exactly what a collapsing tower needs. The intact legs disappear in the same frame
 * the baked fall appears, and neither leaves a ghost wall behind.
 *
 * While the arena is in static streaming mode its own obstacle list is parked in a snapshot and
 * the live list only holds the streamed batches. Collider changes are written into that snapshot
 * instead, so they are already correct when streaming ends and the parked list comes back.
 */

const SLOT_NAME_PREFIX = 'glb-slot-';
const PIECE_NAME_PREFIX = 'piece_';

/**
 * Groups the loader's colliders by the model they belong to. Built once after the GLB load;
 * the collider objects themselves are the ones the arena holds, so adding one back later puts
 * the identical entry into the obstacle list.
 * @param {readonly any[] | null | undefined} colliders
 * @returns {Map<string, any[]>}
 */
export function createGlbModelColliderIndex(colliders) {
    /** @type {Map<string, any[]>} */
    const index = new Map();
    for (const collider of Array.isArray(colliders) ? colliders : []) {
        const modelId = typeof collider?.modelId === 'string' ? collider.modelId : '';
        const bucket = index.get(modelId);
        if (bucket) bucket.push(collider);
        else index.set(modelId, [collider]);
    }
    return index;
}

/**
 * The slot group of one collection model. A single-model map has no slots, so an empty id
 * addresses the whole loaded scene.
 * @param {any} arena
 * @param {string} modelId
 */
export function resolveGlbModelRoot(arena, modelId) {
    const scene = arena?._glbScene;
    if (!scene) return null;
    if (!modelId) return scene;
    return scene.getObjectByName(`${SLOT_NAME_PREFIX}${modelId}`) || null;
}

/**
 * @param {any} arena
 * @returns {any[] | null}
 */
function resolveObstacleList(arena) {
    const parked = arena?._staticStreamingSnapshot?.obstacles;
    if (Array.isArray(parked)) return parked;
    return Array.isArray(arena?.obstacles) ? arena.obstacles : null;
}

/**
 * @param {any[]} list
 * @param {readonly any[]} colliders
 * @param {boolean} active
 * @returns {boolean} whether the list changed
 */
function applyCollidersToList(list, colliders, active) {
    if (colliders.length === 0) return false;
    if (active) {
        const present = new Set(list);
        let changed = false;
        for (const collider of colliders) {
            if (present.has(collider)) continue;
            list.push(collider);
            changed = true;
        }
        return changed;
    }
    const removed = new Set(colliders);
    let write = 0;
    for (let read = 0; read < list.length; read += 1) {
        const entry = list[read];
        if (removed.has(entry)) continue;
        list[write] = entry;
        write += 1;
    }
    if (write === list.length) return false;
    list.length = write;
    return true;
}

/**
 * @param {any} arena
 * @param {readonly any[]} colliders
 * @param {boolean} active
 */
function applyColliders(arena, colliders, active) {
    const list = resolveObstacleList(arena);
    if (!list) return false;
    let changed = applyCollidersToList(list, colliders, active);

    const dynamic = colliders.filter((collider) => collider?.dynamic);
    if (dynamic.length > 0 && Array.isArray(arena._glbDynamicObstacles)) {
        changed = applyCollidersToList(arena._glbDynamicObstacles, dynamic, active) || changed;
    }
    // The collision grid is keyed on this revision; without the bump a removed wall would keep
    // blocking until something else happened to rebuild it.
    if (changed) arena.staticCollisionRevision = (Number(arena.staticCollisionRevision) || 0) + 1;
    return changed;
}

/**
 * Draws and collides a whole model, or takes it out of the world entirely.
 * @param {any} arena
 * @param {Map<string, any[]> | null | undefined} colliderIndex
 * @param {string} modelId
 * @param {boolean} active
 */
export function setGlbModelActive(arena, colliderIndex, modelId, active) {
    const id = typeof modelId === 'string' ? modelId : '';
    const root = resolveGlbModelRoot(arena, id);
    const visible = active === true;
    if (root) root.visible = visible;
    const colliders = colliderIndex?.get(id) || [];
    applyColliders(arena, colliders, visible);
    return !!root;
}

/**
 * Takes every model the preset marked `hiddenUntilTriggered` out of the world right after the
 * load. The loader already leaves such a slot invisible; this also removes its colliders, which
 * would otherwise block the airspace the intact building still occupies.
 * @param {any} arena
 * @param {Map<string, any[]> | null | undefined} colliderIndex
 * @returns {string[]} the model ids that were switched off
 */
export function deactivateHiddenGlbModels(arena, colliderIndex) {
    /** @type {string[]} */
    const hidden = [];
    for (const slot of arena?._glbScene?.children || []) {
        if (slot?.userData?.glbHiddenUntilTriggered !== true) continue;
        const modelId = String(slot.userData.glbModelId || '');
        hidden.push(modelId);
        setGlbModelActive(arena, colliderIndex, modelId, false);
    }
    return hidden;
}

/**
 * Same for one authored piece inside a model. Pieces are authored as nodes named
 * `piece_<id>...`, so the summit of a toppling scene can be switched off when it already fell
 * on its own earlier in the round.
 * @param {any} arena
 * @param {Map<string, any[]> | null | undefined} colliderIndex
 * @param {string} modelId
 * @param {string} pieceId
 * @param {boolean} active
 */
export function setGlbPieceActive(arena, colliderIndex, modelId, pieceId, active) {
    const id = typeof modelId === 'string' ? modelId : '';
    const piece = typeof pieceId === 'string' ? pieceId.trim().toLowerCase() : '';
    if (!piece) return false;
    const prefix = `${PIECE_NAME_PREFIX}${piece}`;
    const visible = active === true;

    const root = resolveGlbModelRoot(arena, id);
    root?.traverse?.((node) => {
        if (node === root) return;
        if (!String(node.name || '').toLowerCase().startsWith(prefix)) return;
        node.visible = visible;
    });

    const colliders = (colliderIndex?.get(id) || []).filter(
        (collider) => String(collider?.sourceName || '').toLowerCase().startsWith(prefix),
    );
    applyColliders(arena, colliders, visible);
    return !!root;
}
