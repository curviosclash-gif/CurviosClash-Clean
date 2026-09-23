import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// prototypes/vehicle-lab/main.js cannot be imported from Node: it constructs the whole
// workshop (DOM, WebGL canvas, localStorage) at module scope. The wiring between an
// immediate save and the pending auto-save timer is therefore asserted on the source.
const VEHICLE_LAB_SOURCE = readFileSync(
    new URL('../prototypes/vehicle-lab/main.js', import.meta.url),
    'utf8'
);

function readMethodBody(source, methodName) {
    const signatureIndex = source.indexOf(`\n    ${methodName}(`);
    assert.notEqual(signatureIndex, -1, `main.js must define ${methodName}()`);
    const bodyStart = source.indexOf('{', signatureIndex);
    assert.notEqual(bodyStart, -1, `${methodName}() must have a body`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const character = source[index];
        if (character === '{') depth += 1;
        if (character === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(bodyStart, index + 1);
        }
    }
    throw new Error(`${methodName}() body is not balanced`);
}

test('the debounced auto-save keeps its timer handle on the app', () => {
    const body = readMethodBody(VEHICLE_LAB_SOURCE, 'debouncedSave');

    assert.match(
        body,
        /this\._saveTimeout = setTimeout\(/,
        'debouncedSave must store the pending timer in this._saveTimeout'
    );
});

test('an immediate save cancels the pending auto-save before it reports its status', () => {
    const body = readMethodBody(VEHICLE_LAB_SOURCE, 'persistCurrentConfig');
    const cancelIndex = body.indexOf('clearTimeout(this._saveTimeout)');
    const resetIndex = body.indexOf('this._saveTimeout = null');
    const statusIndex = body.indexOf('this.setStatus(');

    assert.notEqual(
        cancelIndex,
        -1,
        'persistCurrentConfig must clear the pending auto-save timer, otherwise it overwrites '
        + 'the status message of the action that triggered the save'
    );
    assert.notEqual(resetIndex, -1, 'persistCurrentConfig must forget the cleared timer handle');
    assert.notEqual(statusIndex, -1, 'persistCurrentConfig must report a status message');
    assert.ok(
        cancelIndex < statusIndex && resetIndex < statusIndex,
        'the pending auto-save must be cancelled before the status message is set'
    );
});

test('the handlers that save at once refresh the blueprint status themselves', () => {
    // The cancelled timer used to refresh the blueprint status 180 ms later. The handlers
    // that persist immediately now do it explicitly, like deletePart always did, so the
    // status bar does not depend on whether a timer happened to be pending.
    for (const methodName of ['duplicatePart', 'toggleMirrorPart', 'deletePart']) {
        const body = readMethodBody(VEHICLE_LAB_SOURCE, methodName);
        const refreshIndex = body.indexOf('this.updateArcadeBlueprintStatus()');
        const persistIndex = body.indexOf('this.persistCurrentConfig(');
        assert.notEqual(refreshIndex, -1, `${methodName} must refresh the arcade blueprint status`);
        assert.ok(
            refreshIndex < persistIndex,
            `${methodName} must refresh the blueprint status before it persists`
        );
    }
});

test('flushing the pending save still only runs while a save is pending', () => {
    const body = readMethodBody(VEHICLE_LAB_SOURCE, 'flushPendingSave');

    assert.match(
        body,
        /if \(!this\._saveTimeout\) return;/,
        'flushPendingSave must stay a no-op without a pending auto-save'
    );
    assert.match(
        body,
        /clearTimeout\(this\._saveTimeout\)/,
        'flushPendingSave clears the timer itself, so the flush paths keep their previous behaviour'
    );
});

test('history replaces the editor mesh when a configuration changes vehicle class', () => {
    for (const methodName of ['undo', 'redo']) {
        const body = readMethodBody(VEHICLE_LAB_SOURCE, methodName);
        assert.match(body, /this\.applyHistoryVehicleConfig\(config\)/);
        assert.equal(body.includes('this.vehicle.updateConfig(config)'), false);
    }
    const applyBody = readMethodBody(VEHICLE_LAB_SOURCE, 'applyHistoryVehicleConfig');
    assert.match(applyBody, /this\.replaceVehicle\(this\.createEditorVehicleMesh\(cloned\)\)/);
    assert.match(applyBody, /this\.activeReferenceVehicle = cloned\.baseVehicleId/);
});

test('gizmo persistence removes transient animation offsets', () => {
    const body = readMethodBody(VEHICLE_LAB_SOURCE, 'syncGizmoToConfig');
    assert.match(body, /vehicleLabAnimationState/);
    assert.match(body, /positionYOffset/);
    assert.match(body, /rotationOffset/);
    assert.match(body, /scaleFactor/);
});
