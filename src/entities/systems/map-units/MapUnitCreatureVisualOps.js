import * as THREE from 'three';

const SEGMENT_COUNT = 8;
const HEALTH_COLOR = 0x8cfa65;

export function createCreatureAssets() {
    return {
        segmentGeometry: new THREE.SphereGeometry(1, 12, 8),
        healthBackGeometry: new THREE.BoxGeometry(5.2, 0.36, 0.12),
        healthFillGeometry: new THREE.BoxGeometry(5, 0.24, 0.14),
        bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x9b5d38, emissive: 0x241008, emissiveIntensity: 0.18,
            roughness: 0.88, metalness: 0.02,
        }),
        headMaterial: new THREE.MeshStandardMaterial({
            color: 0xc57943, emissive: 0x351509, emissiveIntensity: 0.22,
            roughness: 0.78, metalness: 0.03,
        }),
        healthBackMaterial: new THREE.MeshBasicMaterial({ color: 0x16100c, transparent: true, opacity: 0.8 }),
    };
}

export function disposeCreatureAssets(assets) {
    for (const value of Object.values(assets || {})) value?.dispose?.();
}

export function createCreatureVisual(renderer, assets, scale = 1) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.scale.setScalar(Math.max(0.001, Number(scale) || 1));
    root.userData.creature = true;
    root.userData.segments = [];
    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
        const segment = new THREE.Mesh(
            assets.segmentGeometry,
            index === 0 ? assets.headMaterial : assets.bodyMaterial,
        );
        const taper = 1 - (index * 0.055);
        segment.scale.set(1.65 * taper, 1.25 * taper, 1.5 * taper);
        root.add(segment);
        root.userData.segments.push(segment);
    }
    const healthMaterial = new THREE.MeshBasicMaterial({ color: HEALTH_COLOR });
    const healthBack = new THREE.Mesh(assets.healthBackGeometry, assets.healthBackMaterial);
    healthBack.position.y = 5;
    root.add(healthBack);
    const healthFill = new THREE.Mesh(assets.healthFillGeometry, healthMaterial);
    healthFill.position.set(0, 5, 0.08);
    root.add(healthFill);
    root.userData.healthFill = healthFill;
    root.userData.disposableMaterials = [healthMaterial];
    renderer.addToScene(root);
    return root;
}

export function updateCreatureVisual(unit) {
    const root = unit?.root;
    if (!root) return;
    root.position.copy(unit.groundPosition);
    root.rotation.y = unit.yaw;
    const phase = unit.progress * 0.22;
    for (let index = 0; index < root.userData.segments.length; index += 1) {
        const segment = root.userData.segments[index];
        segment.position.set(Math.sin(phase - index * 0.62) * 0.7, 1.35, -index * 1.15);
    }
    const healthFill = root.userData.healthFill;
    const ratio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    healthFill.scale.x = Math.max(0.001, ratio);
    healthFill.position.x = -2.5 * (1 - ratio);
    healthFill.material.color.setHex(ratio <= 0.3 ? 0xff5533 : HEALTH_COLOR);
}
