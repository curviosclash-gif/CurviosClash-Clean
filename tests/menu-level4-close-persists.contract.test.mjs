import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleLevel4CloseAction } from '../src/core/runtime/MenuRuntimeSessionService.js';

function createGame() {
    const calls = { saved: 0, drawer: [] };
    const game = {
        settings: {
            localSettings: {
                toolsState: { level4Open: true, level4ReturnTarget: 'lobby', activeSection: 'audio' },
            },
        },
        uiManager: { setLevel4Open: (open) => calls.drawer.push(open) },
        _saveSettings: () => { calls.saved += 1; },
    };
    return { game, calls };
}

test('closing the options window stores the closed state right away', () => {
    // Without the save the stored flag stays true until some later change is saved,
    // and a restart in between reopens the window inside the lobby.
    const { game, calls } = createGame();
    handleLevel4CloseAction({ game });
    assert.equal(game.settings.localSettings.toolsState.level4Open, false);
    assert.equal('level4ReturnTarget' in game.settings.localSettings.toolsState, false);
    assert.deepEqual(calls.drawer, [false]);
    assert.equal(calls.saved, 1);
});

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('Escape closes the options window through the close button', () => {
    // One path for both: the close button emits LEVEL4_CLOSE, which clears the
    // return target and stores the state; Escape used to only hide the drawer.
    const source = readSource('../src/ui/UINavigationLifecycleController.js');
    assert.match(source, /onLevel4CloseRequested: \(\) => this\._requestLevel4Close\(\)/);
    assert.match(source, /_requestLevel4Close\(\) \{[\s\S]*?closeLevel4Button[\s\S]*?\.click\(\)/);
});

test('the start setup sync may close the options window but never opens it', () => {
    const source = readSource('../src/ui/UIStartSyncController.js');
    assert.doesNotMatch(source, /this\.manager\.setLevel4Open\(level4Open\)/);
});
