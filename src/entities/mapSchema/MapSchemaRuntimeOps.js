import { DEFAULT_PORTAL_COLORS } from './MapSchemaConstants.js';
import { asPositiveNumber } from './MapSchemaSanitizeOps.js';
import { createMapDocument } from './MapSchemaMigrationOps.js';

function cloneObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return { ...value };
}

function toNonNegativeInteger(value, fallback = 0) {
    const parsed = Number(value);
    return Math.max(0, Math.trunc(Number.isFinite(parsed) ? parsed : fallback));
}

function scalePosArray(raw, invScale) {
    const source = Array.isArray(raw) ? raw : [0, 0, 0];
    return [
        (Number(source[0]) || 0) * invScale,
        (Number(source[1]) || 0) * invScale,
        (Number(source[2]) || 0) * invScale,
    ];
}

function mapParcoursCheckpoint(entry, invScale, fallbackType = 'gate') {
    if (!entry || typeof entry !== 'object') return null;
    const nextIds = [
        ...new Set(
            (Array.isArray(entry.nextIds) ? entry.nextIds : [entry.nextId])
                .map((value) => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean)
        ),
    ];
    const checkpoint = {
        id: typeof entry.id === 'string' ? entry.id : undefined,
        type: typeof entry.type === 'string' ? entry.type : fallbackType,
        aliasOf: typeof entry.aliasOf === 'string' ? entry.aliasOf : undefined,
        nextIds: nextIds.length > 0 ? nextIds : undefined,
        pos: scalePosArray(entry.pos, invScale),
        radius: asPositiveNumber(entry.radius, 3.5, 0.1) * invScale,
        forward: Array.isArray(entry.forward) ? [
            Number(entry.forward[0]) || 0,
            Number(entry.forward[1]) || 0,
            Number(entry.forward[2]) || 0,
        ] : undefined,
        params: cloneObject(entry.params),
    };
    return checkpoint;
}

function mapParcoursToRuntime(parcours, invScale) {
    if (!parcours || typeof parcours !== 'object' || parcours.enabled !== true) {
        return undefined;
    }

    const checkpoints = Array.isArray(parcours.checkpoints)
        ? parcours.checkpoints
            .map((entry) => mapParcoursCheckpoint(entry, invScale, 'gate'))
            .filter(Boolean)
        : [];

    const finish = mapParcoursCheckpoint(parcours.finish, invScale, 'finish');
    if (finish) {
        finish.type = 'finish';
    }

    return {
        enabled: true,
        routeId: typeof parcours.routeId === 'string' ? parcours.routeId : 'custom_route_v1',
        checkpoints,
        rules: {
            ordered: parcours.rules?.ordered !== false,
            bidirectionalCheckpoints: parcours.rules?.bidirectionalCheckpoints !== false,
            resetOnDeath: parcours.rules?.resetOnDeath !== false,
            resetToLastValid: parcours.rules?.resetToLastValid === true,
            allowLaneAliases: parcours.rules?.allowLaneAliases !== false,
            winnerByParcoursComplete: parcours.rules?.winnerByParcoursComplete !== false,
            maxSegmentTimeMs: toNonNegativeInteger(parcours.rules?.maxSegmentTimeMs, 0),
            cooldownMs: toNonNegativeInteger(parcours.rules?.cooldownMs, 450),
            wrongOrderCooldownMs: toNonNegativeInteger(parcours.rules?.wrongOrderCooldownMs, 650),
            wrongOrderPenaltyMs: toNonNegativeInteger(parcours.rules?.wrongOrderPenaltyMs, 2000),
            errorIndicatorMs: toNonNegativeInteger(parcours.rules?.errorIndicatorMs, 1400),
            animateCheckpoints: parcours.rules?.animateCheckpoints !== false,
            showGhost: parcours.rules?.showGhost !== false,
        },
        finish,
    };
}

function buildPortalAuthoringContract(portalMode, authoredPortalNodeCount, authoredPortalPairCount) {
    const mode = typeof portalMode === 'string' ? portalMode : 'dynamic';
    const nodeCount = Math.max(0, Math.trunc(Number(authoredPortalNodeCount) || 0));
    const pairCount = Math.max(0, Math.trunc(Number(authoredPortalPairCount) || 0));
    const hasDanglingPortalNode = (nodeCount % 2) !== 0;
    const usesAuthoredPortals = pairCount > 0 && (mode === 'authored' || mode === 'hybrid');
    const usesDynamicPortals = mode === 'dynamic' || mode === 'hybrid';

    return {
        mode,
        authoredNodeCount: nodeCount,
        authoredPairCount: pairCount,
        hasDanglingPortalNode,
        usesAuthoredPortals,
        usesDynamicPortals,
    };
}

function buildItemSpawnAuthoringContract(itemSpawnMode, authoredAnchorCount) {
    const mode = typeof itemSpawnMode === 'string' ? itemSpawnMode : 'fallback-random';
    const anchorCount = Math.max(0, Math.trunc(Number(authoredAnchorCount) || 0));
    const requiresAuthoredAnchor = mode === 'anchor-only';
    const usesAuthoredAnchors = anchorCount > 0 && (requiresAuthoredAnchor || mode === 'hybrid');
    const usesRandomFallback = mode === 'fallback-random' || mode === 'hybrid';
    const disablesSpawnWithoutAnchor = requiresAuthoredAnchor && anchorCount === 0;

    return {
        mode,
        authoredAnchorCount: anchorCount,
        requiresAuthoredAnchor,
        usesAuthoredAnchors,
        usesRandomFallback,
        disablesSpawnWithoutAnchor,
    };
}

export function toArenaMapDefinition(mapDocument, options = {}) {
    const mapScale = asPositiveNumber(options.mapScale, 1, 0.0001);
    const invScale = 1 / mapScale;
    const warnings = [];
    const normalized = createMapDocument(mapDocument, { warnings });

    const obstacles = [];
    const pushBlockAsObstacle = (block, kind = 'hard') => {
        const obstacle = {
            pos: [
                block.x * invScale,
                block.y * invScale,
                block.z * invScale,
            ],
            size: [
                block.width * invScale,
                block.height * invScale,
                block.depth * invScale,
            ],
            kind,
        };
        if (block.tunnel && typeof block.tunnel === 'object') {
            obstacle.tunnel = {
                radius: asPositiveNumber(block.tunnel.radius, Math.min(block.width, block.height, block.depth) * 0.3, 0.1) * invScale,
                axis: block.tunnel.axis === 'x' || block.tunnel.axis === 'y' || block.tunnel.axis === 'z'
                    ? block.tunnel.axis
                    : 'z',
            };
        }
        obstacles.push(obstacle);
    };

    normalized.hardBlocks.forEach((block) => pushBlockAsObstacle(block, 'hard'));
    normalized.foamBlocks.forEach((block) => pushBlockAsObstacle(block, 'foam'));

    normalized.tunnels.forEach((tunnel, tunnelIndex) => {
        const start = [
            tunnel.ax * invScale,
            tunnel.ay * invScale,
            tunnel.az * invScale,
        ];
        const end = [
            tunnel.bx * invScale,
            tunnel.by * invScale,
            tunnel.bz * invScale,
        ];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const dz = end[2] - start[2];
        const lengthSq = dx * dx + dy * dy + dz * dz;
        if (lengthSq < 0.25) {
            warnings.push(`Tunnel ${tunnel.id || tunnelIndex + 1} was ignored because it is too short.`);
            return;
        }

        obstacles.push({
            shape: 'tube',
            kind: 'hard',
            start,
            end,
            radius: asPositiveNumber(tunnel.radius, 1, 0.1) * invScale,
        });
    });

    const defaultPlayerSpawn = {
        x: -800,
        y: normalized.arenaSize.height * 0.55,
        z: 0,
    };

    const portals = [];
    for (let i = 0; i < normalized.portals.length; i += 2) {
        const entryA = normalized.portals[i];
        const entryB = normalized.portals[i + 1];
        if (!entryA || !entryB) {
            break;
        }

        const pairIndex = Math.floor(i / 2);
        portals.push({
            a: [entryA.x * invScale, entryA.y * invScale, entryA.z * invScale],
            b: [entryB.x * invScale, entryB.y * invScale, entryB.z * invScale],
            color: DEFAULT_PORTAL_COLORS[pairIndex % DEFAULT_PORTAL_COLORS.length],
        });
    }

    const items = normalized.items.map((entry) => ({
        id: entry.id,
        type: entry.type,
        pickupType: entry.pickupType,
        model: entry.model,
        weight: asPositiveNumber(entry.weight, 1, 0.01),
        x: entry.x * invScale,
        y: entry.y * invScale,
        z: entry.z * invScale,
        rotateY: Number(entry.rotateY) || 0,
    }));

    const portalMode = typeof normalized.portalMode === 'string'
        ? normalized.portalMode
        : (normalized.preferAuthoredPortals === true ? 'authored' : 'dynamic');
    const portalAuthoring = buildPortalAuthoringContract(portalMode, normalized.portals.length, portals.length);
    const itemSpawnMode = typeof normalized.itemSpawnMode === 'string'
        ? normalized.itemSpawnMode
        : (normalized.items.length > 0 ? 'anchor-only' : 'fallback-random');
    const itemSpawnAuthoring = buildItemSpawnAuthoringContract(itemSpawnMode, items.length);
    if (portalAuthoring.hasDanglingPortalNode) {
        warnings.push('Authored portal contract requires complete A/B pairs; a trailing portal node was ignored.');
    }
    if (portalMode === 'authored' && portalAuthoring.authoredPairCount === 0) {
        warnings.push('Portal mode "authored" requires at least one complete authored portal pair; dynamic fallback remains disabled.');
    }
    if (portalMode === 'hybrid' && portalAuthoring.authoredPairCount === 0) {
        warnings.push('Portal mode "hybrid" has no complete authored portal pair; runtime falls back to dynamic-only placement.');
    }
    if (portalMode === 'dynamic' && portalAuthoring.authoredNodeCount > 0) {
        warnings.push('Authored portal nodes were ignored because portalMode=dynamic.');
    }
    if (itemSpawnAuthoring.mode === 'anchor-only' && itemSpawnAuthoring.authoredAnchorCount === 0) {
        warnings.push('Item spawn mode "anchor-only" requested, but no authored item anchors are available; runtime keeps random fallback disabled.');
    }
    if (itemSpawnAuthoring.mode === 'hybrid' && itemSpawnAuthoring.authoredAnchorCount === 0) {
        warnings.push('Item spawn mode "hybrid" has no authored item anchors; runtime falls back to random-only placement.');
    }
    if (itemSpawnAuthoring.mode === 'fallback-random' && itemSpawnAuthoring.authoredAnchorCount > 0) {
        warnings.push('Authored item anchors were ignored because itemSpawnMode=fallback-random.');
    }

    const aircraft = normalized.aircraft.map((entry) => ({
        id: entry.id,
        jetId: entry.jetId,
        x: entry.x * invScale,
        y: entry.y * invScale,
        z: entry.z * invScale,
        scale: asPositiveNumber(entry.scale, 1, 0.01) * invScale,
        rotateY: Number(entry.rotateY) || 0,
    }));

    const glbModels = normalized.glbModels.map((entry) => ({
        id: entry.id,
        url: entry.url,
        position: entry.position.map((value) => value * invScale),
        rotation: [...entry.rotation],
        scale: asPositiveNumber(entry.scale, 1, 0.0001) * invScale,
        targetSize: Number(entry.targetSize) > 0 ? entry.targetSize * invScale : 0,
    }));

    const playerSpawn = normalized.playerSpawn
        ? {
            id: normalized.playerSpawn.id,
            x: normalized.playerSpawn.x * invScale,
            y: normalized.playerSpawn.y * invScale,
            z: normalized.playerSpawn.z * invScale,
        }
        : {
            x: defaultPlayerSpawn.x * invScale,
            y: defaultPlayerSpawn.y * invScale,
            z: defaultPlayerSpawn.z * invScale,
        };

    const botSpawns = normalized.botSpawns.map((entry) => ({
        id: entry.id,
        x: entry.x * invScale,
        y: entry.y * invScale,
        z: entry.z * invScale,
    }));

    const gates = normalized.gates.map((gate) => ({
        id: gate.id,
        type: gate.type,
        legacyType: typeof gate.legacyType === 'string' ? gate.legacyType : undefined,
        warningCode: typeof gate.warningCode === 'string' ? gate.warningCode : undefined,
        pos: [
            gate.pos[0] * invScale,
            gate.pos[1] * invScale,
            gate.pos[2] * invScale,
        ],
        radius: asPositiveNumber(gate.radius, gate.type === 'boost' ? 3.25 : 2.9, 0.1) * invScale,
        rot: Array.isArray(gate.rot) ? [...gate.rot] : undefined,
        forward: Array.isArray(gate.forward) ? [...gate.forward] : undefined,
        up: Array.isArray(gate.up) ? [...gate.up] : undefined,
        color: gate.color,
        params: gate.params ? { ...gate.params } : undefined,
    }));
    const parcours = mapParcoursToRuntime(normalized.parcours, invScale);

    return {
        map: {
            name: String(options.name || 'Custom Map'),
            size: [
                normalized.arenaSize.width * invScale,
                normalized.arenaSize.height * invScale,
                normalized.arenaSize.depth * invScale,
            ],
            obstacles,
            portals,
            portalLevels: normalized.portalLevels.map((level) => level * invScale),
            portalMode,
            portalAuthoring,
            preferAuthoredPortals: normalized.preferAuthoredPortals === true || portalAuthoring.authoredPairCount > 0,
            itemSpawnMode,
            itemSpawnAuthoring,
            gates,
            playerSpawn,
            botSpawns,
            items,
            aircraft,
            glbModel: typeof normalized.glbModel === 'string' ? normalized.glbModel : undefined,
            glbModels,
            glbColliderMode: typeof normalized.glbColliderMode === 'string' ? normalized.glbColliderMode : undefined,
            parcours,
        },
        warnings,
        mapDocument: normalized,
    };
}
