import { getRuntimeMapScale } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { cloneJsonCompatibleValue } from '../../shared/utils/JsonClone.js';
import { MAP_SCHEMA_VERSION } from './MapSchemaConstants.js';
import { readAuthoredObstacleGLBFlags } from './MapSchemaGlbOps.js';
import { createMapDocument } from './MapSchemaMigrationOps.js';
import { asArray, asPositiveNumber } from './MapSchemaSanitizeOps.js';

// Reverse of toArenaMapDefinition for catalog maps made of boxes, tubes, portals, items, gates
// and spawns. An editor document holds 35 editor units per map unit: that keeps every catalog
// map above the 500-unit line from which the export divides by 35 again (CustomMapLoader).
export const EDITOR_UNITS_PER_MAP_UNIT = 35;

// Documents keep a millionth of an editor unit. It strips float noise such as 24.9 * 35 =
// 871.4999999999999 from the JSON and is far below what a collision or a spawn can resolve
// (3e-8 map units).
const EDITOR_PRECISION = 1e6;

// Not map content: names, picker flags and settings that only matter next to the world model.
const METADATA_KEYS = new Set([
    'name', 'description', 'hiddenFromMapPicker', 'glbColliderMode', 'glbAuthoredObstaclesCollisionOnly',
    'glbLoadDelayMs', 'glbLoadConcurrency', 'glbAnimationClock', 'excludedModes',
]);
// Keys this converter writes into the document (or reports itself while walking the lists).
const CONVERTED_KEYS = new Set([
    'size', 'obstacles', 'portals', 'portalLevels', 'items', 'gates', 'playerSpawn', 'botSpawns',
    'lighting', 'scaleAuthoredAnchors', 'itemSpawnMode', 'preferAuthoredPortals',
    'parcours', 'aircraft',
]);

function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toEditorUnits(value, factor) {
    return Math.round(finite(value) * factor * EDITOR_PRECISION) / EDITOR_PRECISION;
}

function toEditorVector(raw, factor) {
    const source = Array.isArray(raw) ? raw : [];
    return [toEditorUnits(source[0], factor), toEditorUnits(source[1], factor), toEditorUnits(source[2], factor)];
}

function isVector3(raw) {
    return Array.isArray(raw) && raw.length >= 3 && raw.slice(0, 3).every((value) => Number.isFinite(Number(value)));
}

function withId(target, id) {
    if (typeof id === 'string' && id.trim()) target.id = id.trim();
    return target;
}

// Anchors are written either as { x, y, z } or as { pos: [x, y, z] }, like Arena reads them.
function toEditorAnchor(entry, factor, id) {
    const pos = Array.isArray(entry?.pos) ? entry.pos : [];
    return withId({
        x: toEditorUnits(entry?.x ?? pos[0], factor),
        y: toEditorUnits(entry?.y ?? pos[1], factor),
        z: toEditorUnits(entry?.z ?? pos[2], factor),
    }, id);
}

function hasContent(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
}

// An editor map always scales its anchors, so the match multiplies the fog height by MAP_SCALE
// and divides the falloff by it. A catalog map without scaleAuthoredAnchors states both in world
// units; converted here they end up at the same world height. Fog distances stay world units.
function toEditorLighting(lighting, scaledAnchors, mapScale) {
    const copy = cloneJsonCompatibleValue(lighting);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return undefined;
    if (scaledAnchors || !copy.fog || typeof copy.fog !== 'object') return copy;
    if (copy.fog.height !== undefined) copy.fog.height = finite(copy.fog.height) / mapScale;
    if (copy.fog.heightFalloff !== undefined) copy.fog.heightFalloff = finite(copy.fog.heightFalloff) * mapScale;
    return copy;
}

function convertObstacles(obstacles, units, report) {
    const hardBlocks = [];
    const foamBlocks = [];
    const tunnels = [];
    for (const obstacle of asArray(obstacles)) {
        const shape = String(obstacle?.shape || '').toLowerCase();
        if (shape === 'tube') {
            if (!isVector3(obstacle.start) || !isVector3(obstacle.end) || !Number.isFinite(Number(obstacle.radius))) {
                report('obstacles.invalid');
                continue;
            }
            const [ax, ay, az] = toEditorVector(obstacle.start, units);
            const [bx, by, bz] = toEditorVector(obstacle.end, units);
            tunnels.push(withId({ ax, ay, az, bx, by, bz, radius: toEditorUnits(obstacle.radius, units) }, obstacle.id));
            continue;
        }
        if (shape) {
            // Solid beams and other shapes have no editor counterpart.
            report(`obstacles.${shape}`);
            continue;
        }
        if (!isVector3(obstacle?.pos) || !isVector3(obstacle?.size)) {
            report('obstacles.invalid');
            continue;
        }
        const [x, y, z] = toEditorVector(obstacle.pos, units);
        const [width, height, depth] = toEditorVector(obstacle.size, units);
        const block = withId({ x, y, z, width, height, depth, rotateY: finite(obstacle.rotateY) }, obstacle.id);
        if (obstacle.tunnel && typeof obstacle.tunnel === 'object') {
            block.tunnel = {
                radius: toEditorUnits(obstacle.tunnel.radius, units),
                axis: obstacle.tunnel.axis,
            };
        }
        Object.assign(block, readAuthoredObstacleGLBFlags(obstacle));
        (String(obstacle.kind || 'hard').toLowerCase() === 'foam' ? foamBlocks : hardBlocks).push(block);
    }
    return { hardBlocks, foamBlocks, tunnels };
}

function convertPortals(portals, units, report) {
    const result = [];
    for (const pair of asArray(portals)) {
        if (!isVector3(pair?.a) || !isVector3(pair?.b)) {
            report('portals.invalid');
            continue;
        }
        for (const side of ['A', 'B']) {
            const [x, y, z] = toEditorVector(pair[side === 'A' ? 'a' : 'b'], units);
            const entry = { x, y, z };
            if (Number.isInteger(pair.color) && pair.color >= 0 && pair.color <= 0xffffff) entry.color = pair.color;
            const model = pair[`model${side}`];
            if (typeof model === 'string' && model) entry.model = model;
            const rotation = pair[`rotation${side}`];
            if (Array.isArray(rotation)) {
                [entry.rotateX, entry.rotateY, entry.rotateZ] = [0, 1, 2].map((index) => finite(rotation[index]));
            }
            const forward = pair[`forward${side}`];
            if (Array.isArray(forward)) entry.forward = [...forward];
            result.push(entry);
        }
    }
    return result;
}

function convertItems(items, anchorUnits) {
    return asArray(items).map((entry) => {
        const item = toEditorAnchor(entry, anchorUnits, entry?.id);
        for (const key of ['type', 'pickupType', 'model']) {
            if (typeof entry?.[key] === 'string' && entry[key]) item[key] = entry[key];
        }
        if (Number.isFinite(Number(entry?.weight))) item.weight = Number(entry.weight);
        if (Number.isFinite(Number(entry?.rotateY))) item.rotateY = Number(entry.rotateY);
        return item;
    });
}

function convertGates(gates, units, report) {
    const result = [];
    for (const entry of asArray(gates)) {
        if (!isVector3(entry?.pos)) {
            report('gates.invalid');
            continue;
        }
        const type = entry.type === 'slingshot' ? 'slingshot' : 'boost';
        // The match falls back to 3.25 / 2.9 map units; the document default is in editor units.
        const radius = asPositiveNumber(entry.radius, type === 'boost' ? 3.25 : 2.9, 0.1);
        const gate = withId({ type, pos: toEditorVector(entry.pos, units), radius: toEditorUnits(radius, units) }, entry.id);
        for (const key of ['rot', 'forward', 'up']) {
            if (Array.isArray(entry[key])) gate[key] = [...entry[key]];
        }
        if (Number.isFinite(Number(entry.color))) gate.color = Number(entry.color);
        if (entry.params && typeof entry.params === 'object') gate.params = cloneJsonCompatibleValue(entry.params);
        result.push(gate);
    }
    return result;
}

function convertParcours(source, units) {
    if (!source || typeof source !== 'object') return undefined;
    const checkpoint = (entry, finish = false) => {
        if (!entry || typeof entry !== 'object') return undefined;
        return { ...cloneJsonCompatibleValue(entry), pos: toEditorVector(entry.pos, units),
            radius: toEditorUnits(asPositiveNumber(entry.radius, finish ? 4.2 : 3.5, 0.1), units) };
    };
    return { ...cloneJsonCompatibleValue(source),
        checkpoints: asArray(source.checkpoints).map(entry => checkpoint(entry)).filter(Boolean),
        ...(source.finish ? { finish: checkpoint(source.finish, true) } : {}),
        ...(Array.isArray(source.guidancePaths) ? { guidancePaths: source.guidancePaths.map(path => ({
            ...cloneJsonCompatibleValue(path), points: asArray(path.points).map(point => toEditorVector(point, units)),
        })) } : {}),
    };
}

/**
 * Editor document of a catalog map definition: the inverse of toArenaMapDefinition for boxes,
 * foam, tubes, portal pairs, items, gates, portal levels, spawns, size and lighting.
 *
 * Parcours IDs and graph references stay unchanged; only positions and radii scale. Everything
 * else (world models, map units, turrets, ...) is not carried over and is
 * listed in `skipped` as { key, count }, so a caller can warn instead of losing it silently.
 * Units: obstacles, gates, size and portals are map units x 35; spawns and items follow the
 * catalog map's own convention (map units with scaleAuthoredAnchors, world units divided by the
 * map scale without it), because the exported document always scales its anchors.
 *
 * @param {object} mapDefinition - Catalog map definition (an entry of the map preset catalog).
 * @param {{ mapScale?: number }} [options] - Runtime MAP_SCALE (defaults to the configured one).
 * @returns {{ document: object, skipped: { key: string, count: number }[], warnings: string[] }}
 */
export function fromArenaMapDefinition(mapDefinition, options = {}) {
    if (!mapDefinition || typeof mapDefinition !== 'object' || Array.isArray(mapDefinition)) {
        throw new Error('Map definition must be an object.');
    }
    if (!isVector3(mapDefinition.size)) {
        throw new Error('Map definition needs a size of three numbers.');
    }

    const units = EDITOR_UNITS_PER_MAP_UNIT;
    const mapScale = asPositiveNumber(options.mapScale, getRuntimeMapScale(1), 0.0001);
    const scaledAnchors = mapDefinition.scaleAuthoredAnchors === true;
    const anchorUnits = scaledAnchors ? units : units / mapScale;
    const warnings = [];
    const skippedCounts = new Map();
    const report = (key, count = 1) => skippedCounts.set(key, (skippedCounts.get(key) || 0) + count);

    const { hardBlocks, foamBlocks, tunnels } = convertObstacles(mapDefinition.obstacles, units, report);
    const items = convertItems(mapDefinition.items, anchorUnits);
    const [width, height, depth] = toEditorVector(mapDefinition.size, units);
    if (Math.max(width, height, depth) < 500) {
        warnings.push('Map is smaller than 500 editor units; the editor export would not divide it by 35 again.');
    }

    const raw = {
        schemaVersion: MAP_SCHEMA_VERSION,
        arenaSize: { width, height, depth },
        hardBlocks,
        foamBlocks,
        tunnels,
        portals: convertPortals(mapDefinition.portals, units, report),
        portalLevels: asArray(mapDefinition.portalLevels).map((level) => toEditorUnits(level, units)),
        gates: convertGates(mapDefinition.gates, units, report),
        items,
        aircraft: asArray(mapDefinition.aircraft).map(entry => ({ ...toEditorAnchor(entry, anchorUnits, entry.id),
            jetId: entry.jetId, scale: toEditorUnits(asPositiveNumber(entry.scale, 1, 0.01), anchorUnits), rotateY: finite(entry.rotateY) })),
        botSpawns: asArray(mapDefinition.botSpawns).map((spawn, index) => toEditorAnchor(spawn, anchorUnits, `spawn_bot_${index + 1}`)),
    };
    if (mapDefinition.playerSpawn) raw.playerSpawn = toEditorAnchor(mapDefinition.playerSpawn, anchorUnits, 'spawn_player');
    const parcours = convertParcours(mapDefinition.parcours, units);
    if (parcours) raw.parcours = parcours;
    if (mapDefinition.glbAnimationClock) raw.glbAnimationClock = cloneJsonCompatibleValue(mapDefinition.glbAnimationClock);
    if (typeof mapDefinition.glbAuthoredObstaclesCollisionOnly === 'boolean') raw.glbAuthoredObstaclesCollisionOnly = mapDefinition.glbAuthoredObstaclesCollisionOnly;
    if (typeof mapDefinition.preferAuthoredPortals === 'boolean') raw.preferAuthoredPortals = mapDefinition.preferAuthoredPortals;
    // Without a stated mode the match fills anchors first and then spawns randomly (Powerup.js).
    const itemSpawnMode = mapDefinition.itemSpawnMode || (items.length > 0 ? 'hybrid' : undefined);
    if (itemSpawnMode) raw.itemSpawnMode = itemSpawnMode;

    const document = createMapDocument(raw, { warnings });
    // The schema may not know lighting yet; it is stored as the preset states it either way.
    const lighting = toEditorLighting(mapDefinition.lighting, scaledAnchors, mapScale);
    if (lighting) document.lighting = lighting;

    for (const [key, value] of Object.entries(mapDefinition)) {
        if (CONVERTED_KEYS.has(key) || METADATA_KEYS.has(key) || !hasContent(value)) continue;
        report(key, Array.isArray(value) ? value.length : 1);
    }

    return {
        document,
        skipped: [...skippedCounts].map(([key, count]) => ({ key, count })),
        warnings,
    };
}
