import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowUiController } from '../src/ui/MatchFlowUiController.js';

function createHarness(deviceAssignment, gamepadEnabled = true) {
    const sources = new Map();
    const keyboardPolls = [];
    const input = {
        setPlayerSource(index, source) { source.bind(index); sources.set(index, source); },
        clearPlayerSources() {
            for (const source of sources.values()) source.dispose();
            sources.clear();
        },
        getKeyboardInput(index) { keyboardPolls.push(index); return { keyboardIndex: index }; },
    };
    const game = {
        input,
        settings: { controls: { GAMEPAD: { enabled: gamepadEnabled } }, localSettings: {} },
        runtimeConfig: {
            session: {
                numHumans: 3,
                splitScreenVariant: 'three_player',
                threePlayerSplit: { deviceAssignment },
            },
        },
    };
    const controller = new MatchFlowUiController({ game, sessionOrchestrator: {} });
    controller._configureInputSourcesForMatch();
    return { input, sources, keyboardPolls };
}

test('three-player input binds the default two controllers and a full keyboard source', () => {
    const { input, sources, keyboardPolls } = createHarness(['gamepad-1', 'gamepad-2', 'keyboard']);
    assert.equal(sources.get(0).gamepadIndex, 0);
    assert.equal(sources.get(1).gamepadIndex, 1);
    assert.equal(sources.get(2).type, 'keyboard');
    assert.deepEqual(sources.get(2).poll(), { keyboardIndex: 2 });
    assert.deepEqual(keyboardPolls, [2]);
    input.clearPlayerSources();
});

test('three-player input follows a reordered per-slot device assignment', () => {
    const { input, sources } = createHarness(['keyboard', 'gamepad-2', 'gamepad-1']);
    assert.equal(sources.get(0).type, 'keyboard');
    assert.deepEqual(sources.get(0).poll(), { keyboardIndex: 0 });
    assert.equal(sources.get(1).gamepadIndex, 1);
    assert.equal(sources.get(2).gamepadIndex, 0);
    input.clearPlayerSources();
});

test('disabled gamepads cannot fall through onto another three-player keyboard slot', () => {
    const { input, sources, keyboardPolls } = createHarness(['gamepad-1', 'gamepad-2', 'keyboard'], false);
    assert.equal(sources.get(0).poll().yawLeft, false);
    assert.equal(sources.get(1).poll().yawLeft, false);
    assert.deepEqual(keyboardPolls, []);
    assert.deepEqual(sources.get(2).poll(), { keyboardIndex: 2 });
    assert.deepEqual(keyboardPolls, [2]);
    input.clearPlayerSources();
});

test('all three players can independently use their own keyboard binding scope', () => {
    const { input, sources, keyboardPolls } = createHarness(['keyboard', 'keyboard', 'keyboard'], false);
    assert.deepEqual(sources.get(0).poll(), { keyboardIndex: 0 });
    assert.deepEqual(sources.get(1).poll(), { keyboardIndex: 1 });
    assert.deepEqual(sources.get(2).poll(), { keyboardIndex: 2 });
    assert.deepEqual([0, 1, 2].map((index) => sources.get(index).keyboardPlayerIndex), [0, 1, 2]);
    assert.deepEqual(keyboardPolls, [0, 1, 2]);
    input.clearPlayerSources();
});

test('all three players can use separate gamepads', () => {
    const { input, sources } = createHarness(['gamepad-1', 'gamepad-2', 'gamepad-3']);
    assert.deepEqual(
        [sources.get(0).gamepadIndex, sources.get(1).gamepadIndex, sources.get(2).gamepadIndex],
        [0, 1, 2]
    );
    input.clearPlayerSources();
});

test('every keyboard and gamepad type combination is supported independently per player', () => {
    for (let gamepadMask = 0; gamepadMask < 8; gamepadMask += 1) {
        const deviceAssignment = [0, 1, 2].map((playerIndex) => (
            gamepadMask & (1 << playerIndex) ? `gamepad-${playerIndex + 1}` : 'keyboard'
        ));
        const { input, sources } = createHarness(deviceAssignment);
        assert.deepEqual(
            [0, 1, 2].map((playerIndex) => sources.get(playerIndex).type),
            deviceAssignment.map((device) => device === 'keyboard' ? 'keyboard' : 'gamepad'),
            `type combination ${gamepadMask.toString(2).padStart(3, '0')}`
        );
        input.clearPlayerSources();
    }
});
