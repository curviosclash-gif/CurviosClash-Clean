// ============================================
// arcade-hitbox-consumers.contract.test.mjs - Paket 2b: every hit test follows the part
// boxes in Arcade (MG ray, projectiles, trails, crashes, bot radius, spawn switch, bounce
// landing, own-trail skip) and stays exactly as before without player.arcadeHitbox.
// Star-Cruiser at 100 %: right wing box reaches x 2.16, z -0.99..0.66 (engine from z 0.71).
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

import {
    applyArcadePartHitbox,
    applyArcadeSpawnHitbox,
    rayHitsArcadePartBoxes,
    segmentHitsArcadePartBoxes,
    syncArcadePartHitbox,
} from '../src/entities/player/ArcadePartHitboxOps.js';
import { CollisionResponseSystem } from '../src/entities/systems/CollisionResponseSystem.js';
import { estimatePointRisk } from '../src/entities/ai/BotTargetingOps.js';
import { isSphereInPlayerOBB } from '../src/entities/player/PlayerMotionOps.js';
import { resolvePlayerRayEntryDistance } from '../src/hunt/HuntPlayerRayOps.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { arcadeShipsTouch, resolveArcadeTrailCollision } from '../src/entities/systems/lifecycle/ArcadePartCollisionOps.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { listVehicleDescriptors } from '../src/entities/vehicle-registry.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicle-lab/player-ships/index.js';

const BESIDE_TIP = 2.31;
const ON_WING = 1.8;
const WING_Z = -0.5;

function makeShip({ scale = 1, sizes = null, arcade = true, isBot = false } = {}) {
    const player = {
        vehicleId: 'ship5', modelScale: scale, arcadePartSizes: sizes, alive: true, isBot, index: 0,
        hitboxRadius: 1.2 * scale, hitboxBox: new THREE.Box3(new THREE.Vector3(-1, -0.3, -1.6), new THREE.Vector3(1, 0.3, 1.6)),
        position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), _renderPrevQuaternion: new THREE.Quaternion(),
        _tmpWorldToLocal: new THREE.Matrix4(), _tmpLocalSphere: new THREE.Sphere(), _tmpHitboxScale: new THREE.Vector3(),
        _obbCollisionPrepared: false,
    };
    player.isSphereInOBB = (center, radius) => isSphereInPlayerOBB(player, center, radius);
    if (arcade) applyArcadePartHitbox(player);
    return player;
}

const down = new THREE.Vector3(0, -1, 0);
const above = (x) => new THREE.Vector3(x, 10, WING_Z);

test('arcade consumers: MG ray beside the wing tip misses, on the wing hits', () => {
    const ship = makeShip();
    const scratch = new THREE.Vector3();
    assert.equal(resolvePlayerRayEntryDistance(ship, above(BESIDE_TIP), down, 100, scratch), -1);
    const entry = resolvePlayerRayEntryDistance(ship, above(ON_WING), down, 100, scratch);
    assert.ok(entry > 9.5 && entry < 10.5, `entry ${entry}`);
    assert.equal(resolvePlayerRayEntryDistance(ship, above(ON_WING), down, 5, scratch), -1, 'out of range');

    // Bigger wings reach the old miss.
    const big = makeShip({ sizes: { wings: 125 } });
    assert.ok(rayHitsArcadePartBoxes(big, above(BESIDE_TIP), down, 100) > 0);

    // Turned and scaled ship: same answer in world space.
    const turned = makeShip({ scale: 2 });
    turned.position.set(50, 5, -20);
    turned.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const local = (x) => new THREE.Vector3(x * 2, 0, WING_Z * 2).applyQuaternion(turned.quaternion).add(turned.position);
    const from = (x) => local(x).add(new THREE.Vector3(0, 20, 0));
    assert.equal(rayHitsArcadePartBoxes(turned, from(BESIDE_TIP), down, 100), -1);
    assert.ok(rayHitsArcadePartBoxes(turned, from(ON_WING), down, 100) > 0);
});

test('arcade consumers: projectiles and rockets use the part boxes, no sphere fallback', () => {
    const resolver = new ProjectileHitResolver({ _tmpVec: new THREE.Vector3() });
    const ship = makeShip();
    const shot = (x) => ({ radius: 0.05, previousPosition: above(x), position: new THREE.Vector3(x, -10, WING_Z) });
    const miss = shot(BESIDE_TIP);
    assert.equal(resolver._isProjectileSweepTouchingTarget(miss, ship), false);
    assert.equal(resolver._isProjectileTouchingTarget(miss, ship, new THREE.Vector3(BESIDE_TIP, -0.27, WING_Z)), false, 'inside the old sphere, beside the wing');
    const hit = shot(ON_WING);
    assert.equal(resolver._isProjectileSweepTouchingTarget(hit, ship), true);
    assert.ok(hit.position.y > -0.5 && hit.position.y < 0, `projectile stops on the wing (${hit.position.y})`);
    assert.ok(segmentHitsArcadePartBoxes(ship, above(BESIDE_TIP), new THREE.Vector3(BESIDE_TIP, -10, WING_Z), 0.2) > 0, 'rocket radius inflates');
});

test('arcade consumers: trails see the wall shape along the move', () => {
    const ship = makeShip();
    const calls = [];
    const pole = (x) => ({
        gridSize: 10,
        checkGlobalCollision(point, radius, index, skip, ref, cellRange) {
            calls.push(cellRange);
            return Math.hypot(point.x - x, point.z - WING_Z) <= radius + 0.05 ? { hit: true, playerIndex: 1 } : null;
        },
    });
    const phase = (x) => ({ entityManager: { _trailSpatialIndex: pole(x) } });
    assert.equal(resolveArcadeTrailCollision(phase(BESIDE_TIP + 0.3), ship, ship.position.clone(), 0), null);
    assert.equal(resolveArcadeTrailCollision(phase(ON_WING), ship, ship.position.clone(), 0)?.playerIndex, 1);

    // A long move asks one wide prefilter first.
    calls.length = 0;
    ship.position.set(0, 0, -40);
    assert.equal(resolveArcadeTrailCollision(phase(500), ship, new THREE.Vector3(), 0), null);
    assert.deepEqual(calls, [3], 'prefilter covers radius 20 + ship with a 7x7 cell block');
});

test('arcade consumers: crashes compare both part shapes', () => {
    const a = makeShip();
    const b = makeShip();
    b.index = 1;
    // The wing-tip engines are the outermost parts (box to x 2.38).
    b.position.set(2.38 * 2 - 0.2, 0, 0);
    assert.equal(arcadeShipsTouch(a, b), true, 'engines overlap');
    b.position.set(2.38 * 2 + 1.0, 0, 0);
    assert.equal(arcadeShipsTouch(a, b), false, 'ships apart (a probe sphere overreaches its box by < 0.5)');
    b.position.set(0, 0, 2.6);
    assert.equal(arcadeShipsTouch(a, b), true, 'nose into tail');
});

test('arcade consumers: bots dodge with the wall shape radius, spawn switch follows the run type', () => {
    const bot = makeShip({ arcade: false, isBot: true, scale: 2 });
    const legacy = bot.hitboxRadius;
    applyArcadeSpawnHitbox(bot, true);
    assert.equal(bot.arcadeAvoidRadius, bot.arcadeHitbox.wall.crossRadius * 2);
    assert.ok(bot.arcadeAvoidRadius > legacy);
    assert.equal(bot.hitboxRadius, legacy, 'pickups, portals, gates, bounces, turrets, mines, markers, hazards keep theirs');
    bot.arcadePartSizes = { wings: 125 };
    syncArcadePartHitbox(bot);
    assert.equal(bot.hitboxRadius, legacy, 'bigger parts do not grow it either');
    assert.equal(bot.arcadeAvoidRadius, bot.arcadeHitbox.wall.crossRadius * 2);
    applyArcadeSpawnHitbox(bot, false);
    assert.equal(bot.arcadeHitbox, null);
    assert.equal(bot.hitboxRadius, legacy);
    assert.equal(bot.arcadeAvoidRadius, 0);

    const spawnOps = new EntitySpawnOps({ _simulationClockMs: 0, gameModeStrategy: { isNormalArcadeRun: () => true } });
    const human = makeShip({ arcade: false });
    human.spawn = () => {};
    spawnOps.spawnPlayerAt(human, { x: 0, y: 0, z: 0 });
    assert.ok(human.arcadeHitbox, 'normal Arcade run');
    spawnOps.entityManager.gameModeStrategy = { isNormalArcadeRun: () => false };
    spawnOps.spawnPlayerAt(human, { x: 0, y: 0, z: 0 });
    assert.equal(human.arcadeHitbox, null, 'daily / weapon race');
    spawnOps.entityManager.gameModeStrategy = {};
    spawnOps.spawnPlayerAt(human, { x: 0, y: 0, z: 0 });
    assert.equal(human.arcadeHitbox, null, 'other modes');
    assert.equal(human.hitboxRadius, 1.2);
});

test('arcade consumers: bounce and spawn search keep the old radius, only bot sensing widens', () => {
    const bot = makeShip({ arcade: false, isBot: true });
    bot.spawn = () => {};
    const radii = [];
    const spawnOps = new EntitySpawnOps({
        _simulationClockMs: 0,
        gameModeStrategy: { isNormalArcadeRun: () => true },
        _findSpawnPosition: () => new THREE.Vector3(),
        _findSafeSpawnDirection: (pos, radius) => { radii.push(radius); return null; },
    });
    spawnOps.spawnPlayer(bot);
    spawnOps.spawnPlayer(bot);
    assert.ok(bot.arcadeHitbox, 'normal Arcade run');
    assert.deepEqual(radii, [1.2, 1.2], 'first spawn and respawn search with the same radius');

    const checked = [];
    const arena = { checkBotCollisionFast: (point, radius) => { checked.push(radius); return false; } };
    const response = new CollisionResponseSystem({ arena, checkGlobalCollision: (point, radius) => { checked.push(radius); return null; } });
    assert.equal(response.isBotPositionSafe(bot, new THREE.Vector3()), true);
    assert.deepEqual(checked, [1.2, 1.2], 'bounce landing check (else the fallback puts the ship in the arena centre)');

    checked.length = 0;
    estimatePointRisk({ checkTrailHit: () => false }, new THREE.Vector3(), bot, arena, [bot]);
    assert.deepEqual(checked, [bot.arcadeHitbox.wall.crossRadius * 2], 'bot risk probe dodges with the wall shape');
});

test('arcade consumers: a bounce without a safe landing keeps the swept pose in Arcade, not the arena centre', () => {
    // The wall sweep stops the part boxes at the wall, nearer than the 1.2 landing sphere allows.
    const owner = { arena: { bounds: { minX: -10, maxX: 30, minY: 0, maxY: 20, minZ: -10, maxZ: 10 } }, _tmpVec2: new THREE.Vector3() };
    const placement = new SpawnPlacementSystem(owner, { isBotPositionSafe: () => false });
    for (const arcade of [true, false]) {
        const ship = makeShip({ arcade, isBot: true });
        ship.position.set(3, 4, 5);
        placement.findSafeBouncePosition(ship, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), { normalPush: 2 }, 1);
        assert.deepEqual(ship.position.toArray(), arcade ? [3, 4, 5] : [10, 10, 0], arcade ? 'Arcade part hitbox' : 'other modes unchanged');
    }
});

test('arcade consumers: the own-trail skip covers the wall shape tail (long Arrow tail at low speed)', () => {
    const radiusOf = new Map(listVehicleDescriptors().map((entry) => [entry.id, entry.hitboxRadius]));
    let checked = 0;
    for (const config of PLAYER_SHIP_PART_CONFIGS) {
        for (const size of [80, 100, 125]) {
            const sizes = { hull: size, nose: size, wings: size, engines: size, utility: size };
            for (const s of [0.6, 1, 1.5]) {
                const player = { vehicleId: config.id, arcadePartSizes: sizes, modelScale: s, hitboxRadius: (radiusOf.get(config.id) || 1.2) * s, trail: { width: 0.6 } };
                applyArcadePartHitbox(player);
                const { probes } = player.arcadeHitbox.wall;
                let tail = 0;
                for (let k = 0; k < probes.length; k += 4) tail = Math.max(tail, (probes[k + 2] + probes[k + 3]) * s);
                const interval = resolveEntityRuntimeConfig(player).TRAIL.UPDATE_INTERVAL;
                for (const speed of [12, 16, 20, 30, 54]) {
                    player.speed = speed;
                    const skip = EntityManager.deriveSelfTrailSkipRecentSegments(player);
                    // The speed estimate's cap. It only runs without a laid trail here; with one, Arcade
                    // measures the trail itself (arcade-collision-safety: straight flight).
                    if (skip >= 12) continue;
                    // The newest segment is still growing: the skipped ones reach (skip - 1) spacings back.
                    const covered = (skip - 1) * speed * interval;
                    assert.ok(covered >= tail + 0.3, `${config.id} ${size}% s=${s} ${speed} u/s: skip ${skip} covers ${covered.toFixed(2)} < tail ${(tail + 0.3).toFixed(2)}`);
                    checked += 1;
                }
            }
        }
    }
    assert.ok(checked > 300, `checked ${checked}`);
});

test('arcade consumers: every bot sensor reads the evasion radius first', () => {
    const files = ['src/entities/Bot.js', ...readdirSync('src/entities/ai', { recursive: true })
        .filter((name) => String(name).endsWith('.js'))
        .map((name) => join('src/entities/ai', String(name)))];
    const readers = files.flatMap((file) => readFileSync(file, 'utf8').split('\n')
        .filter((line) => /player\.hitboxRadius/.test(line))
        .map((line) => `${file}: ${line.trim()}`));
    assert.ok(readers.length >= 10, `found the bot sensors (${readers.length})`);
    for (const line of readers) assert.match(line, /player\.arcadeAvoidRadius \|\| player\.hitboxRadius/, line);
});

test('arcade consumers: after a wall bounce the trail check follows the flown path, not a made-up turn', () => {
    for (const [trailX, expectHit] of [[2.9, false], [2.0, true]]) {
        const ship = makeShip();
        ship.getDirection = (out) => out.set(0, 0, -1).applyQuaternion(ship.quaternion);
        ship.refreshObbCollisionQuery = () => {};
        const probes = ship.arcadeHitbox.wall.probes;
        let nose = 0;
        for (let k = 0; k < probes.length; k += 4) nose = Math.min(nose, probes[k + 2] - probes[k + 3]);
        const wallZ = nose - 0.2;
        const wall = { hit: true, kind: 'wall', isWall: true, normal: new THREE.Vector3(0, 0, 1) };
        const manager = {
            arena: {
                getCollisionInfo: (point, radius) => (point.z - radius <= wallZ ? wall : null),
                checkCollision: (point, radius) => point.z - radius <= wallZ,
            },
            players: [ship],
            constructor: { deriveSelfTrailSkipRecentSegments: () => 0 },
            // Another player's trail runs beside the flight path at x = trailX.
            _trailSpatialIndex: { gridSize: 10, checkGlobalCollision: (point, radius) => (Math.hypot(point.x - trailX, point.y) <= radius ? { hit: true, playerIndex: 1 } : null) },
            _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpDir: new THREE.Vector3(),
        };
        manager.arena.getBotCollisionInfo = manager.arena.getCollisionInfo;
        const walls = new CollisionResponseSystem(manager);
        let trailHits = 0;
        const strategy = {
            handleWallCollision: (player, collision) => { walls.resolvePlayerWallCollision(player, collision); return false; },
            handleTrailCollision: () => { trailHits += 1; return false; },
        };
        const prev = ship.position.clone();
        ship.position.set(0, 0, -0.5);
        new PlayerCollisionPhase(manager).run(ship, prev, strategy);
        assert.ok(ship.getDirection(new THREE.Vector3()).z > 0.99, 'frontal wall contact turned the ship around');
        assert.equal(trailHits > 0, expectHit, `trail at x ${trailX}`);
    }
});

test('arcade consumers: without arcadeHitbox every consumer keeps the old answer', () => {
    const ship = makeShip({ arcade: false });
    const scratch = new THREE.Vector3();
    // Old sphere radius 1.2: a ray at x 1.1 hits, x 1.3 misses - whatever the wings do.
    assert.ok(resolvePlayerRayEntryDistance(ship, new THREE.Vector3(1.1, 10, 0), down, 100, scratch) > 0);
    assert.equal(resolvePlayerRayEntryDistance(ship, new THREE.Vector3(1.3, 10, 0), down, 100, scratch), -1);
    // Old oriented box (hitboxBox) decides sphere contacts.
    assert.equal(isSphereInPlayerOBB(ship, new THREE.Vector3(1.05, 0, 0), 0.01), false);
    assert.equal(isSphereInPlayerOBB(ship, new THREE.Vector3(0.95, 0, 0), 0.01), true);
    const resolver = new ProjectileHitResolver({ _tmpVec: new THREE.Vector3() });
    assert.equal(resolver._isProjectileTouchingTarget({ radius: 0.05 }, ship, new THREE.Vector3(1.1, 0.4, 0)), true, 'old sphere fallback');

    // The collision phase takes the old arena path.
    const phase = new PlayerCollisionPhase({ arena: { getCollisionInfo: () => null }, players: [ship], checkGlobalCollision: () => null, constructor: { deriveSelfTrailSkipRecentSegments: () => 0 } });
    let legacyCalls = 0;
    const original = phase._resolveArenaCollision.bind(phase);
    phase._resolveArenaCollision = (...args) => { legacyCalls += 1; return original(...args); };
    ship.getAimDirection = (out) => out.set(0, 0, -1);
    ship.getDirection = (out) => out.set(0, 0, -1);
    phase.entityManager._tmpDir = new THREE.Vector3();
    phase.entityManager._tmpVec = new THREE.Vector3();
    phase.entityManager._tmpVec2 = new THREE.Vector3();
    phase.run(ship, ship.position.clone(), {});
    assert.equal(legacyCalls, 1);
    assert.equal(ship.hitboxRadius, 1.2, 'radius untouched');
});
