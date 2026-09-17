import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { applyMenuPlanarMode } from '../src/ui/menu/MenuPlanarModeOps.js';

function freeFlightSettings() {
    return { portalsEnabled: false, gameplay: { planarMode: false, portalCount: 0 } };
}

test('planar flight turns portals on and free flight hands the old setup back', () => {
    const settings = freeFlightSettings();
    const memory = {};

    const on = applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    assert.equal(settings.portalsEnabled, true);
    assert.equal(settings.gameplay.portalCount, 4);
    assert.equal(on.portalCountRaised, true);

    const off = applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);
    assert.equal(settings.gameplay.planarMode, false);
    assert.equal(settings.portalsEnabled, false, 'free flight must not keep the portals planar flight added');
    assert.equal(settings.gameplay.portalCount, 0);
    assert.ok(off.changedKeys.includes(SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED));
    assert.ok(off.changedKeys.includes(SETTINGS_CHANGE_KEYS.GAMEPLAY_PORTAL_COUNT));
});

test('portals the player had before planar flight stay after it', () => {
    const settings = { portalsEnabled: true, gameplay: { planarMode: false, portalCount: 8 } };
    const memory = {};

    applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    const off = applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);

    assert.equal(settings.portalsEnabled, true);
    assert.equal(settings.gameplay.portalCount, 8);
    assert.deepEqual(off.changedKeys, [SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE]);
});

test('clicking planar flight twice still restores the setup from before the first click', () => {
    const settings = freeFlightSettings();
    const memory = {};

    applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);

    assert.equal(settings.portalsEnabled, false);
    assert.equal(settings.gameplay.portalCount, 0);
});

test('leaving a planar setup that was loaded, not switched on here, keeps its portals', () => {
    const settings = { portalsEnabled: true, gameplay: { planarMode: true, portalCount: 4 } };
    const memory = {};

    applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);

    assert.equal(settings.portalsEnabled, true);
    assert.equal(settings.gameplay.portalCount, 4);
});
