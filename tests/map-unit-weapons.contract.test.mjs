import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';

function createPlayer(index, position, isBot = false) {
    const player = {
        index,
        alive: true,
        isBot,
        hp: 100,
        spawnProtectionTimer: 0,
        position: new THREE.Vector3(...position),
        taken: [],
        takeDamage(amount) {
            this.taken.push(amount);
            this.hp -= amount;
            return { hpApplied: amount, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
    };
    return player;
}

// A standing tank (both path points far apart, speed kept tiny) with a target 20 units ahead.
function createWorld({ weapons, targetPlayers = 'all', human = [0, 2, 20], bot = null, authority = true } = {}) {
    const shots = [];
    const damageEvents = [];
    const kills = [];
    const players = [createPlayer(0, human)];
    if (bot) players.push(createPlayer(1, bot, true));
    const manager = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        isFightOutcomeAuthority: authority,
        arena: {
            blocked: false,
            checkCollisionFast() { return this.blocked; },
            currentMapDefinition: {
                mapUnits: [{ id: 'tank_a', path: [[0, 0, 0], [0, 0, 500]], speed: 1, weapons, targetPlayers }],
            },
        },
        players,
        humanPlayers: players.filter((player) => !player.isBot),
        _projectileSystem: { spawnExternalProjectile: (shot) => { shots.push(shot); return {}; } },
        _emitHuntDamageEvent: (event) => damageEvents.push(event),
        _killPlayer: (player, cause, options) => kills.push({ player, cause, options }),
    };
    manager._staticTurretSystem = new StaticTurretSystem(manager);
    const system = new MapUnitSystem(manager);
    system.startRound();
    return { manager, system, players, shots, damageEvents, kills, tank: system.units[0] };
}

function run(system, seconds, step = 0.05) {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) system.update(step);
}

test('the tank machine gun shoots a player in range and is credited as the tank', () => {
    const { system, players, damageEvents, tank } = createWorld({ weapons: { rocket: false } });
    run(system, 1.5);
    assert.ok(players[0].taken.length >= 2, 'several bursts land');
    assert.equal(players[0].taken[0], 3, 'tank MG deals 3 per hit');
    assert.equal(damageEvents[0].sourcePlayer, tank.source);
    assert.equal(tank.source.combatLabel, 'Panzer');
});

test('the tank rocket launcher fires its medium rocket every five seconds', () => {
    const { system, shots, tank } = createWorld({ weapons: { mg: false } });
    run(system, 6);
    assert.equal(shots.length, 1, 'half a cooldown to start, then five seconds between rockets');
    assert.equal(shots[0].type, 'ROCKET_MEDIUM');
    assert.equal(shots[0].owner, tank.source);
    assert.equal(shots[0].sourceTurretId, 'tank_a:rocket');
    run(system, 5);
    assert.equal(shots.length, 2);
});

test('walls block the tank and replicas never fire', () => {
    const blocked = createWorld({ weapons: { rocket: false } });
    blocked.manager.arena.blocked = true;
    run(blocked.system, 2);
    assert.equal(blocked.players[0].taken.length, 0, 'no line of sight, no shot');

    const replica = createWorld({ weapons: { rocket: false }, authority: false });
    run(replica.system, 2);
    assert.equal(replica.players[0].taken.length, 0, 'only the host decides who is hit');
});

test('a tank for humans only ignores bots, a neutral tank shoots them too', () => {
    const humansOnly = createWorld({ weapons: { rocket: false }, targetPlayers: 'humans', human: [0, 2, -400], bot: [0, 2, 20] });
    run(humansOnly.system, 2);
    assert.equal(humansOnly.players[1].taken.length, 0);

    const neutral = createWorld({ weapons: { rocket: false }, human: [0, 2, -400], bot: [0, 2, 20] });
    run(neutral.system, 2);
    assert.ok(neutral.players[1].taken.length > 0);
});

test('the tank does not count as its own target', () => {
    const { tank } = createWorld({ weapons: {} });
    assert.equal(tank.ownerPlayer, tank.source, 'weapons skip targets owned by the shooter');
    assert.deepEqual(tank.mounts.map((mount) => mount.id), ['tank_a:mg', 'tank_a:rocket']);
    assert.equal(tank.mounts[0].position, tank.position, 'the mounts ride on the tank');
});
