// Menü-Umbau Etappe 3, Paket B: Neu starten, Steuerung anzeigen und Auto-Pause in der Pause.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';

function createElementStub(tagName = 'div') {
    const attributes = new Map();
    const element = new EventTarget();
    element.tagName = tagName;
    element.className = '';
    element.hidden = false;
    element.children = [];
    element._text = '';
    Object.defineProperty(element, 'textContent', {
        get() { return this._text + this.children.map((child) => child.textContent).join(''); },
        set(value) { this._text = String(value); this.children = []; },
    });
    element.setAttribute = (name, value) => attributes.set(name, String(value));
    element.removeAttribute = (name) => attributes.delete(name);
    element.getAttribute = (name) => attributes.get(name) ?? null;
    element.appendChild = (child) => { element.children.push(child); return child; };
    element.replaceChildren = (...nodes) => { element._text = ''; element.children = nodes; };
    element.click = () => element.dispatchEvent(new Event('click'));
    return element;
}

function createPausedMatch({ settings = {}, snapshot = null, state = 'PAUSED' } = {}) {
    const view = new EventTarget();
    const doc = { defaultView: view, createElement: (tag) => createElementStub(tag) };
    const overlay = createElementStub();
    overlay.ownerDocument = doc;
    overlay.classList = { contains: () => false };
    const keyed = [];
    const focusable = [];
    overlay.contains = (node) => focusable.includes(node);
    overlay.querySelectorAll = (selector) => (selector === 'button' ? focusable : keyed);
    const restart = createElementStub('button');
    restart.textContent = 'Neu starten';
    restart.getAttribute = ((original) => (name) => (name === 'data-menu-visibility-key' ? 'pauseRestart' : original(name)))(restart.getAttribute);
    keyed.push(restart);
    const controlsButton = createElementStub('button');
    controlsButton.textContent = 'Steuerung anzeigen';
    controlsButton.setAttribute('aria-expanded', 'false');
    const controlsPanel = createElementStub();
    controlsPanel.ownerDocument = doc;
    controlsPanel.hidden = true;
    const ui = {
        pauseOverlay: overlay,
        pauseResumeButton: createElementStub('button'),
        pauseSettingsButton: createElementStub('button'),
        pauseMenuButton: createElementStub('button'),
        pauseRestartButton: restart,
        pauseControlsButton: controlsButton,
        pauseControlsPanel: controlsPanel,
        pauseNotice: createElementStub('p'),
        pauseMenuHint: createElementStub('p'),
    };
    ui.pauseNotice.hidden = true;
    for (const button of [ui.pauseResumeButton, restart, ui.pauseSettingsButton, ui.pauseMenuButton]) {
        button.disabled = false;
        button.focus = () => { doc.activeElement = button; };
        focusable.push(button);
    }
    doc.activeElement = ui.pauseResumeButton;
    const game = {
        state,
        ui,
        settings: {
            localSettings: { sessionType: 'single' },
            controls: {
                GAMEPAD: { enabled: true },
                SPLITSCREEN: { layout: 'controller-controller' },
                PLAYER_1: { LEFT: 'KeyA', RIGHT: 'KeyD', BOOST: 'ShiftLeft' },
            },
            ...settings,
        },
        uiManager: { closePauseSettings: () => false },
    };
    const calls = { start: [], pause: 0 };
    ui.doc = doc;
    const controller = new PauseOverlayController({
        game,
        matchFlowUiController: { applyLifecycleTransition() {}, applyMatchUiState() {} },
        runtimePort: {
            getSessionRuntimeSnapshot: () => snapshot,
            startMatch: (options) => { calls.start.push(options); return true; },
            pauseMatch: () => { calls.pause += 1; game.state = 'PAUSED'; controller.applyPauseProjection(); return true; },
            returnToMenu: () => true,
        },
    });
    controller.setupListeners();
    return { controller, ui, game, view, calls };
}

test('restart asks first and starts a new match on the second press', () => {
    const { controller, ui, calls } = createPausedMatch();
    controller.applyPauseProjection();
    ui.pauseRestartButton.click();
    assert.equal(ui.pauseRestartButton.getAttribute('data-confirm-armed'), 'true');
    assert.equal(calls.start.length, 0, 'the first press only asks');
    ui.pauseRestartButton.click();
    assert.deepEqual(calls.start, [{ source: 'pause_restart' }]);
    controller.dispose();
});

test('a network guest can neither see nor trigger the restart', () => {
    const { controller, ui, calls } = createPausedMatch({
        settings: { localSettings: { sessionType: 'multiplayer' } },
        snapshot: { isHost: false },
    });
    controller.applyPauseProjection();
    assert.equal(ui.pauseRestartButton.hidden, true);
    assert.equal(controller.restartFromPause(), false);
    assert.equal(calls.start.length, 0);
    controller.dispose();
});

test('the host and local players keep the restart', () => {
    const { controller, ui } = createPausedMatch({
        settings: { localSettings: { sessionType: 'multiplayer' } },
        snapshot: { isHost: true },
    });
    controller.applyPauseProjection();
    assert.equal(ui.pauseRestartButton.hidden, false);
    controller.dispose();
});

test('"Steuerung anzeigen" folds the key overview open and closed and a new pause closes it', () => {
    const { controller, ui } = createPausedMatch();
    controller.applyPauseProjection();
    ui.pauseControlsButton.click();
    assert.equal(ui.pauseControlsButton.getAttribute('aria-expanded'), 'true');
    assert.equal(ui.pauseControlsPanel.hidden, false);
    assert.equal(ui.pauseControlsButton.textContent, 'Steuerung ausblenden');
    assert.match(ui.pauseControlsPanel.textContent, /Lenken/);
    assert.match(ui.pauseControlsPanel.textContent, /AD/);
    ui.pauseControlsButton.click();
    assert.equal(ui.pauseControlsPanel.hidden, true);
    ui.pauseControlsButton.click();
    controller.applyPauseProjection();
    assert.equal(ui.pauseControlsButton.getAttribute('aria-expanded'), 'false');
    assert.equal(ui.pauseControlsPanel.hidden, true);
    controller.dispose();
});

test('the leave button names its destination in the line below it', () => {
    const { controller, ui } = createPausedMatch();
    controller.applyPauseProjection();
    assert.equal(ui.pauseMenuHint.textContent, 'zurück zur Spielauswahl');
    controller.dispose();
    const lobby = createPausedMatch({ settings: { localSettings: { sessionType: 'multiplayer' } } });
    lobby.controller.applyPauseProjection();
    assert.equal(lobby.ui.pauseMenuHint.textContent, 'zurück zur Lobby');
    lobby.controller.dispose();
});

test('a pad of a local player that drops out pauses the running match with a notice', () => {
    const { controller, ui, game, view, calls } = createPausedMatch({ state: 'PLAYING' });
    view.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0 } }));
    assert.equal(calls.pause, 1);
    assert.equal(game.state, 'PAUSED');
    assert.equal(ui.pauseNotice.textContent, 'Controller von Spieler 1 getrennt');
    assert.equal(ui.pauseNotice.hidden, false);
    controller.applyPauseProjection();
    assert.equal(ui.pauseNotice.hidden, true, 'a later manual pause carries no stale notice');
    controller.dispose();
});

test('no auto-pause in the menu, for strangers pads or in network play', () => {
    const idle = createPausedMatch({ state: 'MENU' });
    idle.view.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0 } }));
    assert.equal(idle.calls.pause, 0);
    const stranger = createPausedMatch({ state: 'PLAYING' });
    stranger.view.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 3 } }));
    assert.equal(stranger.calls.pause, 0);
    const network = createPausedMatch({ state: 'PLAYING', settings: { localSettings: { sessionType: 'multiplayer' } } });
    network.view.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0 } }));
    assert.equal(network.calls.pause, 0);
    for (const match of [idle, stranger, network]) match.controller.dispose();
});

test('dispose removes the pad listener', () => {
    const { controller, view, calls } = createPausedMatch({ state: 'PLAYING' });
    controller.dispose();
    view.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0 } }));
    assert.equal(calls.pause, 0);
});

test('the pause markup carries the new buttons and the stylesheet only uses menu tokens', () => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const id of ['btn-pause-resume', 'btn-pause-restart', 'btn-pause-controls', 'pause-controls', 'btn-pause-settings', 'btn-pause-menu', 'pause-notice', 'pause-menu-hint']) {
        assert.match(html, new RegExp(`id="${id}"`), id);
    }
    assert.match(html, /id="pause-notice"[^>]*role="status"/);
    assert.match(html, /id="btn-pause-controls"[^>]*aria-expanded="false"/);
    // The pause sheet loads after the tokens it reads; other menu sheets may sit in between.
    assert.match(html, /MenuTokens\.css">[\s\S]*?<link rel="stylesheet" href="src\/ui\/menu\/MenuPause\.css"/);
    const css = fs.readFileSync(new URL('../src/ui/menu/MenuPause.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/, 'no literal colours, only --menu-* tokens');
    assert.match(css, /\[class\*="menu-q-"\]\[hidden\]\s*\{\s*display: none;/);
});

test('arrow keys move the focus through the pause buttons like the D-pad', () => {
    const { controller, ui } = createPausedMatch();
    const press = (key) => {
        const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
        ui.pauseOverlay.dispatchEvent(event);
        return event;
    };
    assert.equal(press('ArrowDown').defaultPrevented, true);
    assert.equal(ui.doc.activeElement, ui.pauseRestartButton);
    press('ArrowDown');
    assert.equal(ui.doc.activeElement, ui.pauseSettingsButton);
    press('ArrowUp');
    assert.equal(ui.doc.activeElement, ui.pauseRestartButton);
    press('ArrowUp');
    press('ArrowUp');
    assert.equal(ui.doc.activeElement, ui.pauseMenuButton, 'wraps around');
    assert.equal(press('KeyA').defaultPrevented, false, 'other keys are left alone');
    ui.pauseRestartButton.hidden = true;
    ui.doc.activeElement = ui.pauseResumeButton;
    press('ArrowDown');
    assert.equal(ui.doc.activeElement, ui.pauseSettingsButton, 'a hidden restart button is skipped');
    controller.dispose();
});
