// Geometry behind tests/map-anchor-guard.contract.test.mjs: where a catalog map really puts its
// spawns, items, portals, gates and lights once the arena has scaled them, and what is wrong there.
//
// Coordinate rule, copied from the arena (not invented here):
//  - obstacles, portals, gates and the arena size always grow by MAP_SCALE
//    (ArenaGeometryCompilePipeline.compileObstacleStage, PortalLayoutBuilder, ArenaBuilder)
//  - player spawn, bot spawns, item anchors, lights and their `distance` grow only when the map
//    says `scaleAuthoredAnchors: true` (Arena._cacheAuthoredMapAnchors, AuthoredMapLightRig.build)
//
// What the checks can and cannot see: solid geometry comes from listCompiledBoxObstacles, the same
// list the parcours ring guard uses, so on maps with GLB scene collision only boxes marked
// compileWithGlb count. The scene geometry itself is not visible here. On those maps the checks
// "in-solid" and "free-directions" therefore only prove what the authored boxes say; the lights
// and bounds checks are exact. Tubes and beams (start/end shapes) are not tested as solids.
// Portals are reported even though the arena nudges an authored portal up to 12 world units
// vertically out of a wall: the nudge is a rescue, not a placement.

import { listCompiledBoxObstacles, RING_CLEARANCE_WORLD_RADIUS } from '../../scripts/parcours-ring-clearance.mjs';
import { normalizeMapLightSources } from '../../src/shared/contracts/MapLightSourcesContract.js';
import { getPickupDefinition, normalizePickupType } from '../../src/shared/contracts/PickupRegistryContract.js';

export const CHECKS = Object.freeze([
    'anchor-format',
    'bounds',
    'in-solid',
    'free-directions',
    'item-type',
    'item-duplicate',
    'light-reach',
]);

// A ship that can only turn into 2 of 6 axis directions is boxed in. Eight world units is five ship
// diameters (PLAYER.HITBOX_RADIUS 0.8): enough room to react to the first frame of a round.
export const FREE_DISTANCE = 8;
export const MIN_FREE_DIRECTIONS = 3;
export const SHIP_CLEARANCE = RING_CLEARANCE_WORLD_RADIUS;
// Two items closer than this are one item in practice (the pickup radius is larger).
export const ITEM_DUPLICATE_DISTANCE = 1;

const AXIS_DIRECTIONS = Object.freeze([
    ['+x', [1, 0, 0]], ['-x', [-1, 0, 0]],
    ['+y', [0, 1, 0]], ['-y', [0, -1, 0]],
    ['+z', [0, 0, 1]], ['-z', [0, 0, -1]],
]);
const AXIS_INDEX = Object.freeze({ x: 0, y: 1, z: 2 });

const fmt = (point) => `(${point.map((value) => Math.round(value * 10) / 10).join(', ')})`;
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function scaleBox(obstacle, mapScale, index) {
    return {
        label: `obstacles[${obstacle.id || index}]${obstacle.kind === 'foam' ? ' (foam)' : ''}`,
        center: obstacle.pos.map((value) => value * mapScale),
        half: obstacle.size.map((value) => (value * mapScale) / 2),
        rotateY: Number(obstacle.rotateY) || 0,
        bore: obstacle.boreSpec
            ? { radius: Number(obstacle.boreSpec.radius) * mapScale, axis: AXIS_INDEX[obstacle.boreSpec.axis] ?? 2 }
            : null,
    };
}

// listCompiledBoxObstacles drops tunnel boxes, but a tunnel box is a wall with a hole: solid
// everywhere except the bore. Handing it the tunnels as plain boxes keeps its one rule for which
// boxes the arena compiles; the bore is re-applied in isSolid.
function listSolidBoxes(map, mapScale) {
    const obstacles = Array.isArray(map?.obstacles) ? map.obstacles : [];
    const indexOf = new Map(obstacles.map((obstacle, index) => [obstacle, index]));
    const plain = obstacles.map((obstacle) => (
        obstacle?.tunnel ? { ...obstacle, tunnel: undefined, boreSpec: obstacle.tunnel, sourceIndex: indexOf.get(obstacle) } : { ...obstacle, sourceIndex: indexOf.get(obstacle) }
    ));
    return listCompiledBoxObstacles({ ...map, obstacles: plain }).map((obstacle) => scaleBox(obstacle, mapScale, obstacle.sourceIndex));
}

function toLocal(point, box) {
    const dx = point[0] - box.center[0];
    const dy = point[1] - box.center[1];
    const dz = point[2] - box.center[2];
    if (box.rotateY === 0) return [dx, dy, dz];
    // The arena builds the box with Matrix4.makeRotationY(rotateY); this is its inverse.
    const cos = Math.cos(box.rotateY);
    const sin = Math.sin(box.rotateY);
    return [dx * cos - dz * sin, dy, dx * sin + dz * cos];
}

// margin 0 = the point lies inside the box. A positive margin grows the box (and shrinks the bore)
// by a ship radius, so "free" means a ship fits, not just a point.
export function findSolidAt(point, boxes, margin = 0) {
    for (const box of boxes) {
        const local = toLocal(point, box);
        if (!local.every((value, axis) => Math.abs(value) < box.half[axis] + margin)) continue;
        if (box.bore) {
            const perpendicular = [0, 1, 2].filter((axis) => axis !== box.bore.axis).map((axis) => local[axis]);
            if (Math.hypot(...perpendicular) <= box.bore.radius - margin) continue;
        }
        return box;
    }
    return null;
}

function resolveWorldSize(map, mapScale, { initial = false } = {}) {
    const stageSize = initial ? map?.expansion?.stages?.[0]?.size : null;
    const size = Array.isArray(stageSize) && stageSize.length >= 3 ? stageSize : map.size;
    return size.map((value) => value * mapScale);
}

function insideWorld(point, worldSize) {
    return Math.abs(point[0]) <= worldSize[0] / 2
        && point[1] >= 0 && point[1] <= worldSize[1]
        && Math.abs(point[2]) <= worldSize[2] / 2;
}

function outsideDescription(point, worldSize) {
    const axes = [];
    if (Math.abs(point[0]) > worldSize[0] / 2) axes.push(`x beyond ±${worldSize[0] / 2}`);
    if (point[1] < 0 || point[1] > worldSize[1]) axes.push(`y outside 0..${worldSize[1]}`);
    if (Math.abs(point[2]) > worldSize[2] / 2) axes.push(`z beyond ±${worldSize[2] / 2}`);
    return axes.join(', ');
}

function countFreeDirections(point, boxes, worldSize) {
    const free = [];
    const blocked = [];
    for (const [name, direction] of AXIS_DIRECTIONS) {
        let hit = null;
        for (let distance = 1; distance <= FREE_DISTANCE && !hit; distance += 1) {
            const sample = point.map((value, axis) => value + direction[axis] * distance);
            const solid = findSolidAt(sample, boxes, SHIP_CLEARANCE);
            if (solid) hit = solid.label;
            else if (Math.abs(sample[0]) > worldSize[0] / 2 - SHIP_CLEARANCE
                || sample[1] < SHIP_CLEARANCE || sample[1] > worldSize[1] - SHIP_CLEARANCE
                || Math.abs(sample[2]) > worldSize[2] / 2 - SHIP_CLEARANCE) hit = 'arena wall';
        }
        (hit ? blocked : free).push(hit ? `${name} ${hit}` : name);
    }
    return { free, blocked };
}

function distanceToBox(point, center, half) {
    return Math.hypot(...point.map((value, axis) => Math.max(0, Math.abs(value - center[axis]) - half[axis])));
}

function distanceToSegment(point, start, end) {
    const segment = end.map((value, axis) => value - start[axis]);
    const lengthSquared = segment.reduce((sum, value) => sum + value * value, 0) || 1;
    const t = Math.min(1, Math.max(0, point.reduce((sum, value, axis) => sum + (value - start[axis]) * segment[axis], 0) / lengthSquared));
    return Math.hypot(...point.map((value, axis) => value - (start[axis] + segment[axis] * t)));
}

// Anything a light could be lighting: every authored obstacle (tunnels, tubes and beams included,
// this is about sight, not collision) and every GLB model, which is only known by its position and
// roughly by targetSize.
function listLightTargets(map, mapScale) {
    const targets = [];
    for (const obstacle of Array.isArray(map?.obstacles) ? map.obstacles : []) {
        if (Array.isArray(obstacle?.pos) && Array.isArray(obstacle?.size)) {
            targets.push((point) => distanceToBox(point, obstacle.pos.map((v) => v * mapScale), obstacle.size.map((v) => (v * mapScale) / 2)));
        } else if (Array.isArray(obstacle?.start) && Array.isArray(obstacle?.end)) {
            const radius = (Number(obstacle.radius) || 0) * mapScale;
            const start = obstacle.start.map((v) => v * mapScale);
            const end = obstacle.end.map((v) => v * mapScale);
            targets.push((point) => Math.max(0, distanceToSegment(point, start, end) - radius));
        }
    }
    const models = Array.isArray(map?.glbModels) ? map.glbModels : [];
    for (const model of models) {
        const position = Array.isArray(model?.position) ? model.position : [0, 0, 0];
        const center = position.map((value) => value * mapScale);
        const radius = ((Number(model?.targetSize) || 0) * mapScale) / 2;
        targets.push((point) => Math.max(0, Math.hypot(...point.map((value, axis) => value - center[axis])) - radius));
    }
    if (typeof map?.glbModel === 'string' && map.glbModel) targets.push((point) => Math.hypot(...point));
    return targets;
}

function readAnchorPoint(entry, requireY) {
    if (!entry || typeof entry !== 'object') return null;
    // Same reading as Arena._cacheAuthoredMapAnchors: x/y/z first, pos: [x, y, z] as the fallback.
    const pos = Array.isArray(entry.pos) ? entry.pos : [];
    const point = { x: entry.x ?? pos[0], y: entry.y ?? pos[1], z: entry.z ?? pos[2] };
    const keys = requireY ? ['x', 'y', 'z'] : ['x', 'z'];
    return keys.every((key) => isNumber(point[key])) ? [point.x, point.y ?? 0, point.z] : null;
}

/**
 * @param {string} mapKey
 * @param {any} map a catalog preset
 * @param {number} mapScale CONFIG.ARENA.MAP_SCALE
 * @returns {{ map: string, check: string, point: string, reason: string }[]}
 */
export function analyzeMapAnchors(mapKey, map, mapScale) {
    const violations = [];
    const add = (check, point, reason) => violations.push({ map: mapKey, check, point, reason });
    const anchorScale = map?.scaleAuthoredAnchors === true ? mapScale : 1;
    const worldSize = resolveWorldSize(map, mapScale);
    const spawnWorldSize = resolveWorldSize(map, mapScale, { initial: true });
    const boxes = listSolidBoxes(map, mapScale);
    const label = (entry, index, fallback) => (typeof entry?.id === 'string' && entry.id ? entry.id : `${fallback}${index}`);

    // Shared by every kind of placed point: bounds, then solid geometry.
    const checkPlacement = (point, world, size, name, { solid = true } = {}) => {
        if (!insideWorld(world, size)) {
            add('bounds', point, `${fmt(world)} lies outside the arena: ${outsideDescription(world, size)}`);
            return false;
        }
        if (solid) {
            const box = findSolidAt(world, boxes);
            if (box) add('in-solid', point, `${name} ${fmt(world)} sits inside ${box.label}`);
            return !box;
        }
        return true;
    };

    const checkSpawn = (entry, point) => {
        const local = readAnchorPoint(entry, false);
        if (!local) {
            add('anchor-format', point, 'spawn has no numeric x/z; the game cannot read it');
            return;
        }
        const world = [local[0] * anchorScale, local[1] * anchorScale, local[2] * anchorScale];
        if (!checkPlacement(point, world, spawnWorldSize, 'spawn')) return;
        const { free, blocked } = countFreeDirections(world, boxes, worldSize);
        if (free.length < MIN_FREE_DIRECTIONS) {
            add('free-directions', point, `only ${free.length}/6 axis directions free for ${FREE_DISTANCE} units at ${fmt(world)}; blocked: ${blocked.join(', ')}`);
        }
    };

    if (map?.playerSpawn) checkSpawn(map.playerSpawn, 'playerSpawn');
    (Array.isArray(map?.botSpawns) ? map.botSpawns : []).forEach((entry, index) => checkSpawn(entry, `botSpawns[${index}]`));

    const itemWorlds = [];
    (Array.isArray(map?.items) ? map.items : []).forEach((entry, index) => {
        const point = `items[${label(entry, index, '#')}]`;
        const local = readAnchorPoint(entry, true);
        if (!local) {
            const written = Array.isArray(entry?.pos) ? ` pos ${JSON.stringify(entry.pos)}` : '';
            add('anchor-format', point, `item has no numeric x/y/z or pos[3]${written}; the game reads it at the origin`);
            return;
        }
        // The same three keys, in the same order, as Powerup.resolveAuthoredPickupType. An anchor
        // without any of them is a fixed place for a random type; only a named unknown type is wrong.
        const named = [entry.pickupType, entry.type, entry.model].filter((candidate) => candidate !== undefined);
        const known = named
            .map((candidate) => normalizePickupType(candidate))
            .some((type) => type && getPickupDefinition(type));
        if (named.length > 0 && !known) add('item-type', point, `no known pickup type in pickupType=${JSON.stringify(entry.pickupType)} type=${JSON.stringify(entry.type)}`);
        const world = local.map((value) => value * anchorScale);
        checkPlacement(point, world, worldSize, 'item');
        const twin = itemWorlds.find((other) => Math.hypot(...other.world.map((value, axis) => value - world[axis])) < ITEM_DUPLICATE_DISTANCE);
        if (twin) add('item-duplicate', point, `same place as ${twin.point} at ${fmt(world)}`);
        itemWorlds.push({ point, world });
    });

    (Array.isArray(map?.portals) ? map.portals : []).forEach((portal, index) => {
        for (const end of ['a', 'b']) {
            if (!Array.isArray(portal?.[end])) continue;
            const world = portal[end].map((value) => value * mapScale);
            checkPlacement(`portals[${index}].${end}`, world, worldSize, 'portal');
        }
    });

    (Array.isArray(map?.gates) ? map.gates : []).forEach((gate, index) => {
        if (!Array.isArray(gate?.pos)) return;
        checkPlacement(`gates[${label(gate, index, '#')}]`, gate.pos.map((value) => value * mapScale), worldSize, 'gate');
    });

    const targets = listLightTargets(map, mapScale);
    normalizeMapLightSources(map?.lights).forEach((light, index) => {
        const point = `lights[${label(light, index, '#')}]`;
        const world = [light.x * anchorScale, light.y * anchorScale, light.z * anchorScale];
        const reach = light.distance * anchorScale;
        checkPlacement(point, world, worldSize, 'light', { solid: false });
        const nearest = targets.reduce((best, distanceTo) => Math.min(best, distanceTo(world)), Infinity);
        if (nearest > reach) {
            add('light-reach', point, `nothing within its distance ${Math.round(reach)} at ${fmt(world)}; nearest obstacle or model is ${Number.isFinite(nearest) ? Math.round(nearest) : 'none'} away`);
        }
    });

    return violations;
}

export const violationKey = (violation) => `${violation.map} | ${violation.check} | ${violation.point}`;
