// ============================================
// hangar-gamepad-navigation.contract.test.mjs - Nutzerentscheidung 06.10.2026: der Hangar lässt sich
// mit dem Controller bedienen. Steuerkreuz/Stick bewegen den Fokus über den sichtbaren Reiter, A klickt
// das fokussierte Element (zweistufige Knöpfe bestätigen dadurch wie mit der Maus), B nimmt den Weg der
// Escape-Taste (erst Auswahl aufheben, dann Hangar schließen), LB/RB wechseln den Reiter, Regler folgen
// links/rechts. Bausteine werden ohne Ziehen platziert: Baustein mit A wählen, Platz mit A wählen.
// Läuft mit dem schmalen Ersatz-DOM der Hangar-Tests, einem Ersatz-Gamepad und einem Ersatz-Bildtakt.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, bind, createEvent, fakeDocument, find } from './helpers/fake-hangar-dom.mjs';

// The hangar sends B as a real Escape keydown; Node has no KeyboardEvent, so this one carries the
// same fields the fake DOM's events have.
globalThis.KeyboardEvent = class {
    constructor(type, init = {}) { Object.assign(this, createEvent(type, init)); }
};

const { createHangarGamepadNavigation } = await import('../src/ui/hangar/HangarGamepadNavigation.js');
const { createHangarPartStylePanel } = await import('../src/ui/hangar/HangarPartStylePanel.js');
const { GAMEPAD_MENU_BUTTONS } = await import('../src/ui/menu/GamepadMenuPoller.js');

function element(tag, { parent, className = '', data = {}, rect = null, text = '' } = {}) {
    const node = new FakeElement(tag);
    node.className = className;
    node.textContent = text;
    Object.assign(node.dataset, data);
    if (tag === 'button') node.type = 'button';
    if (rect) node.getBoundingClientRect = () => ({ x: rect[0], y: rect[1], width: rect[2] ?? 100, height: rect[3] ?? 30 });
    parent?.appendChild(node);
    return node;
}

/**
 * A small hangar page. The listeners stand in for the real ones: HangarWindowApp clicks
 * "Zurück zum Menü" on an Escape nobody consumed, ArcadeHangarWorkshop selects a part on a click
 * in the catalog, installs it on a click on a slot and clears the selection on Escape (consuming
 * the key), and the tab row shows one panel per tab.
 */
function createHangarPage({ controls = null } = {}) {
    const page = { closed: 0, selectedPartId: '', installs: [], controls };
    const root = element('body');
    page.root = root;
    page.close = element('button', { parent: root, rect: [600, 0] });
    bind(page.close, 'click', () => { page.closed += 1; });
    bind(root, 'keydown', (event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        page.close.click();
    });

    const workshop = element('div', { parent: root, className: 'hangar-workshop-shell' });
    bind(workshop, 'keydown', (event) => {
        if (event.key === 'Escape' && page.selectedPartId) { event.preventDefault(); page.selectedPartId = ''; }
    });
    const tabRow = element('div', { parent: workshop });
    page.tabs = ['workshop', 'stats', 'presets', 'upgrade'].map((view, index) => {
        const tab = element('button', { parent: tabRow, data: { buildView: view }, rect: [index * 110, 60] });
        tab.setAttribute('aria-selected', String(view === 'upgrade'));
        return tab;
    });
    page.tabs[0].classList.add('hidden'); // the arcade hangar hides "Umbau"
    bind(tabRow, 'click', (event) => {
        const view = event.target.closest('[data-build-view]')?.dataset.buildView;
        page.tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.buildView === view)));
    });

    const catalog = element('div', { parent: workshop });
    const card = element('div', { parent: catalog, data: { partId: 'stone_red' } });
    page.partButton = element('button', { parent: card, data: { partSelect: 'stone_red' }, rect: [0, 150] });
    bind(catalog, 'click', (event) => {
        const partId = event.target.closest('[data-part-id]')?.dataset.partId;
        if (partId) page.selectedPartId = page.selectedPartId === partId ? '' : partId;
    });
    const slots = element('div', { parent: workshop });
    page.slotButton = element('button', { parent: slots, data: { selectSlot: 'nose' }, rect: [0, 250] });
    bind(slots, 'click', (event) => {
        const slotId = event.target.closest('[data-select-slot]')?.dataset.selectSlot;
        if (slotId && page.selectedPartId) { page.installs.push([page.selectedPartId, slotId]); page.selectedPartId = ''; }
    });
    page.slider = element('input', { parent: workshop, rect: [0, 350] });
    page.slider.type = 'range';
    page.slider.value = '5';
    page.slider.stepUp = () => { page.slider.value = String(Number(page.slider.value) + 1); };
    page.slider.stepDown = () => { page.slider.value = String(Number(page.slider.value) - 1); };
    page.sliderEvents = [];
    bind(page.slider, 'input', () => page.sliderEvents.push('input'));
    bind(page.slider, 'change', () => page.sliderEvents.push('change'));
    return page;
}

/** Stands in for a standard-mapping pad plus the rAF clock that drives the hangar's poll loop. */
function connectPad(page) {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] };
    const frames = new Map();
    let nextHandle = 1;
    let time = 0;
    const navigation = createHangarGamepadNavigation({
        root: page.root,
        doc: fakeDocument,
        getControls: () => page.controls,
        getGamepads: () => [pad],
        requestFrame: (tick) => { const handle = nextHandle++; frames.set(handle, tick); return handle; },
        cancelFrame: (handle) => frames.delete(handle),
    });
    navigation.start();
    const frame = () => {
        const [[handle, tick]] = frames;
        frames.delete(handle);
        time += 16;
        tick(time);
    };
    const press = (name) => {
        pad.buttons[GAMEPAD_MENU_BUTTONS[name]].pressed = true;
        frame();
        pad.buttons[GAMEPAD_MENU_BUTTONS[name]].pressed = false;
        frame();
    };
    return { navigation, press, frames };
}

test('the d-pad moves the focus through the visible hangar; the first press picks a start point', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { press } = connectPad(page);
    press('DOWN');
    assert.equal(fakeDocument.activeElement, page.close, 'with nothing focused the first press focuses the first control');
    page.partButton.focus();
    press('DOWN');
    assert.equal(fakeDocument.activeElement, page.slotButton, 'down goes to the control below');
    press('UP');
    assert.equal(fakeDocument.activeElement, page.partButton, 'up comes back');
    assert.equal(page.root.dataset.gamepadFocus, 'true', 'pad navigation turns on the visible focus ring');
});

test('A clicks the focused control, so a two-step confirm button asks first and resets on the second A', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const saved = [];
    const panel = createHangarPartStylePanel({
        bind,
        onStyleChange: (style) => { saved.push(style); panel.render({ vehicleId: 'ship5', style }); },
        onSelectPart() {},
    });
    panel.render({ vehicleId: 'ship5', style: {} });
    const color = find(panel.root, 'hangar-part-style-color');
    color.value = '#ff0000';
    color.dispatchEvent(createEvent('input'));
    saved.length = 0;
    page.root.appendChild(panel.root);
    const resetAll = find(panel.root, 'hangar-part-style-reset-all');
    const { press } = connectPad(page);

    resetAll.focus();
    press('A');
    assert.deepEqual(saved, [], 'the first A only arms the confirmation');
    assert.equal(resetAll.getAttribute('data-confirm-armed'), 'true');
    press('A');
    assert.deepEqual(saved, [{}], 'the second A resets every part colour');
});

test('a part is placed without dragging: A on the part, A on the slot; B cancels a chosen part', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { press } = connectPad(page);
    page.partButton.focus();
    press('A');
    assert.equal(page.selectedPartId, 'stone_red', 'A picks the part');
    press('DOWN');
    press('A');
    assert.deepEqual(page.installs, [['stone_red', 'nose']], 'A on the slot installs the chosen part');

    press('UP');
    press('A');
    press('B');
    assert.equal(page.selectedPartId, '', 'B drops the chosen part');
    assert.equal(page.closed, 0, 'and leaves the hangar open, just like Escape');
});

test('B with nothing chosen takes the Escape way out of the hangar', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { press } = connectPad(page);
    page.slotButton.focus();
    press('B');
    assert.equal(page.closed, 1);
});

test('LB and RB switch the visible tab and skip hidden ones', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { press } = connectPad(page);
    const selected = () => page.tabs.find((tab) => tab.getAttribute('aria-selected') === 'true').dataset.buildView;
    press('RB');
    assert.equal(selected(), 'stats', 'RB wraps from the last tab to the first visible one');
    assert.equal(fakeDocument.activeElement, page.tabs[1], 'the new tab takes the focus');
    press('LB');
    assert.equal(selected(), 'upgrade', 'LB goes back and skips the hidden "Umbau" tab');
});

test('left and right turn a focused slider instead of leaving it', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { press } = connectPad(page);
    page.slider.focus();
    press('RIGHT');
    assert.equal(page.slider.value, '6');
    assert.deepEqual(page.sliderEvents, ['input', 'change'], 'the panel hears the change like a mouse drag');
    assert.equal(fakeDocument.activeElement, page.slider);
});

test('"Controller-Steuerung aus" in the settings leaves the hangar alone', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage({ controls: { GAMEPAD: { enabled: false } } });
    const { press } = connectPad(page);
    page.partButton.focus();
    press('A');
    press('DOWN');
    press('B');
    assert.equal(page.selectedPartId, '');
    assert.equal(fakeDocument.activeElement, page.partButton);
    assert.equal(page.closed, 0);
});

test('dispose stops the poll loop and removes the listener and the focus ring flag', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { navigation, press, frames } = connectPad(page);
    press('DOWN');
    assert.equal(page.root.dataset.gamepadFocus, 'true');
    const listenersBefore = page.root.listeners.pointerdown?.length || 0;
    navigation.dispose();
    assert.equal(frames.size, 0, 'no frame is pending after dispose');
    assert.equal(page.root.listeners.pointerdown?.length || 0, listenersBefore - 1, 'the pointer listener is gone');
    assert.equal(page.root.dataset.gamepadFocus, undefined);
});

test('a mouse press hides the pad focus ring again', () => {
    fakeDocument.activeElement = null;
    const page = createHangarPage();
    const { press } = connectPad(page);
    press('DOWN');
    page.root.dispatchEvent(createEvent('pointerdown'));
    assert.equal(page.root.dataset.gamepadFocus, undefined);
});
