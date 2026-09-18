import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';
import {
    PAUSE_LEVEL4_SECTION_IDS,
    enterLevel4PauseHost,
    isLevel4PauseHosted,
    leaveLevel4PauseHost,
    resolvePauseLevel4Section,
} from '../src/ui/menu/Level4PauseHost.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function createClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
    };
}

function createPausedUi() {
    return {
        mainMenu: { dataset: {}, classList: createClassList(['hidden']) },
        level4Drawer: { dataset: {} },
        hud: { classList: createClassList() },
        pauseSettingsButton: { focused: false, focus() { this.focused = true; } },
    };
}

test('the pause menu has no settings block of its own any more', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /id="pause-settings"/);
    assert.doesNotMatch(html, /id="pause-(auto-roll-toggle|invert-p1|invert-p2|keybind-p1|keybind-p2)"/);
    assert.match(html, /id="btn-pause-settings"/);
});

test('auto-roll sits in the controls tab so the pause window still reaches it', () => {
    const html = read('index.html');
    const controls = html.match(/<section id="level4-section-controls"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(controls, /id="auto-roll-toggle"/);
});

test('the pause window only offers controls, audio, graphics and HUD', () => {
    assert.deepEqual([...PAUSE_LEVEL4_SECTION_IDS], ['controls', 'audio', 'graphics', 'hud']);
    assert.equal(resolvePauseLevel4Section('audio'), 'audio');
    assert.equal(resolvePauseLevel4Section('gameplay'), 'controls');
    assert.equal(resolvePauseLevel4Section('tools'), 'controls');

    const css = read('style.css');
    const rule = css.match(/#main-menu\[data-pause-settings="true"\] \.level4-section-tab((?::not\(\[data-level4-section-target="[a-z_]+"\]\))+)\s*\{\s*display:\s*none/);
    assert.ok(rule, 'the pause mode hides the other tabs');
    const kept = [...rule[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    assert.deepEqual(kept.sort(), [...PAUSE_LEVEL4_SECTION_IDS].sort());
});

test('entering the pause host shows the menu root in settings-only mode and leaving restores it', () => {
    const ui = createPausedUi();
    assert.equal(enterLevel4PauseHost(ui), true);
    assert.equal(isLevel4PauseHosted(ui), true);
    assert.equal(ui.mainMenu.classList.contains('hidden'), false);
    assert.equal(ui.level4Drawer.dataset.level4ReturnTarget, 'pause');
    assert.equal(ui.hud.classList.contains('pause-settings-open'), true);
    assert.equal(enterLevel4PauseHost(ui), false, 'a second open is ignored');

    assert.equal(leaveLevel4PauseHost(ui), true);
    assert.equal(isLevel4PauseHosted(ui), false);
    assert.equal(ui.mainMenu.classList.contains('hidden'), true, 'the menu hides again behind the pause overlay');
    assert.equal(ui.hud.classList.contains('pause-settings-open'), false);
    assert.equal(ui.pauseSettingsButton.focused, true);
    assert.equal(leaveLevel4PauseHost(ui), false);
});

test('the pause settings button opens the shared settings window', () => {
    const calls = [];
    const game = {
        keyCapture: null,
        ui: {},
        uiManager: {
            openPauseSettings: () => { calls.push('open'); return true; },
            closePauseSettings: () => { calls.push('close'); return true; },
        },
    };
    const controller = new PauseOverlayController({ matchFlowUiController: { game }, runtime: game });
    controller._showSettings();
    assert.equal(controller.closeSettingsIfOpen(), true);
    assert.deepEqual(calls, ['open', 'close']);
});

test('closing the drawer from the pause returns to the pause overlay', () => {
    const source = read('src/ui/UINavigationLifecycleController.js');
    assert.match(source, /returnTarget === PAUSE_LEVEL4_RETURN_TARGET\) \{\s*leaveLevel4PauseHost\(this\.ui\);/);
});

test('Escape in the pause-hosted drawer does not reach the game loop', () => {
    // Otherwise the same press closes the window and resumes the match in the next frame.
    const source = read('src/ui/menu/MenuNavigationRuntime.js');
    const escapeBranch = source.match(/event\.key === 'Escape'[\s\S]*?_goBackFromCurrent\('escape'\)/)?.[0] || '';
    assert.match(escapeBranch, /isLevel4PauseHosted\(this\.ui\)\) event\.stopPropagation\(\)/);
});
