import assert from 'node:assert/strict';
import test from 'node:test';

import { TEAM_COLORS, TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';
import { resolvePlayerColor as resolveHangarPreviewColor } from '../src/ui/arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { resolveStartSetupPlayerColor } from '../src/ui/start-setup/StartSetupVehiclePicker3d.js';
import { HANGAR_SELECTION_PLAYER_SLOTS } from '../src/ui/hangar/HangarSelectionWritebackContract.js';

const PLAYER_1_COLOR = `#${TEAM_COLORS[TEAM_IDS.ALPHA].toString(16).padStart(6, '0')}`;

test('vehicle-manager previews default P1 to the in-game team color and normalize stored number/string colors', () => {
    assert.equal(resolveHangarPreviewColor({}), PLAYER_1_COLOR);
    assert.equal(resolveHangarPreviewColor({ localSettings: { playerColorP1: TEAM_COLORS[TEAM_IDS.ALPHA] } }), PLAYER_1_COLOR);
    assert.equal(resolveHangarPreviewColor({ localSettings: { playerColorP1: 0x123abc } }), '#123abc');
    assert.equal(resolveHangarPreviewColor({ localSettings: { playerColorP1: '#ABCDEF' } }), '#abcdef');
    assert.equal(resolveHangarPreviewColor({ localSettings: { playerColorP1: '0x123abc' } }), '#123abc');
    assert.equal(resolveHangarPreviewColor({ localSettings: { playerColorP1: 'invalid' } }), PLAYER_1_COLOR);
});

test('start-setup P1 uses the same color while P2 and P3 keep their preview colors', () => {
    const settings = { localSettings: { playerColorP1: 0x123abc } };
    assert.equal(resolveStartSetupPlayerColor({}, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1), PLAYER_1_COLOR);
    assert.equal(resolveStartSetupPlayerColor(settings, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1), '#123abc');
    assert.equal(resolveStartSetupPlayerColor(settings, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2), '#ff9f5a');
    assert.equal(resolveStartSetupPlayerColor(settings, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_3), '#7dff6a');
});
