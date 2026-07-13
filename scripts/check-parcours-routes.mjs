#!/usr/bin/env node
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

const MIN_STAGE_STEP_DISTANCE = 0.35;
const BASE_MAX_STAGE_STEP_DISTANCE = 80;
const MAX_STAGE_STEP_RATIO_OF_MAP_DIAGONAL = 0.55;
const MAX_BRANCH_SPREAD_DISTANCE = 120;

function asVec3(input, fallback = [0, 0, 0]) {
    if (!Array.isArray(input) || input.length < 3) return [...fallback];
    return [
        Number(input[0]) || 0,
        Number(input[1]) || 0,
        Number(input[2]) || 0,
    ];
}

function dot3(a, b) {
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length3(value) {
    const x = Number(value?.[0]) || 0;
    const y = Number(value?.[1]) || 0;
    const z = Number(value?.[2]) || 0;
    return Math.hypot(x, y, z);
}

function distance3(a, b) {
    return length3(sub3(a, b));
}

function formatMeters(value) {
    return Number(value).toFixed(2);
}

function buildEntriesByStage(route) {
    const byStage = Array.from({ length: Math.max(0, route?.totalCheckpoints || 0) }, () => []);
    for (const entry of Array.isArray(route?.checkpoints) ? route.checkpoints : []) {
        if (!Number.isInteger(entry?.routeIndex)) continue;
        if (entry.routeIndex < 0 || entry.routeIndex >= byStage.length) continue;
        byStage[entry.routeIndex].push(entry);
    }
    return byStage;
}

function resolveMapHeuristicThresholds(mapDef) {
    const size = Array.isArray(mapDef?.size) ? mapDef.size : [0, 0, 0];
    const sx = Math.max(0, Number(size[0]) || 0);
    const sy = Math.max(0, Number(size[1]) || 0);
    const sz = Math.max(0, Number(size[2]) || 0);
    const mapDiagonal = Math.hypot(sx, sy, sz);
    const maxStageStepDistance = Math.max(
        BASE_MAX_STAGE_STEP_DISTANCE,
        mapDiagonal * MAX_STAGE_STEP_RATIO_OF_MAP_DIAGONAL
    );
    return {
        mapDiagonal,
        maxStageStepDistance,
    };
}

function buildCanonicalStageIndex(route) {
    const stageByCanonicalId = new Map();
    for (const entry of Array.isArray(route?.checkpoints) ? route.checkpoints : []) {
        const canonicalId = String(entry?.aliasOf || entry?.id || '').trim();
        if (!canonicalId) continue;
        const stage = Number.isInteger(entry?.routeIndex) ? entry.routeIndex : -1;
        if (stage < 0) continue;
        const previous = stageByCanonicalId.get(canonicalId);
        if (!Number.isInteger(previous) || stage < previous) {
            stageByCanonicalId.set(canonicalId, stage);
        }
    }
    return stageByCanonicalId;
}

function evaluateStageDistanceHeuristics(findings, mapDef, route, byStage) {
    const spawn = asVec3([mapDef?.playerSpawn?.x, mapDef?.playerSpawn?.y, mapDef?.playerSpawn?.z], [0, 0, 0]);
    const thresholds = resolveMapHeuristicThresholds(mapDef);
    for (let stage = 0; stage < byStage.length; stage += 1) {
        const entries = byStage[stage];
        const fromPositions = stage > 0
            ? (byStage[stage - 1] || []).map((entry) => asVec3(entry.pos))
            : [spawn];

        for (const entry of entries) {
            const cpPos = asVec3(entry.pos);
            let minDistance = Infinity;
            for (const sourcePos of fromPositions) {
                const distance = distance3(cpPos, sourcePos);
                if (distance < minDistance) minDistance = distance;
            }
            if (!Number.isFinite(minDistance)) continue;
            if (minDistance < MIN_STAGE_STEP_DISTANCE) {
                findings.warnings.push(
                    `stage-${stage + 1}:${entry.id || 'unknown'} suspicious-step-distance too-close=${formatMeters(minDistance)}`
                );
            }
            if (minDistance > thresholds.maxStageStepDistance) {
                findings.warnings.push(
                    `stage-${stage + 1}:${entry.id || 'unknown'} suspicious-stage-jump too-far=${formatMeters(minDistance)} max=${formatMeters(thresholds.maxStageStepDistance)}`
                );
            }
        }

        if (entries.length > 1) {
            for (let left = 0; left < entries.length; left += 1) {
                for (let right = left + 1; right < entries.length; right += 1) {
                    const leftPos = asVec3(entries[left].pos);
                    const rightPos = asVec3(entries[right].pos);
                    const spread = distance3(leftPos, rightPos);
                    if (spread > MAX_BRANCH_SPREAD_DISTANCE) {
                        findings.warnings.push(
                            `stage-${stage + 1}:branch-spread large=${formatMeters(spread)} limit=${formatMeters(MAX_BRANCH_SPREAD_DISTANCE)}`
                        );
                    }
                }
            }
        }
    }

    if (route.finish) {
        const lastStageEntries = byStage[Math.max(0, byStage.length - 1)] || [];
        if (lastStageEntries.length > 0) {
            const finishPos = asVec3(route.finish.pos);
            let minFinishDistance = Infinity;
            for (const entry of lastStageEntries) {
                const distance = distance3(finishPos, asVec3(entry.pos));
                if (distance < minFinishDistance) minFinishDistance = distance;
            }
            if (Number.isFinite(minFinishDistance) && minFinishDistance > thresholds.maxStageStepDistance) {
                findings.warnings.push(
                    `finish suspicious-stage-jump too-far=${formatMeters(minFinishDistance)} max=${formatMeters(thresholds.maxStageStepDistance)}`
                );
            }
        }
    }
}

function evaluateStageJumpHeuristics(findings, route) {
    const stageByCanonicalId = buildCanonicalStageIndex(route);
    for (const entry of Array.isArray(route?.checkpoints) ? route.checkpoints : []) {
        const currentStage = Number.isInteger(entry?.routeIndex) ? entry.routeIndex : -1;
        if (currentStage < 0) continue;
        const nextIds = Array.isArray(entry?.nextCheckpointIds) ? entry.nextCheckpointIds : [];
        for (const nextIdRaw of nextIds) {
            const nextId = String(nextIdRaw || '').trim();
            if (!nextId) continue;
            const targetStage = stageByCanonicalId.get(nextId);
            if (!Number.isInteger(targetStage)) {
                findings.warnings.push(
                    `stage-${currentStage + 1}:${entry.id || 'unknown'} next-id-unresolved=${nextId}`
                );
                continue;
            }
            const delta = targetStage - currentStage;
            if (delta <= 0) {
                findings.warnings.push(
                    `stage-${currentStage + 1}:${entry.id || 'unknown'} non-forward-next-id=${nextId} delta=${delta}`
                );
                continue;
            }
            if (delta > 1) {
                findings.warnings.push(
                    `stage-${currentStage + 1}:${entry.id || 'unknown'} stage-jump-next-id=${nextId} delta=${delta}`
                );
            }
        }
    }
}

function evaluateRoute(mapKey, mapDef) {
    const findings = {
        mapKey,
        routeId: String(mapDef?.parcours?.routeId || ''),
        errors: [],
        warnings: [],
    };
    const route = buildRouteFromParcours(mapDef?.parcours);
    if (!route) {
        findings.errors.push('route-build-failed');
        return findings;
    }
    if (!(route.totalCheckpoints > 0)) {
        findings.errors.push('route-has-no-checkpoints');
    }
    if (route.rules?.winnerByParcoursComplete === true && !route.finish) {
        findings.errors.push('winner-by-complete-without-finish');
    }

    const byStage = buildEntriesByStage(route);
    for (let stage = 0; stage < byStage.length; stage += 1) {
        if (byStage[stage].length === 0) {
            findings.errors.push(`stage-${stage + 1}-empty`);
        }
    }
    evaluateStageDistanceHeuristics(findings, mapDef, route, byStage);
    evaluateStageJumpHeuristics(findings, route);

    const requiresDirectionalCrossing = route.rules?.bidirectionalCheckpoints === false;
    if (!requiresDirectionalCrossing) {
        return findings;
    }

    const spawn = asVec3([mapDef?.playerSpawn?.x, mapDef?.playerSpawn?.y, mapDef?.playerSpawn?.z], [0, 0, 0]);
    for (let stage = 0; stage < byStage.length; stage += 1) {
        const entries = byStage[stage];
        const prevEntries = stage > 0 ? byStage[stage - 1] : [];
        const fromPositions = prevEntries.length > 0
            ? prevEntries.map((entry) => asVec3(entry.pos))
            : [spawn];
        for (const entry of entries) {
            if (!Array.isArray(entry.forward)) {
                findings.warnings.push(`stage-${stage + 1}:${entry.id || 'unknown'} missing-forward`);
                continue;
            }
            const cpPos = asVec3(entry.pos);
            let bestDot = -Infinity;
            for (const sourcePos of fromPositions) {
                const approach = sub3(cpPos, sourcePos);
                const alignment = dot3(approach, entry.forward);
                if (alignment > bestDot) {
                    bestDot = alignment;
                }
            }
            if (!(bestDot > 0)) {
                findings.warnings.push(
                    `stage-${stage + 1}:${entry.id || 'unknown'} suspicious-forward alignment<=0`
                );
            }
        }
    }

    if (route.finish) {
        const finishForward = route.finish.forward;
        if (!Array.isArray(finishForward)) {
            findings.warnings.push('finish missing-forward');
        }
    }

    return findings;
}

const strict = process.argv.includes('--strict');

const parcoursMaps = Object.entries(MAP_PRESET_CATALOG)
    .filter(([, mapDef]) => mapDef?.parcours?.enabled === true);

const results = parcoursMaps.map(([mapKey, mapDef]) => evaluateRoute(mapKey, mapDef));

let totalErrors = 0;
let totalWarnings = 0;
for (const result of results) {
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
}

for (const result of results) {
    const heading = `[parcours] ${result.mapKey} (${result.routeId || 'no-route-id'})`;
    if (result.errors.length === 0 && result.warnings.length === 0) {
        process.stdout.write(`${heading} OK\n`);
        continue;
    }
    process.stdout.write(`${heading}\n`);
    for (const error of result.errors) {
        process.stdout.write(`  ERROR: ${error}\n`);
    }
    for (const warning of result.warnings) {
        process.stdout.write(`  WARN: ${warning}\n`);
    }
}

process.stdout.write(
    `\n[parcours] summary maps=${results.length} errors=${totalErrors} warnings=${totalWarnings} strict=${strict}\n`
);

if (totalErrors > 0) {
    process.exit(1);
}
if (strict && totalWarnings > 0) {
    process.exit(1);
}
