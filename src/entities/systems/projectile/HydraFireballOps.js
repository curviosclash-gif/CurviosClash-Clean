import * as THREE from 'three';

export const HYDRA_FIREBALL = 'HYDRA_FIREBALL';

/** A map-unit projectile, deliberately outside the pickup registry. */
export function spawnHydraFireball(system, owner, position, direction, scale = 1) {
    if (system.networkReplica || !owner || !position || !direction) return null;
    system._tmpDir.copy(direction);
    if (system._tmpDir.lengthSq() <= 0.000001) return null;
    system._tmpDir.normalize();
    const mesh = system._acquireProjectileMesh(HYDRA_FIREBALL, 0xff6b21);
    mesh.position.copy(position);
    mesh.scale.setScalar(scale);
    const projectile = system._acquireProjectileState();
    projectile.mesh = mesh;
    projectile.poolKey = HYDRA_FIREBALL;
    projectile.type = HYDRA_FIREBALL;
    projectile.owner = owner;
    projectile.position.copy(position);
    projectile.previousPosition.copy(position);
    projectile.velocity.copy(system._tmpDir).multiplyScalar(22 * scale);
    projectile.radius = 0.85 * scale;
    projectile.visualScale = scale;
    projectile.ttl = 4;
    projectile.maxDistance = 88 * scale;
    projectile.traveled = 0;
    projectile.huntRocket = false;
    projectile.homingEnabled = false;
    projectile.target = null;
    projectile.environmentProjectile = false;
    projectile.ignoresTrails = true;
    projectile.ignoresTurrets = true;
    projectile.targetReacquireDisabled = true;
    projectile.traversalId = `hydra:${system._nextTraversalId++}`;
    system.projectiles.push(projectile);
    return projectile;
}

export function createHydraFireballAssets() {
    return {
        bodyGeo: new THREE.SphereGeometry(0.85, 12, 8),
        bodyMat: new THREE.MeshStandardMaterial({ color: 0xff6b21, emissive: 0xff3800,
            emissiveIntensity: 1.8, roughness: 0.6 }),
    };
}

export function getHydraFireballAssets(cache) {
    const assets = createHydraFireballAssets();
    cache.set(HYDRA_FIREBALL, assets);
    return assets;
}

export function createHydraFireballGroup(assets) {
    const group = new THREE.Group();
    const material = assets.bodyMat.clone();
    group.add(new THREE.Mesh(assets.bodyGeo, material));
    group.userData.cosmeticMaterials = { bodyMaterial: material };
    return group;
}
