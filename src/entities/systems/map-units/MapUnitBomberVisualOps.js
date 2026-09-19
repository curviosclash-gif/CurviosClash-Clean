import * as THREE from 'three';

export function createBomberAssets() {
    return {
        box: new THREE.BoxGeometry(1, 1, 1),
        bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x4c5663, roughness: 0.58, metalness: 0.48,
        }),
        accentMaterial: new THREE.MeshStandardMaterial({
            color: 0xc74736, emissive: 0x32100c, emissiveIntensity: 0.28, roughness: 0.42, metalness: 0.4,
        }),
    };
}

export function disposeBomberAssets(assets) {
    assets?.box?.dispose?.();
    assets?.bodyMaterial?.dispose?.();
    assets?.accentMaterial?.dispose?.();
}

export function createBomberVisual(renderer, assets, scale = 1) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.scale.setScalar(Math.max(0.001, Number(scale) || 1));
    root.userData.bomber = true;

    const addPart = (position, partScale, material = assets.bodyMaterial) => {
        const mesh = new THREE.Mesh(assets.box, material);
        mesh.position.set(...position);
        mesh.scale.set(...partScale);
        root.add(mesh);
    };
    addPart([0, 0, 0], [1.15, 0.55, 3.2]);
    addPart([-2.6, 0, 0.15], [2.1, 0.18, 1.3]);
    addPart([2.6, 0, 0.15], [2.1, 0.18, 1.3]);
    addPart([0, 0.65, 2.45], [0.18, 0.75, 0.85], assets.accentMaterial);
    addPart([0, 0.45, -1.25], [0.72, 0.35, 0.9], assets.accentMaterial);

    renderer.addToScene(root);
    return root;
}

export function updateBomberVisual(unit) {
    if (!unit?.root) return;
    unit.root.position.copy(unit.position);
    unit.root.rotation.y = unit.yaw;
}
