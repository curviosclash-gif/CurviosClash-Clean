import * as THREE from 'three';
import { copyExplosionContact } from '../../effects/ConventionalExplosionProfiles.js';

export function createBomberBombMesh() {
    const root = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.48, metalness: 0.7 });
    const noseMaterial = new THREE.MeshStandardMaterial({ color: 0x9b5530, roughness: 0.55, metalness: 0.45 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), bodyMaterial);
    body.scale.set(0.76, 1.55, 0.76);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.46, 8), noseMaterial);
    nose.rotation.x = -Math.PI / 2;
    nose.position.y = -0.43;
    root.add(body, nose);
    root.userData.bomberBombMaterials = [bodyMaterial, noseMaterial];
    return root;
}

export function spawnBomberBomb(system, owner, position, velocity, { damage = 50, blastRadius = 15 } = {}) {
    if (system.networkReplica || !owner || !position || !velocity) return null;
    const mesh = system._acquireProjectileMesh('BOMBER_BOMB', 0x30343b);
    mesh.position.copy(position);
    const projectile = system._acquireProjectileState();
    projectile.mesh = mesh;
    projectile.poolKey = 'BOMBER_BOMB';
    projectile.owner = owner;
    projectile.type = 'BOMBER_BOMB';
    projectile.position.copy(position);
    projectile.previousPosition.copy(position);
    projectile.velocity.copy(velocity);
    projectile.radius = 0.55;
    projectile.gravity = -24;
    projectile.blastDamage = Math.max(1, Number(damage) || 50);
    projectile.blastRadius = Math.max(1, Number(blastRadius) || 15);
    projectile.ttl = 30;
    projectile.maxDistance = Infinity;
    system.projectiles.push(projectile);
    return projectile;
}

export function simulateBomberBomb(system, projectile, index, dt, arena, players, trailSpatialIndex, time) {
    const steps = Math.max(1, Math.ceil(Math.min(30, Math.max(0, Number(dt) || 0)) * 60));
    const stepDt = Math.max(0, Number(dt) || 0) / steps;
    let shouldRemove = false;
    for (let step = 0; step < steps; step += 1) {
        const result = system._simulationOps.stepProjectile(
            projectile, index, stepDt, arena, players, trailSpatialIndex, time,
        );
        copyExplosionContact(projectile.explosionContact, result?.arenaCollision,
            result?.projectileHitArena === true && result?.bouncedOnFoam !== true);
        shouldRemove = system._hitResolver.resolveProjectileOutcome(projectile, players, trailSpatialIndex, result);
        if (shouldRemove) break;
    }
    return shouldRemove;
}
