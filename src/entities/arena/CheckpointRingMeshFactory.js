import * as THREE from 'three';
import { getCheckpointLabelTexture } from './ArenaBuildResourceCache.js';

const CHECKPOINT_COLOR = 0xaaff00;
export const CHECKPOINT_BRANCH_COLOR = 0x33e6ff;
const CHECKPOINT_FINISH_COLOR = 0xffd700;
const CHECKPOINT_INACTIVE_COLOR = 0x666666;
const CHECKPOINT_PASSED_COLOR = 0x00cc00;

export const RING_STATE_INACTIVE = 'inactive';
export const RING_STATE_NEXT = 'next';
export const RING_STATE_PASSED = 'passed';
const RING_RADIUS = 12;
const RING_TUBE = 0.2;
const FINISH_TUBE = 0.35;
const LABEL_SIZE = 8;
const MIN_RING_SCALE = 0.26;
const MIN_LABEL_SCALE = 0.65;
const MAX_LABEL_SCALE = 1.15;

let sharedRingGeometry = null;
let sharedFinishGeometry = null;
let sharedLabelGeometry = null;

function getRingGeometry() {
    if (!sharedRingGeometry) {
        sharedRingGeometry = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 12, 56);
        sharedRingGeometry.userData.__sharedNoDispose = true;
    }
    return sharedRingGeometry;
}

function getFinishGeometry() {
    if (!sharedFinishGeometry) {
        sharedFinishGeometry = new THREE.TorusGeometry(RING_RADIUS, FINISH_TUBE, 12, 56);
        sharedFinishGeometry.userData.__sharedNoDispose = true;
    }
    return sharedFinishGeometry;
}

function getLabelGeometry() {
    if (!sharedLabelGeometry) {
        sharedLabelGeometry = new THREE.PlaneGeometry(LABEL_SIZE, LABEL_SIZE);
        sharedLabelGeometry.userData.__sharedNoDispose = true;
    }
    return sharedLabelGeometry;
}

function createRingMaterial(color, overrides = {}) {
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.85,
        roughness: 0.25,
        metalness: 0.7,
    });
    if (Number.isFinite(overrides.emissiveIntensity)) {
        material.emissiveIntensity = overrides.emissiveIntensity;
    }
    return material;
}

function createLabelMaterial(label) {
    return new THREE.MeshBasicMaterial({
        map: getCheckpointLabelTexture(label),
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function buildRingGroup(position, rotation, ringGeometry, ringMaterial, label, visualRadius = RING_RADIUS, options = {}) {
    const group = new THREE.Group();
    group.position.copy(position);
    if (rotation) {
        group.rotation.copy(rotation);
    }

    const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
    ringMesh.frustumCulled = false;
    const ringScale = Math.max(MIN_RING_SCALE, Number(visualRadius) / RING_RADIUS || 1);
    ringMesh.scale.setScalar(ringScale);
    group.add(ringMesh);

    const labelMesh = new THREE.Mesh(getLabelGeometry(), createLabelMaterial(label));
    labelMesh.frustumCulled = false;
    labelMesh.scale.setScalar(clamp(ringScale * 1.8, MIN_LABEL_SCALE, MAX_LABEL_SCALE));
    group.add(labelMesh);

    group.userData.ringMesh = ringMesh;
    group.userData.labelMesh = labelMesh;
    group.userData.ringVisualKind = options.visualKind || 'default';
    return group;
}

export function setCheckpointRingState(ringEntry, state) {
    const mesh = ringEntry?.mesh;
    if (!mesh) return;
    const ringMesh = mesh.userData?.ringMesh;
    if (!ringMesh?.material) return;

    mesh.userData.ringState = state;
    if (state === RING_STATE_INACTIVE) {
        ringMesh.material.color.setHex(CHECKPOINT_INACTIVE_COLOR);
        ringMesh.material.emissive.setHex(CHECKPOINT_INACTIVE_COLOR);
        ringMesh.material.emissiveIntensity = 0.2;
    } else if (state === RING_STATE_NEXT) {
        const baseColor = mesh.userData.checkpointColor ?? CHECKPOINT_COLOR;
        ringMesh.material.color.setHex(baseColor);
        ringMesh.material.emissive.setHex(baseColor);
        ringMesh.material.emissiveIntensity = 0.85;
    } else if (state === RING_STATE_PASSED) {
        ringMesh.material.color.setHex(CHECKPOINT_PASSED_COLOR);
        ringMesh.material.emissive.setHex(CHECKPOINT_PASSED_COLOR);
        ringMesh.material.emissiveIntensity = 0.45;
    }
}

export function createCheckpointRingMesh(
    position,
    rotation,
    number,
    renderer,
    visualRadius = RING_RADIUS,
    options = {}
) {
    const checkpointColor = Number.isFinite(options.color) ? options.color : CHECKPOINT_COLOR;
    const material = createRingMaterial(checkpointColor, {
        emissiveIntensity: Number.isFinite(options.emissiveIntensity) ? options.emissiveIntensity : 0.85,
    });
    const group = buildRingGroup(
        position,
        rotation,
        getRingGeometry(),
        material,
        number,
        visualRadius,
        options
    );
    group.userData.checkpointNumber = number;
    group.userData.checkpointColor = checkpointColor;
    group.userData.checkpointVisualKind = options.visualKind || 'default';
    renderer?.addToScene?.(group);
    return group;
}

export function createFinishRingMesh(position, rotation, renderer, visualRadius = RING_RADIUS) {
    const material = createRingMaterial(CHECKPOINT_FINISH_COLOR);
    material.emissiveIntensity = 1.0;
    material.roughness = 0.2;
    material.metalness = 0.75;
    const group = buildRingGroup(position, rotation, getFinishGeometry(), material, 'F', visualRadius);
    group.userData.isFinish = true;
    renderer?.addToScene?.(group);
    return group;
}

export function disposeCheckpointRingMesh(group) {
    if (!group) return;
    group.traverse((child) => {
        if (child.isMesh) {
            if (child.material) {
                child.material.dispose();
            }
            if (child.geometry && !child.geometry.userData.__sharedNoDispose) {
                child.geometry.dispose();
            }
        }
    });
    if (group.parent) {
        group.parent.remove(group);
    }
}
