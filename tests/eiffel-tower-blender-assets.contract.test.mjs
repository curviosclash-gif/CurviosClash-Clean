import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { EIFFEL_TOWER_MAPS } from '../src/core/config/maps/presets/eiffel_tower/index.js';
import { EIFFEL_TOWER_METRE, EIFFEL_TOWER_GROUND } from '../src/core/config/maps/presets/eiffel_tower/EiffelTowerModels.js';

const ASSET_ROOT = path.resolve('assets/maps/eiffel_tower');

// The eight static parts, with the underside height the generator reported for each. The map has
// to place them at exactly these heights or the tower comes apart, so the numbers live here as
// well as in the preset: this is the contract between the Blender source and the map.
const STRUCTURE_PARTS = Object.freeze({
    '01_champ_de_mars': -1.5,
    '02_legs_lower': -0.66,
    '03_arches': 17.6,
    '04_first_floor': 52.38,
    '05_legs_mid': 59.63,
    '06_second_floor': 111.54,
    '07_shaft': 117.65,
    '08_summit': 276.1,
});

// The four animated parts and the loop length each was authored at, in seconds.
const MACHINE_PARTS = Object.freeze({
    '09_leg_elevator': 14,
    '10_shaft_lift': 12,
    '11_beacon': 8,
    '12_illumination_ring': 9,
});

const CLIP_NAMES = Object.freeze({
    '09_leg_elevator': 'LegElevatorLoop',
    '10_shaft_lift': 'ShaftLiftLoop',
    '11_beacon': 'BeaconLoop',
    '12_illumination_ring': 'IlluminationRingLoop',
});

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with a JSON chunk`);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDurationSeconds(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

// Mirrors the runtime rule: a keyframed transform moves every mesh in its subtree, so a rig empty
// makes the meshes parented below it collidable.
function animatedMeshNodeNames(document) {
    const nodes = document.nodes || [];
    const names = new Set();
    const collectSubtreeMeshes = (index) => {
        const node = nodes[index];
        if (!node) return;
        if (node.mesh !== undefined) names.add(node.name);
        for (const child of node.children || []) collectSubtreeMeshes(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (!['translation', 'rotation', 'scale'].includes(channel.target?.path)) continue;
            collectSubtreeMeshes(channel.target.node);
        }
    }
    return [...names];
}

function triangleCount(document) {
    const accessors = document.accessors || [];
    let total = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            if (primitive.indices === undefined) continue;
            total += Math.floor(Number(accessors[primitive.indices]?.count || 0) / 3);
        }
    }
    return total;
}

function modelsByFile(map) {
    const byFile = new Map();
    for (const model of map.glbModels) {
        const stem = path.basename(model.url, '.glb');
        if (!byFile.has(stem)) byFile.set(stem, []);
        byFile.get(stem).push(model);
    }
    return byFile;
}

test('every Eiffel Tower part keeps an editable Blender source and a non-empty GLB', () => {
    for (const name of [...Object.keys(STRUCTURE_PARTS), ...Object.keys(MACHINE_PARTS)]) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps an editable Blender source`);
        assert.ok(statSync(glbPath).size > 2_000, `${name} exports a non-empty GLB`);
    }
});

test('the static tower parts carry no animation and stay inside the triangle budget', () => {
    for (const name of Object.keys(STRUCTURE_PARTS)) {
        const document = readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`));
        assert.equal(document.animations?.length ?? 0, 0, `${name} is static iron`);
        // The same 18000 the Notre-Dame architecture is held to. The upper shaft is the closest
        // to it, and it is the part a player looks at for the longest stretch of the climb.
        assert.ok(triangleCount(document) <= 18_000, `${name} stays inside the static budget`);
        // Lattice work is thousands of members; joined per material it has to export as a handful
        // of nodes, not as a few thousand draw calls.
        assert.ok((document.nodes || []).length <= 12, `${name} exports as joined meshes`);
    }
});

test('the Eiffel Tower machines expose one correctly timed loop each', () => {
    for (const [name, expectedDuration] of Object.entries(MACHINE_PARTS)) {
        const document = readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`));
        assert.equal(document.animations?.length, 1, `${name} has exactly one loader-compatible clip`);
        assert.ok(document.animations[0].channels.length > 0, `${name} clip animates scene nodes`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, document.animations[0]) - expectedDuration) <= (1 / 30),
            `${name} keeps its authored loop duration`,
        );
        assert.ok(
            animatedMeshNodeNames(document).length > 0,
            `${name} drives at least one mesh, so it can carry a dynamic collider`,
        );
    }
});

test('the map places every part at the height the generator reported', () => {
    const map = EIFFEL_TOWER_MAPS.eiffel_tower;
    const byFile = modelsByFile(map);

    for (const [name, baseMetres] of Object.entries(STRUCTURE_PARTS)) {
        const placed = byFile.get(name);
        assert.ok(placed, `${name} is placed in the map`);
        assert.equal(placed.length, 1, `${name} is placed exactly once`);
        const [model] = placed;
        // The tower is symmetric about its axis, so every static part recentres to the middle by
        // itself. A part nudged sideways would tear the silhouette apart at that height.
        assert.deepEqual([model.position[0], model.position[2]], [0, 0], `${name} stands on the tower axis`);
        assert.equal(model.scale, EIFFEL_TOWER_METRE, `${name} shares the one scale factor`);
        assert.ok(
            Math.abs(model.position[1] - (EIFFEL_TOWER_GROUND + baseMetres * EIFFEL_TOWER_METRE)) < 1e-6,
            `${name} sits at its reported underside`,
        );
    }

    for (const name of Object.keys(MACHINE_PARTS)) {
        const placed = byFile.get(name);
        assert.ok(placed?.length, `${name} is placed in the map`);
        for (const model of placed) {
            assert.equal(
                model.animationClock?.clipName,
                CLIP_NAMES[name],
                `${name} addresses the clip its GLB actually contains`,
            );
            assert.equal(model.scale, EIFFEL_TOWER_METRE, `${name} shares the one scale factor`);
        }
    }
});

test('the tower fits under the map ceiling and collides off its own triangles', () => {
    for (const map of Object.values(EIFFEL_TOWER_MAPS)) {
        // 330 m of tower at 0.6 units per metre, on an esplanade at 8, is 206 of the 220 the map
        // is tall. Losing that headroom is how the antenna ends up clipped.
        const tipHeight = EIFFEL_TOWER_GROUND + 330 * EIFFEL_TOWER_METRE;
        assert.ok(tipHeight < map.size[1], 'the antenna tip clears the map ceiling');
        // On a lattice the openings are the level, so collision has to follow the drawn triangles.
        assert.equal(map.glbColliderMode, 'scene');
        assert.ok(Array.isArray(map.obstacles) && map.obstacles.length > 0, 'a load-failure fallback tower remains');
        assert.equal(map.glbAuthoredObstaclesCollisionOnly, true);
    }
});

test('the climb is an ordered route that ends at the antenna', () => {
    const { parcours } = EIFFEL_TOWER_MAPS.eiffel_tower;
    assert.equal(parcours.enabled, true);
    assert.equal(parcours.rules.ordered, true);

    const ids = new Set(parcours.checkpoints.map((checkpoint) => checkpoint.id));
    for (const checkpoint of parcours.checkpoints) {
        for (const nextId of checkpoint.nextIds || []) {
            assert.ok(ids.has(nextId), `${checkpoint.id} branches to a checkpoint that exists`);
        }
    }

    // The route is flown upward, and that is the whole difference between this map and the
    // horizontal ones. The spine -- everything that is not one of the two alternatives of a
    // branch -- may never drop, from the iris under the tower to the antenna. The approach before
    // it is exempt: a run comes in over the gardens and dips under the arches.
    const spine = parcours.checkpoints
        .slice(parcours.checkpoints.findIndex((checkpoint) => checkpoint.type === 'iris'))
        .filter((checkpoint) => !checkpoint.params?.height);
    assert.ok(spine.length >= 8, 'the climb is described by more than a handful of rings');
    for (let index = 1; index < spine.length; index += 1) {
        assert.ok(
            spine[index].pos[1] > spine[index - 1].pos[1],
            `${spine[index].id} stands above ${spine[index - 1].id}`,
        );
    }
    assert.ok(
        parcours.finish.pos[1] > spine[spine.length - 1].pos[1],
        'the finish stands above the last checkpoint',
    );

    // Both alternatives of a branch have to live between the ring that splits the route and the
    // ring that joins it again, or one lane climbs past the merge and the other never reaches it.
    const byId = new Map(parcours.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    for (const entry of parcours.checkpoints.filter((checkpoint) => checkpoint.type === 'branch_entry')) {
        for (const laneId of entry.nextIds) {
            const lane = byId.get(laneId);
            const merge = byId.get(lane.nextIds[0]);
            assert.ok(
                lane.pos[1] > entry.pos[1] && lane.pos[1] < merge.pos[1],
                `${laneId} climbs between ${entry.id} and ${merge.id}`,
            );
        }
    }
});
