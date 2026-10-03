// ============================================
// arcade-collision-safety.contract.test.mjs - Paket 2b: safety proof against tunnelling.
// The worst case is rebuilt from the real limits (settings, CONFIG.PLAYER, pickups, the
// balance table and every map preset); the sweep step count must stay below its cap and a
// 0.02 thin wall across the path is always found, while a pole beside the wing tip is not.
// Stuck poses get out of the wall, and tunnel bounces head back into the tunnel.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import {
    ARCADE_EXTERNAL_IMPULSE_MAX,
    ARCADE_HITBOX_MIN_THICKNESS,
    ARCADE_SWEEP_MAX_STEPS,
    buildArcadeHitboxShape,
    computeArcadeSweepSteps,
    resolveArcadeMotionWorstCase,
} from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import {
    ARCADE_ROLL_BASE_PCT,
    resolveArcadeStatCapPct,
    resolveArcadeVehicleBaseStats,
    resolveArcadeWallHitboxScale,
} from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { resolveArcadeVehicleBuildStats } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { PICKUP_REGISTRY } from '../src/shared/contracts/PickupRegistryContract.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicle-lab/player-ships/index.js';
import { VEHICLE_PRESETS } from '../src/shared/vehicle-lab/VehiclePresets.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { applyArcadePartHitbox } from '../src/entities/player/ArcadePartHitboxOps.js';
import { resolveArcadeArenaCollision, resolveArcadeTrailCollision } from '../src/entities/systems/lifecycle/ArcadePartCollisionOps.js';
import { Arena } from '../src/entities/Arena.js';
import { CollisionResponseSystem } from '../src/entities/systems/CollisionResponseSystem.js';
import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';
import { recoverPlayerFromCollision } from '../src/modes/HuntCollisionOps.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { Trail } from '../src/entities/Trail.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';
import { listVehicleDescriptors } from '../src/entities/vehicle-registry.js';
import v8 from 'node:v8';
import vm from 'node:vm';

const FACTORY = [...PLAYER_SHIP_PART_CONFIGS, VEHICLE_PRESETS.find((preset) => preset.id === 'lab_helix_interceptor')];
const PLAYER = CONFIG_SECTIONS.PLAYER;

function listFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? listFiles(path) : (path.endsWith('.js') ? [path] : []);
    });
}

function maxAuthored(key) {
    let max = 0;
    for (const file of listFiles('src')) {
        for (const match of readFileSync(file, 'utf8').matchAll(new RegExp(`${key}:\\s*([0-9.]+)`, 'g'))) {
            max = Math.max(max, Number(match[1]));
        }
    }
    return max;
}

function worstCaseEnv() {
    const table = FACTORY.map((config) => resolveArcadeVehicleBaseStats(config.id));
    return {
        baseSpeed: Math.max(SETTINGS_LIMITS.gameplay.speed.max, PLAYER.SPEED),
        speedCapPct: Math.max(...table.map((stats) => resolveArcadeStatCapPct(stats.speedPct))),
        boostMultiplier: PLAYER.BOOST_MULTIPLIER,
        speedEffectMultiplier: PICKUP_REGISTRY.SPEED_UP.multiplier,
        externalImpulse: ARCADE_EXTERNAL_IMPULSE_MAX,
        turnSpeed: Math.max(SETTINGS_LIMITS.gameplay.turnSensitivity.max, PLAYER.TURN_SPEED),
        turnCapPct: Math.max(...table.map((stats) => resolveArcadeStatCapPct(stats.turnPct))),
        rollSpeed: PLAYER.ROLL_SPEED,
        // Roll (wing side value, Paket 2a) has its own cap: the same base for every ship + 100 points.
        rollCapPct: resolveArcadeStatCapPct(ARCADE_ROLL_BASE_PCT),
        frameDt: CONFIG_SECTIONS.TIME_STEP,
        minClockScale: Math.min(PLAYER.SLOWMO_TIME_SCALE, PICKUP_REGISTRY.SLOW_TIME.timeScale),
    };
}

test('arcade safety: authored portal and slingshot pushes stay inside ARCADE_EXTERNAL_IMPULSE_MAX', () => {
    const forward = maxAuthored('forwardImpulse');
    const lift = maxAuthored('liftImpulse');
    assert.ok(forward >= 60 && lift >= 38, `scan found the known maps (${forward}, ${lift})`);
    // Boost portal (forward) and slingshot (forward + lift) can overlap.
    assert.ok(forward + Math.hypot(forward, lift) <= ARCADE_EXTERNAL_IMPULSE_MAX, `${forward} + |(${forward}, ${lift})|`);
});

test('arcade safety: worst case numbers from the real limits', () => {
    const env = worstCaseEnv();
    assert.equal(env.baseSpeed, 45);
    assert.equal(env.speedCapPct, 220);
    assert.equal(env.turnCapPct, 230);
    const worst = resolveArcadeMotionWorstCase(env);
    assert.ok(Math.abs(worst.stepDt - 1 / 24) < 1e-12, 'slow motion owner: 1/60 s at clock 0.4');
    assert.ok(Math.abs(worst.specStepDistance - (45 * 2.2 * 2.3 * 1.5) / 24) < 1e-9, 'maximum dive multiplier applies to capped speed');
    assert.ok(Math.abs(worst.stepDistance - (45 * 2.2 * 2.3 * 1.5 * 1.6 + ARCADE_EXTERNAL_IMPULSE_MAX) / 24) < 1e-9, 'with maximum dive speed, SPEED_UP, and map pushes');
    assert.equal(env.rollCapPct, 200, 'roll: its own base 100 % + 100 points');
    assert.ok(Math.abs(worst.stepAngle - (Math.SQRT2 * 5 * 2.3 + 3 * 2.0) / 24) < 1e-9);
});

test('arcade safety: the proof rolls with the roll cap the build really clamps to (wings, stones), not the turn cap', () => {
    const env = worstCaseEnv();
    const maxWings = { sizeWorkshopUnlocked: true, purchasedSizeSteps: 25, partSizes: { wings: 125 } };
    // Stones (Paket 3) add wing steps on top; a huge count saturates the clamp.
    const runtimeMax = Math.max(...FACTORY.map((config) => resolveArcadeVehicleBuildStats(config.id, maxWings, { wings: 1e6 }).rollPct));
    assert.equal(env.rollCapPct, runtimeMax, 'proof and runtime share one roll cap');
    const factory = resolveArcadeVehicleBuildStats('drone', null).rollPct;
    assert.ok(env.rollCapPct > factory, `the cap sits above the factory roll (${factory} %)`);
});

test('arcade safety: sweep steps stay under the cap for every ship, size and plane scale', () => {
    const worst = resolveArcadeMotionWorstCase(worstCaseEnv());
    let highest = 0;
    for (const config of FACTORY) {
        for (const size of [80, 125]) {
            const sizes = { hull: size, nose: size, wings: size, engines: size, utility: size };
            const wall = buildArcadeHitboxShape(config.parts, sizes, { originScale: resolveArcadeWallHitboxScale(config.id) });
            for (const s of [SETTINGS_LIMITS.gameplay.planeScale.min, SETTINGS_LIMITS.gameplay.planeScale.max]) {
                const steps = Math.ceil((worst.stepDistance + worst.stepAngle * wall.boundRadius * s) / (ARCADE_HITBOX_MIN_THICKNESS * s));
                highest = Math.max(highest, steps);
                assert.ok(steps <= ARCADE_SWEEP_MAX_STEPS, `${config.id} ${size}% s=${s}: ${steps} steps`);
                assert.equal(computeArcadeSweepSteps(worst.stepDistance, worst.stepAngle, wall.boundRadius * s, ARCADE_HITBOX_MIN_THICKNESS * s), steps);
            }
        }
    }
    assert.ok(highest > 100, `the cap is actually needed (${highest})`);
    assert.equal(computeArcadeSweepSteps(0, 0, 3, 0.25), 1);
    assert.equal(computeArcadeSweepSteps(1e6, 0, 3, 0.25), ARCADE_SWEEP_MAX_STEPS);
});

test('arcade safety: PlayerMotionOps points at the new proof', () => {
    const source = readFileSync('src/entities/player/PlayerMotionOps.js', 'utf8');
    assert.match(source, /resolveArcadeMotionWorstCase/);
});

function makePlayer(vehicleId, sizes, scale) {
    const player = {
        vehicleId, arcadePartSizes: sizes, modelScale: scale, isBot: false, alive: true,
        position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), _renderPrevQuaternion: new THREE.Quaternion(),
        hitboxBox: new THREE.Box3(), refreshObbCollisionQuery() {},
    };
    applyArcadePartHitbox(player);
    return player;
}

function makePhase(isHit) {
    const info = { hit: true, kind: 'wall', isWall: true, normal: new THREE.Vector3(-1, 0, 0) };
    const arena = {
        queries: 0,
        getCollisionInfo(point, radius) { this.queries += 1; return isHit(point, radius) ? info : null; },
    };
    arena.getBotCollisionInfo = arena.getCollisionInfo;
    return { phase: new PlayerCollisionPhase({ arena }), arena };
}

// Real arena: ArenaCollision behind the Arena forwarders, a wide open box and the given
// obstacles in the compiled format of ArenaGeometryCompilePipeline.
function createRealArena(obstacles) {
    const arena = new Arena({
        addToScene() {}, removeFromScene() {}, setMapLighting() {}, setShadowCoverage() {},
        getGraphicsStyle() { return 'modern'; }, getMaxAnisotropy() { return 1; },
    });
    arena.entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_SECTIONS);
    arena.bounds = { minX: -500, maxX: 500, minY: -500, maxY: 500, minZ: -500, maxZ: 500 };
    arena.obstacles = obstacles;
    return arena;
}

function boxObstacle(min, max) {
    return { box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), isWall: true, kind: 'wall' };
}

// Tube (wallThickness > 0) or beam (0) exactly as ArenaGeometryCompilePipeline._addStandaloneTunnel builds it.
function tubeObstacle(start, end, innerRadius, wallThickness) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const outerRadius = innerRadius + wallThickness;
    return {
        box: new THREE.Box3().setFromPoints([a, b]).expandByScalar(outerRadius),
        isWall: false,
        kind: 'hard',
        tube: {
            ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z,
            innerRadius: wallThickness > 0 ? innerRadius : 0, outerRadius, lengthSq: a.distanceToSquared(b),
        },
    };
}

function faceAlong(player, direction) {
    player.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.clone().normalize());
    player._renderPrevQuaternion.copy(player.quaternion);
}

// Farthest wall-shape probe along a world direction, from the ship origin (with or without its radius).
function reachAlong(player, direction, withRadius = true) {
    const { probes } = player.arcadeHitbox.wall;
    const s = player.modelScale;
    const point = new THREE.Vector3();
    let best = -Infinity;
    for (let k = 0; k < probes.length; k += 4) {
        point.set(probes[k], probes[k + 1], probes[k + 2]).multiplyScalar(s).applyQuaternion(player.quaternion);
        best = Math.max(best, point.dot(direction) + (withRadius ? probes[k + 3] * s : 0));
    }
    return best;
}

test('arcade safety: a thin wall plate on the worst-case path is always found (real ArenaCollision)', () => {
    const worst = resolveArcadeMotionWorstCase(worstCaseEnv());
    const d = worst.stepDistance;
    // 0.02 thick and only 0.1 wide around the line the ship origin flies along - not a whole plane.
    const phase = new PlayerCollisionPhase({ arena: createRealArena([boxObstacle([-0.01, 0.25, 0.05], [0.01, 0.35, 0.15])]) });
    const turns = [
        new THREE.Euler(0, 0, 0), new THREE.Euler(0, Math.PI / 2, 0), new THREE.Euler(0.7, -1.9, 0.4),
        new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Euler(-0.3, 2.8, -1.2),
    ];
    const axis = new THREE.Vector3(0.3, 0.8, -0.52).normalize();
    for (const id of ['ship5', 'arrow', 'drone', 'manta', 'lab_helix_interceptor']) {
        for (const size of [80, 125]) {
            const sizes = { hull: size, nose: size, wings: size, engines: size, utility: size };
            for (const s of [0.6, 2]) {
                const player = makePlayer(id, sizes, s);
                const reach = player.arcadeHitbox.wall.boundRadius * s;
                for (const euler of turns) {
                    for (const lead of [0.51, 0.75, 0.97]) {
                        if (d * lead <= reach) continue;
                        const prev = new THREE.Vector3(-d * lead, 0.3, 0.1);
                        player.position.set(d * (1 - lead), 0.3, 0.1);
                        player._renderPrevQuaternion.setFromEuler(euler);
                        player.quaternion.copy(player._renderPrevQuaternion)
                            .multiply(new THREE.Quaternion().setFromAxisAngle(axis, worst.stepAngle));
                        const hit = resolveArcadeArenaCollision(phase, player, prev);
                        const label = `${id} ${size}% s=${s} ${euler.toArray().slice(0, 3)} lead ${lead}`;
                        assert.ok(hit?.hit, `${label}: wall missed`);
                        assert.equal(hit.responseAlreadySeparated, true, label);
                        assert.ok(player.position.x < 0, `${label}: stopped before the wall (${player.position.x})`);
                    }
                }
            }
        }
    }
});

test('arcade safety: a pole beside the Star-Cruiser wing tip is not a wall hit, one through the wing is', () => {
    const player = makePlayer('ship5', null, 1);
    const pole = (x) => (point, radius) => Math.hypot(point.x - x, point.z + 0.5) <= radius + 0.01;
    const outside = makePhase(pole(2.16 + POLE_CLEARANCE));
    assert.equal(resolveArcadeArenaCollision(outside.phase, player, player.position.clone()), null, 'pole beside the tip');
    const through = makePhase(pole(1.8));
    assert.ok(resolveArcadeArenaCollision(through.phase, player, player.position.clone())?.hit, 'pole through the wing');
    const far = makePhase(() => false);
    assert.equal(resolveArcadeArenaCollision(far.phase, player, player.position.clone()), null);
    assert.equal(far.arena.queries, 1, 'free space costs one prefilter query');
});

// Probe spheres enclose each box, so they reach a little beyond it; this is the measured
// clearance at the Star-Cruiser wing tip (see ARCADE_PROBES_PER_BOX_MAX).
const POLE_CLEARANCE = 0.3;

test('arcade safety: the core anchor alone stops a plate 0.02 thin along the flight; a coarser sweep would step over it', () => {
    // No parts and a tiny model: only the core anchor cube carries the sweep (safety proof).
    // Along -z its probes reach 0.132 * s on the centre line, just over half a sample spacing
    // (0.125 * s). The plate lies at 25 places along paths of 3 to 150 samples (the step cap).
    for (const s of [0.6, 1, 2]) {
        const player = {
            vehicleId: 'aircraft', modelScale: s, isBot: false, alive: true, hitboxRadius: 0.01,
            position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), _renderPrevQuaternion: new THREE.Quaternion(),
            vehicleMesh: { localBox: new THREE.Box3(new THREE.Vector3(-0.01, -0.01, -0.01), new THREE.Vector3(0.01, 0.01, 0.01)) },
            hitboxBox: new THREE.Box3(), refreshObbCollisionQuery() {},
        };
        applyArcadePartHitbox(player);
        assert.equal(player.arcadeHitbox.wall.count, 1, 'only the core anchor');
        const spacing = ARCADE_HITBOX_MIN_THICKNESS * s * 0.999;
        const clear = 0.3 * s + 0.01;
        for (const along of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)]) {
            // 0.02 thin along the flight, 0.04 across.
            const half = new THREE.Vector3(0.02, 0.02, 0.02).addScaledVector(along.clone().set(Math.abs(along.x), Math.abs(along.y), Math.abs(along.z)), -0.01);
            const phase = new PlayerCollisionPhase({ arena: createRealArena([boxObstacle(half.clone().negate().toArray(), half.toArray())]) });
            for (const samples of [3, 3.3, 4, 4.7, 6.1, 13.9, 41.3, 150]) {
                const travel = samples * spacing;
                for (let k = 0; k <= 24; k++) {
                    // Start and end pose stay clear of the plate; the plate moves along the path.
                    const start = along.clone().multiplyScalar(-(clear + (k / 24) * (travel - 2 * clear)));
                    const label = `s=${s} ${along.toArray()} ${samples} samples at ${k}/24`;
                    player.position.copy(start);
                    assert.equal(resolveArcadeArenaCollision(phase, player, start.clone()), null, `${label}: start pose is free`);
                    player.position.copy(start).addScaledVector(along, travel);
                    assert.equal(resolveArcadeArenaCollision(phase, player, player.position.clone()), null, `${label}: end pose is free`);
                    const hit = resolveArcadeArenaCollision(phase, player, start);
                    assert.ok(hit?.hit && hit.responseAlreadySeparated, `${label}: plate missed`);
                    assert.ok(player.position.dot(along) < 0, `${label}: stopped in front of the plate`);
                }
            }
        }
    }
});

test('arcade safety: a thin pole on the arc of the outermost probe is found while the ship turns (rotation share)', () => {
    // Worst-case turn per sweep with no or little travel: only the turn moves the wing tip
    // across the pole, so the samples must follow the arc length, not only the travel.
    const worst = resolveArcadeMotionWorstCase(worstCaseEnv());
    const point = new THREE.Vector3();
    const checked = { turnOnly: 0, withTravel: 0 };
    for (const id of ['ship5', 'manta']) {
        const s = 0.6;
        const player = makePlayer(id, null, s);
        const { probes } = player.arcadeHitbox.wall;
        for (const axis of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
            let outer = 0;
            const offAxis = (k) => point.set(probes[k], probes[k + 1], probes[k + 2]).projectOnPlane(axis).length();
            for (let k = 4; k < probes.length; k += 4) if (offAxis(k) > offAxis(outer)) outer = k;
            const startQuat = new THREE.Quaternion();
            const endQuat = new THREE.Quaternion().setFromAxisAngle(axis, worst.stepAngle);
            for (const travel of [0, 0.75]) {
                const start = new THREE.Vector3();
                const end = new THREE.Vector3(0, 0, -travel);
                for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
                    const label = `${id} turn ${axis.toArray()} travel ${travel} at ${t}`;
                    // Pole (0.02 thick) along the turn axis through that probe centre at sweep fraction t.
                    const quat = new THREE.Quaternion().slerpQuaternions(startQuat, endQuat, t);
                    const centre = point.set(probes[outer], probes[outer + 1], probes[outer + 2]).multiplyScalar(s)
                        .applyQuaternion(quat).add(new THREE.Vector3().lerpVectors(start, end, t)).clone();
                    const reach = axis.clone().multiplyScalar(travel + 0.5);
                    const phase = new PlayerCollisionPhase({ arena: createRealArena([
                        tubeObstacle(centre.clone().sub(reach).toArray(), centre.clone().add(reach).toArray(), 0.01, 0),
                    ]) });
                    // Only poles that neither the start nor the end pose touches: the sweep alone must find them.
                    player.position.copy(start);
                    const startTouches = resolveArcadeArenaCollision(phase, player, start.clone(), startQuat) !== null;
                    player.position.copy(end);
                    player.quaternion.copy(endQuat);
                    const endTouches = resolveArcadeArenaCollision(phase, player, end.clone(), endQuat) !== null;
                    if (!startTouches && !endTouches) {
                        assert.ok(resolveArcadeArenaCollision(phase, player, start, startQuat)?.hit, `${label}: pole missed`);
                        checked[travel === 0 ? 'turnOnly' : 'withTravel'] += 1;
                    }
                    player.quaternion.identity();
                }
            }
        }
    }
    assert.ok(checked.turnOnly >= 6 && checked.withTravel >= 6, `enough poles between free poses (${JSON.stringify(checked)})`);
});

test('arcade safety: a beam end met head-on is found, not skipped by a prefilter (real ArenaCollision)', () => {
    // The exact tube test only counts sphere centres between the end caps, so a big prefilter
    // sphere centred in front of the end must not decide on its own.
    const phase = new PlayerCollisionPhase({ arena: createRealArena([tubeObstacle([0, 10, 0], [0, 10, 40], 1, 0)]) });
    const along = new THREE.Vector3(0, 0, 1);
    for (const id of ['ship5', 'arrow', 'drone', 'ship1']) {
        for (const s of [0.6, 1]) {
            const player = makePlayer(id, null, s);
            faceAlong(player, along);
            const label = `${id} s=${s}`;
            // Every probe centre starts in front of the beam end; the ship centre ends 0.9 inside the beam.
            const prev = new THREE.Vector3(0, 10, -reachAlong(player, along, false) - 0.05);
            player.position.set(0, 10, 0.9 * s);
            const hit = resolveArcadeArenaCollision(phase, player, prev);
            assert.ok(hit?.hit, `${label}: beam end missed`);
            assert.ok(player.position.z < 0, `${label}: stopped in front of the beam (${player.position.z})`);
            assert.equal(resolveArcadeArenaCollision(phase, player, player.position.clone()), null, `${label}: resolved pose is free`);
        }
    }
});

test('arcade safety: an oblique pass through a hollow tube rim near its opening is found (parcours_rift size)', () => {
    // parcours_rift: radius 4.4 x MAP_SCALE 3 = 13.2 inside, wall 1.2 (resolveStandaloneTunnelWallThickness).
    const phase = new PlayerCollisionPhase({ arena: createRealArena([tubeObstacle([0, 0, 0], [0, 0, 40], 13.2, 1.2)]) });
    const from = new THREE.Vector3(0, 16, -3);
    const to = new THREE.Vector3(0, 11.5, 2);
    // Level flight attitude, sinking through the rim. The long arrow at s = 1 already reaches
    // into the rim at the start pose, so it only flies at s = 0.6.
    const cases = [...['ship5', 'drone', 'ship1', 'ship9', 'spaceship'].flatMap((id) => [[id, 0.6], [id, 1]]), ['arrow', 0.6]];
    for (const [id, s] of cases) {
        const player = makePlayer(id, null, s);
        const label = `${id} s=${s}`;
        player.position.copy(from);
        assert.equal(resolveArcadeArenaCollision(phase, player, from.clone()), null, `${label}: start outside the tube is free`);
        player.position.copy(to);
        assert.equal(resolveArcadeArenaCollision(phase, player, to.clone()), null, `${label}: end inside the tube is free`);
        const hit = resolveArcadeArenaCollision(phase, player, from);
        assert.ok(hit?.hit, `${label}: jumped through the tube wall`);
        assert.ok(Math.hypot(player.position.x, player.position.y) > 13.2, `${label}: stopped outside the tube (${player.position.y})`);
    }
});

test('arcade safety: a pose that already touches stays put and hands its own probe to the push-out', () => {
    // Thin wall x in [0, 0.2]; the Star-Cruiser noses 0.05 into it and keeps flying at it
    // (after a grace time or a spawn).
    const arena = createRealArena([boxObstacle([0, -50, -50], [0.2, 50, 50])]);
    const phase = new PlayerCollisionPhase({ arena });
    const along = new THREE.Vector3(1, 0, 0);
    for (const travel of [0.1, 0.3, 0.75]) {
        const player = makePlayer('ship5', null, 1);
        faceAlong(player, along);
        const start = new THREE.Vector3(0.05 - reachAlong(player, along), 0, 0);
        player.position.copy(start).addScaledVector(along, travel);
        const hit = resolveArcadeArenaCollision(phase, player, start);
        const label = `travel ${travel}`;
        assert.ok(hit?.hit && hit.responseHasProbe && !hit.responseAlreadySeparated, `${label}: stuck contact`);
        assert.ok(player.position.distanceTo(start) < 1e-9, `${label}: stays on the touching pose (+${player.position.x - start.x})`);
        const probe = new THREE.Vector3(hit.responseProbeOffsetX, hit.responseProbeOffsetY, hit.responseProbeOffsetZ).add(player.position);
        assert.ok(arena.checkCollision(probe, hit.responseProbeRadius), `${label}: the handed probe touches at that pose`);
        assert.ok(hit.normal.x < 0, `${label}: push-out points out of the wall (${hit.normal.toArray()})`);
        new CollisionResponseSystem({ arena, _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpDir: new THREE.Vector3() })
            .pushPlayerOutOfCollision(player, hit.normal, 1.6, hit);
        const front = player.position.x + reachAlong(player, along);
        assert.ok(front <= 0.05 + 1e-9, `${label}: never pushed deeper into the wall (front ${front})`);
    }
});

test('arcade safety: a vehicle stuck deeper than the push-out reaches flies out instead of freezing (real floor)', () => {
    // A grace time (0.16 s without arena checks, e.g. with boost) can end 8-10 below the floor.
    // The probe push-out reaches 4.8 at most; staying on the previous pose froze the vehicle there.
    const arena = createRealArena([]);
    arena.bounds.minY = 0;
    const phase = new PlayerCollisionPhase({ arena });
    const walls = new CollisionResponseSystem({ arena, _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpDir: new THREE.Vector3() });
    const down = new THREE.Vector3(0, -1, 0);
    const heading = new THREE.Vector3();
    for (const id of ['ship5', 'arrow', 'manta']) {
        for (const depth of [8, 10]) {
            // Flying out at 30 degrees (45 u/s), or diving at 60 degrees (70 u/s) until the wall response turns it.
            for (const [pitch, travel] of [[30, 0.75], [-60, 70 / 60]]) {
                const label = `${id} ${depth} deep, pitch ${pitch}`;
                const player = makePlayer(id, null, 1);
                player.getDirection = (out) => out.set(0, 0, -1).applyQuaternion(player.quaternion);
                const angle = pitch * Math.PI / 180;
                faceAlong(player, new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
                player.position.y = -depth + reachAlong(player, down);
                let frames = 0;
                while (reachAlong(player, down) - player.position.y > 0 && frames < 70) {
                    const prev = player.position.clone();
                    player._renderPrevQuaternion.copy(player.quaternion);
                    player.position.addScaledVector(player.getDirection(heading), travel);
                    const hit = resolveArcadeArenaCollision(phase, player, prev);
                    if (hit) walls.resolvePlayerWallCollision(player, hit);
                    if (pitch > 0) assert.ok(player.position.y > prev.y, `${label}: rises in frame ${frames}`);
                    frames += 1;
                }
                assert.ok(reachAlong(player, down) - player.position.y <= 0, `${label}: still stuck after ${frames} frames`);
            }
        }
    }
});

test('arcade safety: a bounce off the tunnel wall heads back into the tunnel, never to the arena centre (parcours_rift)', () => {
    // parcours_rift foam block: pos (12, 32, 14), size (26, 54, 10), tunnel radius 4.2 along x,
    // MAP_SCALE 3. The tunnel box reports its nearest face (+-z), across the flight path.
    const S = 3;
    const centre = new THREE.Vector3(12 * S, 32 * S, 14 * S);
    const half = new THREE.Vector3(13 * S, 27 * S, 5 * S);
    const radius = 4.2 * S;
    const heading = new THREE.Vector3();
    const outward = new THREE.Vector3();
    for (const kind of ['foam', 'hard']) {
        for (const angle of [12, 20, 30, 45]) {
            for (const around of [0, 90, 180, 270]) {
                for (const roll of [0, 90]) {
                    const label = `${kind} ${angle} deg towards ${around}, roll ${roll}`;
                    const arena = createRealArena([{
                        box: new THREE.Box3(centre.clone().sub(half), centre.clone().add(half)), isWall: false, kind,
                        tunnel: { cx: centre.x, cy: centre.y, cz: centre.z, radius, axis: 'x' },
                    }]);
                    arena.bounds = { minX: -300, maxX: 300, minY: 0, maxY: 300, minZ: -300, maxZ: 300 };
                    const owner = {
                        arena, players: [], botByPlayer: new Map(), runtimeRng: { next: () => 0.5 },
                        _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpDir: new THREE.Vector3(),
                        checkGlobalCollision: () => null,
                        _trailSpatialIndex: { gridSize: 10, checkGlobalCollision: () => null },
                        constructor: { deriveSelfTrailSkipRecentSegments: () => 0 },
                    };
                    const response = new CollisionResponseSystem(owner);
                    response.spawnPlacementSystem = new SpawnPlacementSystem(owner, { isBotPositionSafe: (p, pos) => response.isBotPositionSafe(p, pos) });
                    let bounces = 0;
                    owner._bouncePlayerOnFoam = (p, n) => { bounces += 1; response.bouncePlayerOnFoam(p, n); };
                    owner._bounceBot = (p, n, source, options) => { bounces += 1; response.bounceBot(p, n, source, options); };
                    // A Star-Cruiser bot; the hard tunnel bounces it through HuntCollisionOps like the Arcade strategy.
                    const ship = makePlayer('ship5', null, 1);
                    Object.assign(ship, { isBot: true, index: 0, hitboxRadius: 1.2, trail: { forceGap() {} } });
                    ship.getDirection = (out) => out.set(0, 0, -1).applyQuaternion(ship.quaternion);
                    ship.getAimDirection = ship.getDirection;
                    owner.players.push(ship);
                    const a = around * Math.PI / 180;
                    const t = angle * Math.PI / 180;
                    const dir = new THREE.Vector3(Math.cos(t), Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a));
                    faceAlong(ship, dir);
                    ship.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll * Math.PI / 180));
                    ship.position.set(centre.x - 36, centre.y, centre.z);
                    const phase = new PlayerCollisionPhase(owner);
                    const strategy = {
                        handleWallCollision: (p, collision, manager) => { recoverPlayerFromCollision(p, collision, 'WALL', manager); return false; },
                        handleTrailCollision: () => false,
                    };
                    for (let frame = 0; frame < 400 && bounces === 0; frame++) {
                        const prev = ship.position.clone();
                        ship._renderPrevQuaternion.copy(ship.quaternion);
                        ship.position.addScaledVector(dir, 0.5);
                        phase.run(ship, prev, strategy);
                    }
                    assert.equal(bounces, 1, `${label}: reached the tunnel wall`);
                    outward.set(0, ship.position.y - centre.y, ship.position.z - centre.z);
                    assert.ok(outward.length() < radius, `${label}: stays in the tunnel, not in the arena centre (${ship.position.toArray()})`);
                    assert.ok(ship.getDirection(heading).dot(outward.normalize()) < 0, `${label}: heads back towards the axis`);
                }
            }
        }
    }
});

// Own trail on a straight flight: the real Trail (a segment every TRAIL.UPDATE_INTERVAL, no gaps),
// the real TrailSpatialIndex and PlayerCollisionPhase.run, whose skip comes from the real
// EntityManager.deriveSelfTrailSkipRecentSegments. `legs` are [speed, distance] pieces flown in a
// row along -z; each frame moves, lays the trail and checks it (PlayerLifecycleSystem order).
const HITBOX_RADIUS = new Map(listVehicleDescriptors().map((entry) => [entry.id, entry.hitboxRadius]));
const HEADLESS_RENDERER = { addToScene() {}, removeFromScene() {}, getGraphicsStyle() { return 'classic'; } };
const FORWARD = new THREE.Vector3(0, 0, -1);

function createTrailFlight(vehicleId, sizes, s) {
    const players = [];
    const trailSpatialIndex = new TrailSpatialIndex({ getPlayers: () => players });
    const manager = {
        constructor: EntityManager,
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_SECTIONS),
        runtimeRng: { next: () => 1 },
        arena: { getCollisionInfo: () => null },
        players,
        getTrailSpatialIndex: () => trailSpatialIndex,
        _trailSpatialIndex: trailSpatialIndex,
    };
    const player = makePlayer(vehicleId, sizes, s);
    // Production hitboxBox is finite (fallback or mesh box); an empty Box3 would read as an endless body.
    Object.assign(player, { index: 0, entityManager: manager, hitboxBox: null, hitboxRadius: (HITBOX_RADIUS.get(vehicleId) || PLAYER.HITBOX_RADIUS) * s });
    player.trail = new Trail(HEADLESS_RENDERER, 0xffffff, 0, manager);
    players.push(player);
    const causes = [];
    const strategy = { handleWallCollision: () => false, handleTrailCollision: (p, collision, cause) => { causes.push(cause); return false; } };
    return { player, phase: new PlayerCollisionPhase(manager), strategy, causes };
}

function flyStraight(flight, legs, dt = CONFIG_SECTIONS.TIME_STEP, direction = FORWARD) {
    const { player, phase, strategy, causes } = flight;
    const prev = new THREE.Vector3();
    for (const [speed, distance] of legs) {
        player.speed = speed;
        for (let flown = 0; flown < distance; flown += speed * dt) {
            prev.copy(player.position);
            player.position.addScaledVector(direction, speed * dt);
            player.trail.update(dt, player.position, direction);
            phase.run(player, prev, strategy);
            if (causes.length > 0) return `${causes[0]} at ${speed.toFixed(2)} u/s after ${flown.toFixed(2)} u`;
        }
    }
    return '';
}

test('arcade safety: a straight flight never hits its own trail - slowest speed, speed jumps, grown parts, every plane scale', () => {
    const slowDown = PICKUP_REGISTRY.SLOW_DOWN.multiplier;
    const scales = [SETTINGS_LIMITS.gameplay.planeScale.min, 1, 1.5, SETTINGS_LIMITS.gameplay.planeScale.max];
    let flights = 0;
    for (const config of FACTORY) {
        for (const sizes of [null, { hull: 125 }, { wings: 125 }, { engines: 125 }, { hull: 125, engines: 80 }]) {
            const build = { sizeWorkshopUnlocked: true, purchasedSizeSteps: 25, partSizes: sizes };
            // Slowest cruise: lowest speed setting x table/engine tempo x SLOW_DOWN (Manta, engines 80 %: 2.88 u/s).
            const slowest = SETTINGS_LIMITS.gameplay.speed.min * resolveArcadeVehicleBuildStats(config.id, build).speedPct / 100 * slowDown;
            for (const s of scales) {
                const label = `${config.id} ${JSON.stringify(sizes)} s=${s} at ${slowest.toFixed(2)} u/s`;
                const cruise = [slowest, 2.5 * makePlayer(config.id, sizes, s).arcadeHitbox.wall.boundRadius * s + 3];
                assert.equal(flyStraight(createTrailFlight(config.id, sizes, s), [cruise]), '', `${label}: cruise`);
                // The short slow segments are still behind the ship when it speeds up (boost, map push),
                // also on the long slow-motion step of the owner.
                for (const [fast, dt] of [[slowest * PLAYER.BOOST_MULTIPLIER, CONFIG_SECTIONS.TIME_STEP], [slowest + ARCADE_EXTERNAL_IMPULSE_MAX, 1 / 24]]) {
                    assert.equal(flyStraight(createTrailFlight(config.id, sizes, s), [cruise, [fast, 12]], dt), '', `${label}: then ${fast.toFixed(1)} u/s, step ${dt.toFixed(3)} s`);
                }
                flights += 3;
            }
        }
    }
    assert.equal(flights, FACTORY.length * 5 * scales.length * 3);
});

test('arcade safety: the skipped own trail stays behind the ship - crossing an older stretch still hits', () => {
    for (const s of [SETTINGS_LIMITS.gameplay.planeScale.min, SETTINGS_LIMITS.gameplay.planeScale.max]) {
        const flight = createTrailFlight('manta', { hull: 125 }, s);
        const reach = flight.player.arcadeHitbox.wall.boundRadius * s;
        assert.equal(flyStraight(flight, [[30, 80]]), '', 'the straight stretch itself is free');
        // Gap, then back across that stretch sideways (+x), slowly, 60 u behind its end.
        flight.player.trail.forceGap(10);
        flight.player.position.set(-2 * reach, 0, -20);
        faceAlong(flight.player, new THREE.Vector3(1, 0, 0));
        assert.match(flyStraight(flight, [[4, 4 * reach]], CONFIG_SECTIONS.TIME_STEP, new THREE.Vector3(1, 0, 0)), /^TRAIL_SELF/, `s=${s}`);
    }
});

test('arcade safety: only the Arcade part hitbox measures the laid trail; other modes keep the capped speed estimate', () => {
    const flight = createTrailFlight('manta', { hull: 125 }, 2);
    assert.equal(flyStraight(flight, [[3.2, 30]]), '');
    const measured = EntityManager.deriveSelfTrailSkipRecentSegments(flight.player);
    assert.ok(measured > 12, `Arcade skips the whole tail stretch (${measured} segments)`);
    assert.ok(EntityManager.deriveSelfTrailSkipRecentSegments(flight.player, 1) >= measured, 'the frame move widens it');
    flight.player.arcadeHitbox = null;
    assert.equal(EntityManager.deriveSelfTrailSkipRecentSegments(flight.player, 5), 12, 'estimate, cap and signature use unchanged');
});

test('arcade safety: no module state keeps the last match alive', async () => {
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc');
    const player = makePlayer('ship5', null, 1);
    player.index = 0;
    let phase = new PlayerCollisionPhase({
        arena: createRealArena([boxObstacle([-1, -1, -30], [1, 1, -20])]),
        _trailSpatialIndex: { gridSize: 10, checkGlobalCollision: () => ({ hit: true, playerIndex: 1 }) },
    });
    const refs = [phase, phase.entityManager.arena, phase.entityManager._trailSpatialIndex].map((target) => new WeakRef(target));
    player.position.set(0, 0, -1);
    resolveArcadeArenaCollision(phase, player, new THREE.Vector3());
    resolveArcadeTrailCollision(phase, player, new THREE.Vector3(), 0);
    phase = null;
    await new Promise((resolve) => setImmediate(resolve));
    gc();
    assert.deepEqual(refs.map((ref) => ref.deref() === undefined), [true, true, true], 'phase, arena and trail index are collectable');
});
