import { createMapBreakSceneController } from './MapBreakSceneController.js';
import { refreshDynamicMeshCollider } from './StaticMeshCollider.js';

/**
 * The arena's side of a loaded GLB map: taking the finished load into the world, and the break
 * scenes that change it again while the match runs.
 *
 * This lives next to the arena rather than inside it for one reason only - Arena.js is at its
 * line budget, and none of this needs the arena's other state. Every function takes the arena
 * explicitly and touches nothing else.
 */

/**
 * Hands a finished GLB load to the arena: scene, animation tracks, colliders and the controller
 * that plays the baked falls. Break events that arrived while the models were still loading are
 * applied right away, which is what a replica joining a match in progress depends on.
 * @param {any} arena
 * @param {any} glbResult
 */
export function attachArenaGlbLoadResult(arena, glbResult) {
    arena._glbScene = glbResult.scene;
    arena._glbAnimation.setTracks(glbResult.animationTracks);
    arena._glbFootprint = glbResult.footprint || arena._glbFootprint;
    arena._glbLoadWarnings = Array.isArray(glbResult.warnings) ? [...glbResult.warnings] : [];
    arena.renderer.addToScene(arena._glbScene);
    if (Array.isArray(glbResult.colliders) && glbResult.colliders.length > 0) {
        arena.obstacles.push(...glbResult.colliders);
        arena._glbDynamicObstacles = glbResult.colliders.filter((obstacle) => obstacle.dynamic);
    }
    arena._mapBreakScenes = createMapBreakSceneController(
        arena,
        glbResult.colliders,
        arena._glbAnimation,
        arena._pendingMapBreakEvents,
    );
}

/**
 * Moves the colliders of animated GLB meshes onto their current animation pose. Mixers only
 * write local transforms and collision runs before the renderer would flush the hierarchy, so
 * the world matrices have to be resolved here for a query in this frame to see what is drawn.
 * @param {any} arena
 */
export function refreshArenaGlbDynamicObstacles(arena) {
    if (arena._glbDynamicObstacles.length === 0) return;
    arena._glbScene?.updateMatrixWorld(true);
    for (const obstacle of arena._glbDynamicObstacles) {
        refreshDynamicMeshCollider(obstacle.meshCollider, obstacle.box);
    }
    arena._collision.invalidateDynamicObstacles();
}

/**
 * Drops the break scenes together with the loaded scene they belong to. The pending events go
 * with them: they describe a match on a map that is no longer there.
 * @param {any} arena
 */
export function clearArenaBreakScenes(arena) {
    arena._mapBreakScenes = null;
    arena._pendingMapBreakEvents = [];
}

/**
 * @param {any} arena
 * @param {unknown} events
 */
export function applyArenaMapDestructibleEvents(arena, events) {
    arena._pendingMapBreakEvents = Array.isArray(events) ? events : [];
    arena._mapBreakScenes?.applyEvents(arena._pendingMapBreakEvents);
}

/**
 * @param {any} arena
 */
export function resetArenaMapDestructibleScenes(arena) {
    arena._pendingMapBreakEvents = [];
    arena._mapBreakScenes?.reset();
}
