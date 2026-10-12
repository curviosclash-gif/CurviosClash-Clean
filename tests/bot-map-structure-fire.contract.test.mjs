import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { GameRuntimeDemolitionSupport } from '../src/core/runtime/GameRuntimeDemolitionSupport.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { createStaticMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { MapDestructibleSystem } from '../src/entities/systems/MapDestructibleSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { TargetableRegistry } from '../src/entities/systems/TargetableRegistry.js';
import { applyBotMapUnitFire } from '../src/hunt/HuntBotMapUnitOps.js';
import { hasRailgunLine } from '../src/hunt/HuntBotRailgunOps.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { OverheatGunSystem } from '../src/hunt/OverheatGunSystem.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import {
    allowsBotMapDestructibleFire,
    isMapStructureClosedToBots,
    resolveBotStructureFocusRatio,
} from '../src/shared/contracts/MapDestructibleBotTargetContract.js';
import { MAP_DESTRUCTIBLE_DAMAGE } from '../src/shared/contracts/MapDestructibleContract.js';

// The user decision: bots may shoot a destructible structure in the hunt, where its collapse is
// scenery, but never in a demolition run, where it is the player's score target.
const HUNT = Object.freeze({ modeType: 'HUNT' });
const DEMOLITION = Object.freeze({ modeType: 'ARCADE', runType: 'demolition' });
const MG = Object.freeze({ RANGE: 95, AIM_DOT_MIN: 0.965 });

const segment = (id, kind, hp, anchor) => ({ id, label: id, kind, hp, meshPrefixes: [`Tower_${id}`], anchor });
// Authored for the hunt only, exactly like the siege maps; demolition installs it in arcade.
const tower = (...segments) => ({ gameModes: ['HUNT'], segments });

/**
 * Stands for EntityManager: the destructible system and the registry every weapon reads, wired
 * the way EntityRuntimeSystemAssembly wires them. Mode and run type come from the same strategy
 * and runtime config the real round reads.
 */
function createWorld(mode, destructibles, extraTargets = []) {
    const entityManager = {
        gameModeStrategy: { modeType: mode.modeType, hasMachineGun: () => true, getPickupModeType: () => 'HUNT' },
        runtimeConfig: mode.runType ? { arcade: { enabled: true, runType: mode.runType } } : null,
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        arena: { currentMapDefinition: { destructibles }, glbAnimationElapsedSeconds: 1, checkCollisionFast: () => false },
    };
    const system = new MapDestructibleSystem(entityManager);
    system.startRound();
    const registry = new TargetableRegistry();
    registry.addProvider(() => extraTargets);
    registry.addProvider(() => system.getTargets());
    entityManager._targetableRegistry = registry;
    entityManager._mapDestructibleSystem = system;
    entityManager.getMapDestructibleSystem = () => system;
    const target = (id) => system.getTargets().find((entry) => entry.segmentId === id) || null;
    return { entityManager, system, registry, target };
}

/** A bot at the origin with its nose along +z - the cone every bot weapon check measures from. */
function createBot(overrides = {}) {
    return {
        index: 3,
        alive: true,
        isBot: true,
        position: new THREE.Vector3(0, 10, 0),
        getAimDirection: (out) => out.set(0, 0, 1),
        ...overrides,
    };
}

function botFires(world, bot = createBot()) {
    const policy = { _tmpFlameAim: new THREE.Vector3(), _tmpFlameOffset: new THREE.Vector3() };
    const input = { shootMG: false };
    applyBotMapUnitFire(policy, input, bot, { entityManager: world.entityManager });
    return input.shootMG;
}

/** Where the machine gun aim help sends a bot's burst. */
function botAim(world, players = []) {
    const bot = createBot();
    const resolver = new MGHitResolver({
        players: [bot, ...players],
        combat: { getMgTurretTargets: () => world.registry.collect() },
    });
    return resolver.resolveAimDirection(bot, new THREE.Vector3(), MG);
}

const towardsX = (aim) => Math.sign(Math.round(aim.x * 1000));

test('the mode decision opens the structure to bots in the hunt and nowhere else', () => {
    assert.equal(allowsBotMapDestructibleFire('HUNT'), true);
    assert.equal(allowsBotMapDestructibleFire(' hunt '), true);
    for (const mode of ['ARCADE', 'CLASSIC', 'ESCORT', '', null, undefined]) {
        assert.equal(allowsBotMapDestructibleFire(mode), false, `${mode} keeps bots off`);
    }
    assert.equal(isMapStructureClosedToBots({ mapStructure: true }), true);
    assert.equal(isMapStructureClosedToBots({ mapStructure: true, botTarget: true }), false);
    assert.equal(isMapStructureClosedToBots({ destructible: true, hp: 150 }), false, 'a tank is never closed');
    assert.equal(isMapStructureClosedToBots(null), false);
    assert.equal(resolveBotStructureFocusRatio({ mapStructure: true, hp: 25, maxHp: 100 }), 0.25);
    assert.equal(resolveBotStructureFocusRatio({ mapStructure: true, hp: 5, maxHp: 0 }), Infinity);
    assert.equal(resolveBotStructureFocusRatio({ hp: 5, maxHp: 10 }), Infinity, 'only segments are ranked');
});

test('a hunt bot with a clear line fires at a standing segment and the aim help lands on it', () => {
    const world = createWorld(HUNT, tower(segment('leg_a', 'leg_lower', 500, [2, 10, 40])));

    assert.equal(world.target('leg_a').botTarget, true, 'the hunt marks its segments open to bots');
    assert.equal(botFires(world), true, 'nothing better in front, so the bot shoots the leg');
    assert.equal(towardsX(botAim(world)), 1, 'the burst bends onto the leg');
});

test('players, tanks and turrets outrank a segment even when it sits straighter ahead', () => {
    const leg = segment('leg_a', 'leg_lower', 500, [2, 10, 40]);
    const tank = { hp: 150, alive: true, destructible: true, ownerIndex: -1, position: new THREE.Vector3(-3, 10, 40) };
    const withTank = createWorld(HUNT, tower(leg), [tank]);
    assert.equal(towardsX(botAim(withTank)), -1, 'the tank wins over the straighter leg');

    const rival = { index: 1, alive: true, isBot: false, position: new THREE.Vector3(-3, 10, 40) };
    const withPlayer = createWorld(HUNT, tower(leg));
    assert.equal(towardsX(botAim(withPlayer, [rival])), -1, 'the player wins over the straighter leg');
});

test('among segments the bot works on the one the HUD focuses: least health left', () => {
    const world = createWorld(HUNT, tower(
        segment('leg_a', 'leg_lower', 500, [2, 10, 40]),
        segment('shaft', 'shaft', 40, [-2, 10, 40]),
    ));
    world.target('shaft').takeDamage(10, {});

    assert.equal(towardsX(botAim(world)), -1, 'the hurt shaft comes before the fresh leg');
});

test('fallen and sealed segments are no target', () => {
    const fallen = createWorld(HUNT, tower(
        segment('leg_a', 'leg_lower', 500, [2, 10, 40]),
        segment('shaft', 'shaft', 40, [-2, 10, 40]),
    ));
    fallen.target('shaft').takeDamage(40, {});
    assert.equal(fallen.target('shaft').alive, false);
    assert.equal(towardsX(botAim(fallen)), 1, 'a fallen shaft is no focus, the standing leg is');

    const lonelyFallen = createWorld(HUNT, tower(segment('shaft', 'shaft', 40, [0, 10, 40])));
    lonelyFallen.target('shaft').takeDamage(40, {});
    assert.equal(botFires(lonelyFallen), false, 'nothing standing in front, no shot');

    const sealed = createWorld(HUNT, tower(
        segment('leg_a', 'leg_lower', 50, [30, 10, 0]),
        segment('shaft', 'shaft', 400, [0, 10, 40]),
    ));
    sealed.target('leg_a').takeDamage(50, {});
    assert.equal(sealed.system.getState().sealed, true, 'a lower leg seals the tower');
    assert.equal(botFires(sealed), false, 'a sealed tower has no target left');
    assert.equal(towardsX(botAim(sealed)), 0);
});

test('a demolition bot never picks a segment - not to fire, aim, lock on or release the railgun', () => {
    const world = createWorld(DEMOLITION, tower(
        segment('leg_a', 'leg_lower', 500, [2, 10, 40]),
        segment('shaft', 'shaft', 40, [0, 10, 60]),
    ));
    assert.equal(world.system.isActive(), true, 'demolition installs the structure');
    assert.notEqual(world.target('leg_a').botTarget, true);

    assert.equal(botFires(world), false, 'no burst at the player score target');
    assert.equal(towardsX(botAim(world)), 0, 'the aim help leaves the shot where the bot points');

    const bot = createBot();
    const combat = new HuntCombatSystem({
        services: { entityRuntimeConfig: world.entityManager.entityRuntimeConfig },
        callbacks: { getStrategy: () => world.entityManager.gameModeStrategy },
        combat: { getMgTurretTargets: () => world.registry.collect() },
        players: [bot],
    });
    assert.equal(combat.checkLockOn(bot)?.mapStructure, undefined, 'no lock onto the shaft dead ahead');

    const aim = new THREE.Vector3(0, 0, 1);
    assert.equal(hasRailgunLine(bot, world.registry.collect(), 250, aim, new THREE.Vector3()), false,
        'the shaft on the line releases no railgun shot');

    const hunt = createWorld(HUNT, tower(segment('shaft', 'shaft', 40, [0, 10, 60])));
    const huntCombat = new HuntCombatSystem({
        services: { entityRuntimeConfig: hunt.entityManager.entityRuntimeConfig },
        callbacks: { getStrategy: () => hunt.entityManager.gameModeStrategy },
        combat: { getMgTurretTargets: () => hunt.registry.collect() },
        players: [bot],
    });
    assert.equal(huntCombat.checkLockOn(bot)?.segmentId, 'shaft', 'the hunt bot may lock the shaft');
    assert.equal(hasRailgunLine(bot, hunt.registry.collect(), 250, aim, new THREE.Vector3()), true);
});

test('a turret a bot deployed in demolition does not attack the structure either', () => {
    const run = (mode) => {
        const owner = createBot({ index: 2, position: new THREE.Vector3(0, 20, 0), getAimDirection: (out) => out.set(1, 0, 0) });
        const world = createWorld(mode, tower(segment('shaft', 'shaft', 400, [8, 20, 0])));
        const shots = [];
        Object.assign(world.entityManager, {
            players: [owner],
            humanPlayers: [],
            _projectileSystem: { projectiles: [], spawnExternalProjectile(options) { shots.push(options); return {}; } },
        });
        const turrets = new StaticTurretSystem(world.entityManager);
        try {
            assert.ok(turrets.deployForPlayer(owner, 'rocket'), `${mode.modeType} deploys the rocket turret`);
            turrets.update(0.23);
        } finally { turrets.dispose(); }
        return shots.filter((shot) => shot.target?.mapStructure === true).length;
    };
    assert.equal(run(HUNT), 1, 'in the hunt the bot turret fires at the shaft');
    assert.equal(run(DEMOLITION), 0, 'in demolition it leaves the shaft alone');
});

/**
 * Stands for a match with a tower wall ahead: the machine gun stops at the wall and books the hit
 * on the segment behind the mesh name - the path every pilot's bullet takes.
 */
function createMgWorld(mode, isBot) {
    const destructibles = tower({ id: 'shaft', label: 'Schaft', kind: 'shaft', hp: 40, meshPrefixes: ['Tower_Shaft'] });
    const world = createWorld(mode, destructibles);
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 40, 40));
    wallMesh.position.set(20, 0, 0);
    wallMesh.updateMatrixWorld(true);
    const collision = new ArenaCollision({
        bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500, minZ: -500, maxZ: 500 },
        obstacles: [{
            box: new THREE.Box3().setFromObject(wallMesh),
            isWall: false,
            kind: 'hard',
            meshCollider: createStaticMeshCollider(wallMesh),
            sourceName: 'Tower_Shaft_Lower',
        }],
    });
    world.entityManager.arena.raycast = (origin, direction, maxDistance) => collision.raycast(origin, direction, maxDistance);
    const shooter = {
        index: 0, alive: true, isBot, position: new THREE.Vector3(0, 0, 0), quaternion: new THREE.Quaternion(),
        activeEffects: [], shootCooldown: 0, hitboxRadius: 1, getAimDirection: (out) => out.set(1, 0, 0),
    };
    world.entityManager.players = [shooter];
    const gun = new OverheatGunSystem(world.entityManager);
    gun.tryFire(shooter);
    return world.system.getState().segments[0].hp;
}

test('bot hits take the very damage path of a player hit in the hunt, and none in demolition', () => {
    const expected = 40 - MAP_DESTRUCTIBLE_DAMAGE.MG;
    assert.equal(createMgWorld(HUNT, false), expected, 'a player hit in the hunt');
    assert.equal(createMgWorld(HUNT, true), expected, 'a bot hit in the hunt costs the same');
    assert.equal(createMgWorld(DEMOLITION, false), expected, 'the player still scores in demolition');
    assert.equal(createMgWorld(DEMOLITION, true), 40, 'a stray bot bullet leaves the score target whole');
});

test('a structure a bot brings down in the hunt starts no demolition scoring', () => {
    const world = createWorld(HUNT, tower(segment('shaft', 'shaft', 40, [0, 10, 40])));
    const support = new GameRuntimeDemolitionSupport({ getRuntimeConfig: () => ({ arcade: { enabled: false } }) });
    world.target('shaft').takeDamage(40, { sourcePlayer: createBot() });
    assert.equal(world.system.getState().events.length, 1, 'the shaft fell to the bot');

    assert.equal(support.startIfActive({ runtimeState: { entityManager: world.entityManager } }).handled, false);
    assert.equal(support.updateIfActive(1), false);
    assert.equal(support.getState().breakEvents, 0);
    assert.equal(support.getState().phase, 'idle');
});

test('a map without a structure leaves bot fire at tanks as it was', () => {
    const tank = { hp: 150, alive: true, destructible: true, ownerIndex: -1, position: new THREE.Vector3(0, 10, 60) };
    const world = createWorld(HUNT, undefined, [tank]);
    assert.equal(world.system.isActive(), false);
    assert.equal(botFires(world), true);
    assert.equal(world.registry.collect().length, 1, 'the tank is the only target');
});
