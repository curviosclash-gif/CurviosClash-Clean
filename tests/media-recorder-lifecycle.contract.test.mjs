import assert from 'node:assert/strict';
import test from 'node:test';

import { LIFECYCLE_EVENT_TYPES, MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';
import { attachDirectMediaRecorderStopHandler } from '../src/core/recording/MediaRecorderExportFinalizeOps.js';

test('MediaRecorderSystem lifecycle close events use settleRecording contract path', () => {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        autoRecordingEnabled: false,
        autoDownload: false,
        globalScope: {
            setTimeout,
            clearTimeout,
        },
    });

    const settleCalls = [];
    let stopCalls = 0;
    recorder.settleRecording = async (trigger = null) => {
        settleCalls.push(trigger);
        return {
            ok: false,
            stopped: false,
            reason: 'not_recording',
        };
    };
    recorder.stopRecording = async () => {
        stopCalls += 1;
        return {
            ok: true,
            stopped: true,
            reason: 'stopped',
        };
    };

    recorder.notifyLifecycleEvent(LIFECYCLE_EVENT_TYPES.MATCH_ENDED, { reason: 'contract_test' });
    recorder.notifyLifecycleEvent(LIFECYCLE_EVENT_TYPES.MENU_OPENED, { reason: 'contract_test' });

    assert.equal(stopCalls, 0);
    assert.equal(settleCalls.length, 2);
    assert.equal(settleCalls[0]?.type, LIFECYCLE_EVENT_TYPES.MATCH_ENDED);
    assert.equal(settleCalls[1]?.type, LIFECYCLE_EVENT_TYPES.MENU_OPENED);
    assert.equal(settleCalls[0]?.context?.reason, 'contract_test');
    assert.equal(settleCalls[1]?.context?.reason, 'contract_test');
});

test('MediaRecorderSystem stops its pump as soon as recording stop begins', async () => {
    const recorder = new MediaRecorderSystem({ canvas: null, autoDownload: false, globalScope: {} });
    let pumpStops = 0;
    recorder._isRecording = true;
    recorder._activeRecorderEngine = 'native-mediarecorder';
    recorder._mediaRecorder = { state: 'inactive' };
    recorder._stopMediaRecorderPump = () => { pumpStops += 1; };

    await recorder.stopRecording({ type: 'contract_test' });

    assert.ok(pumpStops >= 1);
    assert.equal(recorder._mediaRecorderPumpTimer, null);
});

test('direct MediaRecorder stop supports the onstop compatibility path', async () => {
    const mediaRecorder = { mimeType: 'video/webm', onstop: null };
    let exportedBlob = null;
    const system = {
        _mediaRecorder: mediaRecorder,
        _mediaRecorderChunks: [new Blob(['frame'], { type: 'video/webm' })],
        _activeMimeType: 'video/webm',
        _finalizeBlobExport: async (blob) => { exportedBlob = blob; },
        logger: null,
    };

    assert.equal(attachDirectMediaRecorderStopHandler(system), true);
    assert.equal(typeof mediaRecorder.onstop, 'function');
    mediaRecorder.onstop();
    await Promise.resolve();

    assert.equal(exportedBlob?.size, 5);
    assert.equal(system._mediaRecorderChunks, null);
});

