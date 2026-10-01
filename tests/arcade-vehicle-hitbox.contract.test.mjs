// ============================================
// arcade-vehicle-hitbox.contract.test.mjs - Paket 2b: Arcade hitbox from part boxes.
// One box per top-level part (factory shape x functional size x 0.9), minimum thickness,
// core anchor, probe spheres that cover every box, Manta wall factor, Hangar box list.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    ARCADE_HITBOX_MAX_BOXES,
    ARCADE_HITBOX_MIN_THICKNESS,
    ARCADE_HITBOX_SCALE,
    buildArcadeCoreHitboxShape,
    buildArcadeHitboxShape,
    listArcadeHitboxBoxes,
} from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { resolveArcadeWallHitboxScale } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { resolveArcadePartSizeFactors } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeSizedPartStyle } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { applyVehiclePartStyle, measureVehiclePartBounds } from '../src/shared/contracts/VehiclePartStyleContract.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicle-lab/player-ships/index.js';
import { VEHICLE_PRESETS } from '../src/shared/vehicle-lab/VehiclePresets.js';
import { createVehicleMesh, getVehicleIds, getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import {
    applyArcadePartHitbox,
    clearArcadePartHitbox,
    rayHitsArcadePartBoxes,
    syncArcadePartHitbox,
} from '../src/entities/player/ArcadePartHitboxOps.js';

const HELIX = VEHICLE_PRESETS.find((preset) => preset.id === 'lab_helix_interceptor');
const FACTORY = [...PLAYER_SHIP_PART_CONFIGS, HELIX];
const MAX = { hull: 125, nose: 125, wings: 125, engines: 125, utility: 125 };
const EPS = 1e-9;
// How the hitbox measures a part: mirrored copies count, engine flames and force fields do not.
const HITBOX_MEASURE = Object.freeze({ includeMirrors: true, ignoreGeos: ['flame', 'forcefield'] });

function boxAt(shape, i) {
    const b = shape.boxes;
    return { c: [b[i * 6], b[i * 6 + 1], b[i * 6 + 2]], h: [b[i * 6 + 3], b[i * 6 + 4], b[i * 6 + 5]] };
}

function unionOf(shape) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < shape.count; i++) {
        const { c, h } = boxAt(shape, i);
        for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], c[a] - h[a]);
            max[a] = Math.max(max[a], c[a] + h[a]);
        }
    }
    return { min, max };
}

test('arcade hitbox: every factory ship gets one box per top-level part, roles included', () => {
    assert.equal(FACTORY.length, 8);
    for (const config of FACTORY) {
        const shape = buildArcadeHitboxShape(config.parts, null);
        assert.ok(shape.count <= ARCADE_HITBOX_MAX_BOXES, `${config.id}: ${shape.count} boxes`);
        const roles = config.parts.map((part) => part.role).filter(Boolean);
        for (const role of roles) assert.ok(shape.roles.includes(role), `${config.id}: ${role} has a box`);
        for (let i = 0; i < shape.count; i++) {
            const { h } = boxAt(shape, i);
            for (const half of h) assert.ok(half >= 0, `${config.id} box ${shape.names[i]} is a real box`);
        }
        // Two-stage wall check: only the core carries the minimum thickness (anchor cube).
        const core = boxAt(shape, shape.roles.indexOf('core'));
        for (const half of core.h) assert.ok(half >= ARCADE_HITBOX_MIN_THICKNESS / 2 - EPS, `${config.id} core too thin`);
        for (let a = 0; a < 3; a++) {
            assert.ok(core.c[a] - core.h[a] <= -ARCADE_HITBOX_MIN_THICKNESS / 2 + EPS, `${config.id} core anchor min axis ${a}`);
            assert.ok(core.c[a] + core.h[a] >= ARCADE_HITBOX_MIN_THICKNESS / 2 - EPS, `${config.id} core anchor max axis ${a}`);
        }
    }
});

test('arcade hitbox: at factory size the boxes stay inside the drawn model and cover most of it', () => {
    for (const config of FACTORY) {
        const shape = buildArcadeHitboxShape(config.parts, null);
        const union = unionOf(shape);
        const box = createVehicleMesh(config.id, 0xffffff).localBox;
        const size = box.getSize(new THREE.Vector3()).toArray();
        const min = box.min.toArray();
        const max = box.max.toArray();
        for (let a = 0; a < 3; a++) {
            const slack = Math.max(ARCADE_HITBOX_MIN_THICKNESS, size[a] * 0.05);
            assert.ok(union.min[a] >= min[a] - slack && union.max[a] <= max[a] + slack, `${config.id} axis ${a} inside the model`);
            const covered = (union.max[a] - union.min[a]) / size[a];
            assert.ok(covered >= 0.6, `${config.id} axis ${a} covers ${covered.toFixed(2)} of the model`);
        }
    }
});

test('arcade hitbox: Star-Cruiser wing tip sits at x 2.16 and grows around the wing pivot', () => {
    const ship5 = FACTORY.find((config) => config.id === 'ship5');
    const shape = buildArcadeHitboxShape(ship5.parts, null);
    const wing = boxAt(shape, shape.roles.indexOf('wing_right'));
    assert.ok(Math.abs(wing.c[0] + wing.h[0] - 2.16) < 0.01, `tip ${wing.c[0] + wing.h[0]}`);
    assert.ok(Math.abs(wing.c[2] - wing.h[2] + 0.989) < 0.01 && Math.abs(wing.c[2] + wing.h[2] - 0.659) < 0.01);

    const grown = buildArcadeHitboxShape(ship5.parts, { wings: 125 });
    const big = boxAt(grown, grown.roles.indexOf('wing_right'));
    const pivot = ship5.parts.find((part) => part.role === 'wing_right').pos;
    assert.ok(Math.abs((big.c[0] - pivot[0]) - 1.25 * (wing.c[0] - pivot[0])) < 1e-6, 'center moves away from the pivot');
    assert.ok(Math.abs(big.h[0] - 1.25 * wing.h[0]) < 1e-6, 'span grows by 25 %');
    const nose = boxAt(grown, grown.roles.indexOf('nose'));
    const nose100 = boxAt(shape, shape.roles.indexOf('nose'));
    assert.deepEqual(nose.h, nose100.h, 'other groups keep their size');
});

test('arcade hitbox: every factory ship has one utility box that grows with the utility size alone', () => {
    for (const config of FACTORY) {
        const utility = config.parts.filter((part) => part.role === 'utility');
        assert.equal(utility.length, 1, `${config.id}: one top-level utility part`);
        const [part] = utility;
        const pivot = part.pos || [0, 0, 0];
        assert.equal(resolveArcadePartSizeFactors(config.parts, { utility: 125 })[part.name], 1.25, `${config.id}: drawn at 125 %`);
        const factory = buildArcadeHitboxShape(config.parts, null);
        assert.equal(factory.roles.filter((role) => role === 'utility').length, 1, `${config.id}: one utility box`);
        const index = factory.roles.indexOf('utility');
        for (const [pct, factor] of [[125, 1.25], [80, 0.8]]) {
            const sized = buildArcadeHitboxShape(config.parts, { utility: pct });
            const box = boxAt(sized, index);
            const base = boxAt(factory, index);
            for (let a = 0; a < 3; a++) {
                const label = `${config.id} utility ${pct} % axis ${a}`;
                assert.ok(Math.abs(box.h[a] - factor * base.h[a]) < 1e-6, `${label}: half ${box.h[a]} = ${factor} x ${base.h[a]}`);
                assert.ok(Math.abs((box.c[a] - pivot[a]) - factor * (base.c[a] - pivot[a])) < 1e-6, `${label}: grows around the part pivot`);
            }
            for (let i = 0; i < sized.count; i++) {
                if (i !== index) assert.deepEqual(boxAt(sized, i), boxAt(factory, i), `${config.id} ${sized.names[i]} keeps its size`);
            }
        }
    }
});

test('arcade hitbox: the utility box moves exactly like the drawn part, riding on the hull where it is built in', () => {
    const GRID = [80, 100, 125];
    // Pivot inside the hull: Manta tail hump, spaceship deck module, Arrow sleeve, Drone gun mount.
    // Standing on the hull (Star-Cruiser, ship1, ship9) or on the Helix reactor spine: pivot stays.
    const BUILT_IN = new Set(['spaceship', 'arrow', 'manta', 'drone']);
    assert.deepEqual(FACTORY.map((config) => config.id).filter((id) => !BUILT_IN.has(id)), ['ship5', 'ship1', 'ship9', 'lab_helix_interceptor']);
    for (const config of FACTORY) {
        const hullPivot = config.parts.find((part) => part.role === 'core').pos || [0, 0, 0];
        const utility = config.parts.find((part) => part.role === 'utility');
        const pivot = utility.pos || [0, 0, 0];
        const factory = buildArcadeHitboxShape(config.parts, null);
        const index = factory.roles.indexOf('utility');
        const base = boxAt(factory, index);
        for (const hull of GRID) {
            for (const size of GRID) {
                const sizes = { hull, utility: size };
                const box = boxAt(buildArcadeHitboxShape(config.parts, sizes), index);
                // Visible size = functional size: the part as hangar and run draw it, x ARCADE_HITBOX_SCALE.
                const drawn = applyVehiclePartStyle(config, resolveArcadeSizedPartStyle(config.parts, null, sizes));
                const bounds = measureVehiclePartBounds(drawn.parts.find((part) => part.role === 'utility'), HITBOX_MEASURE);
                const carry = BUILT_IN.has(config.id) ? hull / 100 : 1;
                for (let a = 0; a < 3; a++) {
                    const label = `${config.id} hull ${hull} % utility ${size} % axis ${a}`;
                    // The hull grows around its pivot and carries a built-in part's pivot; the part grows around that.
                    const expected = hullPivot[a] + (pivot[a] - hullPivot[a]) * carry + (base.c[a] - pivot[a]) * (size / 100);
                    assert.ok(Math.abs(box.c[a] - expected) < 1e-6, `${label}: centre ${box.c[a]} rides on the hull at ${expected}`);
                    assert.ok(Math.abs(box.h[a] - base.h[a] * (size / 100)) < 1e-6, `${label}: half ${box.h[a]} follows the utility size`);
                    assert.ok(Math.abs(box.c[a] - bounds.center[a]) < 1e-6, `${label}: centre matches the drawn part`);
                    assert.ok(Math.abs(box.h[a] - (bounds.size[a] / 2) * ARCADE_HITBOX_SCALE) < 1e-6, `${label}: half matches the drawn part`);
                }
            }
        }
    }
});

test('arcade hitbox: mixed hull and utility sizes reach no further than the all-125 % shape the proof and bot evasion use', () => {
    for (const config of FACTORY) {
        for (const options of [{}, { originScale: resolveArcadeWallHitboxScale(config.id) }]) {
            const widest = buildArcadeHitboxShape(config.parts, MAX, options);
            for (const hull of [80, 100, 125]) {
                for (const utility of [80, 100, 125]) {
                    const label = `${config.id} hull ${hull} % utility ${utility} % scale ${options.originScale || 1}`;
                    const shape = buildArcadeHitboxShape(config.parts, { ...MAX, hull, utility }, options);
                    assert.ok(shape.boundRadius <= widest.boundRadius + EPS, `${label}: sweep bound ${shape.boundRadius} vs ${widest.boundRadius}`);
                    assert.ok(shape.crossRadius <= widest.crossRadius + EPS, `${label}: bot evasion radius ${shape.crossRadius} vs ${widest.crossRadius}`);
                }
            }
        }
    }
});

test('arcade hitbox: the utility parts of Raumschiff, Pfeil and Manta add no reach - bot evasion and sweep bound stay', () => {
    const ALL = (pct) => ({ hull: pct, nose: pct, wings: pct, engines: pct, utility: pct });
    for (const id of ['spaceship', 'arrow', 'manta']) {
        const config = FACTORY.find((entry) => entry.id === id);
        const without = config.parts.filter((part) => part.role !== 'utility');
        const wallScale = resolveArcadeWallHitboxScale(id);
        for (const pct of [80, 100, 125]) {
            for (const options of [{}, { originScale: wallScale }]) {
                const label = `${id} ${pct} % scale ${options.originScale || 1}`;
                const shape = buildArcadeHitboxShape(config.parts, ALL(pct), options);
                const plain = buildArcadeHitboxShape(without, ALL(pct), options);
                assert.equal(shape.count, plain.count + 1, `${label}: one more box`);
                // arcadeAvoidRadius = wall crossRadius; the safety proof sweeps with the wall boundRadius.
                assert.ok(Math.abs(shape.crossRadius - plain.crossRadius) < 1e-12, `${label}: bot evasion radius ${shape.crossRadius} vs ${plain.crossRadius}`);
                assert.ok(Math.abs(shape.boundRadius - plain.boundRadius) < 1e-12, `${label}: sweep bound ${shape.boundRadius} vs ${plain.boundRadius}`);
            }
        }
    }
    // Manta wall factor 0.14: the wall sphere stays at about 3.5 with every part at 125 %.
    const manta = FACTORY.find((entry) => entry.id === 'manta');
    const wall = buildArcadeHitboxShape(manta.parts, MAX, { originScale: resolveArcadeWallHitboxScale('manta') });
    assert.ok(Math.abs(wall.boundRadius - 3.54) < 0.05, `manta wall radius ${wall.boundRadius}`);
});

test('arcade hitbox: mirrored copies are measured, engine flames are not', () => {
    const flank = FACTORY.find((config) => config.id === 'ship5').parts.find((part) => part.name === 'Rumpfflanke');
    const plain = measureVehiclePartBounds(flank);
    const mirrored = measureVehiclePartBounds(flank, { includeMirrors: true });
    assert.ok(plain.min[0] > 0, 'default stays the unmirrored part');
    assert.ok(Math.abs(mirrored.min[0] + mirrored.max[0]) < 1e-9, 'mirror copy spans both sides');

    const shape = buildArcadeHitboxShape(FACTORY.find((config) => config.id === 'ship5').parts, null);
    const engine = boxAt(shape, shape.roles.indexOf('engine_right'));
    assert.ok(engine.c[2] + engine.h[2] < 2.0, `engine box ends at the nozzle, not the flame tip (${engine.c[2] + engine.h[2]})`);
});

function isMirrored(part) {
    return part.mirror === true || ['x', 'y', 'z'].includes(part.mirrorAxis);
}

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('arcade hitbox: each half of a mirrored part gets its own box, nothing in between', () => {
    const spaceship = FACTORY.find((config) => config.id === 'spaceship');
    const shape = buildArcadeHitboxShape(spaceship.parts, null);
    const ship = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), modelScale: 1, arcadeHitbox: { full: shape } };
    const down = new THREE.Vector3(0, -1, 0);
    // The two thin nose cannons sit at x +-0.5 in front of the saucer; between them is empty space.
    assert.equal(rayHitsArcadePartBoxes(ship, new THREE.Vector3(0, 10, -2), down, 100), -1, 'between the cannons');
    assert.equal(rayHitsArcadePartBoxes(ship, new THREE.Vector3(0.2, 10, -2.3), down, 100), -1, 'beside the right cannon');
    assert.ok(rayHitsArcadePartBoxes(ship, new THREE.Vector3(0.5, 10, -2), down, 100) > 0, 'on the right cannon');
    assert.ok(rayHitsArcadePartBoxes(ship, new THREE.Vector3(-0.5, 10, -2), down, 100) > 0, 'on the left cannon');

    for (const config of FACTORY) {
        const built = buildArcadeHitboxShape(config.parts, MAX);
        for (const part of config.parts.filter(isMirrored)) {
            const axis = { x: 0, y: 1, z: 2 }[part.mirrorAxis || 'x'];
            const halves = built.names.flatMap((name, i) => (name === part.name ? [boxAt(built, i)] : []));
            assert.equal(halves.length, 2, `${config.id} ${part.name}: one box per half`);
            for (let a = 0; a < 3; a++) {
                const mirrored = a === axis ? near(halves[0].c[a], -halves[1].c[a]) : near(halves[0].c[a], halves[1].c[a]);
                assert.ok(mirrored && near(halves[0].h[a], halves[1].h[a]), `${config.id} ${part.name} axis ${a}`);
            }
        }
    }
});

test('arcade hitbox: the box budget keeps mirror partners together (no one-sided hit zone)', () => {
    const boxesOf = (shape, name) => shape.names.flatMap((entry, i) => (entry === name ? [boxAt(shape, i)] : []));
    const hasPartner = (box, list) => list.some((other) => near(box.c[0], -other.c[0]) && near(box.c[1], other.c[1])
        && near(box.c[2], other.c[2]) && box.h.every((half, a) => near(half, other.h[a])));
    let capped = 0;
    for (const id of getVehicleIds()) {
        const parts = getVehicleModularConfig(id)?.parts;
        if (!Array.isArray(parts)) continue;
        const shape = buildArcadeHitboxShape(parts, null);
        assert.ok(shape.count <= ARCADE_HITBOX_MAX_BOXES, `${id}: ${shape.count} boxes`);
        // Every part's boxes without any budget; some ships are a little asymmetric by design.
        const all = parts.flatMap((part) => boxesOf(buildArcadeHitboxShape([part], null), part.name));
        if (all.length > ARCADE_HITBOX_MAX_BOXES) capped += 1;
        const kept = shape.names.map((_, i) => boxAt(shape, i));
        const lonely = shape.names.filter((name, i) => hasPartner(kept[i], all) && !hasPartner(kept[i], kept));
        assert.deepEqual(lonely, [], `${id}: the budget dropped only one side of these`);
    }
    assert.ok(capped >= 2, `Leviathan and Aegis exceed the budget (${capped})`);
});

test('arcade hitbox: probe spheres enclose every box', () => {
    for (const config of FACTORY) {
        const shape = buildArcadeHitboxShape(config.parts, MAX);
        for (let i = 0; i < shape.count; i++) {
            const { c, h } = boxAt(shape, i);
            // 5 x 5 x 5 grid over the box, corners included.
            for (let n = 0; n < 125; n++) {
                const p = [n % 5, Math.floor(n / 5) % 5, Math.floor(n / 25)].map((k, a) => c[a] + h[a] * (k / 2 - 1));
                let inside = false;
                for (let k = shape.probeStart[i]; k < shape.probeStart[i + 1]; k++) {
                    const q = shape.probes;
                    const d = Math.hypot(p[0] - q[k * 4], p[1] - q[k * 4 + 1], p[2] - q[k * 4 + 2]);
                    if (d <= q[k * 4 + 3] + 1e-9) { inside = true; break; }
                }
                assert.ok(inside, `${config.id} ${shape.names[i]} point ${p} uncovered`);
            }
            assert.ok(shape.probeStart[i + 1] - shape.probeStart[i] <= 6);
        }
    }
});

test('arcade hitbox: Manta walls use about spaceship size, every other ship the full shape', () => {
    for (const config of FACTORY) {
        const scale = resolveArcadeWallHitboxScale(config.id);
        if (config.id === 'manta') {
            assert.ok(scale > 0 && scale < 0.2, `manta wall scale ${scale}`);
            const wall = buildArcadeHitboxShape(config.parts, MAX, { originScale: scale });
            assert.ok(wall.boundRadius > 3.2 && wall.boundRadius < 3.8, `manta wall radius ${wall.boundRadius}`);
            const full = buildArcadeHitboxShape(config.parts, MAX);
            assert.ok(full.boundRadius > 20, 'MG and rockets still see the full manta');
        } else {
            assert.equal(scale, 1, config.id);
        }
    }
    assert.equal(resolveArcadeWallHitboxScale('aircraft'), 1);
});

test('arcade hitbox: vehicles without parts get one core box from the model bounds', () => {
    const shape = buildArcadeCoreHitboxShape([-1, -0.5, -2], [1, 0.5, 2]);
    assert.equal(shape.count, 1);
    const { c, h } = boxAt(shape, 0);
    assert.deepEqual(c, [0, 0, 0]);
    assert.deepEqual(h, [ARCADE_HITBOX_SCALE, 0.5 * ARCADE_HITBOX_SCALE, 2 * ARCADE_HITBOX_SCALE]);
});

test('arcade hitbox: Hangar gets the boxes as plain data', () => {
    const ship5 = FACTORY.find((config) => config.id === 'ship5');
    const list = listArcadeHitboxBoxes(ship5, { wings: 125 });
    assert.equal(list.length, ship5.parts.length + ship5.parts.filter(isMirrored).length, 'mirrored parts: one box per half');
    const wing = list.find((entry) => entry.role === 'wing_right');
    assert.equal(wing.name, ship5.parts.find((part) => part.role === 'wing_right').name);
    assert.equal(wing.center.length, 3);
    assert.equal(wing.halfSize.length, 3);
    assert.deepEqual(listArcadeHitboxBoxes(null, null).length, 1, 'empty config: only the core anchor');
});

test('arcade hitbox: the Hangar hit-zone size is the summed box surface of the full shape and follows every part size', async () => {
    const contract = await import('../src/shared/contracts/ArcadeVehicleHitboxContract.js');
    assert.equal(typeof contract.measureArcadeHitboxSurface, 'function', 'measureArcadeHitboxSurface exported');
    const surfaceOf = (boxes) => boxes.reduce((sum, { halfSize: [x, y, z] }) => sum + 8 * (x * y + y * z + z * x), 0);
    for (const config of FACTORY) {
        const factory = contract.measureArcadeHitboxSurface(config.parts, null);
        assert.ok(Math.abs(factory - surfaceOf(listArcadeHitboxBoxes(config, null))) < EPS, `${config.id}: the boxes the Hangar draws`);
        // Every group the ship has moves the number on its own (a bounding sphere would miss parts
        // inside the span); a group without parts leaves it alone.
        let moved = 0;
        for (const group of ['hull', 'nose', 'wings', 'engines', 'utility']) {
            const grown = contract.measureArcadeHitboxSurface(config.parts, { [group]: 125 });
            const shrunk = contract.measureArcadeHitboxSurface(config.parts, { [group]: 80 });
            if (grown === factory) {
                assert.equal(shrunk, factory, `${config.id} ${group}: no parts, no change`);
                continue;
            }
            assert.ok(grown > factory && shrunk < factory, `${config.id} ${group}: ${shrunk} < ${factory} < ${grown}`);
            moved += 1;
        }
        assert.ok(moved >= 4, `${config.id}: ${moved} groups move the hit zone`);
    }
    assert.equal(contract.default.measureArcadeHitboxSurface, contract.measureArcadeHitboxSurface);
});

test('arcade hitbox runtime: spawn state follows vehicle and part sizes, clear restores the old radius', () => {
    const player = { vehicleId: 'ship5', modelScale: 2, hitboxRadius: 2.4, hitboxBox: new THREE.Box3() };
    applyArcadePartHitbox(player);
    const state = player.arcadeHitbox;
    assert.ok(state, 'state set');
    assert.equal(player.arcadeAvoidRadius, state.wall.crossRadius * 2, 'bot evasion radius follows the wall shape');
    assert.equal(player.hitboxRadius, 2.4, 'every other reader keeps the old radius');

    player.arcadePartSizes = { wings: 125 };
    syncArcadePartHitbox(player);
    assert.notEqual(player.arcadeHitbox.full, state.full, 'size change rebuilds');
    const rebuilt = player.arcadeHitbox.full;
    syncArcadePartHitbox(player);
    assert.equal(player.arcadeHitbox.full, rebuilt, 'unchanged sizes keep the cached shape');

    player.modelScale = 1;
    syncArcadePartHitbox(player);
    assert.equal(player.arcadeAvoidRadius, player.arcadeHitbox.wall.crossRadius, 'radius follows the live model scale');

    clearArcadePartHitbox(player);
    assert.equal(player.arcadeHitbox, null);
    assert.equal(player.hitboxRadius, 2.4);
    assert.equal(player.arcadeAvoidRadius, 0);
});
