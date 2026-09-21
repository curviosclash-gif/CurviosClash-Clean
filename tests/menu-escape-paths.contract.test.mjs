import assert from 'node:assert/strict';
import test from 'node:test';

import { MenuNavigationRuntime } from '../src/ui/menu/MenuNavigationRuntime.js';
import { MENU_STATE_IDS } from '../src/ui/menu/MenuStateMachine.js';

test('Escape leaves an unjoined multiplayer panel through normal back navigation', () => {
    const panel = { id: 'submenu-multiplayer', dataset: { lobbyJoined: 'false' }, querySelector: () => null };
    const runtime = new MenuNavigationRuntime({
        ui: { multiplayerPanel: panel },
        stateMachine: { getState: () => MENU_STATE_IDS.MULTIPLAYER },
    });
    let returnedToMain = 0;
    runtime._isLevel4Open = () => false;
    runtime._getVisiblePanelElement = () => panel;
    runtime.showMainNav = () => { returnedToMain += 1; };
    const event = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };

    runtime._handleMenuKeyDown(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(returnedToMain, 1);
});

test('Escape does not silently leave an already joined lobby', () => {
    const panel = { id: 'submenu-multiplayer', dataset: { lobbyJoined: 'true' } };
    const runtime = new MenuNavigationRuntime({ ui: { multiplayerPanel: panel } });
    runtime._isLevel4Open = () => false;
    runtime._getVisiblePanelElement = () => panel;
    let returnedToMain = 0;
    runtime.showMainNav = () => { returnedToMain += 1; };

    assert.equal(runtime._goBackFromCurrent('escape'), true);
    assert.equal(returnedToMain, 0);
});
