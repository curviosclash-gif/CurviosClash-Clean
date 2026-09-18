import * as THREE from 'three';

const SWARM_COLOR = 0xd8f4ff;

export function createSwarmAssets() {
    return {
        geometry: new THREE.OctahedronGeometry(0.8, 0),
        material: new THREE.MeshStandardMaterial({
            color: SWARM_COLOR,
            emissive: 0x294c66,
            emissiveIntensity: 0.45,
            roughness: 0.45,
            metalness: 0.35,
        }),
    };
}

export function disposeSwarmAssets(assets) {
    assets?.geometry?.dispose?.();
    assets?.material?.dispose?.();
}

export function createSwarmVisual(renderer, assets, members) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.userData.swarm = true;
    for (const member of members) {
        const mesh = new THREE.Mesh(assets.geometry, assets.material);
        mesh.position.copy(member.offset);
        mesh.userData.swarmMemberIndex = member.index;
        root.add(mesh);
    }
    renderer.addToScene(root);
    return root;
}

export function updateSwarmVisual(unit) {
    if (!unit?.root) return;
    unit.root.position.copy(unit.position);
    unit.root.rotation.y = unit.yaw;
}
