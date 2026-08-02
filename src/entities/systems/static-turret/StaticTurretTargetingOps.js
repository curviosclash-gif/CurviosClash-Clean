import * as THREE from 'three';

function clampFinite(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function isPlayerTargetEligible(turret, candidate) {
    if (candidate === turret.ownerPlayer || !candidate?.alive || !candidate.position) return false;
    return (candidate.spawnProtectionTimer || 0) <= 0;
}

function isTargetStillValid(system, turret, target) {
    if (!target?.position) return false;
    if (target.isTrail) {
        if (!target.entry || target.entry.destroyed) return false;
        const owner = system.entityManager?.players?.[target.entry.playerIndex];
        if ((owner?.spawnProtectionTimer || 0) > 0) return false;
    } else if (!isPlayerTargetEligible(turret, target)) {
        return false;
    }
    return turret.position.distanceToSquared(target.position) < turret.range * turret.range;
}

export function hasStaticTurretLineOfSight(system, turret, target) {
    const arena = system.entityManager?.arena;
    if (!arena?.checkCollisionFast) return true;
    system._tmpAim.subVectors(target.position, turret.position);
    const distance = system._tmpAim.length();
    if (distance <= 0.000001) return true;
    const stepSize = clampFinite(turret.losSampleStep, 0.5, 0.2, 2);
    const steps = Math.max(2, Math.ceil(distance / stepSize));
    for (let i = 1; i < steps; i += 1) {
        system._tmpPoint.lerpVectors(turret.position, target.position, i / steps);
        if (arena.checkCollisionFast(system._tmpPoint, 0.18)) return false;
    }
    return true;
}

function findTrailTarget(system, turret, nearestDistanceSq) {
    const trailSpatialIndex = system.entityManager?._trailSpatialIndex;
    const grid = trailSpatialIndex?.spatialGrid;
    const gridSize = Math.max(1, Number(trailSpatialIndex?.gridSize) || 10);
    if (!(grid instanceof Map)) return null;
    const range = turret.range;
    const minCellX = Math.floor((turret.position.x - range) / gridSize);
    const maxCellX = Math.floor((turret.position.x + range) / gridSize);
    const minCellZ = Math.floor((turret.position.z - range) / gridSize);
    const maxCellZ = Math.floor((turret.position.z + range) / gridSize);
    const queryStamp = ++system._trailQueryStamp;
    const target = turret.trailTarget || (turret.trailTarget = {
        isTrail: true, entry: null, position: new THREE.Vector3(),
    });
    const candidate = turret.trailCandidate || (turret.trailCandidate = {
        isTrail: true, entry: null, position: new THREE.Vector3(),
    });
    target.entry = null;
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
            const cell = grid.get((cellX + 1000) * 2000 + (cellZ + 1000));
            if (!cell) continue;
            for (const entry of cell) {
                if (!entry || entry.destroyed || entry.playerIndex === turret.ownerPlayer.index) continue;
                const owner = system.entityManager?.players?.[entry.playerIndex];
                if ((owner?.spawnProtectionTimer || 0) > 0) continue;
                if (entry._turretTrailQueryStamp === queryStamp) continue;
                entry._turretTrailQueryStamp = queryStamp;
                const fromX = Number(entry.fromX) || 0;
                const fromY = Number(entry.fromY) || 0;
                const fromZ = Number(entry.fromZ) || 0;
                const segmentX = (Number(entry.toX) || 0) - fromX;
                const segmentY = (Number(entry.toY) || 0) - fromY;
                const segmentZ = (Number(entry.toZ) || 0) - fromZ;
                const lengthSq = segmentX ** 2 + segmentY ** 2 + segmentZ ** 2;
                const projection = lengthSq > 0.000001 ? THREE.MathUtils.clamp((
                    (turret.position.x - fromX) * segmentX
                    + (turret.position.y - fromY) * segmentY
                    + (turret.position.z - fromZ) * segmentZ
                ) / lengthSq, 0, 1) : 0;
                candidate.entry = entry;
                candidate.position.set(
                    fromX + segmentX * projection,
                    fromY + segmentY * projection,
                    fromZ + segmentZ * projection
                );
                const distanceSq = turret.position.distanceToSquared(candidate.position);
                if (distanceSq >= nearestDistanceSq
                    || !hasStaticTurretLineOfSight(system, turret, candidate)) continue;
                nearestDistanceSq = distanceSq;
                target.entry = entry;
                target.position.copy(candidate.position);
            }
        }
    }
    return target.entry ? target : null;
}

function findTarget(system, turret) {
    const candidates = turret.ownerPlayer
        ? (system.entityManager?.players || [])
        : (system.entityManager?.humanPlayers || []);
    let nearest = null;
    let nearestDistanceSq = turret.range * turret.range;
    for (const candidate of candidates) {
        if (!isPlayerTargetEligible(turret, candidate)) continue;
        const distanceSq = turret.position.distanceToSquared(candidate.position);
        if (distanceSq >= nearestDistanceSq
            || !hasStaticTurretLineOfSight(system, turret, candidate)) continue;
        nearest = candidate;
        nearestDistanceSq = distanceSq;
    }
    if (turret.ownerPlayer) {
        const trailTarget = findTrailTarget(system, turret, nearestDistanceSq);
        if (trailTarget) return trailTarget;
    }
    return nearest;
}

export function resolveStaticTurretTarget(system, turret, dt) {
    turret.targetHoldRemaining = Math.max(0, turret.targetHoldRemaining - dt);
    turret.targetReacquireRemaining = Math.max(0, turret.targetReacquireRemaining - dt);
    if (isTargetStillValid(system, turret, turret.target)) {
        if (turret.targetHoldRemaining > 0 || turret.targetReacquireRemaining > 0) return turret.target;
    } else {
        turret.target = null;
    }
    if (turret.targetReacquireRemaining > 0) return null;
    const previousTarget = turret.target;
    const nextTarget = findTarget(system, turret);
    turret.target = nextTarget;
    turret.targetHoldRemaining = nextTarget ? turret.targetHoldSeconds : 0;
    turret.targetReacquireRemaining = turret.targetReacquireSeconds;
    if (nextTarget && nextTarget !== previousTarget) {
        turret.acquireRemaining = turret.acquireDelaySeconds;
    }
    return nextTarget;
}
