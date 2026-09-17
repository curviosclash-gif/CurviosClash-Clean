import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';

function createClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
    };
}

function createPausedGame({ settingsOpen }) {
    return {
        keyCapture: null,
        ui: {
            pauseSettingsPanel: { classList: createClassList(settingsOpen ? [] : ['hidden']) },
            pauseSettingsButton: { classList: createClassList(settingsOpen ? ['hidden'] : []) },
        },
    };
}

function createController(game) {
    return new PauseOverlayController({ matchFlowUiController: { game }, runtime: game });
}

test('Escape closes the open pause settings instead of resuming', () => {
    const game = createPausedGame({ settingsOpen: true });
    const controller = createController(game);

    assert.equal(controller.closeSettingsIfOpen(), true);
    assert.equal(game.ui.pauseSettingsPanel.classList.contains('hidden'), true);
    assert.equal(game.ui.pauseSettingsButton.classList.contains('hidden'), false, 'the settings button is back in the pause menu');
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
