import { CONFIG_SECTIONS } from '../../src/core/config/ConfigSections.js';

// The match look for the editor: the match's own lighting rig (lights, sky dome, fog), fed in
// match units and converted afterwards. The lighting contract caps fog distances in match
// units, so the conversion has to happen behind it, not in front of it.

const NEUTRAL_BRIGHTNESS = Object.freeze({ exposure: 1, ambient: 1, fog: 1 });

function positive(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/** Match config with the editor camera's far plane, so the sky dome stays inside it. */
export function createEditorGameViewConfig(cameraFar) {
    return {
        ...CONFIG_SECTIONS,
        CAMERA: { ...CONFIG_SECTIONS.CAMERA, FAR: positive(cameraFar, 10000) },
    };
}

/**
 * Applies a map's lighting in the modern style and converts the fog into editor units.
 * @param {{apply: Function}} rig SceneLightingRig
 * @param {{fog: {near: number, far: number}}} scene
 */
export function applyEditorGameLighting(rig, scene, { mapLighting, unitsPerWorldUnit }) {
    const units = positive(unitsPerWorldUnit, 1);
    const lighting = rig.apply({
        graphicsStyle: 'modern',
        mapLighting,
        brightnessFactors: NEUTRAL_BRIGHTNESS,
        // Height terms are authored in map units, which the export scales by MAP_SCALE * units.
        mapScale: positive(CONFIG_SECTIONS.ARENA.MAP_SCALE, 1) * units,
    });
    scene.fog.near *= units;
    scene.fog.far *= units;
    return lighting;
}

/**
 * In flight the pilot sees exactly as far as in a match. The overview camera usually stands
 * further out than that, so its fog moves behind the far side of the arena, keeping its shape.
 */
export function resolveEditorGameFogRange({ gameFog, flying, cameraDistance, arenaRadius }) {
    const gameFar = positive(gameFog?.far, 1);
    const gameNear = Math.max(0, Number(gameFog?.near) || 0);
    const overviewFar = Math.max(0, Number(cameraDistance) || 0) + Math.max(0, Number(arenaRadius) || 0);
    if (flying || overviewFar <= gameFar) return { near: gameNear, far: gameFar };
    return { near: overviewFar * (gameNear / gameFar), far: overviewFar };
}

/** Shadow box of the editor arena: centred on the origin, standing on the floor. */
export function resolveEditorArenaShadowBounds({ width, height, depth }) {
    const halfWidth = positive(width, 1) / 2;
    const halfDepth = positive(depth, 1) / 2;
    return {
        minX: -halfWidth,
        maxX: halfWidth,
        minY: 0,
        maxY: positive(height, 1),
        minZ: -halfDepth,
        maxZ: halfDepth,
    };
}
