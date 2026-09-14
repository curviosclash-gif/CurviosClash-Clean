import { isHuntTargetDescriptor } from '../../../hunt/HuntTargetingOps.js';
import * as THREE from 'three';

export function configureProjectileRange(projectile, config, multiplier = 1) {
    projectile.ttl = config.LIFE_TIME * multiplier;
    projectile.maxDistance = config.MAX_DISTANCE * multiplier;
}

export function configureExternalProjectileTarget(projectile, options) {
    const target = options.target;
    projectile.target = isHuntTargetDescriptor(target)
        ? { ...target, point: target.point ? { ...target.point } : undefined, position: { ...target.position } }
        : (target?.alive ? target : null);
    projectile.turretTargeting = options.turretTargeting ? { ...options.turretTargeting } : null;
    projectile.sourceTurretId = String(options.sourceTurretId || '');
    projectile.homingReacquireTimer = projectile.homingReacquireInterval;
}

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
            maxDistance: Infinity,
            target: null,
            turretTargeting: null,
            sourceTurretId: '',
            detonated: false,
            huntRocket: false,
            homingEnabled: false,
            itemHomingProfile: false,
            isMine: false,
            visualScale: 1,
            homingTurnRate: 0,
            homingLockOnAngle: 0,
            homingRange: 0,
            homingReacquireInterval: 0,
            homingReacquireTimer: 0,
            foamBounces: 0,
            foamBounceCooldown: 0,
            rocketTrailHandle: null,
            rocketTrailAccumulator: 0,
            rocketTrailLastPosition: new THREE.Vector3(),
            traversalId: '',
            networkId: '',
            environmentProjectile: false,
            targetPlayerIndex: -1,
            targetReacquireDisabled: false,
            ignoresTrails: false,
            ignoresTurrets: false,
            zoneProjectile: false,
            zoneSequence: 0,
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
        projectile.maxDistance = Infinity;
        projectile.target = null;
        projectile.turretTargeting = null;
        projectile.sourceTurretId = '';
        projectile.detonated = false;
        projectile.huntRocket = false;
        projectile.homingEnabled = false;
        projectile.itemHomingProfile = false;
        projectile.isMine = false;
        projectile.visualScale = 1;
        projectile.homingTurnRate = 0;
        projectile.homingLockOnAngle = 0;
        projectile.homingRange = 0;
        projectile.homingReacquireInterval = 0;
        projectile.homingReacquireTimer = 0;
        projectile.foamBounces = 0;
        projectile.foamBounceCooldown = 0;
        projectile.rocketTrailHandle = null;
        projectile.rocketTrailAccumulator = 0;
        projectile.rocketTrailLastPosition.set(0, 0, 0);
        projectile.traversalId = '';
        projectile.networkId = '';
        projectile.environmentProjectile = false;
        projectile.targetPlayerIndex = -1;
        projectile.targetReacquireDisabled = false;
        projectile.ignoresTrails = false;
        projectile.ignoresTurrets = false;
        projectile.zoneProjectile = false;
        projectile.zoneSequence = 0;
        this.pool.push(projectile);
    }

    clear() {
        this.pool.length = 0;
    }
}
