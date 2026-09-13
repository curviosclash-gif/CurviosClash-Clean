import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { HuntCombatSystem } from '../src/entities/systems/HuntCombatSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { resolveHuntFallbackItemAction } from '../src/hunt/HuntBotPolicy.js';
import { MGHitResolver } from '../src/hunt/mg/MGHitResolver.js';
import { getPickupDefinition, isPickupTypeAllowedForMode } from '../src/entities/PickupRegistry.js';
import { createTrailTargetDescriptor } from '../src/hunt/HuntTargetingOps.js';
import { resolveStaticTurretTarget } from '../src/entities/systems/static-turret/StaticTurretTargetingOps.js';

const runtimeConfig = () => createEntityRuntimeConfig(null, CONFIG_BASE);
const player = (index, x = 0, isBot = false) => ({
    index, alive: true, isBot, position: new THREE.Vector3(x, 20, 0),
    getAimDirection: (out) => out.set(1, 0, 0),
});
const fixed = (overrides = {}) => ({
    id: 'fixed', weapon: 'rocket', pos: [0, 20, 0], destructible: true,
    targetPlayers: 'all', targetTrails: true, allowedModes: ['HUNT', 'ARCADE'], ...overrides,
});
function fixture(options = {}) {
    const owner = player(0);
    const enemy = player(1, 35, true);
    const shots = [];
    const manager = {
        gameModeStrategy: { modeType: 'HUNT' }, entityRuntimeConfig: runtimeConfig(),
        arena: { checkCollisionFast: () => false, currentMapDefinition: { staticTurrets: [fixed()] } },
        players: [owner, enemy], humanPlayers: [owner],
        _projectileSystem: { spawnExternalProjectile: (shot) => { shots.push(shot); return {}; } },
        ...options,
    };
    return { owner, enemy, manager, shots, system: new StaticTurretSystem(manager) };
}

test('rocket pickup is a deployable item and failed placement preserves inventory and existing turrets', () => {
    const definition = getPickupDefinition('ROCKET_TURRET');
    assert.equal(definition.actionRole, 'deployment');
    const botAction = resolveHuntFallbackItemAction({ inventory: ['ROCKET_TURRET'] }, { enemyClose: true, pressureLevel: 1 });
    assert.equal(botAction.useItem, 0);
    assert.equal(botAction.shootItem, false);
    assert.equal(definition.shootable, false);
    assert.equal(definition.observationSlot, getPickupDefinition('MG_TURRET').observationSlot);
    assert.equal(isPickupTypeAllowedForMode('ROCKET_TURRET', 'CLASSIC'), false);
    const { system, owner, manager } = fixture();
    try {
        const old = system.deployForPlayer(owner, 'rocket');
        owner.inventory = ['ROCKET_TURRET'];
        owner.applyPowerup = () => assert.fail('not a timed player effect');
        const combat = new HuntCombatSystem({
            services: { entityRuntimeConfig: runtimeConfig() },
            callbacks: { getStrategy: () => ({ modeType: 'HUNT', hasMachineGun: () => true }) },
            combat: { deployRocketTurret: (pilot) => system.deployForPlayer(pilot, 'rocket') },
        });
        manager.arena.checkCollisionFast = () => true;
        assert.equal(combat.useInventoryItem(owner, 0).ok, false);
        assert.deepEqual(owner.inventory, ['ROCKET_TURRET']);
        assert.equal(system.turrets[0], old);
        manager.arena.checkCollisionFast = () => false;
        assert.equal(combat.useInventoryItem(owner, 0).ok, true);
        assert.deepEqual(owner.inventory, []);
        assert.notEqual(system.turrets[0], old);
    } finally { system.dispose(); }
});

test('MG and rocket limits are separate; TTL, owner death and restart release both', () => {
    const { system, owner } = fixture();
    try {
        const mg = system.deployForPlayer(owner);
        const first = system.deployForPlayer(owner, 'rocket');
        const second = system.deployForPlayer(owner, 'rocket');
        assert.deepEqual(system.turrets, [mg, second]);
        assert.notEqual(first.id, second.id);
        assert.equal(second.range, 90);
        assert.equal(second.cooldown, 3.4);
        assert.equal(second.hp, 45);
        assert.deepEqual(system.getHudStatesForPlayer(0).map((entry) => entry.weapon), ['mg', 'rocket']);
        system.update(20);
        assert.equal(system.turrets.length, 0);
        system.deployForPlayer(owner, 'rocket');
        owner.alive = false;
        system.update(0.01);
        assert.equal(system.turrets.length, 0);
        system.startRound();
        assert.equal(system.turrets.length, 1);
        assert.equal(system.turrets[0].hp, 90);
    } finally { system.dispose(); }
});

test('fixed launchers target bots and trails, honor protection and keep legacy emplacements unchanged', () => {
    const { system, owner, enemy, manager, shots } = fixture();
    owner.position.x = -100;
    const entry = { playerIndex: 1, segmentIdx: 0, fromX: 15, toX: 17, fromY: 20, toY: 20, fromZ: 0, toZ: 0 };
    manager._trailSpatialIndex = { spatialGrid: new Map([[1001 * 2000 + 1000, new Set([entry])]]), gridSize: 10 };
    try {
        system.startRound();
        const turret = system.turrets[0];
        enemy.spawnProtectionTimer = 1;
        assert.equal(resolveStaticTurretTarget(system, turret, 0.2), null);
        enemy.spawnProtectionTimer = 0;
        system.update(0.23);
        assert.equal(shots.length, 1);
        assert.equal(shots[0].target.kind, 'trail');
        assert.equal(shots[0].target.playerIndex, 1);
        system.update(0.5);
        assert.equal(shots.length, 1);
        entry.destroyed = true;
        system.update(3.4);
        assert.equal(shots[1].target, enemy);
        manager.arena.checkCollisionFast = () => true;
        system.update(3.4);
        assert.equal(shots.length, 2);
        manager.arena.currentMapDefinition.staticTurrets = [fixed({ destructible: undefined, targetPlayers: undefined, targetTrails: undefined, allowedModes: undefined })];
        system.startRound();
        assert.equal(system.turrets[0].hp, Infinity);
        assert.equal(system.turrets[0].targetPlayers, 'humans');
        assert.equal(system.turrets[0].targetTrails, false);
    } finally { system.dispose(); }
});

test('failed rocket spawn does not report or charge a shot', () => {
    const { system, manager, owner, enemy } = fixture();
    try {
        const turret = system.deployForPlayer(owner, 'rocket');
        manager._projectileSystem.spawnExternalProjectile = () => null;
        system._fire(turret, enemy);
        assert.equal(turret.shotsFired, 0);
        assert.equal(turret.cooldownRemaining, 0);
        assert.equal(turret.flashRemaining, 0);
    } finally { system.dispose(); }
});

test('only the existing arcade Hunt combat profile enables rocket deployment; peaceful sectors stay inactive', () => {
    const arcade = new ArcadeModeStrategy({ runType: 'endless_parcours', combatProfile: 'hunt' });
    const { system, manager, owner } = fixture({ gameModeStrategy: arcade });
    try {
        assert.ok(arcade.filterSpawnableTypes(['ROCKET_TURRET'], CONFIG_BASE.POWERUP.TYPES).includes('ROCKET_TURRET'));
        assert.ok(system.deployForPlayer(owner, 'rocket'));
        assert.equal(system.deployForPlayer(owner), null);
        assert.equal(system.startRound(), 1);
        arcade.setSectorType('sector_parcours');
        assert.equal(arcade.isSectorParcours(), true);
        assert.deepEqual(arcade.filterSpawnableTypes(['ROCKET_TURRET'], CONFIG_BASE.POWERUP.TYPES), []);
        assert.equal(system.deployForPlayer(owner, 'rocket'), null);
        assert.equal(system.startRound(), 0);
        manager.gameModeStrategy = new ArcadeModeStrategy();
        assert.equal(system.deployForPlayer(owner, 'rocket'), null);
        manager.gameModeStrategy = { modeType: 'CLASSIC' };
        assert.equal(system.startRound(), 0);
    } finally { system.dispose(); }
});

test('fixed turret takes MG and rocket damage, stays removed and respawns only on restart', () => {
    const { system, owner, manager } = fixture();
    try {
        manager.arena.currentMapDefinition.staticTurrets = [fixed({ pos: [20, 20, 0] })];
        system.startRound();
        const turret = system.turrets[0];
        const resolver = new MGHitResolver({ players: [owner], combat: {
            getMgTurretTargets: () => system.getDestructibleTargets(),
            damageMgTurret: (...args) => system.damageTurret(...args),
        } });
        const hit = resolver.resolveHit(owner, { RANGE: 50, DAMAGE: 10, MIN_FALLOFF: 0.5 });
        assert.equal(hit.turret, turret);
        resolver.applyTurretHit(owner, turret, hit.distance, { RANGE: 50, DAMAGE: 10, MIN_FALLOFF: 0.5 });
        assert.ok(turret.hp < 90);
        const rockets = new ProjectileHitResolver({
            _tmpVec: new THREE.Vector3(), entityRuntimeConfig: runtimeConfig(),
            getTurrets: () => system.getDestructibleTargets(),
        });
        const hpBeforeRocket = turret.hp;
        for (let shot = 0; shot < 4 && turret.hp > 0; shot++) {
            assert.equal(rockets.resolveProjectileOutcome({
                type: 'ROCKET_WEAK', owner, radius: 0.5,
                previousPosition: new THREE.Vector3(15, 20, 0), position: new THREE.Vector3(22, 20, 0),
            }, [], null, {}), true);
        }
        assert.ok(turret.hp < hpBeforeRocket);
        assert.equal(turret.hp, 0);
        system.update(30);
        assert.equal(system.turrets.length, 0);
        system.startRound();
        assert.equal(system.turrets[0].hp, 90);
    } finally { system.dispose(); }
});

test('network replicas round-trip two owned types and a destructible fixed turret without firing', () => {
    const { system, owner, manager } = fixture();
    const replica = new StaticTurretSystem({ ...manager, _projectileSystem: { spawnExternalProjectile: () => assert.fail('replica fired') } });
    try {
        system.startRound();
        system.deployForPlayer(owner);
        system.deployForPlayer(owner, 'rocket');
        replica.applyNetworkSnapshot(system.createNetworkSnapshot(), manager.players);
        assert.equal(replica.turrets.length, 3);
        assert.equal(replica.turrets[0].destructible, true);
        assert.equal(replica.turrets[0].hp, 90);
        assert.equal(replica.turrets[0].ownerIndex, -1);
        replica.update(5);
        assert.equal(replica.damageTurret(replica.turrets[0], 20).hpApplied, 0);
        system.damageTurret(system.turrets[0], 90);
        replica.applyNetworkSnapshot(system.createNetworkSnapshot(), manager.players);
        assert.equal(replica.turrets.length, 2);
        assert.deepEqual(replica.getHudStatesForPlayer(0).map((entry) => entry.weapon), ['mg', 'rocket']);
    } finally { system.dispose(); replica.dispose(); }
});

test('external rockets retain independent trail descriptors and re-acquire only eligible targets after target loss', () => {
    const owner = player(0);
    const enemy = player(1, 35);
    const protectedEnemy = player(2, 20);
    protectedEnemy.spawnProtectionTimer = 2;
    const players = [owner, enemy, protectedEnemy];
    const config = runtimeConfig();
    const entry = { playerIndex: 1, segmentIdx: 0, fromX: 14, toX: 16, fromY: 20, toY: 20, fromZ: 0, toZ: 0, radius: 0.5 };
    const trailIndex = { resolveTrailEntry: () => entry.destroyed ? null : entry };
    const system = new ProjectileSystem({ entityRuntimeConfig: config, getStrategy: () => new HuntModeStrategy(), getPlayers: () => players });
    try {
        const target = createTrailTargetDescriptor(entry, { x: 15, y: 20, z: 0 });
        const rocket = system.spawnExternalProjectile({ owner, type: 'ROCKET_WEAK', position: owner.position,
            direction: new THREE.Vector3(1, 0, 0), target, turretTargeting: { targetPlayers: 'all', targetTrails: true } });
        assert.ok(rocket);
        target.point.x = 900;
        assert.equal(rocket.target.point.x, 15);
        system._simulationOps.stepProjectile(rocket, 0, 0.01, null, players, trailIndex, 0);
        assert.equal(rocket.target.kind, 'trail');
        entry.destroyed = true;
        system._simulationOps.stepProjectile(rocket, 0, 0.01, null, players, trailIndex, 0);
        assert.equal(rocket.target.playerIndex, 1);
        assert.equal(rocket.target.kind, 'player');
        system.setNetworkReplica(true);
        assert.equal(system.spawnExternalProjectile({ owner, type: 'ROCKET_WEAK' }), null);
    } finally { system.dispose(); }
});
