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
    const owner = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: { currentMapDefinition: { mapUnits: [SWARM] } },
        _huntScoring: scoring,
        _notifyPlayerFeedback() {},
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

test('Arcade accepts exact mixed-unit XP while old tank telemetry keeps paying thirty', () => {
    const base = calculateSectorXp({ kills: 0, unitsDestroyed: 0 });
    assert.equal(calculateSectorXp({ kills: 0, unitsDestroyed: 1, unitDestroyedXp: 5 }) - base, 5);
    assert.equal(calculateSectorXp({ kills: 0, unitsDestroyed: 1 }) - base, 30);
});
