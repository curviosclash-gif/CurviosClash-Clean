import * as THREE from 'three';
import { normalizeMapLightSources } from '../../shared/contracts/MapLightSourcesContract.js';

// The lights a map places inside its own geometry. They deliberately do not cast shadows: a
// cathedral lit from the inside has to throw some of that light back out through its openings, and a
// shadow-casting point light would stop at the first wall. Six shadow maps per frame would also cost
// far more than this is worth.
export class AuthoredMapLightRig {
    /** @param {{ addToScene: Function, removeFromScene: Function }} renderer */
    constructor(renderer) {
        this.renderer = renderer;
        /** @type {THREE.PointLight[]} */
        this.lights = [];
    }

    clear() {
        if (this.lights.length === 0) return;
        for (const light of this.lights) {
            this.renderer.removeFromScene(light);
            light.dispose?.();
        }
        this.lights = [];
    }

    /**
     * @param {any} map
     * @param {number} mapScale
     */
    build(map, mapScale = 1) {
        this.clear();
        const sources = normalizeMapLightSources(map?.lights);
        if (sources.length === 0) return this.lights;

        // Same anchor rule as the spawns and the aircraft decorations, so a map is authored in one
        // coordinate space rather than two.
        const scale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(mapScale) || 1)
            : 1;

        for (let i = 0; i < sources.length; i += 1) {
            const source = sources[i];
            const light = new THREE.PointLight(
                source.color,
                source.intensity,
                source.distance * scale,
                source.decay
            );
            light.name = `map-light-${source.id || i}`;
            light.position.set(source.x * scale, source.y * scale, source.z * scale);
            light.castShadow = false;
            light.userData = {
                ...(light.userData || {}),
                authoredLightId: source.id,
                ...(source.offWhenDestroyed ? { offWhenDestroyed: source.offWhenDestroyed, baseIntensity: source.intensity } : {}),
            };
            this.renderer.addToScene(light);
            this.lights.push(light);
        }
        return this.lights;
    }

    /**
     * Puts out the lights tied to a destroyed segment and relights them when the segment stands
     * again (a new round). Intensity rather than visibility, so the shader does not recompile.
     * @param {{ segments?: ReadonlyArray<{ id: string, destroyed?: boolean }> } | null | undefined} state
     */
    applyDestructibleState(state) {
        for (const light of this.lights) {
            const segmentId = light.userData.offWhenDestroyed;
            if (!segmentId) continue;
            const segment = state?.segments?.find((entry) => entry.id === segmentId);
            light.intensity = segment?.destroyed === true ? 0 : light.userData.baseIntensity;
        }
    }

    getLightCount() {
        return this.lights.length;
    }
}
