// ============================================
// ObjectiveTargetMarkerSystem.js - highlights the bot an arcade objective asks for
// ============================================

import * as THREE from 'three';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';
import {
    createObjectiveTargetMarkerState,
    resolveObjectiveTargetMarkerPulse,
    setObjectiveTargetMarkerIndex,
    updateObjectiveTargetMarkerState,
} from './ObjectiveTargetMarkerOps.js';

// A crimson that no trail colour uses (trails are cyan, orange, red, green,
// yellow, magenta), so the marked bot stays readable next to its own trail.
const MARKER_EMISSIVE_COLOR = 0xff2d55;
const MARKER_BASE_COLOR = 0x140208;
const MARKER_EMISSIVE_INTENSITY = 1.4;

const MARKER_OUTER_RADIUS_FACTOR = 1.9;
const MARKER_INNER_RADIUS_FACTOR = 0.86;
const MARKER_MIN_OUTER_RADIUS = 1.1;
const MARKER_MAX_OUTER_RADIUS = 6;
const MARKER_SEGMENTS = 28;
const MARKER_HEIGHT_OFFSET = -0.25;
const MARKER_RENDER_ORDER = 3;
const MARKER_RADIUS_EPSILON = 0.05;

function resolveOuterRadius(target) {
    const hitboxRadius = Math.max(0.2, Number(target?.hitboxRadius) || 0.8);
    return Math.min(
        MARKER_MAX_OUTER_RADIUS,
        Math.max(MARKER_MIN_OUTER_RADIUS, hitboxRadius * MARKER_OUTER_RADIUS_FACTOR)
    );
}

function resolveViewGroup(target) {
    // The view group is interpolated during render. Parenting the ring to it
    // keeps the marker glued to the ship instead of trailing one step behind.
    return target?.view?.group || null;
}

function resolveFollowPosition(target) {
    // Fallback without a view group (headless runs): follow the simulation.
    return target?.position || null;
}

export class ObjectiveTargetMarkerSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.state = createObjectiveTargetMarkerState();
        this.mesh = null;
        this._outerRadius = 0;
        this._parentGroup = null;
    }

    /**
     * Core pushes the player index that the active objective wants highlighted,
     * or `null` when nothing should be marked. Entities never read arcade state
     * themselves, so this stays a one-way call from the runtime into the scene.
     */
    setTarget(targetIndex) {
        return setObjectiveTargetMarkerIndex(this.state, targetIndex);
    }

    getTargetIndex() {
        return this.state.targetIndex;
    }

    getActiveIndex() {
        return this.state.activeIndex;
    }

    hasMarker() {
        return this.mesh !== null;
    }

    update(dt) {
        const result = updateObjectiveTargetMarkerState(this.state, {
            players: this.entityManager?.players || [],
            dt,
        });
        if (!result.target || result.changed) this._removeMesh();
        if (!result.target) return result;
        const mesh = this._ensureMesh(result.target);
        if (!mesh) return result;

        const position = this._parentGroup ? null : resolveFollowPosition(result.target);
        if (position) {
            mesh.position.set(
                Number(position.x) || 0,
                (Number(position.y) || 0) + MARKER_HEIGHT_OFFSET,
                Number(position.z) || 0
            );
        }
        const pulse = resolveObjectiveTargetMarkerPulse(result.elapsedSeconds);
        mesh.scale.set(pulse.scale, pulse.scale, pulse.scale);
        mesh.material.opacity = pulse.opacity;
        return result;
    }

    _ensureMesh(target) {
        const group = resolveViewGroup(target);
        // Inside the view group every unit is scaled by the model scale, so the
        // ring radius and height offset are expressed in that local space.
        const groupScale = group ? Math.max(0.01, Number(group.scale?.x) || 1) : 1;
        const outerRadius = resolveOuterRadius(target) / groupScale;
        if (
            this.mesh
            && this._parentGroup === group
            && Math.abs(this._outerRadius - outerRadius) <= MARKER_RADIUS_EPSILON
        ) {
            return this.mesh;
        }
        this._removeMesh();

        const geometry = new THREE.RingGeometry(
            outerRadius * MARKER_INNER_RADIUS_FACTOR,
            outerRadius,
            MARKER_SEGMENTS,
            1
        );
        const material = new THREE.MeshStandardMaterial({
            color: MARKER_BASE_COLOR,
            emissive: new THREE.Color(MARKER_EMISSIVE_COLOR),
            emissiveIntensity: MARKER_EMISSIVE_INTENSITY,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = MARKER_RENDER_ORDER;
        mesh.frustumCulled = false;
        mesh.userData.objectiveTargetMarker = true;

        if (group) {
            mesh.position.set(0, MARKER_HEIGHT_OFFSET / groupScale, 0);
            group.add(mesh);
        } else {
            this.entityManager?.renderer?.addToScene?.(mesh);
        }
        this.mesh = mesh;
        this._outerRadius = outerRadius;
        this._parentGroup = group;
        return mesh;
    }

    _removeMesh() {
        if (!this.mesh) return;
        if (this._parentGroup) {
            this._parentGroup.remove(this.mesh);
        } else {
            this.entityManager?.renderer?.removeFromScene?.(this.mesh);
        }
        disposeObject3DResources(this.mesh);
        this.mesh = null;
        this._outerRadius = 0;
        this._parentGroup = null;
    }

    reset() {
        this._removeMesh();
        this.state = createObjectiveTargetMarkerState();
    }

    dispose() {
        this.reset();
        this.entityManager = null;
    }
}
