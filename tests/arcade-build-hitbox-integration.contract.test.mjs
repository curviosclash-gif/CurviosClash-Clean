// ============================================
// arcade-build-hitbox-integration.contract.test.mjs - Paket 2a x 2b: the size build and the
// part hitbox meet on the real run paths. The boxes follow the sizes of this spawn (first
// spawn, respawn, sector change, endless, five portals, arena waves after a map change, a
// new run with other sizes; bots stay at 100 %), the drawn part and its box grow by the same
// factor, a nose-built rocket hits the boxes with its multiplied damage, and stats and boxes
// read the same normalized sizes.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { normalizeArcadeUpgradeBonuses } from '../src/modes/ArcadeVehicleStatOps.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { applyArcadePartHitbox, syncArcadePartHitbox } from '../src/entities/player/ArcadePartHitboxOps.js';
import { setEndlessRunProfile } from '../src/entities/endless/EndlessParcoursProgressionOps.js';
import { getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import { RuntimeModularVehicleMesh } from '../src/entities/runtime-modular-vehicle-mesh.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { resolveRocketTierDamage } from '../src/hunt/RocketPickupSystem.js';
import { ARENA_WAVES_COMBAT_PROFILE } from '../src/shared/contracts/ArenaWavesContract.js';
import { ARCADE_HITBOX_MIN_THICKNESS, buildArcadeHitboxShape } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { resolveArcadePartSizeFactors, resolveArcadeSizeGroupForRole } from '../src/shared/contracts/ArcadeVehicleSizeContract.js';
import { resolveArcadeWallHitboxScale } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    createArcadeVehicleProfileRecord,
} from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { getArcadeRunVehicleBonuses } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { PLAYER_SHIP_PART_CONFIGS } from '../src/shared/vehicle-lab/player-ships/index.js';

const ARCADE_CONFIG = Object.freeze({
    ...DEFAULT_ENTITY_RUNTIME_CONFIG,
    HUNT: { ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT, ACTIVE_MODE: 'ARCADE' },
});
const FACTORY_IDS = [...PLAYER_SHIP_PART_CONFIGS.map((config) => config.id), 'lab_helix_interceptor'];
const MIXED = Object.freeze({ hull: 125, nose: 80, wings: 115, engines: 90, utility: 105 });

function sizes(partial = {}) {
    return { hull: 100, nose: 100, wings: 100, engines: 100, utility: 100, ...partial };
}

function sizedProfile(vehicleId, partSizes) {
    return {
        ...createArcadeVehicleProfileRecord(vehicleId, 0),
        xpBank: 1_000_000,
        sizeWorkshopUnlocked: true,
        purchasedSizeSteps: 25,
        partSizes: sizes(partSizes),
    };
}

function makePlayer(vehicleId, { isBot = false, index = 0 } = {}) {
    return {
        index, vehicleId, isBot, alive: true, modelScale: 1, hitboxRadius: 1.2,
        baseSpeed: 40, speed: 40, turnSpeed: 2, hasShield: false,
        maxHp: 1, hp: 1, maxShieldHp: 1, shieldHP: 0, inventory: [], rocketInventory: [], activeEffects: [],
        entityRuntimeConfig: ARCADE_CONFIG,
        position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
        hitboxBox: new THREE.Box3(new THREE.Vector3(-1, -0.3, -1.6), new THREE.Vector3(1, 0.3, 1.6)),
        vehicleMesh: new RuntimeModularVehicleMesh(0x3366ff, getVehicleModularConfig(vehicleId)),
        spawn() { this.alive = true; },
    };
}

function boxesFor(vehicleId, partSizes) {
    return Array.from(buildArcadeHitboxShape(getVehicleModularConfig(vehicleId).parts, partSizes).boxes);
}

function assertBoxes(player, partSizes, label) {
    assert.ok(player.arcadeHitbox, `${label}: part hitbox on`);
    assert.deepEqual(Array.from(player.arcadeHitbox.full.boxes), boxesFor(player.vehicleId, partSizes), label);
}

/**
 * The real run start: GameRuntimeArcadeSupport.startRunIfEnabled (cosmetics, size build, run
 * runtime), then MatchStartRuntimeService.startRound -> resetRoundRuntime -> spawnAll ->
 * EntitySpawnOps.spawnPlayerAt. Every session is a new strategy, like a (re)built MatchSession.
 */
function createRunHarness(runType, profiles, { dailyChallenge = false } = {}) {
    const holder = { runtimeState: null, profiles };
    const store = {
        loadJsonRecord: (key, fallback) => (key === ARCADE_VEHICLE_PROFILE_STORAGE_KEY ? holder.profiles : fallback),
    };
    const support = new GameRuntimeArcadeSupport({
        getRuntimeState: () => holder.runtimeState,
        getGame: () => ({ settingsManager: { getPlayerRecordStorePort: () => store } }),
        nowMs: () => 1000,
    });
    const startSession = ({ vehicleId = 'ship5', players = null } = {}) => {
        const combatProfile = runType === 'arena_waves' ? ARENA_WAVES_COMBAT_PROFILE : undefined;
        const strategy = new ArcadeModeStrategy({ runType, combatProfile, isDailyChallenge: dailyChallenge });
        const sessionPlayers = players || [makePlayer(vehicleId), makePlayer(vehicleId, { isBot: true, index: 1 })];
        const human = sessionPlayers[0];
        const bot = sessionPlayers.find((player) => player?.isBot === true) || null;
        const entityManager = {
            players: sessionPlayers,
            humanPlayers: sessionPlayers.filter((player) => player?.isBot !== true),
            bots: sessionPlayers.filter((player) => player?.isBot === true),
            gameModeStrategy: strategy, _simulationClockMs: 0,
        };
        const endless = {
            entityManager,
            setRecordStore() {},
            setRunProfile(options) { return setEndlessRunProfile(endless, options); },
            getHudState() { return null; },
        };
        holder.runtimeState = {
            runtimeConfig: {
                arcade: { enabled: true, runType, dailyChallenge, seed: 7 },
                player: { vehicles: { PLAYER_1: String(human?.vehicleId || vehicleId) } },
                session: { numBots: 1 },
            },
            entityManager,
            endlessParcoursRuntime: runType === 'endless_parcours' ? endless : null,
        };
        support.syncRuntimeConfig();
        support.startRunIfEnabled();
        const spawnOps = new EntitySpawnOps(entityManager);
        for (const player of entityManager.players) spawnOps.spawnPlayerAt(player, new THREE.Vector3());
        return { strategy, human, bot, players: sessionPlayers, spawnOps };
    };
    return { holder, support, startSession };
}

test('gauntlet map rebind reapplies each human vehicle profile after setStrategy', () => {
    const profiles = {
        ship1: { ...sizedProfile('ship1', {}), hangarBonuses: { speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0 } },
        ship5: { ...sizedProfile('ship5', { wings: 125 }), hangarBonuses: { speedBonusPct: 8, turningBonusPct: 10, maxHpBonus: 15 } },
        ship9: { ...sizedProfile('ship9', { engines: 80 }), hangarBonuses: { speedBonusPct: 20, turningBonusPct: 5, maxHpBonus: 30 } },
    };
    const run = createRunHarness('gauntlet', profiles);
    const makeRoster = () => [
        makePlayer('ship1', { index: 0 }),
        makePlayer('ship5', { index: 1 }),
        makePlayer('ship9', { index: 2 }),
    ];

    const first = run.startSession({ vehicleId: 'ship1', players: makeRoster() });
    for (const player of first.players) {
        assert.ok(Number.isFinite(first.strategy.getSpeedMultiplier(player)));
    }

    // A map/session rebuild rebinds a new strategy while the same run remains active;
    // startRunIfEnabled returns the existing run before it can republish the profile map.
    const rebound = run.startSession({ vehicleId: 'ship1', players: makeRoster() });
    const expected = new ArcadeModeStrategy({ runType: 'gauntlet' });
    expected.applyVehicleUpgrades({
        byVehicleId: Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, getArcadeRunVehicleBonuses(profile)])),
    });
    for (const player of rebound.players) {
        assert.equal(
            rebound.strategy.getSpeedMultiplier(player),
            expected.getSpeedMultiplier(player),
            `${player.vehicleId} uses its own saved functional profile after rebind`,
        );
        assert.deepEqual(
            player.arcadePartSizes,
            sizes(player.vehicleId === 'ship5' ? { wings: 125 } : (player.vehicleId === 'ship9' ? { engines: 80 } : {})),
            `${player.vehicleId} keeps its own size profile and hitbox source`,
        );
    }
    assert.notEqual(rebound.strategy.getSpeedMultiplier(rebound.players[0]), rebound.strategy.getSpeedMultiplier(rebound.players[1]));
    assert.notEqual(rebound.strategy.getSpeedMultiplier(rebound.players[1]), rebound.strategy.getSpeedMultiplier(rebound.players[2]));
});

test('daily challenge keeps fixed factory stats and sizes on first start and existing-run rebind', () => {
    const profiles = {
        ship1: { ...sizedProfile('ship1', { hull: 125 }), hangarBonuses: { speedBonusPct: 50, turningBonusPct: 50, maxHpBonus: 50 } },
        ship5: { ...sizedProfile('ship5', { wings: 125 }), hangarBonuses: { speedBonusPct: 50, turningBonusPct: 50, maxHpBonus: 50 } },
    };
    const run = createRunHarness('gauntlet', profiles, { dailyChallenge: true });
    const makeRoster = () => [makePlayer('ship1', { index: 0 }), makePlayer('ship5', { index: 1 })];
    const baseline = new ArcadeModeStrategy({ runType: 'gauntlet', isDailyChallenge: true });

    for (const session of [
        run.startSession({ vehicleId: 'ship1', players: makeRoster() }),
        run.startSession({ vehicleId: 'ship1', players: makeRoster() }),
    ]) {
        for (const player of session.players) {
            assert.equal(session.strategy.getSpeedMultiplier(player), baseline.getSpeedMultiplier(player));
            assert.equal(player.arcadePartSizes, undefined, 'daily size build is not applied');
            assert.equal(player.arcadeDamageMultiplier, undefined, 'daily profile build stays inactive');
        }
    }
});

// --- I1: the boxes are built from the sizes of this spawn ---

for (const runType of ['gauntlet', 'endless_parcours', 'five_portals', 'arena_waves']) {
    test(`I1: ${runType} - the human flies wing boxes of 125 %, the bot of 100 %`, () => {
        const run = createRunHarness(runType, { ship5: sizedProfile('ship5', { wings: 125 }) });
        const { strategy, human, bot, spawnOps } = run.startSession();
        assertBoxes(human, sizes({ wings: 125 }), 'first spawn');
        assertBoxes(bot, sizes(), 'bot');
        assert.deepEqual(human.arcadePartSizes, sizes({ wings: 125 }));

        // Respawn (RespawnSystem: spawn, resetPlayerHealth) and the next collision frame.
        const respawn = new RespawnSystem({
            callbacks: {
                getStrategy: () => strategy,
                parcours: {
                    isRespawnEnabled: () => true,
                    takeRespawnPlan: () => ({ position: [0, 0, 0], forward: [0, 0, -1], delaySeconds: 0.1 }),
                },
            },
        });
        human.alive = false;
        assert.equal(respawn.onPlayerDied(human), true);
        respawn.update(1);
        assert.equal(human.alive, true, 'respawned');
        syncArcadePartHitbox(human);
        assertBoxes(human, sizes({ wings: 125 }), 'respawn');

        // Sector change without a new session: spawnAll again on the same strategy.
        spawnOps.spawnPlayerAt(human, new THREE.Vector3());
        spawnOps.spawnPlayerAt(bot, new THREE.Vector3());
        assertBoxes(human, sizes({ wings: 125 }), 'next sector, same map');
        assertBoxes(bot, sizes(), 'bot, next sector');

        // Map change: a new session (new strategy and players) continues the run.
        const next = run.startSession();
        assertBoxes(next.human, sizes({ wings: 125 }), 'after the map change');
        assertBoxes(next.bot, sizes(), 'bot after the map change');
    });
}

test('I1/I5: a new run with other sizes rebuilds the boxes of a reused player', () => {
    const run = createRunHarness('five_portals', { ship5: sizedProfile('ship5', { wings: 125 }) });
    const first = run.startSession();
    assertBoxes(first.human, sizes({ wings: 125 }), 'first run');
    run.holder.profiles = { ship5: sizedProfile('ship5', { wings: 80, hull: 110 }) };
    run.support.resetRunState({ force: true });
    const second = run.startSession({ players: [first.human, first.bot] });
    assert.equal(second.human, first.human, 'same player object');
    assertBoxes(first.human, sizes({ wings: 80, hull: 110 }), 'second run');
    const wingScale = (mesh) => mesh.children.find((child) => child.name === 'Linker Flügel').scale.x;
    const factoryMesh = new RuntimeModularVehicleMesh(0x3366ff, getVehicleModularConfig('ship5'));
    assert.ok(Math.abs(wingScale(first.human.vehicleMesh) / wingScale(factoryMesh) - 0.8) < 1e-9, 'drawn at 80 % too');
});

// --- I3: the drawn part and its box grow by the same factor ---

function visualPartBoxes(mesh) {
    mesh.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const relative = new THREE.Matrix4();
    return mesh.children
        .filter((child) => child.userData?.config && !child.userData.runtimeVisual && !child.userData.runtimeHelper)
        .map((child) => {
            const box = new THREE.Box3();
            child.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
                relative.multiplyMatrices(inverse, node.matrixWorld);
                box.union(node.geometry.boundingBox.clone().applyMatrix4(relative));
            });
            return { name: child.name, box };
        });
}

/** Pairs every hitbox box with its drawn part: same name, same n-th occurrence (own half, then mirror). */
function pairByOccurrence(names, visual) {
    const seen = new Map();
    const byKey = new Map();
    for (const entry of visual) {
        const n = seen.get(entry.name) || 0;
        seen.set(entry.name, n + 1);
        byKey.set(`${entry.name}#${n}`, entry);
    }
    seen.clear();
    return names.map((name) => {
        const n = seen.get(name) || 0;
        seen.set(name, n + 1);
        return byKey.get(`${name}#${n}`) || null;
    });
}

function anchored(boxes, i, axis) {
    const t = ARCADE_HITBOX_MIN_THICKNESS / 2;
    const c = boxes[i * 6 + axis];
    const h = boxes[i * 6 + 3 + axis];
    return Math.abs(c - h + t) < 1e-9 || Math.abs(c + h - t) < 1e-9;
}

test('I3: every factory ship draws each part and grows its box by the same factor, walls see it shrunk', () => {
    let checked = 0;
    for (const vehicleId of FACTORY_IDS) {
        const run = createRunHarness('five_portals', { [vehicleId]: sizedProfile(vehicleId, MIXED) });
        const { human } = run.startSession({ vehicleId });
        const parts = getVehicleModularConfig(vehicleId).parts;
        const factors = resolveArcadePartSizeFactors(parts, MIXED);
        const factory = buildArcadeHitboxShape(parts, null);
        const sized = human.arcadeHitbox.full;
        assert.deepEqual(sized.names, factory.names, `${vehicleId}: same boxes`);
        // Walls and trails see the sized shape shrunk by the wall factor (Manta 0.14), bots dodge with it.
        const wallScale = resolveArcadeWallHitboxScale(vehicleId);
        assert.deepEqual(Array.from(human.arcadeHitbox.wall.boxes),
            Array.from(buildArcadeHitboxShape(parts, MIXED, { originScale: wallScale }).boxes), `${vehicleId}: wall shape`);
        assert.equal(human.arcadeAvoidRadius, human.arcadeHitbox.wall.crossRadius);
        if (vehicleId === 'manta') assert.equal(wallScale, 0.14);
        const drawn = pairByOccurrence(sized.names, visualPartBoxes(human.vehicleMesh));
        const plain = pairByOccurrence(factory.names, visualPartBoxes(new RuntimeModularVehicleMesh(0x3366ff, getVehicleModularConfig(vehicleId))));
        const groups = new Set();
        for (let i = 0; i < sized.count; i++) {
            const factor = factors[sized.names[i]] || 1;
            assert.ok(drawn[i] && plain[i], `${vehicleId} ${sized.names[i]}: drawn part found`);
            const drawnSize = drawn[i].box.getSize(new THREE.Vector3()).toArray();
            const plainSize = plain[i].box.getSize(new THREE.Vector3()).toArray();
            for (let axis = 0; axis < 3; axis++) {
                if (plainSize[axis] < 1e-6 || factory.boxes[i * 6 + 3 + axis] < 1e-6) continue;
                if (sized.roles[i] === 'core' && (anchored(sized.boxes, i, axis) || anchored(factory.boxes, i, axis))) continue;
                const drawnRatio = drawnSize[axis] / plainSize[axis];
                const boxRatio = sized.boxes[i * 6 + 3 + axis] / factory.boxes[i * 6 + 3 + axis];
                const label = `${vehicleId} ${sized.names[i]} axis ${axis}`;
                assert.ok(Math.abs(drawnRatio - factor) < 1e-6, `${label}: drawn x${drawnRatio.toFixed(4)}, factor ${factor}`);
                assert.ok(Math.abs(boxRatio - factor) < 1e-9, `${label}: box x${boxRatio.toFixed(4)}, factor ${factor}`);
                if (factor !== 1) groups.add(resolveArcadeSizeGroupForRole(sized.roles[i]));
                checked += 1;
            }
        }
        assert.deepEqual([...groups].sort(), ['engines', 'hull', 'nose', 'utility', 'wings'].filter((group) => (
            parts.some((part) => resolveArcadeSizeGroupForRole(part.role) === group)
        )), `${vehicleId}: every sized group was compared`);
    }
    assert.ok(checked > 200, `checked ${checked} axes`);
});

// --- I4: nose damage (2a) and the box segment test (2b) on one rocket ---

const BESIDE_TIP = 2.31;
const ON_WING = 1.8;
const WING_Z = -0.5;

function fireRocketDown(x, owner, targetSizes) {
    const system = {
        entityRuntimeConfig: ARCADE_CONFIG, _tmpVec: new THREE.Vector3(),
        getTurrets: () => [], onProjectileHit() {}, onProjectilePowerup() {}, onProjectileDamage() {},
    };
    const target = {
        index: 1, vehicleId: 'ship5', alive: true, isBot: true, modelScale: 1, hitboxRadius: 1.2,
        arcadePartSizes: targetSizes, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
        damage: [],
        takeDamage(amount) { this.damage.push(amount); return { isDead: false }; },
    };
    applyArcadePartHitbox(target);
    const projectile = {
        type: 'ROCKET_MEDIUM', owner, radius: 0.05, ignoresTrails: true,
        previousPosition: new THREE.Vector3(x, 10, WING_Z), position: new THREE.Vector3(x, -10, WING_Z),
        velocity: new THREE.Vector3(0, -1, 0),
    };
    const hit = new ProjectileHitResolver(system).resolveProjectileOutcome(projectile, [owner, target], null, {});
    return { hit, damage: target.damage, projectile, base: resolveRocketTierDamage('ROCKET_MEDIUM', system) };
}

test('I4: a nose-built rocket hits the part boxes and deals its multiplied damage', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades(getArcadeRunVehicleBonuses(sizedProfile('manta', { nose: 115 })));
    const owner = { ...makePlayer('manta'), position: new THREE.Vector3(-50, 0, 0) };
    strategy.resetPlayerHealth(owner);
    strategy.applySpawnStatBonuses(owner);
    assert.ok(Math.abs(owner.arcadeDamageMultiplier - 1.09) < 1e-12, 'nose 115 %: +9 %');

    const miss = fireRocketDown(BESIDE_TIP, owner, null);
    assert.equal(miss.hit, false, 'beside the wing tip at 100 %');
    assert.deepEqual(miss.damage, []);
    assert.equal(miss.projectile.detonated, undefined, 'no detonation');

    const onWing = fireRocketDown(ON_WING, owner, null);
    assert.equal(onWing.hit, true);
    assert.equal(onWing.damage.length, 1);
    assert.ok(Math.abs(onWing.damage[0] - onWing.base * 1.09) < 1e-9, `direct hit ${onWing.damage[0]} = ${onWing.base} x 1.09`);
    assert.ok(onWing.projectile.position.y > -0.5 && onWing.projectile.position.y < 0, 'stops on the wing box');

    const bigWings = fireRocketDown(BESIDE_TIP, owner, sizes({ wings: 125 }));
    assert.equal(bigWings.hit, true, 'the 125 % wing reaches the old miss');
    assert.ok(Math.abs(bigWings.damage[0] - bigWings.base * 1.09) < 1e-9);

    const botShot = fireRocketDown(ON_WING, { ...owner, arcadeDamageMultiplier: 1, arcadeRocketDamageMultiplier: 1 }, null);
    assert.equal(botShot.damage[0], botShot.base, 'factor 1 (bots, other modes) as before');
});

// --- I5: stats and boxes read the same normalized sizes ---

test('I5: a locked or over-capacity build flies factory stats and factory boxes', () => {
    for (const build of [
        { vehicleId: 'manta', partSizes: { wings: 125 } },
        { vehicleId: 'manta', sizeWorkshopUnlocked: true, purchasedSizeSteps: 1, partSizes: { wings: 125 } },
    ]) {
        const bonuses = normalizeArcadeUpgradeBonuses({ build }, null, true);
        assert.equal(bonuses.build.turnPct, 75, 'stats: factory wings');
        assert.deepEqual(bonuses.partSizes, sizes(), 'boxes and drawn size: factory wings as well');

        const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
        strategy.applyVehicleUpgrades({ build });
        const human = makePlayer('manta');
        new EntitySpawnOps({ _simulationClockMs: 0, gameModeStrategy: strategy }).spawnPlayerAt(human, new THREE.Vector3());
        assertBoxes(human, sizes(), 'spawned with factory boxes');
    }
});
