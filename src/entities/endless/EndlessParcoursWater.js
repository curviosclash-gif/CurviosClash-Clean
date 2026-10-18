import * as THREE from 'three';
import { normalizeWaterZone } from '../../shared/contracts/WaterZoneContract.js';
import { deriveEndlessSeed } from '../../shared/contracts/EndlessParcoursContract.js';
import { sphereIntersectsStaticMeshCollider } from '../arena/StaticMeshCollider.js';

const WATER_EFFECTS = normalizeWaterZone({}).effects;

/** Six flooded modules followed by eighteen dry ones; the seed offsets the cycle. */
export function isEndlessWaterModule(module, baseSeed) {
    const index = module.moduleIndex;
    return index >= 6 && (Math.floor(index / 6) + deriveEndlessSeed(baseSeed, 'water-section') % 4) % 4 === 0;
}

export function buildEndlessWaterVisual(tube, module, material) {
    if (!material) return null;
    // The visible closed water envelope and the membership query share every vertex.
    const mesh = new THREE.Mesh(tube.geometries[1], material);
    mesh.name = `endless-module:${module.moduleIndex}:water`;
    mesh.position.z = module.originZ;
    mesh.renderOrder = 4;
    return mesh;
}

/** Queries only currently streamed cabin volumes, without allocating per frame. */
export class EndlessParcoursWaterSource {
    constructor(runtime) { this.runtime = runtime; }

    getEffects() { return WATER_EFFECTS; }

    isPositionUnderwater(position) {
        if (this.runtime._disposed || !position || !Number.isFinite(position.x)
            || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return false;
        for (const instance of this.runtime.activeModules.values()) {
            if (!instance.underwater) continue;
            const b = instance.bounds;
            if (position.x < b.min.x || position.x > b.max.x || position.y < b.min.y
                || position.y > b.max.y || position.z < b.min.z || position.z > b.max.z) continue;
            if (sphereIntersectsStaticMeshCollider(instance.volumeCollider, position, 0)) return true;
        }
        return false;
    }
}
