import * as THREE from 'three';
import { MAP_EXPANSION_PHASES } from '../../shared/contracts/MapExpansionContract.js';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

const FACES = Object.freeze(['minX', 'maxX', 'minZ', 'maxZ', 'maxY']);
const EPSILON = 1e-6;
const WARNING_PULSE_HZ = 1.5;
const WALL_OPACITY = 0.82;
const IDLE_EMISSIVE_INTENSITY = 0.35;
// Kept below 2 with a dark base colour, so the tone mapping cannot wash the warning out to white.
const WARNING_EMISSIVE_PEAK = 1.5;

function createWallMaterial(color, emissive, emissiveIntensity) {
    // Deliberately without the ATMOSPHERIC_FOG_ALPHA_FADE define of the outer walls: stage walls
    // stand inside the map and should not dissolve into the fog the way the far boundary does.
    return new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        roughness: 0.6,
        metalness: 0.2,
        transparent: true,
        opacity: WALL_OPACITY,
        side: THREE.FrontSide,
    });
}

function isMaxFace(face) {
    return face.startsWith('max');
}

function isInsideOuterBounds(face, bounds, outer) {
    return isMaxFace(face) ? bounds[face] < outer[face] - EPSILON : bounds[face] > outer[face] + EPSILON;
}

function opensTowards(face, bounds, next) {
    if (!next) return false;
    return isMaxFace(face) ? next[face] > bounds[face] + EPSILON : next[face] < bounds[face] - EPSILON;
}

// Same placement as the outer walls in ArenaGeometryCompilePipeline.compileWallStage: the wall
// stands just outside the collision bounds, so its inner face is where a player bounces.
function resolveWallBox(face, bounds, thickness) {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const depth = bounds.maxZ - bounds.minZ;
    const centreY = bounds.minY + height / 2;
    const half = thickness / 2;
    if (face === 'minX' || face === 'maxX') {
        const x = face === 'maxX' ? bounds.maxX + half : bounds.minX - half;
        return { x, y: centreY, z: 0, width: thickness, height, depth };
    }
    if (face === 'minZ' || face === 'maxZ') {
        const z = face === 'maxZ' ? bounds.maxZ + half : bounds.minZ - half;
        return { x: 0, y: centreY, z, width: width + 2 * thickness, height, depth: thickness };
    }
    return { x: 0, y: bounds.maxY + half, z: 0, width, height: thickness, depth };
}

function clampUnit(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0;
}

/**
 * The walls a growing map shows on the boundary of its current stage.
 *
 * Every stage gets its own walls on each face that lies inside the fully built map; faces on the
 * outer bounds are the regular arena walls already. While the next stage is announced its moving
 * walls glow, while it opens the side walls sink into the floor and a roof lifts towards the next
 * height. Faces that do not move are handed to the incoming stage at the start of the opening, so
 * two walls never overlap on the same plane. Collision is not part of this: the controller keeps
 * the bounds at the old stage until the opening has finished.
 */
export class ArenaExpansionWallVisual {
    constructor(renderer) {
        this.renderer = renderer || null;
        this.group = null;
        this.stages = [];
        this.idleMaterial = null;
        this.warningMaterial = null;
    }

    /**
     * @param {Array<object>} stageBounds world-space bounds of every stage, in stage order
     * @param {object} outerBounds bounds of the built map
     * @param {number} thickness wall thickness in world units
     */
    build(stageBounds, outerBounds, thickness) {
        this.clear();
        if (!this.renderer?.addToScene || !Array.isArray(stageBounds) || stageBounds.length === 0) return null;
        const wallThickness = Math.max(0.01, Number(thickness) || 0);
        this.idleMaterial = createWallMaterial(0x1b2d44, 0x0a2a4a, IDLE_EMISSIVE_INTENSITY);
        this.warningMaterial = createWallMaterial(0x2a1a10, 0xff7a1a, IDLE_EMISSIVE_INTENSITY);
        this.group = new THREE.Group();
        this.group.name = 'map-expansion-walls';

        for (let index = 0; index < stageBounds.length; index += 1) {
            const bounds = stageBounds[index];
            const next = stageBounds[index + 1] || null;
            const walls = [];
            for (const face of FACES) {
                if (!isInsideOuterBounds(face, bounds, outerBounds)) continue;
                const box = resolveWallBox(face, bounds, wallThickness);
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.width, box.height, box.depth), this.idleMaterial);
                mesh.name = `map-expansion-wall-${index}-${face}`;
                mesh.position.set(box.x, box.y, box.z);
                mesh.visible = false;
                mesh.castShadow = false;
                mesh.renderOrder = 2;
                mesh.userData.expansionStageIndex = index;
                mesh.userData.expansionFace = face;
                const opensNext = opensTowards(face, bounds, next);
                let travel = 0;
                if (opensNext) travel = face === 'maxY' ? next.maxY - bounds.maxY : -(box.height + wallThickness);
                this.group.add(mesh);
                walls.push({ mesh, opensNext, baseY: box.y, travel });
            }
            this.stages.push(walls);
        }

        this.renderer.addToScene(this.group);
        return this.group;
    }

    /** @param {{ stageIndex: number, nextStageIndex: number, phase: string, phaseProgress: number, secondsUntilOpen: number }} state */
    update(state) {
        if (!this.group || !state) return;
        const telegraph = state.phase === MAP_EXPANSION_PHASES.TELEGRAPH;
        const opening = state.phase === MAP_EXPANSION_PHASES.OPENING;
        const progress = clampUnit(state.phaseProgress);

        for (let index = 0; index < this.stages.length; index += 1) {
            const current = index === state.stageIndex;
            const incoming = opening && index === state.nextStageIndex;
            for (const wall of this.stages[index]) {
                const moving = current && wall.opensNext;
                wall.mesh.visible = incoming || (current && (!opening || wall.opensNext));
                wall.mesh.material = moving && (telegraph || opening) ? this.warningMaterial : this.idleMaterial;
                wall.mesh.position.y = moving && opening ? wall.baseY + wall.travel * progress : wall.baseY;
            }
        }

        if (telegraph) {
            const pulse = 0.75 + 0.25 * Math.sin(state.secondsUntilOpen * Math.PI * 2 * WARNING_PULSE_HZ);
            this.warningMaterial.emissiveIntensity = IDLE_EMISSIVE_INTENSITY
                + (WARNING_EMISSIVE_PEAK - IDLE_EMISSIVE_INTENSITY) * progress * pulse;
            this.warningMaterial.opacity = WALL_OPACITY;
        } else if (opening) {
            this.warningMaterial.emissiveIntensity = WARNING_EMISSIVE_PEAK * (1 - progress);
            this.warningMaterial.opacity = WALL_OPACITY * (1 - progress);
        }
    }

    clear() {
        if (this.group) {
            this.renderer?.removeFromScene?.(this.group);
            disposeObject3DResources(this.group);
        }
        this.idleMaterial?.dispose();
        this.warningMaterial?.dispose();
        this.group = null;
        this.stages = [];
        this.idleMaterial = null;
        this.warningMaterial = null;
    }
}
