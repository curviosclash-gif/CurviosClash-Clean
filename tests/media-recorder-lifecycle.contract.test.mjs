import assert from 'node:assert/strict';
import test from 'node:test';

import { LIFECYCLE_EVENT_TYPES, MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';

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

