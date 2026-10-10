import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { HeuristicBotPolicy } from '../src/entities/ai/HeuristicBotPolicy.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function cross(system, player, entry, now) {
    const forward = entry.forward || [1, 0, 0];
    const distance = Math.max(1, entry.radius * 0.5);
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
    return system.updatePlayerProgress(player, previousPosition, now);
}

test('Arcade Parcours profile creates one explicitly marked racer and selects heuristic only for it', () => {
    const profile = resolveArcadeSectorRuntimeProfile({
        sectorNumber: 4,
        templateId: 'sector_parcours',
        parcoursEnabled: true,
    }, { mapKey: 'parcours_rift' });
    assert.equal(profile.botCount, 1);
    assert.equal(profile.parcoursRacer, true);
    assert.deepEqual(profile.botRoles, []);

    const createdTypes = [];
    const owner = {
        renderer: { addToScene() {}, removeFromScene() {}, getGraphicsStyle: () => 'modern' },
        entityRuntimeConfig: resolveEntityRuntimeConfig({}), runtimeConfig: { arcade: { enabled: true } },
        arena: { currentMapDefinition: null }, players: [], humanPlayers: [], bots: [], botByPlayer: new Map(),
        botDifficulty: 'NORMAL', botPolicyType: 'rule-based',
        botPolicyRegistry: { create(type) { createdTypes.push(type); return { setSensePhase() {} }; } },
        gameModeStrategy: { isSectorParcours: () => true, isEndlessParcours: () => false },
        combatModeType: 'ARCADE',
    };
    const setup = new EntitySetupOps(owner);
    try {
        setup.setupBotPlayers(1, 1, { botTeamIds: [], botVehicleIds: ['ship5'], defaultVehicleId: 'ship5', modelScale: 1 });
        assert.deepEqual(createdTypes, ['heuristic']);
        assert.equal(owner.bots[0].player.isArcadeParcoursCompetitor, true);
    } finally {
        for (const player of owner.players) player.dispose?.();
    }
});

test('Arcade Parcours profile marks the racer before the strategy sector type is activated', () => {
    const createdTypes = [];
    const owner = {
        renderer: { addToScene() {}, removeFromScene() {}, getGraphicsStyle: () => 'modern' },
        entityRuntimeConfig: resolveEntityRuntimeConfig({}),
        runtimeConfig: { arcade: { enabled: true, parcoursRacer: true } },
        arena: { currentMapDefinition: null }, players: [], humanPlayers: [], bots: [], botByPlayer: new Map(),
        botDifficulty: 'NORMAL', botPolicyType: 'rule-based',
        botPolicyRegistry: { create(type) { createdTypes.push(type); return { setSensePhase() {} }; } },
        gameModeStrategy: { isSectorParcours: () => false, isEndlessParcours: () => false },
        combatModeType: 'ARCADE',
    };
    const setup = new EntitySetupOps(owner);
    try {
        setup.setupBotPlayers(1, 1, { botTeamIds: [], botVehicleIds: ['ship5'], defaultVehicleId: 'ship5', modelScale: 1 });
        assert.deepEqual(createdTypes, ['heuristic']);
        assert.equal(owner.bots[0].player.isArcadeParcoursCompetitor, true);
    } finally {
        for (const player of owner.players) player.dispose?.();
    }
});

test('Arcade Parcours racer progress is tracked without XP, leaderboard entries, or round victory', () => {
    const racer = {
        index: 1, isBot: true, isArcadeParcoursCompetitor: true, alive: true, hitboxRadius: 1,
        position: new THREE.Vector3(),
    };
    const mapDefinition = {
        parcours: {
            enabled: true,
            routeId: 'test-racer-route',
            checkpoints: [{ id: 'CP01', pos: [0, 0, 0], radius: 4, forward: [1, 0, 0] }],
            finish: { id: 'FINISH', pos: [12, 0, 0], radius: 4, forward: [1, 0, 0] },
        },
    };
    const events = [];
    const entityManager = {
        arena: { currentMapDefinition: mapDefinition }, activeGameMode: 'ARCADE', players: [racer],
        _simulationClockMs: 0, recorder: { logEvent() {} },
        _notifyPlayerFeedback() {},
    };
    const system = new ParcoursProgressSystem(entityManager);
    system.setXpEventCallback((type) => { events.push(`xp:${type}`); return { earned: 10 }; });
    system.setLeaderboardCallback((event) => { events.push(`leaderboard:${event.type}`); return null; });
    system.startRound([racer]);

    const route = system.getRouteSnapshot();
    const racerPolicy = new HeuristicBotPolicy();
    racer.position.set(-10, 0, -10);
    racer.getDirection = (out) => out.set(1, 0, 0);
    const action = racerPolicy.update(1 / 60, racer, {
        mode: 'HUNT',
        runtimeConfig: { arcade: { enabled: true, combatProfile: 'hunt' } },
        entityManager: { getParcoursRouteSnapshot: () => route },
        parcoursProgress: { nextCheckpointIndex: 0, expectedCheckpointIds: ['CP01'] },
    });
    assert.equal(racerPolicy.getDecisionSnapshot().intent, 'parcours-target');
    assert.ok(action.boost === true || action.yawLeft === true || action.yawRight === true || action.pitchUp === true || action.pitchDown === true,
        'the route-following policy steers toward the next checkpoint');
    assert.equal(cross(system, racer, route.checkpoints[0], 100)?.type, 'checkpoint');
    assert.deepEqual(system.getPlayerProgressSnapshot(racer.index).passedCheckpointIds, ['CP01']);
    assert.equal(cross(system, racer, route.finish, 200)?.type, 'finish');
    const progress = system.getPlayerProgressSnapshot(racer.index);
    assert.equal(progress.completed, true, 'the racer can complete its own route state');
    assert.equal(progress.nextCheckpointIndex, 1);
    assert.deepEqual(events, [], 'checkpoint and finish do not award XP or publish leaderboard rows');
    assert.equal(system.getRoundOutcome(), null, 'the racer never enters Parcours completion order as a winner');
    assert.deepEqual(events, ['leaderboard:round_outcome'], 'only the normal outcome query reaches the callback');
});
