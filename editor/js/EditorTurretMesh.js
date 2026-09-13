import * as THREE from 'three';

export function createEditorTurretMesh(manager, rocket = true) {
    const group = new THREE.Group();
    const material = manager.markOwnedResource(new THREE.MeshStandardMaterial({
        color: rocket ? 0xff4d6d : 0xffb347, metalness: 0.65, roughness: 0.4,
    }));
    const base = new THREE.Mesh(manager.cylinderGeo, material);
    base.scale.set(7.2, 6.6, 7.2);
    base.position.y = -3.3;
    const head = new THREE.Mesh(manager.sphereGeo, material);
    head.scale.setScalar(4);
    const barrel = new THREE.Mesh(manager.cylinderGeo, material);
    barrel.scale.set(rocket ? 2.1 : 0.7, 11.4, rocket ? 2.1 : 0.7);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 6.3;
    group.add(base, head, barrel);
    return group;
}
