import * as THREE from 'three';

// Pickup density scales with the arena, so a large map keeps up to a hundred items alive at once,
// each built from two to six meshes. A material per mesh meant several hundred material instances
// and a uniform upload for every one of them. Nothing recolours a pickup at runtime, so identical
// descriptions share a single material instance.
const SHARED_MATERIALS = new Map();

// A collected item must not dispose a material that every other item of the same look still draws
// with, so shared instances are marked and skipped when a pickup mesh is torn down.
export const SHARED_POWERUP_MATERIAL_FLAG = 'sharedPowerupMaterial';

function sharedMaterial(key, build) {
    let material = SHARED_MATERIALS.get(key);
    if (!material) {
        material = build();
        material.userData[SHARED_POWERUP_MATERIAL_FLAG] = true;
        SHARED_MATERIALS.set(key, material);
    }
    return material;
}

export function isSharedPowerupMaterial(material) {
    return material?.userData?.[SHARED_POWERUP_MATERIAL_FLAG] === true;
}

export function createStandardMaterial(color, options = {}) {
    const emissiveIntensity = Number(options.emissiveIntensity) || 0.5;
    const roughness = Number(options.roughness) || 0.3;
    const metalness = Number(options.metalness) || 0.65;
    const transparent = !!options.transparent;
    const opacity = Number.isFinite(options.opacity) ? options.opacity : 1.0;
    return sharedMaterial(
        `standard|${color}|${emissiveIntensity}|${roughness}|${metalness}|${transparent}|${opacity}`,
        () => new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity,
            roughness,
            metalness,
            transparent,
            opacity,
        })
    );
}

export function createBasicMaterial(color, options = {}) {
    const transparent = !!options.transparent;
    const opacity = Number.isFinite(options.opacity) ? options.opacity : 1.0;
    const wireframe = !!options.wireframe;
    const depthWrite = options.depthWrite !== false;
    return sharedMaterial(
        `basic|${color}|${transparent}|${opacity}|${wireframe}|${depthWrite}`,
        () => new THREE.MeshBasicMaterial({
            color,
            transparent,
            opacity,
            wireframe,
            depthWrite,
        })
    );
}
