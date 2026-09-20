import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TANK_TURRET_HEIGHT } from './MapUnitVisualOps.js';

/**
 * The authored tank model (B2). The library is one GLB with a named part per piece, built by
 * scripts/generate_map_unit_blender_assets.py. It is loaded once for the whole game and every tank
 * clones from it, so sixteen units on a map share one geometry and one material.
 *
 * Loading is allowed to be late or to fail. A tank is always drawn from the box model first, and
 * the authored body only replaces it once every part it needs is really there - half a tank would
 * be worse than the boxes. The three hooks the rest of the runtime holds on to (`headPivot`,
 * `muzzleFlash`, `healthFill`) are never touched by the swap.
 *
 * Turret and barrel are authored in ground space like the rest of the tank, because that keeps the
 * blend readable as a whole vehicle. They hang on the head pivot here, so they come down by the
 * pivot height on the way in.
 */

const LIBRARY_URL = new URL('../../../../assets/models/map_units/map_unit_library.glb', import.meta.url).href;

/** The parts a tank needs before the authored body may replace the boxes. */
export const MAP_UNIT_BODY_PARTS = Object.freeze(['tank_hull', 'tank_track_left', 'tank_track_right']);
export const MAP_UNIT_HEAD_PARTS = Object.freeze(['tank_turret', 'tank_barrel']);

/** How far in front of the muzzle the flash sits, in model units. */
const FLASH_LEAD = 0.25;

let libraryPromise = null;

/**
 * Loads the library once. Answers null on any failure, which leaves every tank on the box model.
 * @returns {Promise<{ parts: Map<string, THREE.Object3D> } | null>}
 */
export function loadMapUnitLibrary() {
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve) => {
        new GLTFLoader().load(
            LIBRARY_URL,
            (gltf) => {
                const parts = new Map();
                gltf.scene?.traverse((node) => {
                    if (node.isMesh && typeof node.name === 'string') parts.set(node.name, node);
                });
                resolve(parts.size > 0 ? { parts } : null);
            },
            undefined,
            () => resolve(null),
        );
    });
    return libraryPromise;
}

function removeFallbackBody(root) {
    /** @type {THREE.Object3D[]} */
    const doomed = [];
    root.traverse((node) => {
        if (node.userData?.mapUnitBody === true) doomed.push(node);
    });
    for (const node of doomed) node.removeFromParent();
}

function clonePart(library, name) {
    const source = library.parts.get(name);
    if (!source) return null;
    const clone = source.clone();
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.setScalar(1);
    clone.userData = { mapUnitBody: true, mapUnitPart: name };
    return clone;
}

/**
 * Replaces the box body of a built tank with the authored one. Answers false and changes nothing
 * when a part is missing, so a half loaded library never leaves a tank without a hull.
 */
export function applyAuthoredMapUnitBody(root, library) {
    const headPivot = root?.userData?.headPivot;
    if (!root || !headPivot || !library?.parts) return false;
    const wanted = [...MAP_UNIT_BODY_PARTS, ...MAP_UNIT_HEAD_PARTS];
    const clones = wanted.map((name) => clonePart(library, name));
    if (clones.some((clone) => clone === null)) return false;

    removeFallbackBody(root);
    for (let index = 0; index < wanted.length; index += 1) {
        const clone = /** @type {THREE.Object3D} */ (clones[index]);
        if (MAP_UNIT_HEAD_PARTS.includes(wanted[index])) {
            // Authored in ground space, mounted on a pivot that already sits at the turret height.
            clone.position.y = -TANK_TURRET_HEIGHT;
            headPivot.add(clone);
        } else {
            root.add(clone);
        }
    }

    const barrel = headPivot.children.find((child) => child.userData?.mapUnitPart === 'tank_barrel');
    root.userData.authoredBarrel = barrel || null;
    const flash = root.userData.muzzleFlash;
    if (barrel && flash) {
        const muzzle = new THREE.Box3().setFromObject(barrel);
        flash.position.z = muzzle.max.z + FLASH_LEAD;
    }
    root.userData.authoredBody = true;
    return true;
}

/** The wreck left behind by a destroyed tank, or null while the library is not there yet. */
export function createAuthoredWreck(library) {
    return library?.parts ? clonePart(library, 'tank_wreck') : null;
}
