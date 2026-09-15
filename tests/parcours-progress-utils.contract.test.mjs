import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';
import {
    buildRouteFromParcours,
    createPlayerProgressState,
    resolveExpectedCheckpointEntries,
} from '../src/entities/systems/ParcoursProgressUtils.js';

function createParcoursFixture(rules = undefined) {
    return {
        enabled: true,
        rules: rules && typeof rules === 'object' ? rules : undefined,
        checkpoints: [
            { id: 'CP01', pos: [0, 0, 0], radius: 1.2 },
            { id: 'CP02', pos: [10, 0, 0], radius: 1.2 },
        ],
        finish: { id: 'FINISH', pos: [20, 0, 0], radius: 1.2 },
    };
}

test('Parcours route defaults to ghost enabled unless explicitly disabled', () => {
    const defaultRoute = buildRouteFromParcours(createParcoursFixture());
    assert.equal(defaultRoute?.rules?.showGhost, true);

    const disabledRoute = buildRouteFromParcours(createParcoursFixture({ showGhost: false }));
    assert.equal(disabledRoute?.rules?.showGhost, false);

    const enabledRoute = buildRouteFromParcours(createParcoursFixture({ showGhost: true }));
    assert.equal(enabledRoute?.rules?.showGhost, true);
});

test('Parcours route defaults to bidirectional checkpoints unless explicitly disabled', () => {
    const defaultRoute = buildRouteFromParcours(createParcoursFixture());
    assert.equal(defaultRoute?.rules?.bidirectionalCheckpoints, true);

    const disabledRoute = buildRouteFromParcours(createParcoursFixture({ bidirectionalCheckpoints: false }));
    assert.equal(disabledRoute?.rules?.bidirectionalCheckpoints, false);

    const enabledRoute = buildRouteFromParcours(createParcoursFixture({ bidirectionalCheckpoints: true }));
    assert.equal(enabledRoute?.rules?.bidirectionalCheckpoints, true);
});

test('Parcours route can scale checkpoint world positions and trigger radii', () => {
    const scaledRoute = buildRouteFromParcours(createParcoursFixture(), { positionScale: 3 });
    assert.deepEqual(scaledRoute?.checkpoints?.[0]?.pos, [0, 0, 0]);
    assert.deepEqual(scaledRoute?.checkpoints?.[1]?.pos, [30, 0, 0]);
    assert.ok(Math.abs((scaledRoute?.checkpoints?.[0]?.radius ?? 0) - 3.6) < 1e-9);
    assert.deepEqual(scaledRoute?.finish?.pos, [60, 0, 0]);
    assert.ok(Math.abs((scaledRoute?.finish?.radius ?? 0) - 3.6) < 1e-9);
});

test('Parcours route defaults respawn off and preserves an explicit checkpoint policy', () => {
    const defaultRoute = buildRouteFromParcours(createParcoursFixture());
    assert.equal(defaultRoute?.rules?.respawnOnDeath, false);
    assert.equal(defaultRoute?.rules?.lastCheckpointRespawns, 0);

    const respawnRoute = buildRouteFromParcours(createParcoursFixture({
        respawnOnDeath: true,
        lastCheckpointRespawns: 3,
        respawnDelaySeconds: 2.5,
    }));
    assert.equal(respawnRoute?.rules?.respawnOnDeath, true);
    assert.equal(respawnRoute?.rules?.lastCheckpointRespawns, 3);
    assert.equal(respawnRoute?.rules?.respawnDelaySeconds, 2.5);
});

// A route with a substitute lane: CP07_R is the right-hand way through the same stage as CP07.
function createLaneAliasParcours() {
    return {
        enabled: true,
        routeId: 'lane_alias_route',
        rules: { bidirectionalCheckpoints: false, cooldownMs: 0, maxSegmentTimeMs: 0 },
        checkpoints: [
            { id: 'CP06', type: 'gate', pos: [0, 0, 0], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP07', type: 'gate', pos: [10, 0, 0], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP07_R', type: 'gate', aliasOf: 'CP07', pos: [10, 0, 12], radius: 1.2, forward: [1, 0, 0] },
            { id: 'CP08', type: 'gate', pos: [20, 0, 0], radius: 1.2, forward: [1, 0, 0] },
        ],
        finish: { id: 'FINISH', type: 'finish', pos: [30, 0, 0], radius: 1.3, forward: [1, 0, 0] },
    };
}

test('Parcours route keeps the substitute lane among the expected entries of its stage', () => {
    const route = buildRouteFromParcours(createLaneAliasParcours());
    const alias = route.checkpoints.find((entry) => entry.id === 'CP07_R');
    assert.equal(alias.aliasOf, 'CP07');

    const state = createPlayerProgressState(route.totalCheckpoints);
    // The player has just taken CP06; the next stage is the one CP07 and CP07_R share.
    state.nextCheckpointIndex = alias.routeIndex;
    state.stageCheckpointIds[alias.routeIndex - 1] = 'CP06';

    const expected = resolveExpectedCheckpointEntries(route, state).map((entry) => entry.id);
    assert.deepEqual(expected, ['CP07', 'CP07_R']);
});

test('Parcours progress accepts the substitute lane after its predecessor without a penalty', () => {
    const feedback = [];
    const player = {
        index: 0,
        isBot: true,
        alive: true,
        hitboxRadius: 0.8,
        position: { x: 0, y: 0, z: 0 },
    };
    const nowRef = { value: 1000 };
    const entityManager = {
        players: [player],
        arena: { currentMapDefinition: { parcours: createLaneAliasParcours() } },
        _notifyPlayerFeedback(_target, message) { feedback.push(message); },
    };
    const system = new ParcoursProgressSystem(entityManager, { nowProvider: () => nowRef.value });
    system.startRound([player]);

    const crossAt = (pos) => {
        const previousPosition = { x: pos[0] - 0.45, y: pos[1], z: pos[2] };
        player.position = { x: pos[0] + 0.45, y: pos[1], z: pos[2] };
        return system.updatePlayerProgress(player, previousPosition, nowRef.value);
    };

    assert.deepEqual(crossAt([0, 0, 0]), { type: 'checkpoint', checkpointId: 'CP06' });
    nowRef.value = 2000;
    assert.deepEqual(crossAt([10, 0, 12]), { type: 'checkpoint', checkpointId: 'CP07_R' });

    const snapshot = system.getPlayerProgressSnapshot(0, nowRef.value);
    assert.equal(snapshot.wrongOrderCount, 0);
    assert.equal(snapshot.penaltyTimeMs, 0);
    assert.equal(snapshot.nextCheckpointIndex, 2, 'the substitute lane advances the route like its original');
});
