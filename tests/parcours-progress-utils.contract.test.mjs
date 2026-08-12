import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

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
