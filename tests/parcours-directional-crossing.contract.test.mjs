import assert from 'node:assert/strict';
import test from 'node:test';

import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

function createHarness() {
    const player = {
        index: 0,
        isBot: false,
        alive: true,
        hitboxRadius: 0.8,
        position: { x: -5, y: 0, z: 0 },
    };
    const entityManager = {
        arena: {
            currentMapDefinition: {
                parcours: {
                    enabled: true,
                    routeId: 'directional-step-route',
                    rules: {
                        ordered: true,
                        bidirectionalCheckpoints: false,
                        cooldownMs: 0,
                    },
                    checkpoints: [{
                        id: 'CP01',
                        pos: [0, 0, 0],
                        radius: 3,
                        forward: [1, 0, 0],
                    }],
                    finish: {
                        id: 'FINISH',
                        pos: [10, 0, 0],
                        radius: 3,
                        forward: [1, 0, 0],
                    },
                },
            },
        },
        players: [player],
        recorder: { logEvent() {} },
        _notifyPlayerFeedback() {},
    };
    const system = new ParcoursProgressSystem(entityManager, { nowProvider: () => 0 });
    system.startRound([player]);
    return { player, system };
}

function stepTo(system, player, x, now) {
    const previousPosition = { ...player.position };
    player.position.x = x;
    return system.updatePlayerProgress(player, previousPosition, now);
}

test('directional checkpoint accepts a multi-frame approach through its trigger sphere', () => {
    const { player, system } = createHarness();

    assert.equal(stepTo(system, player, -3, 100), null, 'entering the back of the sphere does not trigger');
    assert.equal(stepTo(system, player, -1, 200), null, 'approaching the plane stays armed');
    assert.deepEqual(
        stepTo(system, player, 1, 300),
        { type: 'checkpoint', checkpointId: 'CP01' },
        'crossing the forward plane triggers even after earlier frames inside the sphere',
    );
    assert.equal(system.getPlayerHudState(0).currentCheckpoint, 1);
});

test('directional checkpoint rejects a reverse crossing', () => {
    const { player, system } = createHarness();
    player.position.x = 2;

    assert.equal(stepTo(system, player, -1, 100), null);
    assert.equal(system.getPlayerHudState(0).currentCheckpoint, 0);
});
