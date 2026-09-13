import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { KINETIC_TIDE_MAP } from '../src/core/config/maps/presets/kinetic_tide.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { RespawnSystem } from '../src/hunt/RespawnSystem.js';
import { ARCADE_SECTOR_TYPES, ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';

function crossCheckpoint(system, player, entry, nowMs) {
    const length = Math.hypot(...entry.forward) || 1;
    const forward = entry.forward.map((value) => value / length);
    const distance = entry.radius * 0.5;
    const previousPosition = {
        x: entry.pos[0] - forward[0] * distance,
        y: entry.pos[1] - forward[1] * distance,
        z: entry.pos[2] - forward[2] * distance,
    };
    player.position.set(
        entry.pos[0] + forward[0] * distance,
        entry.pos[1] + forward[1] * distance,
        entry.pos[2] + forward[2] * distance,
    );
    return system.updatePlayerProgress(player, previousPosition, nowMs);
}

/**
 * Wires the three systems the way EntityRuntimeSystemAssembly does, around a real map.
 * parcours_rift authors no respawn at all, so whatever respawn a test sees there has to
 * come from the Arcade sector; kinetic_tide authors its own and must keep it.
 */
function createArcadeParcoursHarness(mapDefinition = PARCOURS_MAPS.parcours_rift) {
    const strategy = new ArcadeModeStrategy({ nowMs: () => 0, random: () => 0.5 });
    strategy.setSectorType(ARCADE_SECTOR_TYPES.PARCOURS);
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        hitboxRadius: 1.1,
        position: new THREE.Vector3(),
        inventory: [],
        spawn(position) {
            this.position.copy(position);
            this.alive = true;
        },
    };
    const feedback = [];
    const entityManager = {
        arena: { currentMapDefinition: mapDefinition },
        activeGameMode: 'ARCADE',
        gameModeStrategy: strategy,
        entityRuntimeConfig: CONFIG_SECTIONS,
        players: [player],
        _simulationClockMs: 0,
        _notifyPlayerFeedback(_player, message) { feedback.push(message); },
        recorder: { logEvent() {} },
    };
    const parcours = new ParcoursProgressSystem(entityManager);
    const respawn = new RespawnSystem({
        callbacks: {
            getStrategy: () => strategy,
            getSimulationNowMs: () => 0,
            parcours: {
                isRespawnEnabled: () => parcours.isRespawnEnabled(),
                takeRespawnPlan: (target) => parcours.takeRespawnPlan(target),
                onPlayerSpawn: (target, options) => parcours.onPlayerSpawn(target, options),
            },
            combat: { resetRespawnCombatState() {} },
        },
        services: {
            entityRuntimeConfig: CONFIG_SECTIONS,
            recorder: { markPlayerSpawn() {}, logEvent() {} },
        },
        spawn: {
            findSpawnPosition() { throw new Error('a checkpoint respawn must not pick a free position'); },
            findSafeSpawnDirection() { throw new Error('a checkpoint respawn brings its own direction'); },
        },
        events: { emitHuntFeed() {} },
    });
    const outcome = new RoundOutcomeSystem({
        getPlayers: () => entityManager.players,
        isRespawnEnabled: () => strategy.isRespawnEnabled() === true,
        isEliminationSuppressed: () => parcours.isRespawnEnabled() === true,
        isRespawnPending: (target) => respawn.isRespawnPending(target),
    });
    parcours.startRound([player]);

    // Same order as killPlayer: parcours plans the respawn, then the respawn system takes it.
    const die = () => {
        player.alive = false;
        parcours.onPlayerDeath(player, { cause: 'WALL' });
        return respawn.onPlayerDied(player);
    };
    return { die, feedback, outcome, parcours, player, respawn };
}

test('an Arcade parcours sector respawns three times at the last checkpoint, then ends the run', () => {
    const { die, feedback, outcome, parcours, player, respawn } = createArcadeParcoursHarness();
    const route = parcours.getRouteSnapshot();
    const cp01 = route.checkpoints.find((entry) => entry.id === 'CP01');
    const cp02 = route.checkpoints.find((entry) => entry.id === 'CP02');

    assert.equal(crossCheckpoint(parcours, player, cp01, 100)?.checkpointId, 'CP01');
    assert.equal(crossCheckpoint(parcours, player, cp02, 600)?.checkpointId, 'CP02');

    for (let death = 1; death <= 3; death += 1) {
        assert.equal(die(), true, `death ${death} of 3 respawns the player instead of leaving them dead`);
        assert.equal(outcome.resolve().shouldEnd, false, `the sector waits for respawn ${death} instead of ending`);

        respawn.update(10);
        const progress = parcours.getPlayerProgressSnapshot(player.index);
        assert.equal(player.alive, true, `respawn ${death} brings the player back`);
        assert.ok(player.position.distanceTo(new THREE.Vector3(...cp02.pos)) < 20, `respawn ${death} lands at CP02`);
        assert.equal(progress?.nextCheckpointIndex, 1, 'progress falls back to the last checkpoint, not to the start');
        assert.equal(progress?.checkpointRespawnsUsed, death);
        assert.equal(crossCheckpoint(parcours, player, cp02, 600 + death * 500)?.checkpointId, 'CP02');
    }

    assert.equal(die(), false, 'the fourth death has no respawn left');
    assert.deepEqual(outcome.resolve(), {
        shouldEnd: true,
        winner: null,
        reason: 'ELIMINATION',
        parcours: null,
    }, 'the fourth death ends the run instead of freezing it');
    assert.match(feedback.at(-1) || '', /Respawns verbraucht/);
});

test('a map that authors its own checkpoint respawns keeps them inside an Arcade parcours sector', () => {
    const { die, outcome, parcours, player, respawn } = createArcadeParcoursHarness(KINETIC_TIDE_MAP.kinetic_tide);
    const route = parcours.getRouteSnapshot();
    const cp01 = route.checkpoints.find((entry) => entry.id === 'CP01');
    const cp02 = route.checkpoints.find((entry) => entry.id === 'CP02');

    assert.equal(crossCheckpoint(parcours, player, cp01, 100)?.checkpointId, 'CP01');
    assert.equal(crossCheckpoint(parcours, player, cp02, 600)?.checkpointId, 'CP02');
    for (let death = 1; death <= 3; death += 1) {
        assert.equal(die(), true, `death ${death} of 3 respawns the player at the last checkpoint`);
        respawn.update(10);
        assert.equal(crossCheckpoint(parcours, player, cp02, 600 + death * 500)?.checkpointId, 'CP02');
    }

    assert.equal(die(), true, 'the fourth death on Kinetic Tide restarts at checkpoint one, as the map authors it');
    assert.equal(outcome.resolve().shouldEnd, false, 'the authored restart keeps the sector running');
    respawn.update(10);
    assert.equal(player.alive, true, 'the player is back after the authored restart');
    assert.equal(parcours.getPlayerProgressSnapshot(player.index)?.nextCheckpointIndex, 0);
});

test('a player alone in the round ends it on death when no respawn is coming', () => {
    const player = { index: 0, isBot: false, alive: false };
    const outcome = new RoundOutcomeSystem({ getPlayers: () => [player] });

    assert.deepEqual(outcome.resolve(), {
        shouldEnd: true,
        winner: null,
        reason: 'ELIMINATION',
        parcours: null,
    }, 'a lone dead player ends the round instead of freezing it');
});

test('a sector with bots keeps the last-survivor rule while a human waits for nothing', () => {
    const human = { index: 0, isBot: false, alive: false };
    const botA = { index: 1, isBot: true, alive: true };
    const botB = { index: 2, isBot: true, alive: true };
    const outcome = new RoundOutcomeSystem({ getPlayers: () => [human, botA, botB] });

    assert.equal(outcome.resolve().shouldEnd, false, 'two bots still fighting keep the classic round running');
});
