import assert from 'node:assert/strict';
import test from 'node:test';

import { ArenaBuilder } from '../src/entities/arena/ArenaBuilder.js';
import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { resolvePortalPosition } from '../src/entities/arena/PortalPlacementOps.js';
import { NEON_CIRCUIT_MAP } from '../src/core/config/maps/presets/neon_circuit.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { GAMEPLAY_CONFIG_DEFAULTS } from '../src/shared/contracts/GameplayConfigContract.js';
import { resolveActiveParcoursRoute } from '../src/entities/systems/ParcoursProgressRuntime.js';
import { buildArenaSessionKey } from '../src/state/match-session/MatchSessionMapOps.js';
import {
    buildRouteFromParcours,
    resolveParcoursForPortalChain,
} from '../src/entities/systems/ParcoursProgressUtils.js';
import { compileArenaCollision } from './helpers/parcours-race-line.mjs';
import { getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import { ARCADE_PART_SIZE_GROUPS } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeWallHitboxScale } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import {
    K19_NEON_CP05_ROUTE_ID,
    K19_NEON_CP05_ROUTE_WAYPOINTS,
    K19_NEON_CP05_ENTRY_POSITION,
    K19_NEON_CP06_ROUTE_ID,
    K19_NEON_CP06_ROUTE_WAYPOINTS,
    maximumOrientationDeviationEnvelope,
    portalPathConflictsWithTurnEnvelope,
    resolveK19CheckpointEntryOverride,
    selectK19RouteCandidate,
} from './helpers/k19-waypoint-transition.mjs';

const reconstructedK19CheckpointEntryOverride = new Function(
    `return (${resolveK19CheckpointEntryOverride.toString()});`,
)();

const map = NEON_CIRCUIT_MAP.neon_circuit;
const k19Config = { arcade: { enabled: true, runType: 'five_portals', portalChainId: 'portal_chain_k19' } };
const fivePortalsConfig = { arcade: { enabled: true, runType: 'five_portals', portalChainId: 'five_portals' } };

function createArenaBuilder(runtimeConfig) {
    const renderer = new Proxy({ getGraphicsStyle: () => 'modern' }, {
        get: (target, property) => (property in target ? target[property] : () => undefined),
    });
    const arena = {
        runtimeConfig,
        entityRuntimeConfig: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG,
            MAPS: { standard: map, neon_circuit: map },
        },
        renderer,
        portalsEnabled: true,
    };
    const builder = new ArenaBuilder(arena);
    builder.geometryPipeline.beginBuildStage = () => {};
    builder.geometryPipeline.compileWallStage = () => {};
    builder._applyArenaBounds = () => {};
    builder._resolveMaterialBundle = () => ({});
    builder._assignArenaMaterials = () => {};
    builder._compileFloorStage = () => {};
    builder._hasCompiledGeometry = () => true;
    builder.expansionController.build = () => {};
    return { arena, builder };
}

test('Neon K19 clears CP03 and CP07 while ordinary and Five Portals routes keep authored positions', () => {
    const original = map.parcours;
    const ordinary = resolveParcoursForPortalChain(map, null);
    const fivePortals = resolveParcoursForPortalChain(map, fivePortalsConfig);
    const wrongRunType = resolveParcoursForPortalChain(map, {
        arcade: { enabled: true, runType: 'classic', portalChainId: 'portal_chain_k19' },
    });
    const k19 = resolveParcoursForPortalChain(map, k19Config);

    assert.strictEqual(ordinary, original);
    assert.strictEqual(fivePortals, original);
    assert.strictEqual(wrongRunType, original);
    assert.notStrictEqual(k19, original);
    assert.deepEqual(original.checkpoints.find(({ id }) => id === 'CP03').pos, [0, 14, -50]);
    assert.deepEqual(k19.checkpoints.find(({ id }) => id === 'CP03').pos, [15, 42.5, -50]);
    assert.deepEqual(original.checkpoints.find(({ id }) => id === 'CP07').pos, [0, 12, 50]);
    assert.deepEqual(k19.checkpoints.find(({ id }) => id === 'CP07').pos, [0, 35, 50]);
    assert.deepEqual(k19.checkpoints.filter(({ id }) => id !== 'CP03' && id !== 'CP07'),
        original.checkpoints.filter(({ id }) => id !== 'CP03' && id !== 'CP07'));
});

test('the K19 CP07 crossing disk clears authored walls and portal interaction volumes', () => {
    const resolved = resolveParcoursForPortalChain(map, k19Config);
    const cp07 = resolved.checkpoints.find(({ id }) => id === 'CP07');
    const scale = 3;
    const collision = compileArenaCollision(map, scale);
    const portalClearance = GAMEPLAY_CONFIG_DEFAULTS.PORTAL.RADIUS + 1.2 + 1;
    for (let radius = 0; radius <= cp07.radius * scale; radius += 1.5) {
        for (let step = 0; step < 64; step += 1) {
            const angle = step * Math.PI * 2 / 64;
            const point = {
                x: cp07.pos[0] * scale,
                y: cp07.pos[1] * scale + radius * Math.cos(angle),
                z: cp07.pos[2] * scale + radius * Math.sin(angle),
            };
            assert.equal(collision.checkCollisionFast(point, 1.2), false,
                'the crossing disk plus player hull stays clear of compiled walls');
            for (const portal of map.portals) {
                for (const end of [portal.a, portal.b]) {
                    assert.ok(Math.hypot(point.x - end[0] * scale,
                        point.y - end[1] * scale, point.z - end[2] * scale) > portalClearance,
                    'crossing the checkpoint must not activate another authored portal');
                }
            }
        }
    }
});

test('the CP09 entry remains inside its authored ring and clear of the west start platform', () => {
    const route = buildRouteFromParcours(resolveParcoursForPortalChain(map, k19Config), { positionScale: 3 });
    const target = route.checkpoints.find(({ id }) => id === 'CP09');
    const portalEndpoints = map.portals.flatMap(({ a, b }) => [a, b].map(([x, y, z]) => ({
        x: x * 3, y: y * 3, z: z * 3,
    })));
    const request = {
        mapKey: 'neon_circuit', checkpointId: 'CP09', target,
        playerRadius: 1.2, portalEndpoints, portalClearance: 6.2,
    };
    const proposal = reconstructedK19CheckpointEntryOverride(request);
    assert.equal(proposal.accepted, true);
    assert.ok(proposal.checkpointDistance < target.radius,
        'the pilot crosses inside the authored ring rather than enlarging its trigger');
    assert.ok(proposal.position.z < target.pos[2], 'the pose crosses the forward checkpoint plane');
    const collision = compileArenaCollision(map, 3);
    assert.equal(collision.checkCollisionBroad(proposal.position, 9.368 + 1.2), false,
        'the endpoint and existing maximum turn displacement clear compiled obstacles');
    assert.equal(reconstructedK19CheckpointEntryOverride({ ...request, target: { ...target, radius: 1 } }).accepted, false);
    assert.equal(reconstructedK19CheckpointEntryOverride({ ...request, portalEndpoints: [proposal.position] }).accepted, false);
});

test('invalid K19 CP03 position components leave the authored checkpoint unchanged', () => {
    const authoredParcours = map.parcours;
    const authoredCp03 = authoredParcours.checkpoints.find(({ id }) => id === 'CP03');
    const invalidOverrides = [
        [null, 42.5, -50],
        [15, '', -50],
        [15, 42.5, false],
        [15, '42.5', -50],
        [NaN, 42.5, -50],
        [15, Infinity, -50],
        [15, 42.5, -Infinity],
    ];

    for (const invalidPosition of invalidOverrides) {
        const mapWithInvalidOverride = {
            ...map,
            parcours: {
                ...authoredParcours,
                checkpointPositionOverridesByPortalChain: {
                    ...authoredParcours.checkpointPositionOverridesByPortalChain,
                    portal_chain_k19: { CP03: invalidPosition },
                },
            },
        };
        const resolved = resolveParcoursForPortalChain(mapWithInvalidOverride, k19Config);

        assert.strictEqual(resolved, mapWithInvalidOverride.parcours);
        assert.strictEqual(resolved.checkpoints.find(({ id }) => id === 'CP03'), authoredCp03);
        assert.deepEqual(authoredCp03.pos, [0, 14, -50]);
    }
});

test('K19 trigger and ring route builders consume the same scaled CP03 definition and retain route gates', () => {
    const entityManager = {
        activeGameMode: 'ARCADE',
        runtimeConfig: k19Config,
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 3 } },
        arena: { currentMapDefinition: map },
    };
    const triggerRoute = resolveActiveParcoursRoute(entityManager);
    const cp03 = triggerRoute.checkpoints.find(({ id }) => id === 'CP03');
    const arena = { runtimeConfig: k19Config, renderer: null, checkpointRings: [] };
    new PortalLayoutBuilder(arena)._buildCheckpointRings(map, 3);
    const ringCp03 = arena.checkpointRings.find(({ checkpointId }) => checkpointId === 'CP03');

    assert.deepEqual(cp03.pos, [45, 127.5, -150]);
    assert.ok(ringCp03?.mesh.visible, 'the built CP03 checkpoint ring is visible');
    assert.deepEqual(ringCp03.pos.toArray(), cp03.pos,
        'the visible ring world position equals the runtime trigger world position');
    assert.deepEqual(ringCp03.mesh.position.toArray(), cp03.pos);
    const cp07 = triggerRoute.checkpoints.find(({ id }) => id === 'CP07');
    const ringCp07 = arena.checkpointRings.find(({ checkpointId }) => checkpointId === 'CP07');
    assert.deepEqual(cp07.pos, [0, 105, 150]);
    assert.deepEqual(ringCp07.pos.toArray(), cp07.pos);
    assert.deepEqual(ringCp07.mesh.position.toArray(), cp07.pos);
    assert.equal(triggerRoute.rules.maxSegmentTimeMs, 16_000);
    assert.deepEqual(triggerRoute.sequence, map.parcours.checkpoints.map(({ id }) => id));
});

test('Arena reuse and prewarm keys separate normalized portal chains but retain default and non-portal variants', () => {
    const { arena, builder } = createArenaBuilder(k19Config);
    const k19Build = builder.build('neon_circuit');
    assert.equal(k19Build.buildSignature.split('|')[11], 'five_portals:portal_chain_k19');

    arena.runtimeConfig = fivePortalsConfig;
    const defaultBuild = builder.build('neon_circuit', { previousBuildSignature: k19Build.buildSignature });
    assert.notEqual(defaultBuild.buildSignature, k19Build.buildSignature);
    assert.equal(defaultBuild.buildSignature.split('|')[11], 'five_portals',
        'the original default-chain signature remains unchanged');
    assert.equal(defaultBuild.rebuildPolicy, 'rebuild',
        'switching from K19 to the default chain rebuilds checkpoint rings');
    assert.equal(builder.build('neon_circuit', { previousBuildSignature: defaultBuild.buildSignature }).rebuildPolicy, 'reuse');

    const resolution = { effectiveMapKey: 'neon_circuit', mapDefinition: map };
    const k19Key = buildArenaSessionKey(resolution, k19Config, true, 'modern');
    const defaultKey = buildArenaSessionKey(resolution, fivePortalsConfig, true, 'modern');
    const normalizedDefaultKey = buildArenaSessionKey(resolution, {
        arcade: { enabled: true, runType: 'five_portals', portalChainId: ' UNKNOWN ' },
    }, true, 'modern');
    assert.notEqual(k19Key, defaultKey, 'prewarmed sessions cannot cross portal chains');
    assert.equal(defaultKey, normalizedDefaultKey, 'unknown chain IDs normalize to the unchanged default chain');
    assert.equal(
        buildArenaSessionKey(resolution, null, true, 'modern'),
        buildArenaSessionKey(resolution, { arcade: { enabled: false, runType: 'five_portals', portalChainId: 'portal_chain_k19' } }, true, 'modern'),
        'non-portal sessions ignore a stale chain ID',
    );
});

test('the relocated CP03 approach and pinned CP04 route retain static tunnel, portal, hull, and 16-second margins', () => {
    const cp02 = { x: -150, y: 36, z: -150 };
    const cp03 = { x: 45, y: 127.5, z: -150 };
    const cp04 = { x: 180, y: 36, z: -150 };
    const cp03Waypoints = [{ x: -115, y: 76, z: -150 }];
    const cp04Waypoints = [
        { x: 120, y: 127.5, z: -150 },
        { x: 180, y: 127.5, z: -150 },
        cp04,
    ];
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const segmentLength = (points) => points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
    const pointToSegmentDistance = (point, from, to) => {
        const direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        const lengthSquared = direction.x ** 2 + direction.y ** 2 + direction.z ** 2;
        const amount = Math.max(0, Math.min(1, (
            (point.x - from.x) * direction.x
            + (point.y - from.y) * direction.y
            + (point.z - from.z) * direction.z
        ) / lengthSquared));
        return distance(point, {
            x: from.x + direction.x * amount,
            y: from.y + direction.y * amount,
            z: from.z + direction.z * amount,
        });
    };

    const tunnelTop = 84;
    const tunnelMaxX = 18;
    const maxHullRadius = 6.2;
    const portalClearance = 4 + 2.342 + 1;
    const turnDisplacement = 9.368;
    const cp03Route = [cp02, ...cp03Waypoints, cp03];
    const approachAtTunnelMouth = {
        x: -18,
        y: cp03Waypoints[0].y + ((-18 - cp03Waypoints[0].x)
            / (cp03.x - cp03Waypoints[0].x)) * (cp03.y - cp03Waypoints[0].y),
        z: cp02.z,
    };
    const cp02ToCp03Length = segmentLength(cp03Route);
    const westPillarMinX = -99;
    const westPillarMaxX = -81;
    const westPillarTop = 60;
    const cp03PillarGap = Math.min(...[
        [cp02, cp03Waypoints[0]],
        [cp03Waypoints[0], cp03],
    ].map(([from, to]) => {
        if (to.x <= westPillarMinX || from.x >= westPillarMaxX) {
            return Math.max(westPillarMinX - Math.max(from.x, to.x), Math.min(from.x, to.x) - westPillarMaxX, 0);
        }
        return Math.max(from.y, to.y) - westPillarTop;
    }));
    const cp04Length = segmentLength([cp03, ...cp04Waypoints]);
    const cp04PortalGap = Math.min(...[
        [cp03, cp04Waypoints[0]],
        [cp04Waypoints[0], cp04Waypoints[1]],
        [cp04Waypoints[1], cp04],
    ].map(([from, to]) => pointToSegmentDistance({ x: 0, y: 42, z: -150 }, from, to)));
    const cp03TunnelAabbGap = cp03.x - tunnelMaxX;
    const eastPillarMinX = 141;
    const eastPillarMaxX = 159;
    const eastPillarTop = 60;

    assert.ok(approachAtTunnelMouth.y - tunnelTop > maxHullRadius,
        `CP02→CP03 crosses above the tunnel roof with ${(approachAtTunnelMouth.y - tunnelTop - maxHullRadius).toFixed(2)} hull-clearance margin`);
    assert.ok(cp03Waypoints[0].x + maxHullRadius < westPillarMinX,
        'the CP02 approach waypoint clears the west pillar before climbing over it');
    assert.ok(cp03Waypoints[0].y - westPillarTop > maxHullRadius,
        'the route clears the west pillar top after passing its west edge');
    assert.ok(cp03PillarGap > maxHullRadius,
        `CP02→CP03 centerline clears the west pillar with ${cp03PillarGap.toFixed(2)} units`);
    assert.ok(cp03TunnelAabbGap - (15 + 2.342) > 0,
        'the whole checkpoint contact sphere stays beyond the east tunnel mouth');
    assert.ok(distance(cp03, { x: 0, y: 42, z: -150 }) - portalClearance > 0,
        'the relocated trigger center stays outside portal clearance');
    assert.ok(cp04PortalGap - portalClearance > turnDisplacement,
        'the CP03→CP04 route stays outside the unchanged portal turn envelope');
    assert.ok(180 - eastPillarMaxX - maxHullRadius > 0,
        'the CP04 descent stays east of the authored north-straight pillar');
    assert.ok(cp04Waypoints[0].y - eastPillarTop > maxHullRadius,
        'the horizontal bridge clears the pillar top by the unchanged hull bound');
    assert.ok(cp02ToCp03Length / 18 < 16);
    assert.ok(cp04Length / 18 < 16);
    assert.ok(16 - cp02ToCp03Length / 18 > 3);
    assert.ok(16 - cp04Length / 18 > 3);
});

test('the pinned K19 CP05 route physically enters the authored ring with wall, portal, order, and budget margins', () => {
    const start = { x: 179.5623921612266, y: 52.73858443863141, z: -149.99999001735108 };
    const hullRadius = 1.2;
    const maxTurnDisplacement = 9.368;
    const conservativeSpeed = 16;
    const mapScale = GAMEPLAY_CONFIG_DEFAULTS.ARENA.MAP_SCALE;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const collision = compileArenaCollision(map, mapScale);
    const [arenaWidth, arenaHeight, arenaDepth] = map.size.map((value) => value * mapScale);
    const pointToSegmentDistance = (point, from, to) => {
        const direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        const lengthSquared = direction.x ** 2 + direction.y ** 2 + direction.z ** 2;
        const amount = Math.max(0, Math.min(1, (
            (point.x - from.x) * direction.x
            + (point.y - from.y) * direction.y
            + (point.z - from.z) * direction.z
        ) / lengthSquared));
        return distance(point, {
            x: from.x + direction.x * amount,
            y: from.y + direction.y * amount,
            z: from.z + direction.z * amount,
        });
    };
    const runtimePortals = {
        runtimeConfig: k19Config,
        entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, PORTAL: GAMEPLAY_CONFIG_DEFAULTS.PORTAL },
        renderer: null,
        portalsEnabled: true,
        bounds: {
            minX: -arenaWidth / 2, maxX: arenaWidth / 2,
            minY: 0, maxY: arenaHeight,
            minZ: -arenaDepth / 2, maxZ: arenaDepth / 2,
        },
        checkCollision: (position, radius) => collision.checkCollisionFast(position, radius),
        portals: [],
        portalLayoutWarnings: [],
    };
    const portalEndpoints = map.portals.flatMap(({ a, b }) => [a, b].map((position, endpointIndex) => {
        const [x, y, z] = position;
        return resolvePortalPosition(
            { x: x * mapScale, y: y * mapScale, z: z * mapScale },
            endpointIndex === 0 ? 11 : 29,
            runtimePortals,
            runtimePortals.entityRuntimeConfig.PORTAL,
            { verticalOffsets: [0, 2.5, -2.5, 5, -5, 8, -8, 12, -12] },
        );
    }).filter(Boolean));
    const portalRadius = Number(runtimePortals.entityRuntimeConfig.PORTAL.RADIUS) || 4;
    const portalClearance = portalRadius + hullRadius + 1;
    const candidate = {
        routeId: K19_NEON_CP05_ROUTE_ID,
        waypoints: K19_NEON_CP05_ROUTE_WAYPOINTS,
    };
    const authoredRoute = buildRouteFromParcours(resolveParcoursForPortalChain(map, k19Config), {
        positionScale: mapScale,
    });
    const target = authoredRoute.checkpoints.find(({ id }) => id === 'CP05');
    assert.ok(target, 'runtime parcours resolver supplies CP05');
    assert.equal(target.routeIndex, 4, 'the runtime route keeps CP05 at its authored order');
    assert.equal(authoredRoute.rules.bidirectionalCheckpoints, true,
        'the unchanged runtime progress rule accepts entry by the real checkpoint sphere');
    const targetCenter = { x: target.pos[0], y: target.pos[1], z: target.pos[2] };
    const nearestBlockedPortal = portalEndpoints
        .map((endpoint) => ({ endpoint, distance: distance(endpoint, targetCenter) }))
        .filter(({ distance: endpointDistance }) => endpointDistance <= portalClearance)
        .sort((left, right) => left.distance - right.distance)[0];
    assert.ok(nearestBlockedPortal, 'the runtime portal layout identifies CP05 as portal-blocked');
    const contactRadius = target.radius + hullRadius;
    const entryOverride = reconstructedK19CheckpointEntryOverride({
        mapKey: 'neon_circuit', checkpointId: 'CP05', target,
        playerRadius: hullRadius, portalEndpoints, portalClearance,
    });
    assert.equal(entryOverride.accepted, true,
        'the harness selects the explicit entry only when the runtime trigger and portals permit it');
    assert.equal(reconstructedK19CheckpointEntryOverride({
        mapKey: 'aether_relay', checkpointId: 'CP05', target,
        playerRadius: hullRadius, portalEndpoints, portalClearance,
    }), null, 'the override does not affect other maps');
    assert.equal(reconstructedK19CheckpointEntryOverride({
        mapKey: 'neon_circuit', checkpointId: 'CP04', target,
        playerRadius: hullRadius, portalEndpoints, portalClearance,
    }), null, 'the override does not affect other checkpoints');
    assert.equal(reconstructedK19CheckpointEntryOverride({
        mapKey: 'neon_circuit', checkpointId: 'CP05', target: { ...target, radius: 1 },
        playerRadius: hullRadius, portalEndpoints, portalClearance,
    }).accepted, false, 'a smaller actual trigger rejects the pose');
    assert.equal(reconstructedK19CheckpointEntryOverride({
        mapKey: 'neon_circuit', checkpointId: 'CP05', target,
        playerRadius: hullRadius, portalEndpoints: [K19_NEON_CP05_ENTRY_POSITION], portalClearance,
    }).accepted, false, 'a portal at the pose rejects the override');
    const cp05Entry = entryOverride.position;
    const checkpointDistance = distance(cp05Entry, targetCenter);
    const nearestPortalDistance = entryOverride.nearestPortalDistance;
    assert.deepEqual(cp05Entry, { x: 235, y: 48, z: -8 }, 'the K19 harness targets the east-side pose');
    assert.deepEqual(cp05Entry, K19_NEON_CP05_ENTRY_POSITION);
    assert.ok(checkpointDistance < contactRadius,
        `runtime CP05 contact radius ${contactRadius} contains the entry by ${(contactRadius - checkpointDistance).toFixed(3)}u`);
    assert.ok(nearestPortalDistance > portalClearance,
        `runtime portal resolver leaves ${(nearestPortalDistance - portalClearance).toFixed(3)}u beyond clearance`);
    const route = [start, ...K19_NEON_CP05_ROUTE_WAYPOINTS, cp05Entry];
    const turnWaypoint = K19_NEON_CP05_ROUTE_WAYPOINTS[0];
    const incomingLength = distance(start, turnWaypoint);
    const switchDistance = hullRadius * 2;
    const switchPoint = {
        x: turnWaypoint.x + ((start.x - turnWaypoint.x) / incomingLength) * switchDistance,
        y: turnWaypoint.y + ((start.y - turnWaypoint.y) / incomingLength) * switchDistance,
        z: turnWaypoint.z + ((start.z - turnWaypoint.z) / incomingLength) * switchDistance,
    };
    const approachDirection = {
        x: (turnWaypoint.x - start.x) / incomingLength,
        y: (turnWaypoint.y - start.y) / incomingLength,
        z: (turnWaypoint.z - start.z) / incomingLength,
    };
    const turnEnd = {
        x: switchPoint.x + approachDirection.x * maxTurnDisplacement,
        y: switchPoint.y + approachDirection.y * maxTurnDisplacement,
        z: switchPoint.z + approachDirection.z * maxTurnDisplacement,
    };
    const turnMidpoint = {
        x: (switchPoint.x + turnEnd.x) / 2,
        y: (switchPoint.y + turnEnd.y) / 2,
        z: (switchPoint.z + turnEnd.z) / 2,
    };
    const sizeGroups = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, 100]));
    const vehicleId = 'ship5';
    const wallShape = buildArcadeHitboxShape(getVehicleModularConfig(vehicleId)?.parts, sizeGroups, {
        originScale: resolveArcadeWallHitboxScale(vehicleId),
    });
    const departureEnvelope = maxTurnDisplacement / 2 + maximumOrientationDeviationEnvelope(
        wallShape.boundRadius,
        switchPoint,
        turnEnd,
        cp05Entry,
    );
    const turnGeometry = [{ switchPoint, turnEnd, turnMidpoint, departureEnd: cp05Entry, departureEnvelope }];
    const pathClearOfCompiledGeometry = (from, to, radius) => {
        const steps = Math.ceil(distance(from, to) / 0.5);
        for (let step = 0; step <= steps; step += 1) {
            const amount = steps === 0 ? 0 : step / steps;
            const point = {
                x: from.x + (to.x - from.x) * amount,
                y: from.y + (to.y - from.y) * amount,
                z: from.z + (to.z - from.z) * amount,
            };
            if (collision.checkCollisionFast(point, radius)) return false;
        }
        return true;
    };
    const segmentTimeBudgetSeconds = authoredRoute.rules.maxSegmentTimeMs / 1000;
    const startToSwitchPoint = distance(start, switchPoint);
    const turnEndToEntry = distance(turnEnd, cp05Entry);
    const boundedPathLength = startToSwitchPoint
        + maxTurnDisplacement
        + turnEndToEntry;
    const timeAtConservativeSpeed = boundedPathLength / conservativeSpeed;
    const nextCheckpointIndex = target.routeIndex;

    assert.deepEqual(K19_NEON_CP05_ROUTE_WAYPOINTS, [{ x: 220, y: 120, z: -16 }],
        'one high east-side waypoint crosses above the wall before descending eastward');
    assert.equal(selectK19RouteCandidate([candidate], K19_NEON_CP05_ROUTE_ID,
        K19_NEON_CP05_ROUTE_WAYPOINTS), candidate);
    assert.equal(authoredRoute.rules.maxSegmentTimeMs, 16_000,
        'static validation uses the unchanged runtime Parcours segment budget');
    assert.ok(Number.isFinite(departureEnvelope) && departureEnvelope >= 0,
        'runtime Arcade hitbox produces a bounded departure envelope');
    assert.ok(Math.abs(startToSwitchPoint - 152.891003) < 0.001,
        `Desktop switch occurs after ${startToSwitchPoint.toFixed(6)}u from the observed segment start`);
    assert.ok(Math.abs(turnEndToEntry - 76.193945) < 0.001,
        `Desktop turn-end to CP05 entry leg is ${turnEndToEntry.toFixed(6)}u`);
    assert.ok(Math.abs(boundedPathLength - 238.452948) < 0.001,
        `exact bounded route is ${boundedPathLength.toFixed(6)}u`);
    assert.ok(timeAtConservativeSpeed < segmentTimeBudgetSeconds,
        `Desktop-bounded route ${boundedPathLength.toFixed(2)}u / ${timeAtConservativeSpeed.toFixed(2)}s stays under ${segmentTimeBudgetSeconds}s`);
    assert.ok(segmentTimeBudgetSeconds - timeAtConservativeSpeed > 0,
        `conservative segment-time margin is ${(segmentTimeBudgetSeconds - timeAtConservativeSpeed).toFixed(2)}s`);
    assert.ok(Math.abs(timeAtConservativeSpeed - 14.903309) < 0.001,
        `bounded route takes ${timeAtConservativeSpeed.toFixed(6)}s at the unchanged ${conservativeSpeed}u/s budget speed`);

    const compiledSegments = route.slice(1).map((point, index) => [route[index], point]);
    assert.ok(compiledSegments.every(([from, to]) => pathClearOfCompiledGeometry(from, to, hullRadius)),
        'every route segment clears runtime-compiled walls, tunnels, hard obstacles, and foam');
    assert.ok(pathClearOfCompiledGeometry(switchPoint, turnEnd, hullRadius),
        'turn-motion interval clears runtime-compiled geometry');
    assert.ok(pathClearOfCompiledGeometry(turnMidpoint, cp05Entry, hullRadius + departureEnvelope),
        'bounded turn-departure envelope clears runtime-compiled geometry');
    assert.equal(portalPathConflictsWithTurnEnvelope(route, portalEndpoints,
        portalClearance, maxTurnDisplacement, turnGeometry), false,
    'the portal guard receives the same switch, turn, midpoint, and departure envelope as Desktop');

    for (const checkpoint of authoredRoute.checkpoints) {
        if (checkpoint.id === target.id || checkpoint.routeIndex < nextCheckpointIndex) continue;
        for (let index = 1; index < route.length; index += 1) {
            const gap = pointToSegmentDistance(
                { x: checkpoint.pos[0], y: checkpoint.pos[1], z: checkpoint.pos[2] },
                route[index - 1], route[index],
            );
            assert.ok(gap > checkpoint.radius + hullRadius + maxTurnDisplacement,
                `route stays clear of unordered checkpoint ${checkpoint.id}: ${gap.toFixed(2)}u`);
        }
    }
});

test('the pinned K19 CP06 route clears the runtime center wall, portals, order, and 16-second budget', () => {
    const start = { x: 234.50556532147786, y: 50.24773347592193, z: -8.317717820080201 };
    const hullRadius = 1.2;
    const maxTurnDisplacement = 9.368;
    const conservativeSpeed = 16;
    const mapScale = GAMEPLAY_CONFIG_DEFAULTS.ARENA.MAP_SCALE;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const collision = compileArenaCollision(map, mapScale);
    const [arenaWidth, arenaHeight, arenaDepth] = map.size.map((value) => value * mapScale);
    const runtimePortals = {
        runtimeConfig: k19Config,
        entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, PORTAL: GAMEPLAY_CONFIG_DEFAULTS.PORTAL },
        renderer: null,
        portalsEnabled: true,
        bounds: {
            minX: -arenaWidth / 2, maxX: arenaWidth / 2,
            minY: 0, maxY: arenaHeight,
            minZ: -arenaDepth / 2, maxZ: arenaDepth / 2,
        },
        checkCollision: (position, radius) => collision.checkCollisionFast(position, radius),
        portals: [],
        portalLayoutWarnings: [],
    };
    const portalEndpoints = map.portals.flatMap(({ a, b }) => [a, b].map((position, endpointIndex) => {
        const [x, y, z] = position;
        return resolvePortalPosition(
            { x: x * mapScale, y: y * mapScale, z: z * mapScale },
            endpointIndex === 0 ? 11 : 29,
            runtimePortals,
            runtimePortals.entityRuntimeConfig.PORTAL,
            { verticalOffsets: [0, 2.5, -2.5, 5, -5, 8, -8, 12, -12] },
        );
    }).filter(Boolean));
    const portalClearance = (Number(runtimePortals.entityRuntimeConfig.PORTAL.RADIUS) || 4) + hullRadius + 1;
    const authoredRoute = buildRouteFromParcours(resolveParcoursForPortalChain(map, k19Config), {
        positionScale: mapScale,
    });
    const target = authoredRoute.checkpoints.find(({ id }) => id === 'CP06');
    assert.ok(target, 'runtime parcours resolver supplies CP06');
    assert.equal(target.routeIndex, 5, 'the runtime route keeps CP06 at its authored position');
    assert.deepEqual(target.pos, [150, 36, 150], 'the candidate leaves authored CP06 position unchanged');
    assert.equal(authoredRoute.rules.bidirectionalCheckpoints, true,
        'the harness relies on natural progress-system collection of the authored sphere');
    assert.equal(authoredRoute.rules.maxSegmentTimeMs, 16_000,
        'the static route uses the unchanged runtime segment limit');
    const end = { x: target.pos[0], y: target.pos[1], z: target.pos[2] };
    const candidate = {
        routeId: K19_NEON_CP06_ROUTE_ID,
        waypoints: K19_NEON_CP06_ROUTE_WAYPOINTS,
    };
    assert.equal(K19_NEON_CP06_ROUTE_ID, 'neon-cp06-south-wall-overpass-v1',
        'the candidate has a stable harness route identity');
    assert.deepEqual(K19_NEON_CP06_ROUTE_WAYPOINTS, [{ x: 205, y: 80, z: 100 }],
        'the route stays east of the wall while high, then reaches CP06 beyond the wall south edge');
    assert.strictEqual(selectK19RouteCandidate([candidate], K19_NEON_CP06_ROUTE_ID,
        K19_NEON_CP06_ROUTE_WAYPOINTS), candidate);
    assert.equal(selectK19RouteCandidate([candidate], K19_NEON_CP06_ROUTE_ID,
        [{ x: 205, y: 81, z: 100 }]), null, 'pinned selection fails closed on a waypoint change');

    const waypoint = K19_NEON_CP06_ROUTE_WAYPOINTS[0];
    const incomingLength = distance(start, waypoint);
    const switchDistance = hullRadius * 2;
    const switchPoint = {
        x: waypoint.x + ((start.x - waypoint.x) / incomingLength) * switchDistance,
        y: waypoint.y + ((start.y - waypoint.y) / incomingLength) * switchDistance,
        z: waypoint.z + ((start.z - waypoint.z) / incomingLength) * switchDistance,
    };
    const approachDirection = {
        x: (waypoint.x - start.x) / incomingLength,
        y: (waypoint.y - start.y) / incomingLength,
        z: (waypoint.z - start.z) / incomingLength,
    };
    const turnEnd = {
        x: switchPoint.x + approachDirection.x * maxTurnDisplacement,
        y: switchPoint.y + approachDirection.y * maxTurnDisplacement,
        z: switchPoint.z + approachDirection.z * maxTurnDisplacement,
    };
    const turnMidpoint = {
        x: (switchPoint.x + turnEnd.x) / 2,
        y: (switchPoint.y + turnEnd.y) / 2,
        z: (switchPoint.z + turnEnd.z) / 2,
    };
    const sizeGroups = Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, 100]));
    const wallShape = buildArcadeHitboxShape(getVehicleModularConfig('ship5')?.parts, sizeGroups, {
        originScale: resolveArcadeWallHitboxScale('ship5'),
    });
    const departureEnvelope = maxTurnDisplacement / 2 + maximumOrientationDeviationEnvelope(
        wallShape.boundRadius, switchPoint, turnEnd, end,
    );
    const turnGeometry = [{ switchPoint, turnEnd, turnMidpoint, departureEnd: end, departureEnvelope }];
    const route = [start, waypoint, end];
    const pointToSegmentDistance = (point, from, to) => {
        const direction = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        const lengthSquared = direction.x ** 2 + direction.y ** 2 + direction.z ** 2;
        const amount = lengthSquared > 0 ? Math.max(0, Math.min(1, (
            (point.x - from.x) * direction.x
            + (point.y - from.y) * direction.y
            + (point.z - from.z) * direction.z
        ) / lengthSquared)) : 0;
        return distance(point, {
            x: from.x + direction.x * amount,
            y: from.y + direction.y * amount,
            z: from.z + direction.z * amount,
        });
    };
    const pathClearOfCompiledGeometry = (from, to, radius) => {
        const steps = Math.ceil(distance(from, to) / 0.25);
        for (let step = 0; step <= steps; step += 1) {
            const amount = steps === 0 ? 0 : step / steps;
            const point = {
                x: from.x + (to.x - from.x) * amount,
                y: from.y + (to.y - from.y) * amount,
                z: from.z + (to.z - from.z) * amount,
            };
            if (collision.checkCollisionFast(point, radius)) return false;
        }
        return true;
    };
    const startToSwitchPoint = distance(start, switchPoint);
    const turnEndToCheckpoint = distance(turnEnd, end);
    const boundedPathLength = startToSwitchPoint + maxTurnDisplacement + turnEndToCheckpoint;
    const timeAtConservativeSpeed = boundedPathLength / conservativeSpeed;

    assert.ok(Number.isFinite(departureEnvelope) && departureEnvelope >= 0);
    assert.ok(Math.abs(startToSwitchPoint - 113.740018) < 0.001,
        `Desktop switch begins after ${startToSwitchPoint.toFixed(6)}u`);
    assert.ok(Math.abs(turnEndToCheckpoint - 82.595651) < 0.001,
        `turn-end to CP06 is ${turnEndToCheckpoint.toFixed(6)}u`);
    assert.ok(Math.abs(boundedPathLength - 205.703669) < 0.001,
        `exact bounded route is ${boundedPathLength.toFixed(6)}u`);
    assert.ok(Math.abs(timeAtConservativeSpeed - 12.856479) < 0.001);
    assert.ok(timeAtConservativeSpeed < authoredRoute.rules.maxSegmentTimeMs / 1000,
        `the ${timeAtConservativeSpeed.toFixed(3)}s bound stays under 16s`);
    assert.ok(authoredRoute.rules.maxSegmentTimeMs / 1000 - timeAtConservativeSpeed > 3,
        'the route retains more than three seconds of segment margin');

    assert.ok(route.slice(1).every((point, index) =>
        pathClearOfCompiledGeometry(route[index], point, hullRadius)),
    'both route legs clear runtime-compiled wall, tunnel, obstacle, and foam geometry');
    assert.ok(pathClearOfCompiledGeometry(switchPoint, turnEnd, hullRadius),
        'the turn-motion interval clears compiled geometry');
    assert.ok(pathClearOfCompiledGeometry(turnMidpoint, end, hullRadius + departureEnvelope),
        'the departure envelope clears compiled geometry');
    assert.equal(portalPathConflictsWithTurnEnvelope(route, portalEndpoints,
        portalClearance, maxTurnDisplacement, turnGeometry), false,
    'resolved portals clear each leg and the bounded turn/departure');

    for (const checkpoint of authoredRoute.checkpoints) {
        if (checkpoint.id === target.id || checkpoint.routeIndex < target.routeIndex) continue;
        for (let index = 1; index < route.length; index += 1) {
            const gap = pointToSegmentDistance(
                { x: checkpoint.pos[0], y: checkpoint.pos[1], z: checkpoint.pos[2] },
                route[index - 1], route[index],
            );
            assert.ok(gap > checkpoint.radius + hullRadius + maxTurnDisplacement,
                `route stays clear of unordered checkpoint ${checkpoint.id}: ${gap.toFixed(2)}u`);
        }
    }
});
