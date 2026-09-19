import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RECORDING_HUD_MODE } from '../src/shared/contracts/RecordingCaptureContract.js';
import { resolveRecordingHudLabel } from '../src/ui/menu/MenuRecordingCameraBindingOps.js';

const bindingSource = process.env.CURVIOS_RECORDING_BINDING_SOURCE
    || readFileSync(new URL('../src/ui/menu/MenuRecordingCameraBindingOps.js', import.meta.url), 'utf8');
const managerSource = process.env.CURVIOS_RECORDING_MANAGER_SOURCE
    || readFileSync(new URL('../src/ui/UIManager.js', import.meta.url), 'utf8');

test('recording HUD labels describe whether the HUD is visible', () => {
    assert.equal(resolveRecordingHudLabel(RECORDING_HUD_MODE.WITH_HUD), 'mit HUD');
    assert.equal(resolveRecordingHudLabel(RECORDING_HUD_MODE.CLEAN), 'ohne HUD');
    assert.match(bindingSource, /:\s*'ohne HUD'/);
    assert.match(
        managerSource,
        /hudMode === RECORDING_HUD_MODE\.WITH_HUD\s*\?\s*'mit HUD'\s*:\s*'ohne HUD'/
    );
    assert.match(managerSource, /Aufnahmeprofil: \$\{profileLabel\} - \$\{hudLabel\}/);
    assert.doesNotMatch(managerSource, /Aufnahmeprofil: \$\{profileLabel\} - HUD: \$\{hudLabel\}/);
});
