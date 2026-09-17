import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMenuCompatibilityRules } from '../src/ui/menu/MenuCompatibilityRules.js';
import { HUNT_RESPAWN_FIXED_HINT, syncHuntRespawnToggle } from '../src/ui/menu/MenuHuntRespawnToggleSync.js';

function createToggle() {
    return { checked: false, disabled: false, title: '' };
}

function fightSettings() {
    return {
        gameMode: 'HUNT',
        mapKey: 'maze',
        hunt: { respawnEnabled: true, deathmatchKillLimit: 10, timeLimitEnabled: true },
        localSettings: { sessionType: 'single', modePath: 'fight' },
    };
}

test('the Fight respawn toggle is locked because the mode path decides it', () => {
    const settings = fightSettings();
    const toggle = createToggle();

    syncHuntRespawnToggle(toggle, settings, { huntModeActive: true, respawnEnabled: true });

    assert.equal(toggle.checked, true);
    assert.equal(toggle.disabled, true, 'a click would only snap back, so the toggle must not accept one');
    assert.equal(toggle.title, HUNT_RESPAWN_FIXED_HINT);
});

test('the lock matches the rule that snaps the value back', () => {
    const settings = fightSettings();
    settings.hunt.respawnEnabled = false;

    applyMenuCompatibilityRules(settings, { changedKeys: ['hunt.respawnEnabled'] });

    // If the rule ever stops forcing respawn, the toggle has to become usable again.
    assert.equal(settings.hunt.respawnEnabled, true, 'Fight still forces respawn');
});

test('without a fixed mode path the toggle stays usable in Fight', () => {
    const settings = fightSettings();
    settings.localSettings.modePath = '';
    const toggle = createToggle();

    syncHuntRespawnToggle(toggle, settings, { huntModeActive: true, respawnEnabled: false });

    assert.equal(toggle.disabled, false);
    assert.equal(toggle.title, '');
});

test('outside Fight the toggle is disabled without the Fight hint', () => {
    const settings = fightSettings();
    settings.gameMode = 'CLASSIC';
    settings.localSettings.modePath = 'normal';
    const toggle = createToggle();

    syncHuntRespawnToggle(toggle, settings, { huntModeActive: false, respawnEnabled: false });

    assert.equal(toggle.disabled, true);
    assert.equal(toggle.title, '');
});
