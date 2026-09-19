import * as THREE from 'three';

export function createRepairDroneAssets() {
    return {
        bodyGeometry: new THREE.OctahedronGeometry(0.75, 0),
        crossGeometry: new THREE.BoxGeometry(1.35, 0.18, 0.18),
        bodyMaterial: new THREE.MeshStandardMaterial({
            color: 0x49d982,
            emissive: 0x123d28,
            emissiveIntensity: 0.5,
            roughness: 0.45,
            metalness: 0.35,
        }),
        crossMaterial: new THREE.MeshBasicMaterial({ color: 0xeafff1 }),
    };
}

export function createRepairDroneVisual(renderer, assets) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.userData.repairDrone = true;
    root.add(new THREE.Mesh(assets.bodyGeometry, assets.bodyMaterial));
    const horizontal = new THREE.Mesh(assets.crossGeometry, assets.crossMaterial);
    horizontal.position.z = 0.72;
    root.add(horizontal);
    const vertical = new THREE.Mesh(assets.crossGeometry, assets.crossMaterial);
    vertical.position.z = 0.72;
    vertical.rotation.z = Math.PI * 0.5;
    root.add(vertical);
    renderer.addToScene(root);
    return root;
}

export function updateRepairDroneVisual(drone) {
    if (!drone?.root) return;
    drone.root.position.copy(drone.position);
    drone.root.rotation.y = drone.yaw;
}

export function removeRepairDroneVisual(renderer, drone) {
    if (!drone?.root) return;
    renderer?.removeFromScene?.(drone.root);
    drone.root = null;
}

export function disposeRepairDroneAssets(assets) {
    for (const value of Object.values(assets || {})) value?.dispose?.();
}
