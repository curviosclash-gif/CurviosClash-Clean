import * as THREE from 'three';

const SEGMENT_COUNT = 8;
const HEALTH_COLOR = 0x8cfa65;

export function createCreatureAssets() {
    return {
        segmentGeometry: new THREE.SphereGeometry(1, 12, 8),
        eyeGeometry: new THREE.SphereGeometry(1, 8, 6),
        pupilGeometry: new THREE.SphereGeometry(1, 8, 6),
        mouthGeometry: new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.42, 0.08, 0),
            new THREE.Vector3(0, -0.2, 0),
            new THREE.Vector3(0.42, 0.08, 0),
        ]), 10, 0.055, 5, false),
        healthBackGeometry: new THREE.BoxGeometry(5.2, 0.36, 0.12),
        healthFillGeometry: new THREE.BoxGeometry(5, 0.24, 0.14),
        bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x5b9138, emissive: 0x101c08, emissiveIntensity: 0.08,
            roughness: 0.88, metalness: 0.02,
        }),
        bodyStripeMaterial: new THREE.MeshStandardMaterial({
            color: 0x91bd4f, emissive: 0x17240b, emissiveIntensity: 0.08,
            roughness: 0.9, metalness: 0,
        }),
        headMaterial: new THREE.MeshStandardMaterial({
            color: 0xa9d86c, emissive: 0x1d2b0b, emissiveIntensity: 0.08,
            roughness: 0.82, metalness: 0,
        }),
        eyeMaterial: new THREE.MeshStandardMaterial({ color: 0xfff6d8, roughness: 0.45 }),
        pupilMaterial: new THREE.MeshStandardMaterial({ color: 0x172019, roughness: 0.55 }),
        mouthMaterial: new THREE.MeshBasicMaterial({ color: 0x3d281b }),
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
            index === 0 ? assets.headMaterial : index % 2 === 0 ? assets.bodyMaterial : assets.bodyStripeMaterial,
        );
        const taper = 1 - (index * 0.055);
        segment.scale.set(1.55 * taper, 1.15 * taper, 1.4 * taper);
        root.add(segment);
        root.userData.segments.push(segment);
    }
    const face = new THREE.Group();
    face.name = 'worm-face';
    face.userData.creatureFace = true;
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(assets.eyeGeometry, assets.eyeMaterial);
        eye.name = 'worm-eye';
        eye.position.set(side * 0.76, 0.64, 0.98);
        eye.scale.set(0.37, 0.42, 0.24);
        face.add(eye);

        const pupil = new THREE.Mesh(assets.pupilGeometry, assets.pupilMaterial);
        pupil.name = 'worm-pupil';
        pupil.position.set(side * 0.76, 0.62, 1.17);
        pupil.scale.set(0.16, 0.2, 0.11);
        face.add(pupil);
    }
    const mouth = new THREE.Mesh(assets.mouthGeometry, assets.mouthMaterial);
    mouth.name = 'worm-smile';
    mouth.position.set(0, -0.23, 1.34);
    face.add(mouth);
    root.add(face);
    root.userData.face = face;
    root.userData.wormVisual = true;
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
        segment.position.set(Math.sin(phase - index * 0.62) * 1.05, 1.35 + Math.cos(phase - index * 0.62) * 0.14, -index * 1.25);
    }
    root.userData.face.position.copy(root.userData.segments[0].position);
    const healthFill = root.userData.healthFill;
    const ratio = Math.max(0, Math.min(1, unit.hp / Math.max(1, unit.maxHp)));
    healthFill.scale.x = Math.max(0.001, ratio);
    healthFill.position.x = -2.5 * (1 - ratio);
    healthFill.material.color.setHex(ratio <= 0.3 ? 0xff5533 : HEALTH_COLOR);
}
