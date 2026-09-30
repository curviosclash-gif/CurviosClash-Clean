import { NOTRE_DAME_EVOLUTION_MAPS } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { MAP_PRESETS_BASE } from '../src/core/config/maps/MapPresetsBase.js';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_TREE_MODELS } from '../src/core/config/maps/presets/notre_dame/NotreDameModels.js';
import { resolveMapPickerCollection } from '../src/ui/menu/MenuMapCollectionCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

const map = NOTRE_DAME_MAPS.notre_dame;
// Must match NotreDameModels: authored units per metre, and the height of the church floor.
const METRE = 1.4;
const GROUND = 8;

function fabricModels() {
    return map.glbModels.filter((model) => (
        model.url.includes('assets/maps/notre_dame/glb/')
    ));
}

function treeModels() {
    return map.glbModels.filter((model) => model.id.startsWith('notre-dame-tree-'));
}

/** Bounding box of a GLB, from the POSITION accessors' mandatory min/max, in Blender metres. */
function boundingBox(url) {
    const bytes = readFileSync(path.resolve(url));
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessor = document.accessors?.[primitive.attributes?.POSITION];
            if (!accessor?.min || !accessor?.max) continue;
            for (let axis = 0; axis < 3; axis += 1) {
                low[axis] = Math.min(low[axis], Number(accessor.min[axis]));
                high[axis] = Math.max(high[axis], Number(accessor.max[axis]));
            }
        }
    }
    return { low, high };
}

/** Bounding box with glTF node transforms applied, including animated-rig children at frame 0. */
function sceneBoundingBox(url) {
    const bytes = readFileSync(path.resolve(url));
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    const bounds = new THREE.Box3().makeEmpty();

    const visit = (nodeIndex, parentMatrix) => {
        const node = document.nodes?.[nodeIndex];
        if (!node) return;
        const local = new THREE.Matrix4();
        if (Array.isArray(node.matrix)) local.fromArray(node.matrix);
        else {
            local.compose(
                new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
                new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
                new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
            );
        }
        const world = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);
        const mesh = document.meshes?.[node.mesh];
        for (const primitive of mesh?.primitives || []) {
            const accessor = document.accessors?.[primitive.attributes?.POSITION];
            if (!accessor?.min || !accessor?.max) continue;
            bounds.union(new THREE.Box3(
                new THREE.Vector3().fromArray(accessor.min),
                new THREE.Vector3().fromArray(accessor.max),
            ).applyMatrix4(world));
        }
        for (const child of node.children || []) visit(child, world);
    };

    const scene = document.scenes?.[document.scene || 0];
    for (const nodeIndex of scene?.nodes || []) visit(nodeIndex, new THREE.Matrix4());
    return { low: bounds.min.toArray(), high: bounds.max.toArray() };
}

test('Notre-Dame is registered everywhere a map has to appear', () => {
    assert.equal(MAP_PRESET_CATALOG.notre_dame, NOTRE_DAME_EVOLUTION_MAPS.notre_dame);
    assert.equal(MAP_PRESETS_BASE.notre_dame, NOTRE_DAME_EVOLUTION_MAPS.notre_dame);
    assert.equal(map.name, 'Notre-Dame');
    // The same size as the largest existing map.
    assert.deepEqual(map.size, [460, 150, 320]);
    assert.equal(map.parcours.enabled, true);

    // Without a collection the picker drops the map into the unsorted fallback bucket.
    assert.equal(resolveMapPickerCollection('notre_dame').id, 'adventure');
});

test('the map places one cathedral assembly plus the curated Blender tree row', () => {
    assert.equal(map.glbModels.length, 39);
    assert.equal(new Set(map.glbModels.map((model) => model.id)).size, 39);
    assert.equal(map.glbColliderMode, 'scene');
    assert.equal(map.glbAuthoredObstaclesCollisionOnly, true);
    for (const model of fabricModels()) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local GLB`);
        // targetSize would normalise each file to a size of its own and tear the building into
        // seven different scales; one shared scale factor is what keeps it a single object.
        assert.equal(model.scale, METRE, `${model.id} shares the one scale factor`);
        assert.equal(model.targetSize, undefined, `${model.id} must not be size-normalised`);
    }
});

test('both Notre-Dame states reuse all ten ancient-tree LODs at the former tree sites', () => {
    const trees = treeModels();
    assert.deepEqual(trees, NOTRE_DAME_TREE_MODELS);
    trees.forEach((model, index) => assert.equal(model, NOTRE_DAME_TREE_MODELS[index]));
    assert.equal(trees.length, 32);
    assert.equal(new Set(trees.map((model) => model.id)).size, 32);
    assert.deepEqual(
        [...new Set(trees.map((model) => model.url.match(/variant_(\d{2})/)?.[1]))].sort(),
        ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'],
    );
    for (const model of trees) {
        assert.ok(existsSync(path.resolve(model.url)), `${model.id} references a local tree LOD`);
        assert.match(model.url, /ancient_tree_\d{2}_lod2\.glb$/);
        assert.equal(model.position[1], GROUND, `${model.id} stays grounded`);
        assert.equal(model.targetSize, 14.28, `${model.id} preserves the former tree envelope`);
        assert.equal(model.maxRenderDistance, 210, `${model.id} disappears behind the map fog`);
        assert.equal(model.collision, false, `${model.id} remains decorative`);
        assert.equal(model.scale, undefined, `${model.id} is normalized as a reusable library asset`);
    }

    const banks = trees.filter((model) => model.id.includes('-bank-'));
    assert.equal(banks.length, 24);
    assert.deepEqual([...new Set(banks.map((model) => model.position[2]))].sort((a, b) => a - b), [-58.8, 58.8]);
    assert.equal(new Set(banks.map((model) => model.position[0])).size, 12);

    const garden = trees.filter((model) => model.id.includes('-east-garden-'));
    assert.equal(garden.length, 8);
    const centreX = 85.75 * METRE;
    for (const model of garden) {
        const ellipseRadius = Math.hypot(
            (model.position[0] - centreX) / (15 * METRE),
            model.position[2] / (20 * METRE),
        );
        assert.ok(Math.abs(ellipseRadius - 1) < 1e-9, `${model.id} stays on the apse garden ring`);
    }
});

test('only GLB maps whose authored obstacles duplicate complete model surfaces hide them', () => {
    const collisionOnlyMaps = Object.entries(MAP_PRESET_CATALOG)
        .filter(([, definition]) => definition.glbAuthoredObstaclesCollisionOnly === true)
        .map(([mapKey]) => mapKey)
        .sort();
    assert.deepEqual(collisionOnlyMaps, [
        'burg_falkenwacht',
        'burg_falkenwacht_arena',
        'chrono_forge_nexus',
        'complex',
        'eiffel_tower',
        'eiffel_tower_arena',
        'eiffel_tower_siege',
        // Only its setpiece frame colliders; the authored platforms keep renderWithGlb.
        'kinetic_tide',
        'maze',
        'notre_dame',
        'notre_dame_arena',
        'notre_dame_fire',
        'notre_dame_fire_arena',
        'orbital_shipyard',
        'pyramid',
        'reactor_site',
        'skyline_siege',
        'standard',
        'storm_bridge_siege',
        'storm_dam_siege',
        'storm_lighthouse_siege',
        'trench',
        'vertical_maze',
        'wind_cathedral',
    ]);
});

test('the parts land back in the positions they were modelled in', () => {
    // The generator builds every part in one shared cathedral coordinate system, and the loader
    // recentres each file on its own bounding box. This is the test that the preset undoes that
    // recentring correctly: get it wrong and the towers drift away from the nave.
    for (const model of fabricModels()) {
        const box = model.url.endsWith('/01_west_facade.glb')
            ? sceneBoundingBox(model.url)
            : boundingBox(model.url);
        const centreMetres = (box.low[0] + box.high[0]) / 2;
        const baseMetres = box.low[1];

        assert.ok(
            Math.abs(model.position[0] - centreMetres * METRE) <= 0.5,
            `${model.id} sits at its modelled position along the building`,
        );
        assert.ok(
            Math.abs(model.position[1] - (GROUND + baseMetres * METRE)) <= 0.5,
            `${model.id} rests at its modelled height`,
        );
        assert.equal(model.position[2], 0, `${model.id} stays on the nave axis`);
    }
});

test('the spire clears the map ceiling and the building fits the floor plan', () => {
    const [width, height, depth] = map.size;
    const roof = map.glbModels.find((model) => model.url.endsWith('06_roof_fleche.glb'));
    const box = boundingBox(roof.url);
    const tipHeight = roof.position[1] + (box.high[1] - box.low[1]) * METRE;

    // 96 m of cathedral at 1.4 units per metre, standing on the island at 8, is 142.4 -- the
    // whole reason the scale factor is 1.4 and not something rounder.
    assert.ok(tipHeight < height, `the spire tip at ${tipHeight.toFixed(1)} stays under ${height}`);
    assert.ok(tipHeight > height - 15, `the spire uses the height it was given, got ${tipHeight.toFixed(1)}`);

    for (const model of fabricModels()) {
        const box2 = boundingBox(model.url);
        const halfLength = (box2.high[0] - box2.low[0]) / 2 * METRE;
        assert.ok(
            Math.abs(model.position[0]) + halfLength <= width / 2,
            `${model.id} fits the map along X`,
        );
        const halfDepth = (box2.high[2] - box2.low[2]) / 2 * METRE;
        assert.ok(halfDepth <= depth / 2, `${model.id} fits the map across Z`);
    }
});

test('only the west facade carries the authored church-motion clip', () => {
    assert.equal(map.glbAnimationClock, undefined);
    assert.equal(fabricModels().length, 7);
    assert.deepEqual(
        map.glbModels.filter((model) => model.animationClock).map((model) => model.id),
        ['notre-dame-west-facade'],
    );
    assert.equal(map.glbModels.find((model) => model.animationClock)?.animationClock.clipName,
        'NotreDameMotion');
});

test('the route runs three branches through the building and stays inside the arena', () => {
    const route = buildRouteFromParcours(map.parcours);

    assert.ok(route);
    assert.equal(route.routeId, 'notre_dame_v1');
    assert.equal(route.totalCheckpoints, 16);
    assert.equal(route.branches.length, 3);
    assert.ok(route.branches.every((branch) => branch.validMerge));
    assert.ok(route.branches.every((branch) => branch.nextCheckpointIds.length === 2));
    const branchOptions = route.checkpoints.filter((checkpoint) => checkpoint.isBranchOption);
    assert.equal(branchOptions.length, 6);
    assert.deepEqual(
        branchOptions.map((checkpoint) => checkpoint.params.label),
        ['Rose hoch', 'Portal niedrig', 'Dachstuhl hoch', 'Seitenschiff niedrig', 'Chor hoch', 'Umgang niedrig'],
    );
    assert.deepEqual(new Set(branchOptions.map((checkpoint) => checkpoint.params.height)), new Set(['high', 'low']));
    assert.equal(new Set(branchOptions.map((checkpoint) => checkpoint.params.color)).size, 2);
    const choirExit = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_APSE_EXIT');
    const ambulatoryExit = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_APSE_EXIT_AMBULATORY');
    const apseApproach = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_APSE_APPROACH');
    assert.equal(ambulatoryExit?.aliasOf, choirExit?.id);
    assert.deepEqual(choirExit?.nextCheckpointIds, [apseApproach?.id]);
    assert.deepEqual(apseApproach?.nextCheckpointIds, ['CP12']);
    assert.ok(route.branches.every((branch) => branch.validMerge));
    assert.equal(map.portals.length, 4);
    assert.equal(map.gates.filter((gate) => gate.type === 'boost').length, 6);
    assert.equal(map.gates.filter((gate) => gate.type === 'slingshot').length, 3);
    assert.equal(map.items.length, 12);
    assert.equal(map.aircraft.length, 4);
    assert.ok(map.obstacles.length >= 40);

    const [width, height, depth] = map.size;
    for (const entry of [...map.parcours.checkpoints, map.parcours.finish]) {
        const [x, y, z] = entry.pos;
        assert.ok(Math.abs(x) + entry.radius <= width / 2, `${entry.id} fits in X`);
        assert.ok(y - entry.radius >= 0 && y + entry.radius <= height, `${entry.id} fits in Y`);
        assert.ok(Math.abs(z) + entry.radius <= depth / 2, `${entry.id} fits in Z`);
    }
});

test('the high route visits both belfries and finishes inside the spire lantern', () => {
    const checkpoint = (id) => map.parcours.checkpoints.find((entry) => entry.id === id);
    for (const id of ['CP13', 'CP14']) {
        const ring = checkpoint(id);
        assert.ok(ring, `${id} exists`);
        const heightMetres = (ring.pos[1] - GROUND) / METRE;
        assert.ok(heightMetres >= 46 && heightMetres <= 61, `${id} is between 46 m and 61 m`);
    }

    const [finishX, finishY, finishZ] = map.parcours.finish.pos;
    assert.ok(Math.abs(finishX - 17.15) < 0.3 && Math.abs(finishZ) < 0.1,
        'the finish sits on the spire axis');
    assert.ok(Math.abs((finishY - GROUND) / METRE - 72) < 0.1,
        'the finish is inside the 69-77 m lantern');
});

/**
 * Whether a point in authored units sits inside hard collision. Mirrors the three obstacle
 * shapes ArenaGeometryCompilePipeline compiles: a plain box, a box with a bore through it, and
 * a standalone tube whose wall is the solid part.
 */
function isSolid(point) {
    const [px, py, pz] = point;
    for (const obstacle of map.obstacles) {
        if (String(obstacle.kind || 'hard') === 'foam') continue;

        const shape = String(obstacle.shape || '');
        if (shape === 'tube' || shape === 'beam') {
            const [ax, ay, az] = obstacle.start;
            const [bx, by, bz] = obstacle.end;
            const abx = bx - ax; const aby = by - ay; const abz = bz - az;
            const lengthSq = abx * abx + aby * aby + abz * abz;
            const along = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lengthSq;
            if (along < 0 || along > 1) continue;
            const dx = px - (ax + abx * along);
            const dy = py - (ay + aby * along);
            const dz = pz - (az + abz * along);
            const distance = Math.hypot(dx, dy, dz);
            if (shape === 'beam') {
                if (distance <= obstacle.radius) return true;
            } else {
                const outer = obstacle.radius + Math.max(0.25, Math.min(1.2, obstacle.radius * 0.18));
                if (distance <= outer && distance >= obstacle.radius) return true;
            }
            continue;
        }

        const [cx, cy, cz] = obstacle.pos;
        const [width, height, depth] = obstacle.size;
        if (Math.abs(px - cx) > width / 2) continue;
        if (Math.abs(py - cy) > height / 2) continue;
        if (Math.abs(pz - cz) > depth / 2) continue;

        if (obstacle.tunnel) {
            const axis = obstacle.tunnel.axis;
            const crossA = axis === 'x' ? height : width;
            const crossB = axis === 'z' ? height : depth;
            const radius = Math.min(
                obstacle.tunnel.radius,
                Math.max(0.001, Math.min(crossA, crossB) / 2 - 1e-4),
            );
            const first = axis === 'x' ? py - cy : px - cx;
            const second = axis === 'z' ? py - cy : pz - cz;
            if (first * first + second * second < radius * radius) continue;
        }
        return true;
    }
    return false;
}

test('nothing the route asks a player to reach is buried in the collision', () => {
    // The map draws the cathedral from GLB files but collides on the boxes in NotreDameStructure,
    // and nothing in the loader ties the two together. So this is the check that keeps them
    // honest: every ring, pickup and gate the route sends a player at has to stand in open air.
    // It once did not -- the apse merge, the attic branch and the buttress leg all sat in stone.
    const anchors = [
        ...map.parcours.checkpoints.map((entry) => [entry.id, entry.pos]),
        [map.parcours.finish.id, map.parcours.finish.pos],
        ...map.portals.flatMap((portal, index) => ([
            [`portal${index}a`, portal.a], [`portal${index}b`, portal.b],
        ])),
    ];
    for (const variant of [NOTRE_DAME_MAPS.notre_dame, NOTRE_DAME_MAPS.notre_dame_arena]) {
        variant.items.forEach((item) => anchors.push([item.id, [item.x, item.y, item.z]]));
        variant.gates.forEach((gate) => anchors.push([gate.id, gate.pos]));
        const spawn = variant.playerSpawn;
        anchors.push([`${variant.name} spawn`, [spawn.x, spawn.y, spawn.z]]);
        variant.botSpawns.forEach((bot, index) => {
            anchors.push([`${variant.name} bot${index}`, [bot.x, bot.y, bot.z]]);
        });
    }

    for (const [id, pos] of anchors) {
        assert.ok(!isSolid(pos), `${id} at ${pos.join(',')} stands in open air`);
    }
});

test('landing collision that has no matching GLB surface remains visible', () => {
    const landingPlatforms = map.obstacles.filter((obstacle) => obstacle.renderWithGlb === true);
    assert.equal(landingPlatforms.length, 2);
    assert.deepEqual(
        landingPlatforms.map((obstacle) => obstacle.pos),
        [[-112, 14, 0], [110, 16, 0]],
    );
});

test('the interior is the hall it is drawn as, floor to vault to attic', () => {
    // A bore is a cylinder and a gothic vessel is a tall rectangle, so the interior is walled
    // rather than drilled. What that has to produce, measured up the middle of the nave in
    // metres above the church floor: an open vessel from the paving to the vault at 33 m, the
    // vault itself, the timber attic above it, and the roof over that.
    const GROUND = 8;
    const METRE = 1.4;
    const naveColumn = (metres) => isSolid([-49, GROUND + metres * METRE, 0]);

    for (const metres of [1, 4, 10, 20, 30]) {
        assert.ok(!naveColumn(metres), `the nave is open at ${metres} m`);
    }
    assert.ok(naveColumn(34), 'the vault closes the vessel at 33 m');
    for (const metres of [36, 39, 42]) {
        assert.ok(!naveColumn(metres), `the attic is flyable at ${metres} m`);
    }
    assert.ok(naveColumn(44), 'the roof closes the attic');

    // Across the nave at 2 m only the outer aisle wall stands: below the arcade the vessel and
    // its aisles are one hall, which is what lets the aisle branch leave the nave at all.
    assert.ok(!isSolid([-49, GROUND + 2 * METRE, -19.6]), 'the aisle is open beside the nave');
    assert.ok(isSolid([-49, GROUND + 2 * METRE, -28]), 'the outer aisle wall closes it');

    // The transept gable collides where the building ends, 23.1 m out, and not beyond it. The
    // arms once collided from 23.6 m to 33.6 m -- entirely past the wall a player can see.
    const gableRow = (metresOut) => isSolid([17.15, GROUND + 15 * METRE, metresOut * METRE]);
    assert.ok(!gableRow(20), 'the transept arm is hollow where it is drawn');
    assert.ok(gableRow(24), 'the gable collides where it stands');
    assert.ok(!gableRow(28), 'nothing collides past the gable');

    // The spire is the tallest thing on the map; without collision it is 50 m of scenery a
    // player flies straight through.
    for (const metres of [50, 65, 80, 94]) {
        assert.ok(isSolid([17.15, GROUND + metres * METRE, 0]), `the spire is solid at ${metres} m`);
    }
    assert.ok(!isSolid([17.15, GROUND + 72 * METRE, 0]), 'the lantern centre stays open');
    assert.ok(isSolid([17.15 + 5.32, GROUND + 72 * METRE, 0]),
        'the lantern ring supports remain collidable');
    // The crossing under it stays the open shaft the route branches in.
    assert.ok(!isSolid([17.15, GROUND + 20 * METRE, 0]), 'the crossing stays open');
});

test('no collision stands where the map draws nothing at all', () => {
    // The coarse counterpart to the anchor test: every hard obstacle has to fall inside the
    // bounding box of some model the map actually loads. It is only a bounding box, so it will
    // not catch a block that is merely in the wrong place -- but it does catch the case that bit
    // this map twice: collision floating in open air with no geometry anywhere near it.
    const placed = fabricModels().map((model) => {
        const box = sceneBoundingBox(model.url);
        const centreX = (box.low[0] + box.high[0]) / 2;
        const centreZ = (box.low[2] + box.high[2]) / 2;
        return {
            id: model.id,
            min: [
                (box.low[0] - centreX) * METRE + model.position[0],
                model.position[1],
                (box.low[2] - centreZ) * METRE + model.position[2],
            ],
            max: [
                (box.high[0] - centreX) * METRE + model.position[0],
                (box.high[1] - box.low[1]) * METRE + model.position[1],
                (box.high[2] - centreZ) * METRE + model.position[2],
            ],
        };
    });
    const covered = (point) => placed.some((model) => (
        point.every((value, axis) => value >= model.min[axis] && value <= model.max[axis])
    ));

    for (const obstacle of map.obstacles) {
        // The island and its quays are the ground plane, deliberately below everything drawn.
        if (String(obstacle.kind || 'hard') === 'foam') continue;
        // Supplemental landing platforms deliberately draw their own obstacle geometry instead
        // of relying on a matching GLB surface.
        if (obstacle.renderWithGlb === true) continue;
        const centre = ['tube', 'beam'].includes(String(obstacle.shape || ''))
            ? obstacle.start.map((value, axis) => (value + obstacle.end[axis]) / 2)
            : obstacle.pos;
        assert.ok(covered(centre), `collision at ${centre.map((v) => v.toFixed(1))} has geometry around it`);
    }
});

test('the outdoor collision sits on the bays and the curve it is drawn on', () => {
    // The buttress piers are set out on the same 6 m bay as the building, ten along the nave and
    // five along the choir. They were once eight invented positions that matched no drawn pier,
    // so a player threaded gaps where stone stood and hit stone where the gaps were.
    const BAY = 6 * METRE;
    const pierHeight = GROUND + 10 * METRE;
    for (const [start, bays, out] of [[-76.65, 10, 32.2], [26.95, 5, 33.6]]) {
        for (let bay = 0; bay < bays; bay += 1) {
            const x = start + BAY * (bay + 0.5);
            assert.ok(isSolid([x, pierHeight, -out]), `a pier stands on bay ${bay} at x ${x.toFixed(1)}`);
            assert.ok(isSolid([x, pierHeight, out]), `and on the other side of bay ${bay}`);
            // The gap between two piers is the outdoor route and has to stay open. Past the last
            // pier of a row there is no gap: the nave row ends against the transept arm.
            if (bay < bays - 1) {
                assert.ok(!isSolid([x + BAY / 2, pierHeight, -out]), `the gap after bay ${bay} is flyable`);
            }
        }
    }

    // The apse is an ellipse 13.9 m along the building by 19.4 m across, springing from the east
    // end of the straight choir. Collision may sit inside that curve, never outside it: a
    // rectangle carried through to the east end put a wall up to 10 m clear of the building.
    const APSE_SPRING = 68.95;
    for (const degrees of [20, 40, 60, 80]) {
        const radians = (degrees * Math.PI) / 180;
        const outsideX = APSE_SPRING + 19.46 * 1.12 * Math.cos(radians);
        const outsideZ = 27.2 * 1.12 * Math.sin(radians);
        assert.ok(
            !isSolid([outsideX, GROUND + 5 * METRE, outsideZ]),
            `nothing collides outside the apse at ${degrees} degrees`,
        );
    }
});

test('the arena variant reuses the building instead of duplicating it', () => {
    const arena = NOTRE_DAME_MAPS.notre_dame_arena;

    assert.equal(MAP_PRESET_CATALOG.notre_dame_arena, NOTRE_DAME_EVOLUTION_MAPS.notre_dame_arena);
    assert.equal(MAP_PRESETS_BASE.notre_dame_arena, NOTRE_DAME_EVOLUTION_MAPS.notre_dame_arena);
    assert.equal(arena.name, 'Notre-Dame Arena');
    assert.equal(resolveMapPickerCollection('notre_dame_arena').id, 'arena');

    // Identity, not equality: the geometry is the expensive part of this map, so both maps must
    // point at the very same arrays. A copy would double the load and let the two drift apart.
    assert.equal(arena.glbModels, map.glbModels);
    assert.equal(arena.obstacles, map.obstacles);
    assert.equal(arena.portals, map.portals);
    assert.equal(arena.audioProfile, map.audioProfile);
    assert.deepEqual(arena.size, map.size);
    assert.equal(arena.glbColliderMode, 'scene');
    assert.equal(arena.glbAuthoredObstaclesCollisionOnly, true);

    // What actually differs: no ordered route, its own readable light and mirrored combat
    // resources instead of the west-to-east route rewards.
    assert.equal(arena.parcours, undefined);
    assert.notEqual(arena.lighting, map.lighting);
    assert.notEqual(arena.gates, map.gates);
    assert.notEqual(arena.items, map.items);
    assert.equal(arena.gates.length, 8);
    assert.equal(arena.items.length, 10);
    for (const collection of [arena.gates, arena.items]) {
        const byId = new Map(collection.map((entry) => [entry.id, entry]));
        for (const entry of collection.filter((candidate) => candidate.id.endsWith('_north'))) {
            const south = byId.get(entry.id.replace(/_north$/, '_south'));
            assert.ok(south, `${entry.id} has a mirrored south partner`);
            const northZ = Number(entry.z ?? entry.pos?.[2]);
            const southZ = Number(south.z ?? south.pos?.[2]);
            assert.equal(northZ, -southZ, `${entry.id} mirrors across the nave axis`);
        }
    }
    assert.ok(arena.botSpawns.length > map.botSpawns.length);
    assert.notDeepEqual(arena.playerSpawn, map.playerSpawn);

    const [width, height, depth] = arena.size;
    for (const spawn of [arena.playerSpawn, ...arena.botSpawns]) {
        assert.ok(Math.abs(spawn.x) <= width / 2, `spawn ${spawn.x} fits in X`);
        assert.ok(spawn.y > 0 && spawn.y < height, `spawn ${spawn.y} fits in Y`);
        assert.ok(Math.abs(spawn.z) <= depth / 2, `spawn ${spawn.z} fits in Z`);
    }
});
