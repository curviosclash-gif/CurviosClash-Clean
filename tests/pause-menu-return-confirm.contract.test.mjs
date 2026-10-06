// ============================================
// pause-menu-return-confirm.contract.test.mjs - Pause-Menü: "Hauptmenü" beendete das laufende
// Match mit einem einzigen Klick (Menüprüfung 28.09.2026, H4). Der Knopf folgt jetzt dem
// zweistufigen Muster der übrigen zerstörerischen Knöpfe (ConfirmButtonArming). Weil derselbe
// Knopf seine Beschriftung wechselt ("Hauptmenü" / "Verbindung trennen"), darf das Abbrechen der
// Rückfrage die gerade gültige Beschriftung nicht überschreiben.
// ============================================
import assert from 'node:assert/strict';
import test from 'node:test';

import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';

/** Stands for a <button>: click and blur are real events, text and attributes are plain fields. */
function createButton(label) {
    const attributes = new Map();
    const button = new EventTarget();
    button.textContent = label;
    button.setAttribute = (name, value) => attributes.set(name, String(value));
    button.removeAttribute = (name) => attributes.delete(name);
    button.getAttribute = (name) => attributes.get(name) ?? null;
    button.click = () => button.dispatchEvent(new Event('click'));
    return button;
}

/**
 * A paused local match: without a match-flow snapshot the pause intent falls back to the game
 * state, so state PAUSED allows the return. The runtime port records each return to the menu.
 */
function createPausedMatch() {
    const ui = {
        pauseOverlay: { contains: () => false, appendChild() {} },
        pauseResumeButton: createButton('Fortsetzen'),
        pauseSettingsButton: createButton('Einstellungen'),
        // index.html ships "Menü"; the controller relabels it while the match runs.
        pauseMenuButton: createButton('Menü'),
    };
    const returns = [];
    const game = { state: 'PAUSED', ui, uiManager: { closePauseSettings: () => false } };
    const controller = new PauseOverlayController({
        game,
        matchFlowUiController: { applyLifecycleTransition() {}, applyMatchUiState() {} },
        runtimePort: { returnToMenu: (options) => { returns.push(options); return true; } },
    });
    controller.setupListeners();
    controller.applyPauseProjection();
    return { controller, ui, returns };
}

test('one click on "Hauptmenü" only asks; the second click ends the match', () => {
    const { controller, ui, returns } = createPausedMatch();
    assert.equal(ui.pauseMenuButton.textContent, 'Hauptmenü');

    ui.pauseMenuButton.click();
    assert.equal(returns.length, 0, 'a single click must not end the running match');
    assert.equal(ui.pauseMenuButton.getAttribute('data-confirm-armed'), 'true', 'the first click arms the confirmation');
    assert.notEqual(ui.pauseMenuButton.textContent, 'Hauptmenü', 'the armed button says what the next click does');

    ui.pauseMenuButton.click();
    assert.equal(returns.length, 1, 'the confirming click returns to the menu');
    assert.equal(returns[0].reason, 'pause_menu_return');
    controller.dispose();
});

test('cancelling the question keeps the label the pause is showing right now', () => {
    const { controller, ui, returns } = createPausedMatch();
    controller.applyDisconnectConfirmationProjection();
    ui.pauseMenuButton.click();
    ui.pauseMenuButton.dispatchEvent(new Event('blur'));
    assert.equal(ui.pauseMenuButton.textContent, 'Verbindung trennen', 'blur restores the network label, not the page default');
    assert.equal(returns.length, 0);
    controller.dispose();
});

test('resuming while the question is open drops it, so the next pause asks again', () => {
    const { controller, ui, returns } = createPausedMatch();
    ui.pauseMenuButton.click();
    controller.applyPauseProjection();
    assert.equal(ui.pauseMenuButton.textContent, 'Hauptmenü');
    assert.equal(ui.pauseMenuButton.getAttribute('data-confirm-armed'), null, 'a new pause starts unarmed');
    ui.pauseMenuButton.click();
    assert.equal(returns.length, 0, 'the first click of the new pause only asks');
    controller.dispose();
    ui.pauseMenuButton.click();
    ui.pauseMenuButton.click();
    assert.equal(returns.length, 0, 'dispose removes the button handler');
});
