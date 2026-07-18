import * as THREE from 'three';

export class ProjectileStatePool {
    constructor() {
        this.pool = [];
    }

    acquire() {
        const pooled = this.pool.pop();
        if (pooled) {
            return pooled;
        }

        return {
            mesh: null,
            flame: null,
            poolKey: '',
            owner: null,
            type: null,
            position: new THREE.Vector3(),
            previousPosition: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            radius: 0,
            ttl: 0,
            traveled: 0,
            target: null,
            huntRocket: false,
            visualScale: 1,
            homingTurnRate: 0,
            homingLockOnAngle: 0,
            homingRange: 0,
            homingReacquireInterval: 0,
            homingReacquireTimer: 0,
            foamBounces: 0,
            foamBounceCooldown: 0,
            traversalId: '',
        };
    }

    release(projectile) {
        if (!projectile) return;
        projectile.mesh = null;
        projectile.flame = null;
        projectile.poolKey = '';
        projectile.owner = null;
        projectile.type = null;
        projectile.position.set(0, 0, 0);
        projectile.previousPosition.set(0, 0, 0);
        projectile.velocity.set(0, 0, 0);
        projectile.radius = 0;
        projectile.ttl = 0;
        projectile.traveled = 0;
        projectile.target = null;
        projectile.huntRocket = false;
        projectile.visualScale = 1;
        projectile.homingTurnRate = 0;
        projectile.homingLockOnAngle = 0;
        projectile.homingRange = 0;
        projectile.homingReacquireInterval = 0;
        projectile.homingReacquireTimer = 0;
        projectile.foamBounces = 0;
        projectile.foamBounceCooldown = 0;
        projectile.traversalId = '';
        this.pool.push(projectile);
    }

    clear() {
        this.pool.length = 0;
    }
}
