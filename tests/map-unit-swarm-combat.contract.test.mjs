import assert from 'node:assert/strict';
import test from 'node:test';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { calculateSectorXp } from '../src/state/arcade/ArcadeXpRewards.js';

const SWARM = {
    id: 'combat_swarm',
    kind: 'swarm',
    path: [[0, 8, 0], [20, 8, 0]],
    speed: 1,
    memberCount: 8,
    memberHp: 8,
    formationRadius: 5,
    respawnSeconds: 20,
};

function createSide({ replica = false } = {}) {
    const scoring = new HuntScoring(() => 0);
    const scene = new Set();
    const owner = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { currentMapDefinition: { mapUnits: [SWARM] } },
        _huntScoring: scoring,
        _notifyPlayerFeedback() {},
        renderer: {
            addToScene(object) { scene.add(object); },
            removeFromScene(object) { scene.delete(object); },
        },
    };
    const system = new MapUnitSystem(owner);
    system.setNetworkReplica(replica);
    system.startRound();
    return { owner, scoring, system, swarm: system.units[0] };
}

test('each drone is a separate registry target and one hit removes only that drone', () => {
    const { scoring, system, swarm } = createSide();
    const attacker = { index: 0, isBot: false };

    assert.equal(system.getTargets().length, 8);
    assert.equal(swarm.mounts.length, 8, 'every living drone carries the weak swarm gun');
    const first = system.getTargets()[0];
    const result = first.takeDamage(8, { sourcePlayer: attacker, cause: 'MG' });
    assert.equal(result.isDead, true);
    assert.equal(first.alive, false);
    assert.equal(swarm.alive, true);
    assert.equal(system.getTargets().length, 7);

    for (const drone of [...system.getTargets()]) drone.takeDamage(8, { sourcePlayer: attacker, cause: 'MG' });
    assert.equal(swarm.alive, false, 'the map unit ends after its last member');
    assert.equal(swarm.root.visible, false, 'the defeated formation disappears immediately');
    assert.equal(system.getTargets().length, 0);
    const [row] = scoring.getScoreboard([attacker]);
    assert.equal(row.unitsDestroyed, 8);
    assert.equal(row.points, 0, 'drones are statistics, not E75 score-target points');
    assert.equal(row.unitDestroyedXp, 40, 'eight drones pay five Arcade XP each');
});

test('a defeated swarm respawns all members without replacing their objects', () => {
    const { system, swarm } = createSide();
    const members = swarm.members;
    for (const drone of [...system.getTargets()]) drone.takeDamage(99);
    assert.equal(swarm.respawnRemaining, 20);

    system.update(20);
    assert.equal(swarm.alive, true);
    assert.equal(swarm.members, members);
    assert.equal(system.getTargets().length, 8);
    assert.equal(swarm.members.every((member) => member.alive && member.hp === 8), true);
});

test('the host sends member damage and a replica cannot deal its own', () => {
    const host = createSide();
    const client = createSide({ replica: true });
    host.system.getTargets()[2].takeDamage(8);

    client.system.applyNetworkState(host.system.serializeNetworkState());
    assert.equal(client.swarm.members[2].alive, false);
    assert.equal(client.system.getTargets().length, 7);
    const result = client.system.getTargets()[0].takeDamage(99);
    assert.equal(result.hpApplied, 0);
    assert.equal(client.system.getTargets().length, 7);
});

test('a host dive damages one unprotected player and credits the map-unit source', () => {
    const { owner, system, swarm } = createSide();
    const player = {
        index: 7, alive: true, spawnProtectionTimer: 0,
        position: swarm.position.clone().add({ x: 0, y: 0, z: 4 }),
    };
    owner.players = [player];
    owner._applyModeDamage = (target, amount, cause, options) => {
        assert.equal(target, player);
        assert.equal(amount, 14);
        assert.equal(cause, 'PIGEON_DIVE');
        assert.equal(options.sourcePlayer, swarm.source, 'the flock is the damage and kill source');
        assert.ok(options.impactPoint);
        player.damaged = (player.damaged || 0) + 1;
        return { isDead: false };
    };
    swarm.definition = { ...swarm.definition, attack: { damage: 14, cooldown: 3.2, radius: 0.7, range: 9, diveSpeed: 26 } };

    for (let tick = 0; tick < 100 && !player.damaged; tick += 1) system.update(0.05);
    assert.equal(player.damaged, 1, 'one bird completes the dive');
    assert.equal(swarm.attacksFired, 1);
    assert.equal(swarm.contactAttackCooldowns.get(player.index), 3.2);

    swarm.speed = 0;
    for (let tick = 0; tick < 20; tick += 1) system.update(0.05);
    assert.equal(player.damaged, 1, 'the same target cannot take several hits in one flock pass');
});

test('a dive waits out spawn protection and a network replica never applies contact damage', () => {
    const host = createSide();
    const protectedPlayer = {
        index: 4, alive: true, spawnProtectionTimer: 2,
        position: host.swarm.position.clone(),
    };
    host.owner.players = [protectedPlayer];
    host.swarm.definition = { ...host.swarm.definition, attack: { damage: 14, cooldown: 3.2, radius: 0.7, range: 9, diveSpeed: 26 } };
    host.owner._applyModeDamage = () => { protectedPlayer.damaged = true; };
    for (let tick = 0; tick < 30; tick += 1) host.system.update(0.05);
    assert.equal(protectedPlayer.damaged, undefined);
    assert.equal(host.swarm.activeDive, null);

    const client = createSide({ replica: true });
    const target = { index: 4, alive: true, spawnProtectionTimer: 0, position: client.swarm.position.clone() };
    client.owner.players = [target];
    client.owner._applyModeDamage = () => { target.damaged = true; };
    client.swarm.definition = { ...client.swarm.definition, attack: { damage: 14, cooldown: 3.2, radius: 0.7, range: 9, diveSpeed: 26 } };
    for (let tick = 0; tick < 30; tick += 1) client.system.update(0.05);
    assert.equal(target.damaged, undefined);
    assert.equal(client.swarm.activeDive, null);
});

test('the host synchronizes a diving bird offset to its replica', () => {
    const host = createSide();
    host.swarm.definition = { ...host.swarm.definition, attack: { damage: 14, cooldown: 3.2, radius: 0.7, range: 9, diveSpeed: 26 } };
    host.owner.players = [{
        index: 2, alive: true, spawnProtectionTimer: 0,
        position: host.swarm.position.clone().add({ x: 0, y: 0, z: 7 }),
    }];
    host.system.update(0.01);
    host.system.update(0.01);
    assert.ok(host.swarm.members.some((member) => member.offset.distanceToSquared(member.homeOffset) > 0.000001));

    const client = createSide({ replica: true });
    client.system.applyNetworkState(host.system.serializeNetworkState());
    for (let index = 0; index < host.swarm.members.length; index += 1) {
        assert.ok(client.swarm.members[index].offset.distanceTo(host.swarm.members[index].offset) < 0.001);
    }
});

test('Arcade accepts exact mixed-unit XP while old tank telemetry keeps paying thirty', () => {
    const base = calculateSectorXp({ kills: 0, unitsDestroyed: 0 });
    assert.equal(calculateSectorXp({ kills: 0, unitsDestroyed: 1, unitDestroyedXp: 5 }) - base, 5);
    assert.equal(calculateSectorXp({ kills: 0, unitsDestroyed: 1 }) - base, 30);
});
