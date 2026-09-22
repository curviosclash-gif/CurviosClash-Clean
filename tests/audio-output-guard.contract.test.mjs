import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createAudioOutputGuard,
    isControllerAudioOutput,
    pinSafeAudioOutput,
    selectSafeAudioOutput,
} from '../src/core/audio/AudioOutputGuard.js';

const output = (deviceId, label) => ({ kind: 'audiooutput', deviceId, label });

test('selectSafeAudioOutput resolves the physical device behind the current Windows default', () => {
    const devices = [
        output('default', 'Default - Speakers (Realtek Audio)'),
        output('controller', 'Speakers (Wireless Controller)'),
        output('realtek', 'Speakers (Realtek Audio)'),
    ];

    assert.equal(selectSafeAudioOutput(devices)?.deviceId, 'realtek');
});

test('selectSafeAudioOutput never selects Sony controller speakers', () => {
    const devices = [
        output('default', 'Default - Speakers (Wireless Controller)'),
        output('controller', 'Speakers (Wireless Controller)'),
        output('headset', 'Headphones (USB Audio)'),
    ];

    assert.equal(isControllerAudioOutput(devices[1]), true);
    assert.equal(selectSafeAudioOutput(devices)?.deviceId, 'headset');
});

test('pinSafeAudioOutput leaves routing untouched when no named safe output is available', async () => {
    const sinkCalls = [];
    const context = { setSinkId: async (deviceId) => sinkCalls.push(deviceId) };
    const mediaDevices = {
        enumerateDevices: async () => [
            output('default', ''),
            output('controller', 'DualSense Wireless Controller'),
        ],
    };

    assert.equal(await pinSafeAudioOutput(context, mediaDevices), null);
    assert.deepEqual(sinkCalls, []);
});

test('audio output guard restores the pinned speaker after a controller device change', async () => {
    const sinkCalls = [];
    let deviceChange = null;
    const context = { setSinkId: async (deviceId) => sinkCalls.push(deviceId) };
    const mediaDevices = {
        enumerateDevices: async () => [
            output('default', 'Default - Speakers (Realtek Audio)'),
            output('realtek', 'Speakers (Realtek Audio)'),
        ],
        addEventListener(type, listener) { if (type === 'devicechange') deviceChange = listener; },
        removeEventListener(type, listener) {
            if (type === 'devicechange' && deviceChange === listener) deviceChange = null;
        },
    };
    const guard = createAudioOutputGuard(mediaDevices);

    assert.equal(await guard.pin(context), 'realtek');
    deviceChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(sinkCalls, ['realtek', 'realtek']);

    guard.dispose();
    assert.equal(deviceChange, null);
});
