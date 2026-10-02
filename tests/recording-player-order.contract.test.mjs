import assert from 'node:assert/strict';
import test from 'node:test';
import * as ThreeModule from 'three';

globalThis.THREE = ThreeModule;
const { RecordingCapturePipeline } = await import(
    '../src/core/renderer/RecordingCapturePipeline.js'
);

function observeSortCalls(values) {
    let calls = 0;
    class ObservedPlayerList extends Array {
        static get [Symbol.species]() { return ObservedPlayerList; }
        sort(compareFn) {
            calls += 1;
            return super.sort(compareFn);
        }
    }
    const players = new ObservedPlayerList();
    players.push(...values);
    return { players, sortCalls: () => calls };
}

function createPipeline() {
    return new RecordingCapturePipeline({ sourceCanvas: null, sourceRenderer: null, scene: null });
}

test('recording capture reuses already ordered player projections without sorting', () => {
    const pipeline = createPipeline();
    const p0 = { playerIndex: 0, isBot: false };
    const p0Tie = { playerIndex: 0, isBot: true };
    const p1 = { playerIndex: 1, isBot: false };
    const currentFrame = observeSortCalls([p0, p0Tie, p1]);

    assert.deepEqual(Array.from(pipeline._resolveProjectedPlayers({ players: currentFrame.players })), [p0, p0Tie, p1]);
    assert.deepEqual(Array.from(pipeline._resolveRecordingPlayers({ players: currentFrame.players })), [p0, p1]);
    assert.equal(currentFrame.sortCalls(), 0, 'ordered player and human lists must skip redundant sorts');

    const p1AfterJoin = { playerIndex: 1, isBot: false, joined: true };
    const nextFrame = observeSortCalls([p0, p0Tie, p1AfterJoin]);
    assert.deepEqual(Array.from(pipeline._resolveRecordingPlayers({ players: nextFrame.players })), [p0, p1AfterJoin]);
    assert.equal(nextFrame.sortCalls(), 0);
});

test('recording capture keeps stable fallback sorting for unsorted, default, tied, and NaN indices', () => {
    const pipeline = createPipeline();
    const late = { playerIndex: 2, isBot: false, name: 'late' };
    const missing = { isBot: false, name: 'default-missing' };
    const zero = { playerIndex: 0, isBot: false, name: 'default-zero' };
    const oneFirst = { playerIndex: 1, isBot: false, name: 'tie-first' };
    const bot = { playerIndex: 1, isBot: true, name: 'bot' };
    const oneSecond = { playerIndex: 1, isBot: false, name: 'tie-second' };
    const unsorted = observeSortCalls([late, missing, zero, oneFirst, bot, oneSecond]);

    assert.deepEqual(
        Array.from(pipeline._resolveRecordingPlayers({ players: unsorted.players })),
        [missing, zero, oneFirst, oneSecond, late]
    );
    assert.equal(unsorted.sortCalls(), 1, 'unsorted human lists retain the existing stable sort');
    assert.deepEqual(
        Array.from(pipeline._resolveProjectedPlayers({ players: unsorted.players })),
        [missing, zero, oneFirst, bot, oneSecond, late]
    );
    assert.equal(unsorted.sortCalls(), 2, 'all-player lists retain the same fallback sort');

    const nan = { playerIndex: Number.NaN, isBot: false, name: 'nan' };
    const nanInput = observeSortCalls([
        { playerIndex: 2, isBot: false, name: 'two' },
        nan,
        { playerIndex: 1, isBot: false, name: 'one' },
    ]);
    const expected = [...nanInput.players].sort(
        (left, right) => (left.playerIndex || 0) - (right.playerIndex || 0)
    );
    assert.deepEqual(Array.from(pipeline._resolveProjectedPlayers({ players: nanInput.players })), expected);
    assert.equal(nanInput.sortCalls(), 1, 'NaN indices use the existing comparator fallback');
});
