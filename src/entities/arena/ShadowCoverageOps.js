import * as THREE from 'three';

// The shadow frustum used to be fitted to the arena box, which is the space a map is *allowed* to
// use, not the space it fills. On Notre-Dame that box is 1380 units across, which left 0.81 shadow
// texels per world unit - smaller than any detail on the facade, and the reason the masonry
// rendered without relief.
//
// Fitting it to the loaded geometry alone does not help, because the piece that decides the size is
// the terrain: the parvis island measures 1090 x 722 units and only 50 of them are height. Measured
// on the west front, including it leaves the frustum at 1.06 texels per unit and the flat fraction
// of the image unchanged at 92.3%. Dropping it takes the frustum to 1.45 texels per unit and the
// flat fraction to 81.6%, and costs nothing at the crane or the lifting gantry out at the edges.
//
// So the rule is not "fit what is loaded" but "fit what casts". Ground receives shadow; forcing it
// into the frustum spends every other part's sharpness on it.

const PART_BOX = new THREE.Box3();
const CASTER_BOX = new THREE.Box3();

// A part flatter than this - height against its own largest horizontal extent - is treated as
// terrain. The island sits at 0.05, the flattest real caster on the map (the flying buttresses)
// at 0.26, so there is a wide gap to place the line in.
const TERRAIN_FLATNESS = 0.15;

// Room kept around the casters, as a fraction of their largest horizontal extent.
//
// Deliberately small. A cast shadow runs far past the object that throws it - at the sun elevation
// these maps author, a 400 unit tower lays its shadow more than 600 units across the ground - and
// covering that would grow the frustum back to the size of the arena and undo the whole point. What
// the margin has to hold is the shadow map's own edge clamp, not the far end of a long shadow.
const SHADOW_MARGIN_FRACTION = 0.05;

// Below this the tighter frustum would buy a few percent of texel density and cost a shadow map
// rebuild, so the arena box stays.
const MIN_SHRINK = 0.9;

function toFiniteBounds(bounds) {
    const minX = Number(bounds?.minX);
    const maxX = Number(bounds?.maxX);
    const minY = Number(bounds?.minY);
    const maxY = Number(bounds?.maxY);
    const minZ = Number(bounds?.minZ);
    const maxZ = Number(bounds?.maxZ);
    const values = [minX, maxX, minY, maxY, minZ, maxZ];
    if (!values.every((value) => Number.isFinite(value))) return null;
    if (maxX <= minX || maxY <= minY || maxZ <= minZ) return null;
    return { minX, maxX, minY, maxY, minZ, maxZ };
}

function isFiniteBox(box) {
    return !box.isEmpty()
        && [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]
            .every((value) => Number.isFinite(value));
}

// One entry per part the map placed, so the classification runs at the granularity a map is
// authored in rather than per triangle soup. A single mesh of the island is a wall or a quay and
// would read as a caster on its own; the island as a part reads as what it is.
function collectCasterBox(scene, flatness) {
    CASTER_BOX.makeEmpty();
    let casters = 0;
    let parts = 0;
    for (const part of scene.children || []) {
        PART_BOX.makeEmpty();
        PART_BOX.setFromObject(part);
        if (!isFiniteBox(PART_BOX)) continue;
        parts += 1;
        const width = PART_BOX.max.x - PART_BOX.min.x;
        const depth = PART_BOX.max.z - PART_BOX.min.z;
        const height = PART_BOX.max.y - PART_BOX.min.y;
        const spread = Math.max(width, depth);
        if (spread > 0 && height < flatness * spread) continue;
        CASTER_BOX.union(PART_BOX);
        casters += 1;
    }
    return { casters, parts };
}

/**
 * The bounds the shadow frustum should cover, or null to keep whatever it covers now.
 *
 * @param {{scene?: unknown, arenaBounds?: unknown, marginFraction?: unknown, terrainFlatness?: unknown}} options
 * @returns {{minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number}|null}
 */
export function resolveVisibleShadowBounds({
    scene,
    arenaBounds,
    marginFraction,
    terrainFlatness,
} = {}) {
    const arena = toFiniteBounds(arenaBounds);
    if (!arena) return null;
    const root = /** @type {any} */ (scene);
    if (!root || !Array.isArray(root.children) || root.children.length === 0) return null;

    const flatnessInput = Number(terrainFlatness);
    const flatness = Number.isFinite(flatnessInput) && flatnessInput >= 0
        ? flatnessInput
        : TERRAIN_FLATNESS;
    let { casters } = collectCasterBox(root, flatness);
    // A map made entirely of flat pieces has no terrain to drop - it is all there is to shadow.
    if (casters === 0) {
        ({ casters } = collectCasterBox(root, 0));
        if (casters === 0) return null;
    }
    if (!isFiniteBox(CASTER_BOX)) return null;

    const { min, max } = CASTER_BOX;
    const contentWidth = max.x - min.x;
    const contentDepth = max.z - min.z;
    const arenaWidth = arena.maxX - arena.minX;
    const arenaDepth = arena.maxZ - arena.minZ;
    // The frustum is driven by the largest extent seen from the light, so that is what has to shrink
    // for the swap to be worth a shadow map rebuild.
    if (Math.max(contentWidth, contentDepth) >= MIN_SHRINK * Math.max(arenaWidth, arenaDepth)) {
        return null;
    }

    const fraction = Number(marginFraction);
    const margin = Math.max(contentWidth, contentDepth)
        * (Number.isFinite(fraction) && fraction >= 0 ? fraction : SHADOW_MARGIN_FRACTION);

    return {
        minX: Math.max(arena.minX, min.x - margin),
        maxX: Math.min(arena.maxX, max.x + margin),
        // The ground is the main receiver and usually sits below the casters, so it stays in the
        // frustum even though it was dropped from the box that sized it.
        minY: arena.minY,
        maxY: Math.min(arena.maxY, max.y + margin),
        minZ: Math.max(arena.minZ, min.z - margin),
        maxZ: Math.min(arena.maxZ, max.z + margin),
    };
}
