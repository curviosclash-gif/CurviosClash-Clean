import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { bindMenuExtrasButtons } from '../src/ui/menu/MenuExtrasBindings.js';
import { menuScreenPanelId } from './support/menu-screens.js';

test('the loading notice shows at once instead of fading in behind a blocked thread', () => {
    const css = fs.readFileSync('style.css', 'utf8');
    assert.match(css, /#message-overlay\[data-loading="true"\]\s*\{\s*animation:\s*none;/);
    const controller = fs.readFileSync('src/ui/MatchFlowUiController.js', 'utf8');
    assert.match(controller, /setAttribute\?\.\('data-loading', 'true'\)/);
    assert.match(controller, /removeAttribute\?\.\('data-loading'\)/);
});

test('saved settings stay small and fold away when another tab is chosen', () => {
    const css = fs.readFileSync('src/ui/menu/MenuDrawer.css', 'utf8');
    assert.match(css, /\.level4-backups \{[^}]*max-height: min\(30vh, 240px\);/);

    const handlers = new Map();
    const attrs = {};
    const tab = { closest: (selector) => (selector === '[data-level4-section-target]' ? tab : null) };
    const drawer = {};
    const button = {
        setAttribute: (name, value) => { attrs[name] = value; },
        closest: (selector) => (selector === `#${menuScreenPanelId('settings')}` ? drawer : null),
    };
    const panel = { hidden: true };
    // The arcade surface further down needs a real DOM; the backups toggle is bound before it.
    try {
        bindMenuExtrasButtons({
            ui: { level4BackupsButton: button, level4BackupsPanel: panel },
        settings: { localSettings: {} },
        emit() {},
        bind: (target, type, handler) => handlers.set(target, handler),
        eventTypes: {},
        settingsChangeKeys: {},
        });
    } catch (error) {
        if (!(error instanceof ReferenceError)) throw error;
    }
    handlers.get(button)();
    assert.equal(panel.hidden, false);
    assert.equal(attrs['aria-expanded'], 'true');
    handlers.get(drawer)({ target: tab });
    assert.equal(panel.hidden, true);
    assert.equal(attrs['aria-pressed'], 'false');
});
