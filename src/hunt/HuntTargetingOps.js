import * as THREE from 'three';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { HUNT_TARGET_KIND } from '../shared/contracts/HuntTargetingContract.js';
import { toFiniteNumber } from '../utils/MathOps.js';
import {
    createHuntTargetingTelemetryState,
    finalizeHuntTargetingResult,
    resetHuntTargetingCallMetrics,
    resolveHuntTargetingHotpathSettings,
} from './HuntTargetingPerf.js';

function toPositiveNumber(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return numeric;
}

function createPoint(source, fallback = null) {
    if (source) {
        return {
            x: toFiniteNumber(source.x, 0),
            y: toFiniteNumber(source.y, 0),
            z: toFiniteNumber(source.z, 0),
        };
    }
    if (fallback) {
        return createPoint(fallback, null);
    }
    return { x: 0, y: 0, z: 0 };
}

function resolveTrailMidpoint(entry) {
    return {
        x: (toFiniteNumber(entry?.fromX, 0) + toFiniteNumber(entry?.toX, 0)) * 0.5,
        y: (toFiniteNumber(entry?.fromY, 0) + toFiniteNumber(entry?.toY, 0)) * 0.5,
        z: (toFiniteNumber(entry?.fromZ, 0) + toFiniteNumber(entry?.toZ, 0)) * 0.5,
    };
}

function getTrailDescriptorMaxDrift(configSource = null) {
    return toPositiveNumber(resolveGameplayConfig(configSource).HUNT?.TARGETING?.TRAIL_DESCRIPTOR_MAX_DRIFT, 1.25);
}

export function createHuntTargetingTelemetry(reusable = null) {
    return createHuntTargetingTelemetryState(reusable);
}

export function createHuntTargetingScratch(reusable = null) {
    const scratch = reusable || {};
    scratch.direction = scratch.direction instanceof THREE.Vector3 ? scratch.direction : new THREE.Vector3();
    scratch.toTarget = scratch.toTarget instanceof THREE.Vector3 ? scratch.toTarget : new THREE.Vector3();
    scratch.hitPoint = scratch.hitPoint instanceof THREE.Vector3 ? scratch.hitPoint : new THREE.Vector3();
    scratch.trailProbe = scratch.trailProbe instanceof THREE.Vector3 ? scratch.trailProbe : new THREE.Vector3();
    scratch.segmentStart = scratch.segmentStart instanceof THREE.Vector3 ? scratch.segmentStart : new THREE.Vector3();
    scratch.segmentEnd = scratch.segmentEnd instanceof THREE.Vector3 ? scratch.segmentEnd : new THREE.Vector3();
    scratch.metrics = scratch.metrics && typeof scratch.metrics === 'object'
        ? scratch.metrics
        : {
            probeQueries: 0,
            adaptiveProbeQueries: 0,
            legacyProbeQueries: 0,
            refinementScans: 0,
            usedAdaptive: false,
        };
    return scratch;
}

export function isHuntTargetDescriptor(target) {
    const kind = String(target?.kind || '').toLowerCase();
    return kind === HUNT_TARGET_KIND.PLAYER || kind === HUNT_TARGET_KIND.TRAIL;
}

export function isPlayerTargetDescriptor(target) {
    return String(target?.kind || '').toLowerCase() === HUNT_TARGET_KIND.PLAYER;
}

export function isTrailTargetDescriptor(target) {
    return String(target?.kind || '').toLowerCase() === HUNT_TARGET_KIND.TRAIL;
}

export function createPlayerTargetDescriptor(player, distance = Infinity, point = null) {
    if (!player || !Number.isInteger(player.index)) return null;
    const pointData = createPoint(point, player.position);
    return {
        kind: HUNT_TARGET_KIND.PLAYER,
        playerIndex: player.index,
        distance: Number.isFinite(distance) ? distance : Infinity,
        point: pointData,
        position: player.position || pointData,
        alive: !!player.alive,
    };
}

export function createTrailTargetDescriptor(entry, point = null, distance = Infinity) {
    if (!entry || !Number.isInteger(entry.playerIndex) || !Number.isInteger(entry.segmentIdx)) return null;
    const pointData = createPoint(point, resolveTrailMidpoint(entry));
    return {
        kind: HUNT_TARGET_KIND.TRAIL,
        playerIndex: entry.playerIndex,
        segmentIdx: entry.segmentIdx,
        distance: Number.isFinite(distance) ? distance : Infinity,
        point: pointData,
        position: pointData,
        alive: !entry.destroyed,
    };
}

function pointToSegmentDistanceSquared(point, entry, scratch = null) {
    const reusable = createHuntTargetingScratch(scratch);
    const segmentStart = reusable.segmentStart.set(
        toFiniteNumber(entry?.fromX, 0),
        toFiniteNumber(entry?.fromY, 0),
        toFiniteNumber(entry?.fromZ, 0)
    );
    const segmentEnd = reusable.segmentEnd.set(
        toFiniteNumber(entry?.toX, 0),
        toFiniteNumber(entry?.toY, 0),
        toFiniteNumber(entry?.toZ, 0)
    );
    const pointVec = reusable.hitPoint.set(
        toFiniteNumber(point?.x, 0),
        toFiniteNumber(point?.y, 0),
        toFiniteNumber(point?.z, 0)
    );
    reusable.toTarget.subVectors(segmentEnd, segmentStart);
    const segmentLengthSq = reusable.toTarget.lengthSq();
    if (segmentLengthSq <= 0.000001) {
        return pointVec.distanceToSquared(segmentStart);
    }

    reusable.direction.subVectors(pointVec, segmentStart);
    const projection = THREE.MathUtils.clamp(reusable.direction.dot(reusable.toTarget) / segmentLengthSq, 0, 1);
    reusable.direction.copy(segmentStart).addScaledVector(reusable.toTarget, projection);
    return pointVec.distanceToSquared(reusable.direction);
}

export function resolveTrailTargetEntry(trailSpatialIndex, target, options = {}) {
    if (!isTrailTargetDescriptor(target)) return null;
    const resolver = trailSpatialIndex?.resolveTrailEntry;
    if (typeof resolver !== 'function') return null;

    const entry = resolver.call(trailSpatialIndex, target.playerIndex, target.segmentIdx);
    if (!entry || entry.destroyed) return null;

    const point = target.point || null;
    if (!point) return null;
    const maxPointDrift = toPositiveNumber(options.maxPointDrift, getTrailDescriptorMaxDrift(options.configSource || null));
    const allowedDistance = maxPointDrift + Math.max(0, Number(entry.radius) || 0);
    if (pointToSegmentDistanceSquared(point, entry, options.scratch) > allowedDistance * allowedDistance) {
        return null;
    }

    return entry;
}

export function resolveHuntTargetOwnerPlayer(target, players = []) {
    if (isPlayerTargetDescriptor(target) || isTrailTargetDescriptor(target)) {
        const index = Number(target.playerIndex);
        if (!Number.isInteger(index) || index < 0) return null;
        return players[index] || null;
    }
    if (target && typeof target === 'object' && target.position) {
        return target;
    }
    return null;
}

export function resolveHuntTargetPosition(target, players = [], trailSpatialIndex = null, out = null, options = {}) {
    const destination = out instanceof THREE.Vector3 ? out : new THREE.Vector3();
    if (!target) return null;

    if (isPlayerTargetDescriptor(target)) {
        const player = players[target.playerIndex];
        if (!player?.alive || !player.position) return null;
        return destination.copy(player.position);
    }

    if (isTrailTargetDescriptor(target)) {
        const entry = resolveTrailTargetEntry(trailSpatialIndex, target, options);
        if (!entry) return null;
        return destination.set(
            toFiniteNumber(target.point?.x, 0),
            toFiniteNumber(target.point?.y, 0),
            toFiniteNumber(target.point?.z, 0)
        );
    }

    if (target?.alive && target.position) {
        return destination.copy(target.position);
    }
    return null;
}

function scanTrailLine({
    trailSpatialIndex,
    sourcePlayer,
    origin,
    direction,
    probeRadius,
    maxRange,
    sampleStep,
    startDistance = 0,
    skipRecent,
    allowSelfFallback = false,
    metrics = null,
    scratch = null,
}) {
    if (!trailSpatialIndex?.checkProjectileTrailCollision) return null;
    const reusable = createHuntTargetingScratch(scratch);
    const ownerIndex = Number.isInteger(sourcePlayer?.index) ? sourcePlayer.index : -1;
    const callMetrics = metrics && typeof metrics === 'object' ? metrics : null;
    const step = Math.max(0.01, Number(sampleStep) || 0.45);
    const start = Math.max(0, Number(startDistance) || 0);
    const end = Math.max(start, Number(maxRange) || 0);
    let fallbackSelfHit = null;

    for (let distance = start; distance <= end; distance += step) {
        reusable.trailProbe.copy(origin).addScaledVector(direction, distance);
        const hit = trailSpatialIndex.checkProjectileTrailCollision(reusable.trailProbe, probeRadius, {
            excludePlayerIndex: ownerIndex,
            skipRecent,
        });
        if (callMetrics) {
            callMetrics.probeQueries += 1;
            callMetrics.legacyProbeQueries += 1;
        }
        if (!hit?.entry) continue;

        if (hit.closestPoint) {
            reusable.hitPoint.set(
                toFiniteNumber(hit.closestPoint.closestX, reusable.trailProbe.x),
                toFiniteNumber(hit.closestPoint.closestY, reusable.trailProbe.y),
                toFiniteNumber(hit.closestPoint.closestZ, reusable.trailProbe.z)
            );
        } else {
            reusable.hitPoint.copy(reusable.trailProbe);
        }

        const descriptor = createTrailTargetDescriptor(
            hit.entry,
            reusable.hitPoint,
            origin.distanceTo(reusable.hitPoint)
        );
        if (!descriptor) continue;

        if (Number(hit.entry.playerIndex) === ownerIndex) {
            if (allowSelfFallback && !fallbackSelfHit) {
                fallbackSelfHit = descriptor;
            }
            continue;
        }
        return descriptor;
    }

    return fallbackSelfHit;
}

function scanTrailLineAdaptive({
    trailSpatialIndex,
    sourcePlayer,
    origin,
    direction,
    probeRadius,
    maxRange,
    sampleStep,
    skipRecent,
    metrics = null,
    scratch = null,
    optimizedScanStepMultiplier = 2.0,
    optimizedScanMaxStep = 1.1,
}) {
    if (!trailSpatialIndex?.checkProjectileTrailCollision) return null;

    const reusable = createHuntTargetingScratch(scratch);
    const ownerIndex = Number.isInteger(sourcePlayer?.index) ? sourcePlayer.index : -1;
    const step = Math.max(0.01, Number(sampleStep) || 0.45);
    const end = Math.max(0, Number(maxRange) || 0);
    const coarseStep = Math.max(
        step,
        Math.min(
            Math.max(step * toPositiveNumber(optimizedScanStepMultiplier, 2.0), step),
            toPositiveNumber(optimizedScanMaxStep, 1.1)
        )
    );

    if (coarseStep <= step + 0.000001) {
        return scanTrailLine({
            trailSpatialIndex,
            sourcePlayer,
            origin,
            direction,
            probeRadius,
            maxRange: end,
            sampleStep: step,
            startDistance: 0,
            skipRecent,
            allowSelfFallback: false,
            metrics,
            scratch: reusable,
        });
    }

    const callMetrics = metrics && typeof metrics === 'object' ? metrics : null;
    if (callMetrics) {
        callMetrics.usedAdaptive = true;
    }
    const expandedRadius = probeRadius + Math.max(0, (coarseStep - step) * 0.5);

    for (let distance = 0; distance <= end; distance += coarseStep) {
        reusable.trailProbe.copy(origin).addScaledVector(direction, distance);
        const hit = trailSpatialIndex.checkProjectileTrailCollision(reusable.trailProbe, expandedRadius, {
            excludePlayerIndex: ownerIndex,
            skipRecent,
        });
        if (callMetrics) {
            callMetrics.probeQueries += 1;
            callMetrics.adaptiveProbeQueries += 1;
        }
        if (!hit?.entry) continue;

        const refineStart = Math.max(0, (Math.floor((distance - coarseStep) / step)) * step);
        const refineEnd = Math.min(end, distance + coarseStep);
        if (callMetrics) {
            callMetrics.refinementScans += 1;
        }
        const refinedHit = scanTrailLine({
            trailSpatialIndex,
            sourcePlayer,
            origin,
            direction,
            probeRadius,
            maxRange: refineEnd,
            sampleStep: step,
            startDistance: refineStart,
            skipRecent,
            allowSelfFallback: false,
            metrics: callMetrics,
            scratch: reusable,
        });
        if (refinedHit) {
            return refinedHit;
        }
    }

    return null;
}

export function resolveHuntLineTarget({
    sourcePlayer = null,
    players = [],
    trailSpatialIndex = null,
    origin = null,
    direction = null,
    playerRange = 0,
    trailRange = 0,
    trailSampleStep = 0.45,
    trailHitRadius = 0.78,
    trailSelfSkipRecent = 0,
    allowSelfTrailFallback = false,
    optimizedTrailScan = undefined,
    optimizedTrailScanStepMultiplier = undefined,
    optimizedTrailScanMaxStep = undefined,
    runtimeProfiler = null,
    targetingTelemetry = null,
    scratch = null,
} = {}) {
    if (!origin || !direction) return null;

    const reusable = createHuntTargetingScratch(scratch);
    const metrics = resetHuntTargetingCallMetrics(reusable.metrics);
    const telemetry = targetingTelemetry ? createHuntTargetingTelemetryState(targetingTelemetry) : null;
    const profiler = runtimeProfiler || null;
    const profilerSampleStart = profiler?.startSample?.();
    const callStartedAtMs = telemetry
        ? (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())
        : Number.NaN;
    const hotpathSettings = resolveHuntTargetingHotpathSettings({
        optimizedTrailScan,
        optimizedTrailScanStepMultiplier,
        optimizedTrailScanMaxStep,
    });
    reusable.direction.copy(direction);
    if (reusable.direction.lengthSq() <= 0.000001) {
        return finalizeHuntTargetingResult({
            result: null,
            runtimeProfiler: profiler,
            profilerSampleStart,
            callStartedAtMs,
            telemetry,
            metrics,
        });
    }
    reusable.direction.normalize();

    const maxPlayerRange = Math.max(0, Number(playerRange) || 0);
    const maxTrailRange = Math.max(0, Number(trailRange) || 0);
    const ownerIndex = Number.isInteger(sourcePlayer?.index) ? sourcePlayer.index : -1;

    let bestPlayer = null;
    let bestPlayerDistance = Infinity;

    for (const target of players || []) {
        if (!target || !target.alive) continue;
        const targetIndex = Number(target.index);
        if (target === sourcePlayer || (targetIndex >= 0 && targetIndex === ownerIndex)) continue;

        const hitboxRadius = Math.max(
            0.2,
            Number(target.hitboxRadius) || Number(resolveGameplayConfig(target).PLAYER?.HITBOX_RADIUS) || 0.8
        );
        const hitboxRadiusSq = hitboxRadius * hitboxRadius;

        reusable.toTarget.subVectors(target.position, origin);
        const forwardDistance = reusable.direction.dot(reusable.toTarget);
        if (forwardDistance < -hitboxRadius || forwardDistance > maxPlayerRange + hitboxRadius) continue;

        const toTargetLenSq = reusable.toTarget.lengthSq();
        const closestDistanceSq = Math.max(0, toTargetLenSq - forwardDistance * forwardDistance);
        if (closestDistanceSq > hitboxRadiusSq) continue;

        const intersectionOffset = Math.sqrt(Math.max(0, hitboxRadiusSq - closestDistanceSq));
        const entryDistance = Math.max(0, forwardDistance - intersectionOffset);
        if (entryDistance > maxPlayerRange || entryDistance >= bestPlayerDistance) continue;

        reusable.hitPoint.copy(origin).addScaledVector(reusable.direction, entryDistance);
        bestPlayerDistance = entryDistance;
        bestPlayer = createPlayerTargetDescriptor(target, entryDistance, reusable.hitPoint);
    }

    if (maxTrailRange > 0 && trailSpatialIndex?.checkProjectileTrailCollision) {
        const selfSkipRecent = Math.max(0, Math.floor(Number(trailSelfSkipRecent) || 0));
        const skipSelfCompletely = Math.max(
            selfSkipRecent + 1,
            Math.floor(Number(sourcePlayer?.trail?.maxSegments) || 0)
        );
        const maxScanRange = Math.min(maxTrailRange, bestPlayerDistance);
        const sampleStep = Math.max(0.2, Number(trailSampleStep) || 0.45);
        const probeRadius = Math.max(0.12, Number(trailHitRadius) || 0.78);
        const trailDescriptor = hotpathSettings.optimizedScanEnabled
            ? scanTrailLineAdaptive({
                trailSpatialIndex,
                sourcePlayer,
                origin,
                direction: reusable.direction,
                probeRadius,
                maxRange: maxScanRange,
                sampleStep,
                skipRecent: skipSelfCompletely,
                metrics,
                scratch: reusable,
                optimizedScanStepMultiplier: hotpathSettings.optimizedScanStepMultiplier,
                optimizedScanMaxStep: hotpathSettings.optimizedScanMaxStep,
            })
            : scanTrailLine({
                trailSpatialIndex,
                sourcePlayer,
                origin,
                direction: reusable.direction,
                probeRadius,
                maxRange: maxScanRange,
                sampleStep,
                startDistance: 0,
                skipRecent: skipSelfCompletely,
                allowSelfFallback: false,
                metrics,
                scratch: reusable,
            });
        if (trailDescriptor) {
            return finalizeHuntTargetingResult({
                result: trailDescriptor,
                runtimeProfiler: profiler,
                profilerSampleStart,
                callStartedAtMs,
                telemetry,
                metrics,
            });
        }

        if (allowSelfTrailFallback) {
            const selfFallback = scanTrailLine({
                trailSpatialIndex,
                sourcePlayer,
                origin,
                direction: reusable.direction,
                probeRadius,
                maxRange: maxTrailRange,
                sampleStep,
                startDistance: 0,
                skipRecent: selfSkipRecent,
                allowSelfFallback: true,
                metrics,
                scratch: reusable,
            });
            if (selfFallback) {
                const denseStep = Math.max(0.12, sampleStep * 0.5);
                if (denseStep < sampleStep) {
                    const denseEnemyHit = scanTrailLine({
                        trailSpatialIndex,
                        sourcePlayer,
                        origin,
                        direction: reusable.direction,
                        probeRadius,
                        maxRange: maxScanRange,
                        sampleStep: denseStep,
                        startDistance: 0,
                        skipRecent: skipSelfCompletely,
                        allowSelfFallback: false,
                        metrics,
                        scratch: reusable,
                    });
                    if (denseEnemyHit) {
                        return finalizeHuntTargetingResult({
                            result: denseEnemyHit,
                            runtimeProfiler: profiler,
                            profilerSampleStart,
                            callStartedAtMs,
                            telemetry,
                            metrics,
                        });
                    }
                }
                return finalizeHuntTargetingResult({
                    result: selfFallback,
                    runtimeProfiler: profiler,
                    profilerSampleStart,
                    callStartedAtMs,
                    telemetry,
                    metrics,
                });
            }
        }
    }

    return finalizeHuntTargetingResult({
        result: bestPlayer,
        runtimeProfiler: profiler,
        profilerSampleStart,
        callStartedAtMs,
        telemetry,
        metrics,
    });
}

