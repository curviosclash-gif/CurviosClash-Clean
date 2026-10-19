// Decorative libraries often place the same static GLB many times. Decode each URL once per
// collection and clone its scene graph for later slots; geometry and materials remain shared,
// while transforms and visibility stay instance-local. Animated or physical entries keep the
// existing one-load-per-slot path because they own mixers or gameplay collision state.
//
// Collision bodies share the path: cloning is what makes a forest of a hundred trees affordable,
// and a clone's colliders are read off its own world matrix after placement, so each copy
// collides where it stands. The cache is keyed by URL *and* placement mode, because placement
// renames meshes in the decoded scene - a `_nocol` decoration and a solid body would otherwise
// hand each other a scene marked for the wrong one.
//
// Each entry counts the slots holding its geometry, so a slot released after its time limit frees
// nothing a sibling still draws; the last holder frees the shared resources.
import { disposeObject3DResources } from '../shared/rendering/ThreeDisposal.js';

export function createGLBSharedStaticLoads() {
    const entries = new Map();
    const sceneEntries = new WeakMap();

    const acquire = async (descriptor, load) => {
        const canReuse = (descriptor.collision === false || descriptor.collisionOnly === true)
            && descriptor.hiddenUntilTriggered !== true
            && !descriptor.animationClock?.clipName;
        if (!canReuse) return load();

        const cacheKey = `${descriptor.url}|${descriptor.collision === false ? 'nocol' : 'solid'}`
            + `|${descriptor.collisionOnly === true ? 'hidden' : 'drawn'}`;
        let cached = entries.get(cacheKey);
        if (!cached) {
            cached = { cacheKey, promise: load(), claimed: false, users: 0 };
            entries.set(cacheKey, cached);
        }
        // Count the slot before waiting: a sibling released in the tick the file arrives must
        // already see this slot as a holder, or it frees what this slot is about to clone.
        cached.users += 1;
        let result;
        try {
            result = await cached.promise;
        } catch (error) {
            cached.users -= 1;
            throw error;
        }
        // A file may contain an unnamed/default clip even when the descriptor names none. Such a
        // model still needs a private scene and mixer, so only its first slot uses the probe load.
        if (result.animationMixers.length > 0) {
            cached.users -= 1;
            if (!cached.claimed) {
                cached.claimed = true;
                return result;
            }
            return load();
        }
        if (!cached.claimed) {
            cached.claimed = true;
            sceneEntries.set(result.scene, cached);
            return result;
        }
        const scene = result.scene.clone(true);
        scene.name = `glbModel-${descriptor.id}`;
        sceneEntries.set(scene, cached);
        return {
            ...result,
            scene,
            animationMixers: [],
            animationTracks: [],
            animatedNodes: new Set(),
            colliders: [],
            bounds: result.bounds.clone(),
        };
    };

    // Frees a result no slot will place (a prop that arrived after its time limit).
    const release = (result) => {
        for (const mixer of result.animationMixers) mixer.stopAllAction();
        const shared = sceneEntries.get(result.scene);
        if (shared) {
            shared.users -= 1;
            if (shared.users > 0) return;
            // Last holder gone: a slot starting later must decode afresh, not clone a freed scene.
            if (entries.get(shared.cacheKey) === shared) entries.delete(shared.cacheKey);
        }
        disposeObject3DResources(result.scene);
    };

    return { acquire, release };
}
