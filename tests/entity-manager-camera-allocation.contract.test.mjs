import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityManager } from '../src/entities/EntityManager.js';

function createProjectedPlayer(playerIndex, overrides = {}) {
    return {
        playerIndex,
        isBot: false,
        alive: true,
        position: { x: playerIndex * 4, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        direction: { x: 0, y: 0, z: -1 },
        hp: 100,
        maxHp: 100,
        score: playerIndex,
        speed: 18,
        ...overrides,
    };
}

test('camera projection skips bots and reuses its synchronous context', () => {
    const contexts = [];
    const snapshots = [];
    const renderer = {
        cameras: [{}, {}],
        getCameraMode: () => 'THIRD_PERSON',
        updateCamera(...args) {
            const context = args[9];
            contexts.push(context);
            snapshots.push({
                hp: context.playerState.hp,
                otherX: context.otherPlayerPosition?.x ?? null,
            });
        },
    };
    const manager = new EntityManager(renderer, null, null, null, null, null);

    manager.updateCameras(1 / 60, 1, true, {
        players: [
            createProjectedPlayer(0, { hp: 80 }),
            createProjectedPlayer(1, { hp: 60 }),
            createProjectedPlayer(2, { isBot: true }),
        ],
    });

    assert.equal(contexts.length, 2);
    assert.equal(contexts[0], contexts[1]);
    assert.deepEqual(snapshots, [
        { hp: 80, otherX: 4 },
        { hp: 60, otherX: 0 },
    ]);
});
