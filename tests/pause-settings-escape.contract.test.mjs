import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';

// The pause settings are the menu's settings window; the UI manager opens and closes it.
function createPausedGame({ settingsOpen }) {
    const game = {
        keyCapture: null,
        settingsOpen,
        ui: {},
        uiManager: {
            closePauseSettings() {
                if (!game.settingsOpen) return false;
                game.settingsOpen = false;
                return true;
            },
        },
    };
    return game;
}

function createController(game) {
    return new PauseOverlayController({ matchFlowUiController: { game }, runtime: game });
}

test('Escape closes the open pause settings instead of resuming', () => {
    const game = createPausedGame({ settingsOpen: true });
    const controller = createController(game);

    assert.equal(controller.closeSettingsIfOpen(), true);
    assert.equal(game.settingsOpen, false);
});

test('without open settings Escape is left to the resume path', () => {
    const game = createPausedGame({ settingsOpen: false });
    const controller = createController(game);

    assert.equal(controller.closeSettingsIfOpen(), false);
});

test('the paused game loop asks the pause settings before it resumes', () => {
    // main.js boots the whole app on import, so the loop rule is read from its source.
    const source = readFileSync(new URL('../src/core/main.js', import.meta.url), 'utf8');
    const pausedUpdate = source.match(/_updatePausedState\(_dt\) \{([\s\S]*?)\n {4}\}/)?.[1] || '';
    assert.match(pausedUpdate, /wasPressed\?\.\('Escape'\)\s*&&\s*!matchFlowUi\?\.closePauseSettingsIfOpen\?\.\(\)/);
    assert.match(pausedUpdate, /resumeFromPause/);
});

test('the match flow controller forwards the settings check', () => {
    const source = readFileSync(new URL('../src/ui/MatchFlowUiController.js', import.meta.url), 'utf8');
    assert.match(source, /closePauseSettingsIfOpen\(\) \{ return this\.pauseOverlayController\.closeSettingsIfOpen\(\); \}/);
});
