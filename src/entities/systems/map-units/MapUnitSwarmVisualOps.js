import * as THREE from 'three';

export function createSwarmAssets() {
    const wingGeometry = new THREE.BufferGeometry();
    wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, 0.65, 0, -0.12, 0.18, 0, 0.13,
        0.18, 0, 0.13, 0.65, 0, -0.12, 0.48, 0, -0.34,
    ], 3));
    wingGeometry.computeVertexNormals();
    return {
        geometry: new THREE.OctahedronGeometry(0.8, 0),
        wingGeometry,
        material: new THREE.MeshStandardMaterial({
            color: 0x8b8a82,
            roughness: 0.9,
            metalness: 0,
        }),
        wingMaterial: new THREE.MeshStandardMaterial({ color: 0x625f57, side: THREE.DoubleSide, roughness: 0.92 }),
    };
}

export function disposeSwarmAssets(assets) {
    assets?.geometry?.dispose?.();
    assets?.wingGeometry?.dispose?.();
    assets?.material?.dispose?.();
    assets?.wingMaterial?.dispose?.();
}

export function createSwarmVisual(renderer, assets, members) {
    if (!renderer?.addToScene || !assets) return null;
    const root = new THREE.Group();
    root.userData.swarm = true;
    for (const member of members) {
        const bird = new THREE.Group();
        bird.position.copy(member.offset);
        bird.userData.swarmMemberIndex = member.index;
        const body = new THREE.Mesh(assets.geometry, assets.material);
        body.scale.set(0.54, 0.36, 0.86);
        bird.add(body);
        const leftWing = new THREE.Group();
        leftWing.name = 'swarm-wing-left';
        leftWing.position.set(-0.08, 0.08, 0);
        leftWing.scale.x = -1;
        leftWing.add(new THREE.Mesh(assets.wingGeometry, assets.wingMaterial));
        const rightWing = new THREE.Group();
        rightWing.name = 'swarm-wing-right';
        rightWing.position.set(0.08, 0.08, 0);
        rightWing.add(new THREE.Mesh(assets.wingGeometry, assets.wingMaterial));
        bird.add(leftWing, rightWing);
        member.visualWings = [leftWing, rightWing];
        member.visualBody = body;
        root.add(bird);
    }
    renderer.addToScene(root);
    return root;
}

export function updateSwarmVisual(unit, dt = 0) {
    if (!unit?.root) return;
    unit.visualTime = (unit.visualTime || 0) + Math.max(0, dt);
    unit.root.position.copy(unit.position);
    unit.root.rotation.y = unit.yaw;
    for (let index = 0; index < unit.members.length; index += 1) {
        const member = unit.members[index];
        const bird = unit.root.children[index];
        if (!bird) continue;
        bird.visible = member.alive;
        bird.position.copy(member.offset);
        if (member.visualWings) {
            const flap = Math.sin(unit.visualTime * 13 + member.index * 1.7) * 0.62;
            member.visualWings[0].rotation.z = flap;
            member.visualWings[1].rotation.z = -flap;
        }
    }
}

function cloneSharedNode(source) {
    if (!source) return null;
    return source.clone(true);
}

/** Replaces the procedural fallback with the shared Blender parts; all clones share mesh data. */
export function applyAuthoredSwarmVisual(root, members, parts) {
    const bodyPart = parts?.get?.('pigeon_body');
    const wingPart = parts?.get?.('pigeon_wing');
    if (!root || !bodyPart || !wingPart) return false;
    for (const member of members || []) {
        const bird = root.children[member.index];
        if (!bird) return false;
        for (const child of [...bird.children]) child.removeFromParent();
        const body = cloneSharedNode(bodyPart);
        const leftWing = new THREE.Group();
        leftWing.name = 'swarm-wing-left';
        leftWing.position.set(-0.08, 0.08, 0);
        leftWing.scale.x = -1;
        leftWing.add(cloneSharedNode(wingPart));
        const rightWing = new THREE.Group();
        rightWing.name = 'swarm-wing-right';
        rightWing.position.set(0.08, 0.08, 0);
        rightWing.add(cloneSharedNode(wingPart));
        if (body) bird.add(body);
        bird.add(leftWing, rightWing);
        member.visualWings = [leftWing, rightWing];
        member.visualBody = body;
    }
    return true;
}
