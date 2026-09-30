import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioManager } from '../src/core/Audio.js';

function createAudioStub() {
    const calls = { stopped: 0, updates: [] };
    return {
        calls,
        enabled: true,
        stopEngine: () => { calls.stopped += 1; },
        updateEngine: (state) => calls.updates.push(state),
    };
}

const players = [
    { index: 0, isBot: false, alive: false, speed: 10, baseSpeed: 10 },
    { index: 1, isBot: false, alive: true, speed: 14, baseSpeed: 10, isBoosting: true },
    { index: 2, isBot: true, alive: true, speed: 9, baseSpeed: 10 },
];

test('the engine keeps running for player two after player one crashed in a split screen', () => {
    const audio = createAudioStub();
    AudioManager.prototype.syncEngineFromPlayers.call(audio, players, { localPlayerIndex: 0, localHumanCount: 2 });
    assert.equal(audio.calls.stopped, 0);
    assert.equal(audio.calls.updates.at(-1).speed, 14);
    assert.equal(audio.calls.updates.at(-1).boosting, true);
});

test('a single local pilot still silences the engine when crashed, never borrowing another human', () => {
    const audio = createAudioStub();
    AudioManager.prototype.syncEngineFromPlayers.call(audio, players, { localPlayerIndex: 0, localHumanCount: 1 });
    assert.equal(audio.calls.stopped, 1);
    assert.equal(audio.calls.updates.length, 0);
});
