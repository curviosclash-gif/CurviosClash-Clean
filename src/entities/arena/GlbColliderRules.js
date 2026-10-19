// Which GLB surfaces and authored boxes a match collides with. Pure decisions shared by the arena
// build, the GLB loader and the editor's clearance probe, so the editor cannot drift from the match.

// Shootable seeds and kernels are drawn by an instanced batch that hides their nodes and are hit
// through their plant's targeted queries; a baked collider would stay in the air once shot away.
const BATCHED_SHOOTABLE_ROLES = new Set(['shootable_seed', 'shootable_kernel']);

/**
 * @param {{ userData?: any, parent?: any } | null | undefined} node
 * @returns {boolean} the node sits inside a batched shootable plant part
 */
export function isBatchedShootablePart(node) {
    for (let current = node; current; current = current.parent) {
        if (BATCHED_SHOOTABLE_ROLES.has(current.userData?.role)) return true;
    }
    return false;
}

/**
 * Whether the match builds GLB mesh colliders at all: 'fallbackOnly' leaves collision to the
 * authored box obstacles.
 * @param {string} colliderMode resolved collider mode
 */
export function collectsGlbColliders(colliderMode) {
    return colliderMode !== 'fallbackOnly';
}

/**
 * The collider a GLB mesh gets. 'dynamic' keeps static set dressing on the authored boxes and
 * only adds the moving parts.
 * @param {{ name?: string, userData?: any, parent?: any }} mesh
 * @param {{ colliderMode?: string, animated?: boolean }} [options] animated: an animation clip or
 *   a triggered break scene moves the mesh
 * @returns {'static' | 'dynamic' | null}
 */
export function resolveGlbMeshColliderKind(mesh, { colliderMode, animated = false } = {}) {
    const name = String(mesh?.name || '').toLowerCase();
    if (name.includes('_nocol') || isBatchedShootablePart(mesh)) return null;
    const moving = animated || name.includes('_dyn');
    if (colliderMode === 'dynamic' && !moving) return null;
    return moving ? 'dynamic' : 'static';
}

/**
 * Whether a placed model still collides once the match has loaded it: a decorative model
 * (collision false), an optional prop (never physical) and a model hidden until triggered
 * (switched off right after the load) do not.
 * @param {{ collision?: boolean, role?: string, hiddenUntilTriggered?: boolean } | null | undefined} model
 */
export function isGlbModelSolidAfterLoad(model) {
    return model?.collision !== false && model?.role !== 'optionalProp' && model?.hiddenUntilTriggered !== true;
}

/**
 * Authored box obstacles the match keeps. Without a complete GLB world, in 'fallbackOnly' and in
 * 'dynamic' all of them; next to a complete world only those marked compileWithGlb.
 * @template T
 * @param {T[]} obstacleDefs
 * @param {{ usedGlbModel?: boolean, requiredWorldComplete?: boolean, colliderMode?: string }} [state]
 * @returns {T[]}
 */
export function selectAuthoredObstacleDefs(obstacleDefs, { usedGlbModel = false, requiredWorldComplete = false, colliderMode } = {}) {
    const keepAll = !usedGlbModel || !requiredWorldComplete
        || colliderMode === 'fallbackOnly' || colliderMode === 'dynamic';
    return keepAll ? obstacleDefs : obstacleDefs.filter((obstacle) => /** @type {any} */ (obstacle)?.compileWithGlb === true);
}
