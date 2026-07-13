export function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function toPositiveNumber(value, fallback = 1, min = 0.0001) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(min, parsed);
}

export function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function normalizeVec3(raw, fallback = [0, 0, 0]) {
    const source = Array.isArray(raw) ? raw : fallback;
    return [
        toFiniteNumber(source[0], fallback[0]),
        toFiniteNumber(source[1], fallback[1]),
        toFiniteNumber(source[2], fallback[2]),
    ];
}

export function normalizeForward(raw) {
    if (!Array.isArray(raw)) return null;
    const vec = normalizeVec3(raw, [0, 0, 1]);
    const lengthSq = (vec[0] * vec[0]) + (vec[1] * vec[1]) + (vec[2] * vec[2]);
    if (lengthSq < 0.000001) return null;
    const invLength = 1 / Math.sqrt(lengthSq);
    return [vec[0] * invLength, vec[1] * invLength, vec[2] * invLength];
}

function scaleVec3(vec, scale = 1) {
    const normalizedScale = toPositiveNumber(scale, 1, 0.0001);
    return [
        vec[0] * normalizedScale,
        vec[1] * normalizedScale,
        vec[2] * normalizedScale,
    ];
}

export function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

export function formatDurationMs(ms) {
    const clampedMs = Math.max(0, Math.round(Number(ms) || 0));
    const totalSeconds = clampedMs / 1000;
    return `${totalSeconds.toFixed(totalSeconds >= 10 ? 1 : 2)}s`;
}

export function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toCheckpointId(rawId, fallback = '') {
    const normalized = normalizeString(rawId, fallback);
    return normalized || fallback;
}

function normalizeCheckpointIdList(rawIds, rawId = '') {
    const normalizedIds = [];
    if (Array.isArray(rawIds)) {
        for (const candidate of rawIds) {
            const checkpointId = toCheckpointId(candidate, '');
            if (!checkpointId) continue;
            if (normalizedIds.includes(checkpointId)) continue;
            normalizedIds.push(checkpointId);
        }
        return normalizedIds;
    }

    const checkpointId = toCheckpointId(rawId, '');
    return checkpointId ? [checkpointId] : [];
}

function buildCanonicalRouteStages(canonicalIds, nextCanonicalIdsById) {
    const canonicalIndexById = new Map();
    for (let i = 0; i < canonicalIds.length; i += 1) {
        canonicalIndexById.set(canonicalIds[i], i);
    }

    const parentIdsByCanonicalId = new Map();
    for (const canonicalId of canonicalIds) {
        parentIdsByCanonicalId.set(canonicalId, []);
    }

    for (const canonicalId of canonicalIds) {
        const nextIds = nextCanonicalIdsById.get(canonicalId) || [];
        for (const nextId of nextIds) {
            if (!parentIdsByCanonicalId.has(nextId)) {
                parentIdsByCanonicalId.set(nextId, []);
            }
            parentIdsByCanonicalId.get(nextId).push(canonicalId);
        }
    }

    const stageByCanonicalId = new Map();
    const startCanonicalId = canonicalIds[0] || '';
    const visiting = new Set();
    const resolveStage = (canonicalId) => {
        if (!canonicalId || !canonicalIndexById.has(canonicalId)) {
            return 0;
        }
        if (stageByCanonicalId.has(canonicalId)) {
            return stageByCanonicalId.get(canonicalId);
        }

        const rawIndex = canonicalIndexById.get(canonicalId) ?? 0;
        if (!startCanonicalId || canonicalId === startCanonicalId) {
            stageByCanonicalId.set(canonicalId, 0);
            return 0;
        }
        if (visiting.has(canonicalId)) {
            return rawIndex;
        }

        visiting.add(canonicalId);
        const parentIds = parentIdsByCanonicalId.get(canonicalId) || [];
        let stage = rawIndex;
        if (parentIds.length > 0) {
            stage = Math.max(...parentIds.map((parentId) => resolveStage(parentId))) + 1;
        }
        visiting.delete(canonicalId);
        stageByCanonicalId.set(canonicalId, stage);
        return stage;
    };

    for (const canonicalId of canonicalIds) {
        resolveStage(canonicalId);
    }

    const maxStage = canonicalIds.reduce(
        (best, canonicalId) => Math.max(best, stageByCanonicalId.get(canonicalId) ?? 0),
        0
    );
    const totalCheckpoints = canonicalIds.length > 0 ? (maxStage + 1) : 0;
    const stageIds = Array.from({ length: totalCheckpoints }, () => []);
    for (const canonicalId of canonicalIds) {
        const stage = stageByCanonicalId.get(canonicalId) ?? 0;
        if (!stageIds[stage]) continue;
        stageIds[stage].push(canonicalId);
    }

    const branchMetaByCanonicalId = new Map();
    const branches = [];
    for (const canonicalId of canonicalIds) {
        const nextIds = nextCanonicalIdsById.get(canonicalId) || [];
        if (nextIds.length < 2) continue;

        const childMergeIds = [];
        let mergeCheckpointId = '';
        let validMerge = true;
        for (const childId of nextIds) {
            const childNextIds = nextCanonicalIdsById.get(childId) || [];
            if (childNextIds.length !== 1) {
                validMerge = false;
                break;
            }
            childMergeIds.push(childNextIds[0]);
        }

        if (validMerge) {
            const uniqueMergeIds = [...new Set(childMergeIds.filter(Boolean))];
            if (uniqueMergeIds.length === 1) {
                mergeCheckpointId = uniqueMergeIds[0];
            } else {
                validMerge = false;
            }
        }

        branches.push({
            checkpointId: canonicalId,
            routeIndex: stageByCanonicalId.get(canonicalId) ?? 0,
            nextCheckpointIds: [...nextIds],
            mergeCheckpointId: validMerge && mergeCheckpointId ? mergeCheckpointId : null,
            validMerge,
        });

        if (!validMerge || !mergeCheckpointId) continue;
        for (const childId of nextIds) {
            branchMetaByCanonicalId.set(childId, {
                branchParentId: canonicalId,
                mergeCheckpointId,
            });
        }
    }

    return {
        stageByCanonicalId,
        branchMetaByCanonicalId,
        branches,
        sequence: stageIds.map((idsAtStage) => idsAtStage[0] || ''),
        totalCheckpoints,
    };
}

export function buildRouteFromParcours(parcoursRaw, options = {}) {
    if (!isObject(parcoursRaw) || parcoursRaw.enabled !== true) {
        return null;
    }
    const positionScale = toPositiveNumber(options?.positionScale, 1, 0.0001);

    const rawRules = isObject(parcoursRaw.rules) ? parcoursRaw.rules : {};
    const rules = {
        ordered: rawRules.ordered !== false,
        bidirectionalCheckpoints: rawRules.bidirectionalCheckpoints !== false,
        resetOnDeath: rawRules.resetOnDeath !== false,
        resetToLastValid: rawRules.resetToLastValid === true,
        maxSegmentTimeMs: Math.max(0, Math.trunc(toFiniteNumber(rawRules.maxSegmentTimeMs, 0))),
        cooldownMs: Math.max(0, Math.trunc(toFiniteNumber(rawRules.cooldownMs, 450))),
        allowLaneAliases: rawRules.allowLaneAliases !== false,
        winnerByParcoursComplete: rawRules.winnerByParcoursComplete !== false,
        wrongOrderCooldownMs: Math.max(0, Math.trunc(toFiniteNumber(rawRules.wrongOrderCooldownMs, 650))),
        wrongOrderPenaltyMs: Math.max(0, Math.trunc(toFiniteNumber(rawRules.wrongOrderPenaltyMs, 2000))),
        errorIndicatorMs: Math.max(0, Math.trunc(toFiniteNumber(rawRules.errorIndicatorMs, 1400))),
        animateCheckpoints: rawRules.animateCheckpoints !== false,
        // Ghost playback/recording is default-on for parcours routes.
        // Individual maps may opt out via `showGhost: false`.
        showGhost: rawRules.showGhost !== false,
    };

    const rawCheckpoints = Array.isArray(parcoursRaw.checkpoints) ? parcoursRaw.checkpoints : [];
    if (rawCheckpoints.length === 0) {
        return null;
    }

    const checkpointDefinitions = [];
    for (let i = 0; i < rawCheckpoints.length; i += 1) {
        const rawEntry = rawCheckpoints[i];
        if (!isObject(rawEntry)) continue;
        const id = toCheckpointId(rawEntry.id, `CP${String(i + 1).padStart(2, '0')}`);
        checkpointDefinitions.push({
            rawEntry,
            id,
            requestedAliasOf: rules.allowLaneAliases ? normalizeString(rawEntry.aliasOf, '') : '',
            nextIds: normalizeCheckpointIdList(rawEntry.nextIds, rawEntry.nextId),
        });
    }

    if (checkpointDefinitions.length === 0) {
        return null;
    }

    const canonicalIds = [];
    for (const definition of checkpointDefinitions) {
        if (definition.requestedAliasOf) continue;
        const id = definition.id;
        if (canonicalIds.includes(id)) continue;
        canonicalIds.push(id);
    }

    if (canonicalIds.length === 0) {
        for (const definition of checkpointDefinitions) {
            const id = definition.id;
            if (canonicalIds.includes(id)) continue;
            canonicalIds.push(id);
        }
    }

    const canonicalIndexById = new Map();
    for (let i = 0; i < canonicalIds.length; i += 1) {
        canonicalIndexById.set(canonicalIds[i], i);
    }

    const canonicalIdByEntryId = new Map();
    for (const definition of checkpointDefinitions) {
        const aliasOf = definition.requestedAliasOf && canonicalIndexById.has(definition.requestedAliasOf)
            ? definition.requestedAliasOf
            : '';
        definition.aliasOf = aliasOf || null;
        definition.canonicalId = aliasOf || definition.id;
        if (!canonicalIndexById.has(definition.canonicalId)) {
            canonicalIndexById.set(definition.canonicalId, canonicalIds.length);
            canonicalIds.push(definition.canonicalId);
        }
        canonicalIdByEntryId.set(definition.id, definition.canonicalId);
    }

    const primaryDefinitionByCanonicalId = new Map();
    for (const definition of checkpointDefinitions) {
        if (definition.canonicalId !== definition.id) continue;
        if (primaryDefinitionByCanonicalId.has(definition.canonicalId)) continue;
        primaryDefinitionByCanonicalId.set(definition.canonicalId, definition);
    }

    for (const definition of checkpointDefinitions) {
        if (primaryDefinitionByCanonicalId.has(definition.canonicalId)) continue;
        primaryDefinitionByCanonicalId.set(definition.canonicalId, definition);
    }

    const nextCanonicalIdsById = new Map();
    for (let i = 0; i < canonicalIds.length; i += 1) {
        const canonicalId = canonicalIds[i];
        const definition = primaryDefinitionByCanonicalId.get(canonicalId);
        const declaredNextIds = Array.isArray(definition?.nextIds)
            ? definition.nextIds
                .map((targetId) => canonicalIdByEntryId.get(targetId) || targetId)
                .filter((targetId, targetIndex, targetIds) =>
                    !!targetId
                    && targetId !== canonicalId
                    && canonicalIndexById.has(targetId)
                    && (canonicalIndexById.get(targetId) > i)
                    && targetIds.indexOf(targetId) === targetIndex
                )
            : [];
        if (declaredNextIds.length > 0) {
            nextCanonicalIdsById.set(canonicalId, declaredNextIds);
            continue;
        }

        const fallbackNextId = canonicalIds[i + 1] || '';
        nextCanonicalIdsById.set(canonicalId, fallbackNextId ? [fallbackNextId] : []);
    }

    const {
        stageByCanonicalId,
        branchMetaByCanonicalId,
        branches,
        sequence,
        totalCheckpoints,
    } = buildCanonicalRouteStages(canonicalIds, nextCanonicalIdsById);

    const checkpoints = [];
    for (const definition of checkpointDefinitions) {
        const rawEntry = definition.rawEntry;
        const branchMeta = branchMetaByCanonicalId.get(definition.canonicalId) || null;
        const routeIndex = stageByCanonicalId.get(definition.canonicalId) ?? 0;
        checkpoints.push({
            id: definition.id,
            type: normalizeString(rawEntry.type, 'gate').toLowerCase() || 'gate',
            aliasOf: definition.aliasOf || null,
            routeIndex,
            nextCheckpointIds: [...(nextCanonicalIdsById.get(definition.canonicalId) || [])],
            isBranchOption: !!branchMeta,
            branchParentId: branchMeta?.branchParentId || null,
            mergeCheckpointId: branchMeta?.mergeCheckpointId || null,
            pos: scaleVec3(normalizeVec3(rawEntry.pos, [0, 0, 0]), positionScale),
            radius: toPositiveNumber(rawEntry.radius, 3.5, 0.1) * positionScale,
            forward: normalizeForward(rawEntry.forward),
            cooldownMs: Math.max(
                0,
                Math.trunc(toFiniteNumber(rawEntry?.params?.cooldownMs, rules.cooldownMs))
            ),
            params: isObject(rawEntry.params) ? { ...rawEntry.params } : {},
        });
    }

    if (checkpoints.length === 0) {
        return null;
    }

    const entriesByCheckpointIndex = Array.from({ length: totalCheckpoints }, () => []);
    for (const checkpoint of checkpoints) {
        if (!entriesByCheckpointIndex[checkpoint.routeIndex]) continue;
        entriesByCheckpointIndex[checkpoint.routeIndex].push(checkpoint);
    }

    const finishRaw = isObject(parcoursRaw.finish) ? parcoursRaw.finish : null;
    const finish = finishRaw ? {
        id: toCheckpointId(finishRaw.id, 'FINISH'),
        type: 'finish',
        pos: scaleVec3(normalizeVec3(finishRaw.pos, [0, 0, 0]), positionScale),
        radius: toPositiveNumber(finishRaw.radius, 4.2, 0.1) * positionScale,
        forward: normalizeForward(finishRaw.forward),
        cooldownMs: Math.max(
            0,
            Math.trunc(toFiniteNumber(finishRaw?.params?.cooldownMs, rules.cooldownMs))
        ),
        params: isObject(finishRaw.params) ? { ...finishRaw.params } : {},
    } : null;

    return {
        routeId: normalizeString(parcoursRaw.routeId, 'custom_route_v1'),
        totalCheckpoints,
        sequence,
        checkpoints,
        entriesByCheckpointIndex,
        branches,
        finish,
        rules,
    };
}

export function createPlayerProgressState(totalCheckpoints) {
    return {
        nextCheckpointIndex: 0,
        passedMask: new Uint8Array(Math.max(0, totalCheckpoints)),
        stageCheckpointIds: new Array(Math.max(0, totalCheckpoints)).fill(''),
        startedAtMs: 0,
        lastCheckpointAtMs: 0,
        wrongOrderCount: 0,
        penaltyTimeMs: 0,
        resetCount: 0,
        completed: false,
        completedAtMs: 0,
        completionTimeMs: 0,
        lastCheckpointId: '',
        lastError: '',
        errorUntilMs: 0,
        lastWrongOrderAtMs: -Infinity,
        cooldownByCheckpointId: new Map(),
        insideCheckpointById: new Map(),
        segmentSplitsMs: [],
    };
}
