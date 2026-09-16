import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowUiController } from '../src/ui/MatchFlowUiController.js';

function createHarness(deviceAssignment) {
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
        settings: { controls: { GAMEPAD: { enabled: true } }, localSettings: {} },
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
    assert.deepEqual(sources.get(2).poll(), { keyboardIndex: 1 });
    assert.deepEqual(keyboardPolls, [1]);
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
