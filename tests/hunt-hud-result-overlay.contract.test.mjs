import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';
import { MatchFlowUiController } from '../src/ui/MatchFlowUiController.js';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

// Parts the killcam takes off screen, e.g. "> .player-hud" or ".hunt-vitals".
function readKillcamHiddenParts() {
    const parts = new Set();
    const pattern = /#hud\.killcam-active\s*(>?)\s*([^,{]+?)\s*[,{]/g;
    let match;
    while ((match = pattern.exec(css))) {
        parts.add(`${match[1] ? '> ' : ''}${match[2].trim()}`);
    }
    return parts;
}

function readOverlayHiddenParts() {
    const block = css.match(
        /#hud:is\(\.result-overlay-open, \.pause-settings-open\) > :is\(([^)]*)\),\s*#hud:is\(\.result-overlay-open, \.pause-settings-open\) :is\(([^)]*)\)\s*\{\s*visibility:\s*hidden;/
    );
    assert.ok(block, 'style.css needs the class based rule that hides the Fight HUD behind overlays');
    const split = (list) => list.split(',').map((part) => part.trim()).filter(Boolean);
    return new Set([
        ...split(block[1]).map((part) => `> ${part}`),
        ...split(block[2]),
    ]);
}

function createClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
    };
}

test('the result and pause overlays hide every HUD part the killcam hides', () => {
    const killcamParts = readKillcamHiddenParts();
    const overlayParts = readOverlayHiddenParts();

    assert.ok(killcamParts.size >= 8, `expected the killcam list to be readable, saw ${killcamParts.size}`);
    for (const part of killcamParts) {
        assert.ok(overlayParts.has(part), `${part} stays on top of the round result`);
    }
});

test('the overlay rule never watches the whole document', () => {
    // A body:has() rule is re-evaluated on every DOM change; with the HUD updating each
    // frame behind the result it stalled the renderer.
    assert.doesNotMatch(css, /body:has\(#message-overlay:not\(\.hidden\)[^{]*#hud/);
});

test('showing and hiding the round result flags the HUD', () => {
    const hud = { classList: createClassList() };
    const messageOverlay = { classList: createClassList(['hidden']) };
    const controller = Object.create(MatchFlowUiController.prototype);
    Object.defineProperty(controller, 'game', { value: { ui: { hud, messageOverlay } } });
    controller._syncArcadeOverlayPanel = () => {};

    controller.applyMatchUiState({ visibility: { messageOverlayHidden: false } });
    assert.equal(hud.classList.contains('result-overlay-open'), true);

    controller.applyMatchUiState({ visibility: { messageOverlayHidden: true } });
    assert.equal(hud.classList.contains('result-overlay-open'), false);
});

test('opening and closing the pause settings flags the HUD', () => {
    const hud = { classList: createClassList() };
    const game = {
        keyCapture: null,
        settings: { invertPitch: {} },
        ui: {
            hud,
            pauseSettingsPanel: { classList: createClassList(['hidden']) },
            pauseSettingsButton: { classList: createClassList() },
        },
    };
    const controller = new PauseOverlayController({ matchFlowUiController: { game }, runtime: game });

    controller._showSettings();
    assert.equal(hud.classList.contains('pause-settings-open'), true);

    controller.closeSettingsIfOpen();
    assert.equal(hud.classList.contains('pause-settings-open'), false);
});
