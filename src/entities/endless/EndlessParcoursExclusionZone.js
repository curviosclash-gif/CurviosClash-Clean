import { sphereIntersectsStaticMeshCollider } from '../arena/StaticMeshCollider.js';
import { getEndlessActiveInstances } from './EndlessActiveModuleMap.js';

/** Optional arena source, owned by one runtime. Querying it creates no per-tick objects. */
export class EndlessParcoursExclusionZone {
    constructor(runtime) {
        this.runtime = runtime;
        this.graceSeconds = 3;
    }

    getPlayerSpeed(player) { return player?.baseSpeed; }

    isOutside(player, hysteresis = 0) {
        if (this.runtime._disposed || this.runtime._finalized) return false;
        const p = player?.position;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
        const radius = Math.max(0, Number(player.hitboxRadius) || 0) - hysteresis;
        const instances = getEndlessActiveInstances(this.runtime.activeModules);
        for (let slot = 0; slot < instances.length; slot += 1) {
            const instance = instances[slot];
            const b = instance.bounds;
            if (p.x + radius < b.min.x || p.x - radius > b.max.x || p.y + radius < b.min.y
                || p.y - radius > b.max.y || p.z + radius < b.min.z || p.z - radius > b.max.z) continue;
            if (sphereIntersectsStaticMeshCollider(instance.volumeCollider, p, Math.max(0, radius))
                && (radius >= 0 || !sphereIntersectsStaticMeshCollider(instance.staticColliders[0].meshCollider, p, -radius))) return false;
        }
        return true;
    }
}
