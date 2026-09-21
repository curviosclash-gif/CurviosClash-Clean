import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import { sanitizeMapUnitList, toRuntimeMapUnits } from '../src/entities/mapSchema/MapSchemaMapUnitOps.js';
import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { HYDRA_FIREBALL, ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { getHydraMouthPosition } from '../src/entities/systems/map-units/MapUnitHydraVisualOps.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';

const map = MAP_PRESET_CATALOG.hydra_temple;

function player(index, x, z, protectedPlayer = false) {
    return {
        index, alive: true, hp: 100, hitboxRadius: 0.5,
        spawnProtectionTimer: protectedPlayer ? 1 : 0,
        position: new THREE.Vector3(x, 2, z),
        takeDamage(amount) {
            if (this.hasShield) {
                this.hasShield = false;
                return { hpApplied: 0, absorbedByShield: amount, remainingHp: this.hp, isDead: false };
            }
            this.hp = Math.max(0, this.hp - amount);
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
}

function world(players = []) {
    let calls = 0;
    const damage = [];
    const explosions = [];
    const cleared = [];
    const manager = {
        renderer: null, isFightOutcomeAuthority: true,
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 1 } },
        runtimeRng: { next: () => { calls += 1; return 0; } },
        gameModeStrategy: { modeType: 'HUNT' },
        arena: { currentMapDefinition: map },
        players,
        particles: { spawnHit() {}, spawnExplosion: (...args) => explosions.push(args) },
        _emitHuntDamageEvent: (entry) => damage.push(entry),
        _killPlayer() {},
        _projectileSystem: { spawnHydraFireball() {}, clearForOwner: (owner) => cleared.push(owner) },
    };
    const system = new MapUnitSystem(manager);
    system.startRound();
    return { system, unit: system.units[0], manager, damage, explosions, cleared, randomCalls: () => calls };
}

test('Hydra species survives the map schema while the default creature remains the worm', () => {
    const hydra = map.mapUnits[0];
    assert.equal(normalizeMapUnit(hydra).species, 'hydra_v3');
    const saved = sanitizeMapUnitList([hydra]);
    assert.equal(saved[0].species, 'hydra_v3');
    assert.equal(toRuntimeMapUnits(saved, 1)[0].species, 'hydra_v3');
    const worm = normalizeMapUnit({ kind: 'creature', path: [[0, 0, 0], [1, 0, 0]] });
    assert.equal(worm.species, undefined);
    assert.equal(worm.respawnSeconds, 90);
});

test('the registered desktop map has a clear closed route and outer spawns', () => {
    assert.deepEqual(map.size, [100, 35, 100]);
    assert.equal(map.mapUnits[0].path.length, 12);
    assert.equal(map.mapUnits[0].loop, true);
    assert.equal(map.singlePlayerScenario.botCount, 3);
    assert.deepEqual(map.mapUnits[0].allowedModes, ['HUNT', 'ARCADE']);
    for (const [x, , z] of map.mapUnits[0].path) assert.ok(Math.abs(Math.hypot(x, z) - 24) < 0.001);
    for (const spawn of [map.playerSpawn, ...map.botSpawns]) {
        assert.ok(Math.abs(Math.hypot(spawn.x, spawn.z) - 42) < 0.001);
        assert.ok(spawn.y > 0);
    }
});

test('seeded snap warns for 0.7 s, hits once in its random direction, and pauses the route', () => {
    const hit = player(0, 24, 8);
    const miss = player(1, 24, -8);
    const protectedHit = player(2, 24, 8, true);
    const { system, unit, damage, randomCalls } = world([hit, miss, protectedHit]);
    system.update(5);
    assert.equal(unit.hydra.action, 'snap');
    assert.equal(unit.hydra.phase, 'warning');
    assert.equal(unit.groundPosition.x, 24);
    assert.equal(hit.hp, 100);
    system.update(0.69);
    assert.equal(hit.hp, 100);
    system.update(0.02);
    assert.equal(hit.hp, 70);
    assert.equal(miss.hp, 100);
    assert.equal(protectedHit.hp, 100);
    system.update(0.2);
    assert.equal(hit.hp, 70);
    assert.equal(damage.length, 1);
    assert.ok(randomCalls() >= 5);
});

test('spit chooses a visible unprotected player and aims at the position at launch', () => {
    const target = player(0, 35, 0);
    const protectedTarget = player(1, 30, 0, true);
    const { system, unit, manager } = world([target, protectedTarget]);
    const shots = [];
    manager._projectileSystem.spawnHydraFireball = (_owner, origin, direction) => {
        shots.push({ origin: origin.clone(), direction: direction.clone() });
    };
    unit.hydra.snapRemaining = 100;
    unit.hydra.spitRemaining = 0;
    unit.hydra.initialized = true;
    system.update(0);
    assert.equal(unit.hydra.action, 'spit');
    assert.equal(unit.hydra.phase, 'warning');
    assert.equal(shots.length, 0);
    system.update(0.69);
    assert.equal(shots.length, 0);
    target.position.set(35, 2, 10);
    system.update(0.02);
    assert.equal(shots.length, 1);
    const expectedMouth = getHydraMouthPosition(unit, unit.hydra.head, new THREE.Vector3());
    assert.ok(shots[0].origin.distanceTo(expectedMouth) < 0.001);
    const aimed = target.position.clone().sub(shots[0].origin).normalize();
    assert.ok(shots[0].direction.distanceTo(aimed) < 0.001);
    assert.equal(unit.hydra.direction.distanceTo(aimed) < 0.001, true);
});

test('body contact has a per-player cooldown; shields absorb and death causes no tank blast or respawn', () => {
    const shielded = player(0, 24, 0);
    shielded.hasShield = true;
    const { system, unit, explosions, cleared } = world([shielded]);
    unit.speed = 0;
    system.update(0.1);
    assert.equal(shielded.hp, 100);
    assert.equal(shielded.hasShield, false);
    system.update(1);
    assert.equal(shielded.hp, 100);
    system.update(0.5);
    assert.equal(shielded.hp, 90);
    unit.takeDamage(600);
    assert.equal(unit.alive, false);
    assert.equal(shielded.hp, 90);
    assert.equal(explosions.length, 1);
    assert.deepEqual(cleared, [unit.source]);
    system.update(100);
    assert.equal(unit.alive, false);
    system.startRound();
    assert.equal(system.units[0].alive, true);
    assert.equal(system.units[0].hp, 600);
});

test('scaled fireball visual and velocity survive the projectile network snapshot', () => {
    const host = new ProjectileSystem();
    const shot = host.spawnHydraFireball({ index: -1 }, new THREE.Vector3(0, 6, 0), new THREE.Vector3(1, 0, 0), 3);
    assert.equal(shot.velocity.x, 66);
    assert.equal(shot.radius, 2.55);
    const snapshot = createGameStateSnapshot({ players: [], projectiles: host.projectiles }, null);
    assert.equal(snapshot.projectiles[0].visualScale, 3);
    const replica = new ProjectileSystem();
    replica.applyNetworkSnapshot(snapshot.projectiles);
    assert.equal(replica.projectiles[0].mesh.scale.x, 3);
    assert.equal(replica.projectiles[0].velocity.x, 66);
    replica.dispose();
    host.dispose();
});

test('clients copy Hydra action snapshots but make no random choice or damage', () => {
    const host = world([player(0, 24, 8)]);
    const clientTarget = player(0, 24, 8);
    const client = world([clientTarget]);
    host.system.update(5);
    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.unit.hydra.action, 'snap');
    assert.equal(client.unit.hydra.phase, 'warning');
    const before = client.randomCalls();
    client.system.update(1);
    assert.equal(clientTarget.hp, 100);
    assert.equal(client.randomCalls(), before);
});

test('a Hydra fireball is straight, can hit another player, and dies on world collision', () => {
    const target = player(1, 15, 0);
    const bystander = player(2, 8, 0);
    const hits = [];
    const arena = { getCollisionInfo: () => null };
    const system = new ProjectileSystem({
        getArena: () => arena, getPlayers: () => [target, bystander],
        onProjectileDamage: (victim, owner, type) => hits.push([victim.index, type]),
    });
    const origin = new THREE.Vector3(0, 2, 0);
    const direction = new THREE.Vector3(1, 0, 0);
    const shot = system.spawnHydraFireball({ index: -1 }, origin, direction);
    assert.equal(shot.type, HYDRA_FIREBALL);
    assert.equal(shot.velocity.x, 22);
    system.update(0.2);
    assert.equal(shot.velocity.x, 22);
    system.update(0.2);
    assert.deepEqual(hits, [[2, HYDRA_FIREBALL]]);
    assert.equal(target.hp, 100);
    assert.equal(bystander.hp, 76);
    assert.equal(system.projectiles.length, 0);
    bystander.position.x = 100;
    target.position.x = 8;
    target.hasShield = true;
    system.spawnHydraFireball({ index: -1 }, origin, direction);
    system.update(0.4);
    assert.equal(target.hp, 100);
    assert.equal(target.hasShield, false);
    target.spawnProtectionTimer = 1;
    system.spawnHydraFireball({ index: -1 }, origin, direction);
    system.update(0.4);
    assert.equal(target.hp, 100);
    system.clear();
    arena.getCollisionInfo = (position) => position.x >= 2 ? { hit: true, kind: 'hard' } : null;
    system.spawnHydraFireball({ index: -1 }, origin, direction);
    system.update(0.2);
    assert.equal(system.projectiles.length, 0);
    system.dispose();
});
