import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { applyMenuPlanarMode } from '../src/ui/menu/MenuPlanarModeOps.js';
import {
    PLANAR_MIN_PORTAL_ENTRY_COUNT,
    resolveMapPortalEntryCount,
} from '../src/shared/contracts/PortalAuthoringContract.js';

function freeFlightSettings() {
    return { portalsEnabled: false, gameplay: { planarMode: false } };
}

test('planar flight turns portals on and free flight hands the old setup back', () => {
    const settings = freeFlightSettings();
    const memory = {};

    const on = applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    assert.equal(settings.portalsEnabled, true);
    assert.ok(on.changedKeys.includes(SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED));

    const off = applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);
    assert.equal(settings.gameplay.planarMode, false);
    assert.equal(settings.portalsEnabled, false, 'free flight must not keep the portals planar flight added');
    assert.ok(off.changedKeys.includes(SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED));
});

test('portals the player had before planar flight stay after it', () => {
    const settings = { portalsEnabled: true, gameplay: { planarMode: false } };
    const memory = {};

    applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    const off = applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);

    assert.equal(settings.portalsEnabled, true);
    assert.deepEqual(off.changedKeys, [SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE]);
});

test('clicking planar flight twice still restores the setup from before the first click', () => {
    const settings = freeFlightSettings();
    const memory = {};

    applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    applyMenuPlanarMode(settings, true, SETTINGS_CHANGE_KEYS, memory);
    applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);

    assert.equal(settings.portalsEnabled, false);
});

test('leaving a planar setup that was loaded, not switched on here, keeps its portals', () => {
    const settings = { portalsEnabled: true, gameplay: { planarMode: true } };
    const memory = {};

    applyMenuPlanarMode(settings, false, SETTINGS_CHANGE_KEYS, memory);

    assert.equal(settings.portalsEnabled, true);
});

test('planar flight on a map without portals still gets portals to change level', () => {
    assert.equal(resolveMapPortalEntryCount({ portalCount: 0 }, { planarMode: true }), PLANAR_MIN_PORTAL_ENTRY_COUNT);
    assert.equal(resolveMapPortalEntryCount({ portalCount: 0 }, { planarMode: false }), 0);
    assert.equal(resolveMapPortalEntryCount({ portalCount: 6 }, { planarMode: true }), 6);
});
