// Verdant Aperture's openings, measured the way a ship meets them: a grid of parallel rays shot
// through each opening, blocked by the map's obstacle boxes and by the moving colliders of the
// setpiece that gates it, at every 0.1 s of its clip. The map runs glbColliderMode 'dynamic', so
// the static frames of the setpieces are not part of the barrier and are left out here as well.
//
// The loader stands a model on the bottom of its bounding box at `position` and turns it about
// that point afterwards; the placement below is the loader's own computeCollectionPlacement, so a
// preset that reasons from the model's centre fails here instead of in a match.
import assert from 'node:assert/strict';
import path from 'node:path';
import { before, test } from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { VERDANT_APERTURE_MAP } from '../src/core/config/maps/presets/verdant_aperture.js';
import { computeCollectionPlacement } from '../src/entities/GLBCollectionPlacement.js';
import { collectAnimatedNodes, normalizeGLBModelCollection } from '../src/entities/GLBMapLoader.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const map = VERDANT_APERTURE_MAP.verdant_aperture;
const MAP_SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;
// Ray spacing in authored units: 0.25 is 0.75 world units, just under one ship radius.
const STEP = 0.25;
// A ray only counts as a way through when a ship fits around it: every ray within one ship
// radius (PLAYER.HITBOX_RADIUS, 0.8 world units) has to be free as well.
const SHIP_RADIUS_STEPS = CONFIG_SECTIONS.PLAYER.HITBOX_RADIUS / MAP_SCALE / STEP;
const SAMPLE_SECONDS = 0.1;
// Shut: at most 5 % of the opening may admit a ship. The panes, trunks and braids are separate
// meshes, and the GLBs leave seams of 0.7-1.0 authored units (2-3 world units) between
// neighbours; a ship fits through one only when it flies exactly along it. Those seams add up to
// 1.5-3.3 % of an opening; a setpiece that misses its opening leaves 19-77 % of it free.
const MAX_SHUT_SHARE = 0.05;
// Open: the widest moment has to let a ship through with room to spare - ship-free rays over at
// least a square two ship diameters across (in authored units squared).
const MIN_OPEN_AREA = (4 * CONFIG_SECTIONS.PLAYER.HITBOX_RADIUS / MAP_SCALE) ** 2;
// Barriers that carry their gap (curtains, mills) are never shut; their gap may not grow past
// this share of the wall opening they sit in, or the wall around them stops mattering. A round
// rotor in a rectangular wall gap already leaves about 15 % at its corners.
const MAX_CARRIED_SHARE = 0.4;

const DECK_HALF = 15;
const CROWN_DECK = 112;

// axis: the direction the rays run; rect: [uMin, uMax, vMin, vMax] over the other two axes in
// x, y, z order; band: the stretch along `axis` a hit has to fall into.
// A deck hole is one 30 unit cell; the rays run vertically through it. Hits count from just
// under the deck to the top of the highest blade swing, so walls and piers of the storey below
// that happen to stand under the hole do not count as part of the hatch.
function joinOpening(id, [x, z], deckY) {
    return { id, kind: 'shut', axis: 1, rect: [x - DECK_HALF, x + DECK_HALF, z - DECK_HALF, z + DECK_HALF], band: [deckY - 5, deckY + 25] };
}

// The leaf shutters (root deck) and bloom irises (crown deck) are not listed yet: their GLB blades
// and petals overlap so far that, centred on their holes, they seal them for the whole clip, and
// in their old slot they never shut. They join this list once Blender gives them blades that open.
const OPENINGS = [
    joinOpening('louvre-centre', [15, 15], CROWN_DECK),
    // The vine gate between the outer faces of its flanks, from the cellar floor to their top.
    { id: 'vine-gate', kind: 'shut', axis: 2, rect: [-39, 39, 8, 48], band: [-7, 7] },
    // The root arches along their pier, floor to pier top.
    { id: 'root-arch-west', kind: 'shut', axis: 0, rect: [8, 48, -93, -47], band: [-50, -42] },
    { id: 'root-arch-east', kind: 'shut', axis: 0, rect: [8, 48, 47, 93], band: [42, 50] },
    // The crown hall's wall gaps: between the curtain walls and between the mill walls.
    { id: 'canopy-west', kind: 'carried', axis: 0, rect: [58, 102, -20, 20], band: [-79, -69] },
    { id: 'canopy-east', kind: 'carried', axis: 0, rect: [58, 102, -20, 20], band: [69, 79] },
    { id: 'mill-north', kind: 'carried', axis: 2, rect: [-13, 13, 58, 102], band: [-51, -41] },
    { id: 'mill-south', kind: 'carried', axis: 2, rect: [-13, 13, 58, 102], band: [41, 51] },
];

async function placeSetpiece(id) {
    const descriptor = normalizeGLBModelCollection(map.glbModels, { animationClock: map.glbAnimationClock })
        .find((entry) => entry.id === `verdant-aperture-${id}`);
    const gltf = await geometryOnlyGlbLoader.loadAsync(path.resolve(descriptor.url));
    const scene = gltf.scene;
    scene.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    scene.traverse((child) => {
        if (child.isMesh) bounds.union(new THREE.Box3().setFromObject(child));
    });
    // Same hierarchy as GLBMapLoader.placeCollectionScene: slot -> normalizer -> offset -> scene.
    const placement = computeCollectionPlacement(bounds, descriptor, MAP_SCALE);
    const slot = new THREE.Group();
    slot.position.set(...placement.slotPosition);
    slot.rotation.set(...placement.slotRotation);
    const normalizer = new THREE.Group();
    normalizer.scale.setScalar(placement.fitScale);
    const offset = new THREE.Group();
    offset.position.set(...placement.offset);
    offset.add(scene);
    normalizer.add(offset);
    slot.add(normalizer);
    const clip = gltf.animations.find((entry) => entry.name === descriptor.animationClock.clipName);
    assert.ok(clip, `${id} plays ${descriptor.animationClock.clipName}`);
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    const animated = collectAnimatedNodes(scene, [clip]);
    const colliders = [];
    scene.traverse((child) => {
        const name = String(child.name).toLowerCase();
        if (child.isMesh && !name.includes('_nocol') && (animated.has(child) || name.includes('_dyn'))) colliders.push(child);
    });
    const pose = (time) => {
        action.time = time;
        mixer.update(0);
        slot.updateMatrixWorld(true);
    };
    return { clip, colliders, pose };
}

// Triangles of the moving colliders in authored units.
function triangles(colliders) {
    const out = [];
    const v = new THREE.Vector3();
    for (const mesh of colliders) {
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.getIndex();
        const vertices = [];
        for (let i = 0; i < position.count; i += 1) {
            v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).divideScalar(MAP_SCALE);
            vertices.push([v.x, v.y, v.z]);
        }
        const count = index ? index.count : position.count;
        for (let i = 0; i + 2 < count; i += 3) {
            out.push([0, 1, 2].map((k) => vertices[index ? index.getX(i + k) : i + k]));
        }
    }
    return out;
}

function makeGrid(opening) {
    const [u0, u1, v0, v1] = opening.rect;
    const nu = Math.round((u1 - u0) / STEP);
    const nv = Math.round((v1 - v0) / STEP);
    return { nu, nv, u0, v0, blocked: new Uint8Array(nu * nv) };
}

function axesOf(axis) {
    return [0, 1, 2].filter((a) => a !== axis);
}

function blockByObstacles(grid, opening) {
    const [ua, va] = axesOf(opening.axis);
    const [lo, hi] = opening.band;
    for (const obstacle of map.obstacles) {
        const half = obstacle.size.map((s) => s / 2);
        if (obstacle.pos[opening.axis] + half[opening.axis] < lo || obstacle.pos[opening.axis] - half[opening.axis] > hi) continue;
        for (let i = 0; i < grid.nu; i += 1) {
            const u = grid.u0 + (i + 0.5) * STEP;
            if (Math.abs(u - obstacle.pos[ua]) > half[ua]) continue;
            for (let j = 0; j < grid.nv; j += 1) {
                const v = grid.v0 + (j + 0.5) * STEP;
                if (Math.abs(v - obstacle.pos[va]) <= half[va]) grid.blocked[i * grid.nv + j] = 1;
            }
        }
    }
}

function blockByTriangles(grid, opening, tris) {
    const axis = opening.axis;
    const [ua, va] = axesOf(axis);
    const [lo, hi] = opening.band;
    for (const [a, b, c] of tris) {
        if (Math.max(a[axis], b[axis], c[axis]) < lo || Math.min(a[axis], b[axis], c[axis]) > hi) continue;
        const d = (b[va] - c[va]) * (a[ua] - c[ua]) + (c[ua] - b[ua]) * (a[va] - c[va]);
        if (Math.abs(d) < 1e-12) continue;
        const i0 = Math.max(0, Math.floor((Math.min(a[ua], b[ua], c[ua]) - grid.u0) / STEP - 0.5));
        const i1 = Math.min(grid.nu - 1, Math.ceil((Math.max(a[ua], b[ua], c[ua]) - grid.u0) / STEP - 0.5));
        const j0 = Math.max(0, Math.floor((Math.min(a[va], b[va], c[va]) - grid.v0) / STEP - 0.5));
        const j1 = Math.min(grid.nv - 1, Math.ceil((Math.max(a[va], b[va], c[va]) - grid.v0) / STEP - 0.5));
        for (let i = i0; i <= i1; i += 1) {
            const u = grid.u0 + (i + 0.5) * STEP;
            for (let j = j0; j <= j1; j += 1) {
                const cell = i * grid.nv + j;
                if (grid.blocked[cell]) continue;
                const v = grid.v0 + (j + 0.5) * STEP;
                const l1 = ((b[va] - c[va]) * (u - c[ua]) + (c[ua] - b[ua]) * (v - c[va])) / d;
                const l2 = ((c[va] - a[va]) * (u - c[ua]) + (a[ua] - c[ua]) * (v - c[va])) / d;
                const l3 = 1 - l1 - l2;
                if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
                const h = l1 * a[axis] + l2 * b[axis] + l3 * c[axis];
                if (h >= lo && h <= hi) grid.blocked[cell] = 1;
            }
        }
    }
}

// Share of rays a ship fits around: the ray and every ray within one ship radius are free.
function shipFreeShare(grid) {
    const reach = Math.ceil(SHIP_RADIUS_STEPS);
    let free = 0;
    for (let i = 0; i < grid.nu; i += 1) {
        for (let j = 0; j < grid.nv; j += 1) {
            let fits = true;
            for (let di = -reach; fits && di <= reach; di += 1) {
                for (let dj = -reach; fits && dj <= reach; dj += 1) {
                    if (Math.hypot(di, dj) > SHIP_RADIUS_STEPS + 0.5) continue;
                    const ii = i + di, jj = j + dj;
                    // The opening's own rim counts as closed: outside it lies deck or wall.
                    if (ii < 0 || jj < 0 || ii >= grid.nu || jj >= grid.nv || grid.blocked[ii * grid.nv + jj]) fits = false;
                }
            }
            if (fits) free += 1;
        }
    }
    return { share: free / (grid.nu * grid.nv), area: free * STEP * STEP };
}

async function measure(opening) {
    const setpiece = await placeSetpiece(opening.id);
    const shares = [];
    for (let time = 0; time < setpiece.clip.duration - 1e-9; time += SAMPLE_SECONDS) {
        setpiece.pose(time);
        const grid = makeGrid(opening);
        blockByObstacles(grid, opening);
        blockByTriangles(grid, opening, triangles(setpiece.colliders));
        shares.push({ time, ...shipFreeShare(grid) });
    }
    const shut = shares.reduce((a, b) => (b.share < a.share ? b : a));
    const open = shares.reduce((a, b) => (b.share > a.share ? b : a));
    return { shut, open };
}

const results = new Map();

before(async () => {
    for (const opening of OPENINGS) results.set(opening.id, await measure(opening));
    for (const [id, { shut, open }] of results) {
        console.log(`[verdant-openings] ${id}: ship-free ${(100 * shut.share).toFixed(1)}% at ${shut.time.toFixed(1)} s, `
            + `${(100 * open.share).toFixed(1)}% at ${open.time.toFixed(1)} s`);
    }
});

test('every gated opening shuts for a ship and opens for one during its clip', () => {
    const failures = [];
    for (const opening of OPENINGS.filter((entry) => entry.kind === 'shut')) {
        const { shut, open } = results.get(opening.id);
        if (shut.share > MAX_SHUT_SHARE) failures.push(`${opening.id} never shuts: ${(100 * shut.share).toFixed(1)}% ship-free at its tightest (${shut.time.toFixed(1)} s)`);
        if (open.area < MIN_OPEN_AREA) failures.push(`${opening.id} never opens: ${(100 * open.share).toFixed(1)}% ship-free at its widest (${open.time.toFixed(1)} s)`);
    }
    assert.deepEqual(failures, []);
});

test('the curtains and mills carry their gap through a wall opening they fill', () => {
    const failures = [];
    for (const opening of OPENINGS.filter((entry) => entry.kind === 'carried')) {
        const { shut, open } = results.get(opening.id);
        if (open.share > MAX_CARRIED_SHARE) failures.push(`${opening.id} leaves ${(100 * open.share).toFixed(1)}% of its wall gap open (${open.time.toFixed(1)} s)`);
        if (open.area < MIN_OPEN_AREA) failures.push(`${opening.id} carries no gap a ship fits through`);
        if (shut.area < MIN_OPEN_AREA) failures.push(`${opening.id} closes completely at ${shut.time.toFixed(1)} s, but it is meant to carry its gap`);
    }
    assert.deepEqual(failures, []);
});
