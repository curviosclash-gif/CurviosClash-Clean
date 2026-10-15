import assert from 'node:assert/strict';
import test from 'node:test';
import { bindStartSetupControls } from '../src/ui/start-setup/StartSetupControlBindings.js';
import { syncFreePlayUi } from '../src/ui/menu/MenuFreePlayUiSync.js';
import { menuScreenPanelId } from './support/menu-screens.js';

function makeClassList() {
    const values = new Set();
    return {
        toggle(name, force) { const on = force ?? !values.has(name); if (on) values.add(name); else values.delete(name); return on; },
        contains(name) { return values.has(name); },
    };
}

function makeTarget(sectionId, panel) {
    const attributes = new Map();
    return {
        dataset: { startSectionTarget: sectionId }, classList: makeClassList(), panel,
        closest(selector) { return selector === '[data-start-section-target]' ? this : selector === '.submenu-panel' ? panel : null; },
        toggleAttribute(name, force) { if (force) attributes.set(name, ''); else attributes.delete(name); },
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        focus() {},
    };
}

function makeSection(id, panel, open = false) {
    const summary = { attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, String(value)); }, focus() {} };
    return {
        id: `start-${id}-section`, dataset: { startSection: id }, open, panel, summary,
        querySelector(selector) { return selector === ':scope > summary' ? summary : null; },
        matches(selector) { return selector.startsWith('details[data-start-section') && id !== 'multiplayer'; },
        closest(selector) { return selector === '.submenu-panel' ? panel : null; },
    };
}

function makeMainMenu(panels) {
    const sections = panels.flatMap(panel => panel.sections);
    const targets = panels.flatMap(panel => panel.targets);
    const listeners = new Map();
    return {
        listeners,
        querySelectorAll(selector) {
            if (selector === 'details[data-start-section]') return sections;
            if (selector === '[data-start-section-target]') return targets;
            return [];
        },
        querySelector() { return null; },
        contains(target) { return sections.includes(target) || targets.includes(target); },
        addEventListener(type, callback) { listeners.set(type, callback); },
    };
}

test('free play exposes a stable stage state and permits map beside aircraft and rules', () => {
    const setupPanel = { attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, String(value)); },
        getAttribute(name) { return this.attributes.get(name) ?? null; } };
    syncFreePlayUi({ ui: { setupPanel }, settings: { localSettings: { modePath: 'fight' }, hunt: {} }, sessionType: 'single' });
    assert.equal(setupPanel.getAttribute('data-free-play-stage'), 'true');
    syncFreePlayUi({ ui: { setupPanel }, settings: { localSettings: { modePath: 'arcade' } }, sessionType: 'single' });
    assert.equal(setupPanel.getAttribute('data-free-play-stage'), 'false');

    const gamePanel = { id: menuScreenPanelId('freeplay'), attributes: new Map([['data-free-play-stage', 'true']]),
        getAttribute(name) { return this.attributes.get(name) ?? null; },
        querySelectorAll(selector) { return selector === 'details[data-start-section]' ? this.sections : []; } };
    const map = makeSection('map', gamePanel, true), vehicle = makeSection('vehicle', gamePanel), match = makeSection('match', gamePanel);
    const gameTargets = ['map', 'vehicle', 'match'].map(id => makeTarget(id, gamePanel));
    gamePanel.sections = [map, vehicle, match]; gamePanel.targets = gameTargets;
    const arcadePanel = { id: menuScreenPanelId('modeChoice'), attributes: new Map(), getAttribute(name) { return this.attributes.get(name) ?? null; },
        querySelectorAll(selector) { return selector === 'details[data-start-section]' ? this.sections : []; } };
    const arcade = makeSection('arcade', arcadePanel, true);
    const arcadeTarget = makeTarget('arcade', arcadePanel);
    arcadePanel.sections = [arcade]; arcadePanel.targets = [arcadeTarget];
    const mainMenu = makeMainMenu([gamePanel, arcadePanel]);
    bindStartSetupControls({ ui: { mainMenu } }, (target, type, handler) => {
        if (target === mainMenu) mainMenu.listeners.set(type, handler);
    }, () => ({}));

    mainMenu.listeners.get('click')({ target: gameTargets[1] });
    assert.equal(map.open, true, 'opening the aircraft panel keeps the map stage open');
    assert.equal(vehicle.open, true);
    assert.equal(arcade.open, true, 'the separate Arcade hub panel is independent');

    gamePanel.attributes.set('data-free-play-stage', 'false');
    mainMenu.listeners.get('click')({ target: gameTargets[2] });
    assert.equal(map.open, false, 'other start flows retain their exclusive accordion behavior');
    assert.equal(vehicle.open, false);
    assert.equal(match.open, true);
});
