import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Vector3 } from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import {
    NEON_CARNIVAL_MAP,
    NEON_CARNIVAL_ROUTE_ANCHORS,
    NEON_CARNIVAL_SETPIECES,
} from '../src/core/config/maps/presets/neon_carnival.js';
import { ARCADE_SECTOR_CATALOG } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { refreshDynamicMeshCollider, sphereIntersectsStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { SECTOR_MAP_POOLS } from '../src/state/arcade/ArcadeMapProgression.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const map = NEON_CARNIVAL_MAP.neon_carnival;
const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
const SPEED = CONFIG_SECTIONS.PLAYER.SPEED;
const BEAT_SECONDS = 3;
// Every loop is 1, 2 or 4 beats long, so twelve seconds cover each of them a whole number of times.
const CYCLE_SECONDS = 12;
const SAMPLE_STEP_SECONDS = 1 / 15;
// The player's collision sphere in world units, as the parcours route test uses it.
const PLAYER_RADIUS = 1.1;
const ASSET_ROOT = path.resolve('assets/maps/neon_carnival');

const RACE_MODELS = map.glbModels.filter((model) => model.collision !== false);

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    const jsonLength = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDurationSeconds(document) {
    return Math.max(...document.animations[0].samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

const toWorld = (point) => point.map((value) => value * MAP_SCALE);

let placedPromise = null;
/** The race models placed exactly as the arena places them, with materials stripped. */
function loadPlacedRace() {
    placedPromise ??= loadGLBMapCollection(RACE_MODELS, {
        loader: geometryOnlyGlbLoader,
        placementScale: MAP_SCALE,
        colliderMode: map.glbColliderMode,
        animationClock: map.glbAnimationClock,
        requireComplete: true,
    }).then((result) => {
        const driver = new GlbAnimationDriver();
        driver.setTracks(result.animationTracks);
        const box = new Vector3();
        return {
            result,
            driver,
            /** Poses every ride at a match time and refreshes the moving colliders. */
            poseAt(seconds) {
                driver.setElapsedSeconds(seconds);
                driver.advance(0);
                result.scene.updateMatrixWorld(true);
                for (const entry of result.colliders) {
                    if (entry.dynamic) refreshDynamicMeshCollider(entry.meshCollider, entry.box);
                }
            },
            /** Names of every surface a sphere of the player's size touches at `point`. */
            hits(point, radius = PLAYER_RADIUS, { dynamicOnly = false } = {}) {
                box.set(point[0], point[1], point[2]);
                return result.colliders
                    .filter((entry) => !dynamicOnly || entry.dynamic)
                    .filter((entry) => sphereIntersectsStaticMeshCollider(entry.meshCollider, box, radius))
                    .map((entry) => `${entry.modelId}:${entry.sourceName}`);
            },
        };
    });
    return placedPromise;
}

/** Points every half world unit along a segment given in authored units. */
function sampleSegment(from, to) {
    const a = toWorld(from);
    const b = toWorld(to);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(length / 0.5));
    return Array.from({ length: steps + 1 }, (_, index) => a.map((value, axis) => value + (b[axis] - value) * (index / steps)));
}

/** The flight line through a ride: `reach` authored units either side of its anchor. */
function corridorThrough(anchor, heading, reach) {
    const [dx, dz] = heading;
    return sampleSegment(
        [anchor[0] - dx * reach, anchor[1], anchor[2] - dz * reach],
        [anchor[0] + dx * reach, anchor[1], anchor[2] + dz * reach],
    );
}

const CYCLE_SAMPLES = Math.round(CYCLE_SECONDS / SAMPLE_STEP_SECONDS);

/** For every sample time of the cycle, which of the points a player-sized sphere would touch. */
function blockedTable(placed, points) {
    const table = [];
    for (let sample = 0; sample < CYCLE_SAMPLES; sample += 1) {
        placed.poseAt(sample * SAMPLE_STEP_SECONDS);
        table.push(points.map((point) => placed.hits(point).length > 0));
    }
    return table;
}

/** Share of the cycle during which the whole line is blocked or free at one instant. */
function fractionOfCycleBlocked(placed, points) {
    return blockedTable(placed, points).filter((row) => row.some(Boolean)).length / CYCLE_SAMPLES;
}

/**
 * Share of entry times at which a player flying the line at base speed runs into something.
 * Each point is read at the moment the flight actually reaches it, so a ride that crosses the
 * line twice is judged the way it is flown, not as a wall that has to be clear end to end.
 */
function fractionOfEntriesBlocked(placed, points) {
    const table = blockedTable(placed, points);
    const lagSamples = points.map((point) => {
        const distance = Math.hypot(point[0] - points[0][0], point[1] - points[0][1], point[2] - points[0][2]);
        return Math.round((distance / SPEED) / SAMPLE_STEP_SECONDS);
    });
    let blocked = 0;
    for (let entry = 0; entry < CYCLE_SAMPLES; entry += 1) {
        if (points.some((_, index) => table[(entry + lagSamples[index]) % CYCLE_SAMPLES][index])) blocked += 1;
    }
    return blocked / CYCLE_SAMPLES;
}

test('Neon-Jahrmarkt is registered in the catalog, the parcours picker and both arcade pools', () => {
    assert.equal(MAP_PRESET_CATALOG.neon_carnival, map);
    assert.equal(MAP_PRESETS_BASE.neon_carnival, map);
    assert.equal(resolveMapPickerCollection('neon_carnival').id, 'parcours');
    assert.ok(SECTOR_MAP_POOLS.sector_parcours.includes('neon_carnival'));
    assert.ok(ARCADE_SECTOR_CATALOG.find((entry) => entry.id === 'sector_parcours').mapPool.includes('neon_carnival'));
    assert.equal(map.glbColliderMode, 'scene', 'the drawn rides are the collision');
    assert.ok(map.obstacles.every((obstacle) => obstacle.compileWithGlb === true),
        'scene collision would silently drop an authored box without compileWithGlb');
});

test('every ride ships an editable source and one beat-aligned loop under budget', () => {
    let totalBytes = 0;
    for (const spec of Object.values(NEON_CARNIVAL_SETPIECES)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${spec.file}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${spec.file}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${spec.file} keeps its Blender source`);
        const bytes = statSync(glbPath).size;
        assert.ok(bytes < 512 * 1024, `${spec.file} stays below 512 KiB (${bytes})`);
        totalBytes += bytes;

        const document = readGlbJson(glbPath);
        assert.equal(document.animations?.length, 1, `${spec.file} exports exactly one clip`);
        assert.equal(document.animations[0].name, spec.clip);
        const duration = animationDurationSeconds(document);
        const beats = duration / BEAT_SECONDS;
        assert.ok(Math.abs(beats - Math.round(beats)) < 1 / 90 && Math.round(beats) >= 1,
            `${spec.file} loops on whole beats (got ${duration}s)`);
        assert.equal(CYCLE_SECONDS % Math.round(duration), 0, `${spec.file} repeats within the test cycle`);
        assert.ok(document.nodes.some((node) => node.name === 'Anchor_Pass'), `${spec.file} marks its flight line`);
        assert.equal((document.extensionsUsed || []).filter((name) => /draco|meshopt|basisu|ktx/i.test(name)).length, 0);
    }
    assert.ok(totalBytes < 3 * 1024 * 1024, `the whole pack stays below 3 MiB (${totalBytes})`);
});

test('every ride anchor lands on the authored route once the arena has placed it', async () => {
    const placed = await loadPlacedRace();
    placed.poseAt(0);
    const expected = {
        'neon-carnival-marquee': NEON_CARNIVAL_ROUTE_ANCHORS.marquee,
        'neon-carnival-clown': NEON_CARNIVAL_ROUTE_ANCHORS.clown,
        'neon-carnival-hammer-one': NEON_CARNIVAL_ROUTE_ANCHORS.hammerOne,
        'neon-carnival-hammer-two': NEON_CARNIVAL_ROUTE_ANCHORS.hammerTwo,
        'neon-carnival-hammer-three': NEON_CARNIVAL_ROUTE_ANCHORS.hammerThree,
        'neon-carnival-ducks': NEON_CARNIVAL_ROUTE_ANCHORS.ducks,
        'neon-carnival-swing': NEON_CARNIVAL_ROUTE_ANCHORS.swing,
        'neon-carnival-wheel': NEON_CARNIVAL_ROUTE_ANCHORS.wheel,
        'neon-carnival-loop': NEON_CARNIVAL_ROUTE_ANCHORS.loop,
        'neon-carnival-carousel': NEON_CARNIVAL_ROUTE_ANCHORS.carousel,
        'neon-carnival-tower': NEON_CARNIVAL_ROUTE_ANCHORS.tower,
        'neon-carnival-big-top': NEON_CARNIVAL_ROUTE_ANCHORS.bigTop,
    };
    const world = new Vector3();
    for (const [modelId, anchor] of Object.entries(expected)) {
        const slot = placed.result.scene.getObjectByName(`glb-slot-${modelId}`);
        assert.ok(slot, `${modelId} is placed`);
        const marker = slot.getObjectByName('Anchor_Pass');
        marker.getWorldPosition(world);
        const authored = world.toArray().map((value) => value / MAP_SCALE);
        for (let axis = 0; axis < 3; axis += 1) {
            assert.ok(Math.abs(authored[axis] - anchor[axis]) < 0.01,
                `${modelId} anchor axis ${axis}: expected ${anchor[axis]}, got ${authored[axis].toFixed(3)}`);
        }
    }
    const finish = placed.result.scene.getObjectByName('glb-slot-neon-carnival-big-top').getObjectByName('Anchor_Finish');
    finish.getWorldPosition(world);
    assert.deepEqual(world.toArray().map((value) => Math.round(value / MAP_SCALE * 100) / 100), map.parcours.finish.pos,
        'the finish ring hangs where the tent keeps its ring');
});

test('the authored line between checkpoints never cuts through a standing structure', async () => {
    const placed = await loadPlacedRace();
    placed.poseAt(0);
    const cp = Object.fromEntries(map.parcours.checkpoints.map((entry) => [entry.id, entry.pos]));
    const spawn = [map.playerSpawn.x, map.playerSpawn.y, map.playerSpawn.z];
    const A = NEON_CARNIVAL_ROUTE_ANCHORS;
    // The line a player follows. It runs through the rides' anchors, which is where the rides
    // leave their opening, and above the big top before the dive.
    const aboveCrown = [A.bigTop[0], A.bigTop[1] + 14, A.bigTop[2]];
    const lines = {
        midway: [spawn, cp.CP01, A.marquee, A.clown, cp.CP02, A.hammerOne, A.hammerTwo, A.hammerThree, cp.CP03],
        gallery: [cp.CP03, A.ducks, cp.CP04_DUCKS, cp.CP05],
        swing: [cp.CP03, A.swing, cp.CP04_SWING, cp.CP05],
        rides: [cp.CP05, A.wheel, cp.CP06, A.loop, cp.CP07, cp.CP08],
        carousel: [cp.CP08, A.carousel, cp.CP09_RIDE, cp.CP10],
        roof: [cp.CP08, cp.CP09_ROOF, cp.CP10],
        finale: [cp.CP10, A.tower, cp.CP11, aboveCrown, map.parcours.finish.pos],
    };
    for (const [name, points] of Object.entries(lines)) {
        for (let index = 1; index < points.length; index += 1) {
            for (const point of sampleSegment(points[index - 1], points[index])) {
                const statics = placed.hits(point).filter((hit) => !placed.result.colliders.find(
                    (entry) => `${entry.modelId}:${entry.sourceName}` === hit && entry.dynamic,
                ));
                assert.deepEqual(statics, [], `${name} leg ${index} at ${point.map((v) => (v / MAP_SCALE).toFixed(1))}`);
            }
        }
    }
});

test('checkpoint rings never sit inside a ride, not even while it moves', async () => {
    const placed = await loadPlacedRace();
    const rings = [...map.parcours.checkpoints, map.parcours.finish];
    for (let time = 0; time < CYCLE_SECONDS; time += SAMPLE_STEP_SECONDS) {
        placed.poseAt(time);
        for (const ring of rings) {
            assert.deepEqual(placed.hits(toWorld(ring.pos)), [], `${ring.id} is clear at ${time.toFixed(2)}s`);
        }
    }
});

test('each hazard really closes its flight line and opens it again every cycle', async () => {
    const placed = await loadPlacedRace();
    const A = NEON_CARNIVAL_ROUTE_ANCHORS;
    // [anchor, heading, reach in authored units, least and most share of blocked entries]. The
    // band is the level design: every ride has to matter, none may be a coin toss.
    const hazards = {
        clown: [A.clown, [1, 0], 2, 0.25, 0.65],
        hammerOne: [A.hammerOne, [1, 0], 1, 0.1, 0.5],
        ducks: [A.ducks, [1, 0], 4, 0.2, 0.75],
        swing: [A.swing, [1, 0], 12, 0.15, 0.75],
        wheel: [A.wheel, [1, 0], 3, 0.2, 0.7],
        carousel: [A.carousel, [0, 1], 9, 0.2, 0.8],
        tower: [A.tower, [-1, 0], 1, 0.08, 0.5],
    };
    for (const [name, [anchor, heading, reach, least, most]] of Object.entries(hazards)) {
        const share = fractionOfEntriesBlocked(placed, corridorThrough(anchor, heading, reach));
        assert.ok(share >= least && share <= most,
            `${name} stops ${(share * 100).toFixed(0)}% of base-speed flights, expected ${least * 100}-${most * 100}%`);
    }
    // The crown: a vertical dive through the petals.
    const crown = sampleSegment([A.bigTop[0], A.bigTop[1] + 8, A.bigTop[2]], [A.bigTop[0], A.bigTop[1] - 4, A.bigTop[2]]);
    const crownShare = fractionOfCycleBlocked(placed, crown);
    assert.ok(crownShare >= 0.2 && crownShare <= 0.6, `the crown is shut ${(crownShare * 100).toFixed(0)}% of the cycle`);
    // Showpieces are never in the way: the marquee's opening and the loop's centre stay free.
    assert.equal(fractionOfCycleBlocked(placed, corridorThrough(A.marquee, [1, 0], 5)), 0, 'the marquee is a free gate');
    assert.equal(fractionOfCycleBlocked(placed, corridorThrough(A.loop, [1, 0], 4)), 0, 'the loop centre is free');
});

test('one entry timing carries a base-speed flight through all three hammers', async () => {
    const placed = await loadPlacedRace();
    const A = NEON_CARNIVAL_ROUTE_ANCHORS;
    const hammers = [A.hammerOne, A.hammerTwo, A.hammerThree];
    const secondsPerAuthoredUnit = MAP_SCALE / SPEED;
    const clearEntries = [];
    for (let entry = 0; entry < BEAT_SECONDS; entry += 0.05) {
        const clear = hammers.every((anchor) => {
            const arrival = entry + (anchor[0] - hammers[0][0]) * secondsPerAuthoredUnit;
            placed.poseAt(arrival);
            return corridorThrough(anchor, [1, 0], 1).every((point) => placed.hits(point, PLAYER_RADIUS, { dynamicOnly: true }).length === 0);
        });
        if (clear) clearEntries.push(entry);
    }
    // A player who meets the first hammer open meets the others open too, for over a second.
    assert.ok(clearEntries.length * 0.05 >= 1.2, `only ${(clearEntries.length * 0.05).toFixed(2)}s of each beat lets a flight through`);
});

test('the route runs two branches and every segment fits the segment time limit', () => {
    const route = buildRouteFromParcours(map.parcours);
    assert.equal(route.routeId, 'neon_carnival_v1');
    assert.equal(route.totalCheckpoints, 11);
    assert.equal(route.branches.length, 2);
    assert.ok(route.branches.every((branch) => branch.validMerge && branch.nextCheckpointIds.length === 2));

    const entityManager = {
        arena: { currentMapDefinition: map },
        entityRuntimeConfig: CONFIG_SECTIONS,
        _simulationClockMs: 0,
    };
    const system = new ParcoursProgressSystem(entityManager);
    const player = {
        index: 0, alive: true, isBot: false, hitboxRadius: PLAYER_RADIUS,
        position: { x: map.playerSpawn.x * MAP_SCALE, y: map.playerSpawn.y * MAP_SCALE, z: map.playerSpawn.z * MAP_SCALE },
    };
    system.startRound([player]);
    const snapshot = system.getRouteSnapshot();
    const stages = [];
    for (const entry of snapshot.checkpoints) if (!stages[entry.routeIndex]) stages[entry.routeIndex] = entry;

    const flyTo = (target) => {
        const from = { ...player.position };
        const delta = [target[0] - from.x, target[1] - from.y, target[2] - from.z];
        const distance = Math.hypot(...delta);
        const steps = Math.max(1, Math.ceil(distance / 4));
        for (let step = 1; step <= steps; step += 1) {
            const previous = { ...player.position };
            player.position.x = from.x + delta[0] * (step / steps);
            player.position.y = from.y + delta[1] * (step / steps);
            player.position.z = from.z + delta[2] * (step / steps);
            entityManager._simulationClockMs += ((distance / steps) / SPEED) * 1000;
            system.updatePlayerProgress(player, previous, entityManager._simulationClockMs);
        }
    };
    const through = (entry) => {
        flyTo(entry.pos);
        const length = Math.hypot(...entry.forward) || 1;
        flyTo(entry.forward.map((value, axis) => entry.pos[axis] + (value / length) * (entry.radius * 0.5)));
    };
    const reached = stages.map((stage) => {
        through(stage);
        return system.getPlayerHudState(0).currentCheckpoint;
    });
    assert.deepEqual(reached, stages.map((_, index) => index + 1));
    // The finish hangs inside the tent: come in over the crown, then dive.
    flyTo(snapshot.finish.pos.map((value, axis) => value + (axis === 1 ? 20 * MAP_SCALE : 0)));
    through(snapshot.finish);
    const hud = system.getPlayerHudState(0);
    assert.equal(hud.completed, true);
    assert.equal(hud.wrongOrderCount, 0);
    assert.equal(hud.resetCount, 0, 'no segment times out at base speed');
});

test('route triggers stay inside the arena', () => {
    const [width, height, depth] = map.size;
    for (const entry of [...map.parcours.checkpoints, map.parcours.finish]) {
        const [x, y, z] = entry.pos;
        assert.ok(Math.abs(x) + entry.radius <= width / 2, `${entry.id} fits in X`);
        assert.ok(y - entry.radius >= 0 && y + entry.radius <= height, `${entry.id} fits in Y`);
        assert.ok(Math.abs(z) + entry.radius <= depth / 2, `${entry.id} fits in Z`);
    }
});

test.after(async () => {
    if (!placedPromise) return;
    const placed = await placedPromise;
    placed.driver.clear();
    disposeObject3DResources(placed.result.scene);
});
