import { isRocketTierType, resolveRocketTrailBlastMeters } from './RocketPickupSystem.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

const DEFAULT_SELF_SKIP_RECENT = 8;

function segmentLength(entry) {
    if (!entry) return 0;
    const dx = Number(entry.toX) - Number(entry.fromX);
    const dy = Number(entry.toY) - Number(entry.fromY);
    const dz = Number(entry.toZ) - Number(entry.fromZ);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function segmentMidpoint(entry) {
    if (!entry) return null;
    return {
        x: (Number(entry.fromX) + Number(entry.toX)) * 0.5,
        y: (Number(entry.fromY) + Number(entry.toY)) * 0.5,
        z: (Number(entry.fromZ) + Number(entry.toZ)) * 0.5,
    };
}

function buildImpactPoint(hit, projectile) {
    if (hit?.closestPoint) {
        return {
            x: Number(hit.closestPoint.closestX) || Number(projectile?.position?.x) || 0,
            y: Number(hit.closestPoint.closestY) || Number(projectile?.position?.y) || 0,
            z: Number(hit.closestPoint.closestZ) || Number(projectile?.position?.z) || 0,
        };
    }
    return {
        x: Number(projectile?.position?.x) || 0,
        y: Number(projectile?.position?.y) || 0,
        z: Number(projectile?.position?.z) || 0,
    };
}

/**
 * Walk along the trail from the impact segment in both directions,
 * collecting segments until the total distance reaches blastMeters.
 * Returns { entries, totalDestroyedMeters }.
 */
function collectBlastEntriesByMeters(trailSpatialIndex, impactEntry, blastMeters) {
    if (blastMeters <= 0 || !impactEntry || impactEntry.destroyed) {
        return { entries: [], totalDestroyedMeters: 0 };
    }

    const maxSegments = Math.max(0, Math.floor(Number(impactEntry?.ownerTrail?.maxSegments) || 0));
    const playerIndex = impactEntry.playerIndex;
    const centerIdx = Number(impactEntry.segmentIdx);
    const halfBudget = blastMeters * 0.5;

    const seen = new Set();
    const entries = [];
    let totalMeters = 0;

    // Always include the center segment
    const centerLen = segmentLength(impactEntry);
    if (!impactEntry.destroyed) {
        seen.add(`${playerIndex}:${centerIdx}`);
        entries.push(impactEntry);
        totalMeters += centerLen;
    }

    // Walk forward (newer segments)
    let forwardBudget = halfBudget;
    for (let offset = 1; forwardBudget > 0 && offset < 500; offset++) {
        const idx = maxSegments > 0
            ? (centerIdx + offset + maxSegments) % maxSegments
            : centerIdx + offset;
        const candidate = trailSpatialIndex?.resolveTrailEntry?.(playerIndex, idx);
        if (!candidate || candidate.destroyed) break;
        if (impactEntry.ownerTrail && candidate.ownerTrail !== impactEntry.ownerTrail) break;

        const key = `${candidate.playerIndex}:${candidate.segmentIdx}`;
        if (seen.has(key)) break;
        seen.add(key);

        const len = segmentLength(candidate);
        entries.push(candidate);
        totalMeters += len;
        forwardBudget -= len;
    }

    // Walk backward (older segments)
    let backwardBudget = halfBudget;
    for (let offset = 1; backwardBudget > 0 && offset < 500; offset++) {
        const idx = maxSegments > 0
            ? (centerIdx - offset + maxSegments) % maxSegments
            : centerIdx - offset;
        const candidate = trailSpatialIndex?.resolveTrailEntry?.(playerIndex, idx);
        if (!candidate || candidate.destroyed) break;
        if (impactEntry.ownerTrail && candidate.ownerTrail !== impactEntry.ownerTrail) break;

        const key = `${candidate.playerIndex}:${candidate.segmentIdx}`;
        if (seen.has(key)) break;
        seen.add(key);

        const len = segmentLength(candidate);
        entries.push(candidate);
        totalMeters += len;
        backwardBudget -= len;
    }

    return { entries, totalDestroyedMeters: totalMeters };
}

function applyRocketTrailBlast(trailSpatialIndex, impactEntry, projectile, hit) {
    const huntConfig = resolveGameplayConfig(projectile?.owner).HUNT;
    const blastMeters = resolveRocketTrailBlastMeters(projectile?.type, projectile?.owner);
    const { entries: blastEntries, totalDestroyedMeters } =
        collectBlastEntriesByMeters(trailSpatialIndex, impactEntry, blastMeters);

    let destroyedCount = 0;
    const destroyedSegmentIndices = [];
    const explosionPoints = [];

    for (const entry of blastEntries) {
        const mid = segmentMidpoint(entry);
        if (!trailSpatialIndex?.destroySegment?.(entry)) continue;
        destroyedCount += 1;
        destroyedSegmentIndices.push(Number(entry.segmentIdx));
        if (mid) explosionPoints.push(mid);
    }

    // Calculate overflow: meters that would have been destroyed but trail was too short
    const overflowMeters = Math.max(0, blastMeters - totalDestroyedMeters);
    const overflowDamagePerMeter = Math.max(0,
        Number(huntConfig?.ROCKET?.TRAIL_OVERFLOW_DAMAGE_PER_METER) || 2.5);
    const overflowDamage = Math.floor(overflowMeters * overflowDamagePerMeter);

    return {
        entry: impactEntry,
        closestPoint: hit?.closestPoint || null,
        damage: destroyedCount,
        destroyed: destroyedCount > 0,
        destroyedCount,
        destroyedSegmentIndices,
        blastMeters,
        totalDestroyedMeters,
        overflowMeters,
        overflowDamage,
        explosionPoints,
        remainingHp: 0,
        maxHp: Math.max(1, Number(impactEntry?.maxHp) || 1),
        impactPoint: buildImpactPoint(hit, projectile),
    };
}

export function applyTrailDamageFromProjectile(trailSpatialIndex, projectile, options = {}) {
    if (!trailSpatialIndex || !projectile) {
        return null;
    }
    if (options.strategy && !options.strategy.hasDestructibleTrails()) {
        return null;
    }

    const ownerIndex = Number.isInteger(projectile.owner?.index) ? projectile.owner.index : -1;
    const skipRecent = Math.max(0, Number(options.skipRecent) || DEFAULT_SELF_SKIP_RECENT);
    const hit = trailSpatialIndex.checkProjectileTrailCollision(projectile.position, projectile.radius, {
        excludePlayerIndex: ownerIndex,
        skipRecent,
    });
    if (!hit?.entry) return null;

    if (isRocketTierType(projectile.type)) {
        return applyRocketTrailBlast(trailSpatialIndex, hit.entry, projectile, hit);
    }

    const damage = Math.max(1, Number(options.damage) || 1);
    const damageResult = trailSpatialIndex.damageTrailSegment(hit.entry, damage);
    if (!damageResult.hit) {
        return null;
    }

    return {
        entry: hit.entry,
        closestPoint: hit.closestPoint,
        damage,
        destroyed: !!damageResult.destroyed,
        destroyedCount: damageResult.destroyed ? 1 : 0,
        remainingHp: damageResult.remainingHp,
        maxHp: damageResult.maxHp,
        impactPoint: buildImpactPoint(hit, projectile),
    };
}
