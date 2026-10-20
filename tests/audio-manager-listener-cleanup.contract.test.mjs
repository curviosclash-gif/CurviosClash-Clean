import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioManager } from '../src/core/Audio.js';

class CaptureAwareWindow {
    constructor() {
        this.listeners = [];
    }

    addEventListener(type, listener, options = false) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        if (this.listeners.some((entry) => entry.type === type
            && entry.listener === listener && entry.capture === capture)) return;
        this.listeners.push({ type, listener, capture });
    }

    removeEventListener(type, listener, options = false) {
        const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
        this.listeners = this.listeners.filter((entry) => !(entry.type === type
            && entry.listener === listener && entry.capture === capture));
    }

    dispatchEvent(event) {
        for (const entry of this.listeners
            .filter((candidate) => candidate.type === event.type)
            .sort((left, right) => Number(right.capture) - Number(left.capture))) {
            entry.listener.call(this, event);
        }
        return true;
    }

    count(type, listener, capture) {
        return this.listeners.filter((entry) => entry.type === type
            && entry.listener === listener && entry.capture === capture).length;
    }
}

test('AudioManager removes only its capture listeners and preserves other owners and bubble listeners', () => {
    const originalWindow = globalThis.window;
    const mockWindow = new CaptureAwareWindow();
    globalThis.window = mockWindow;

    let firstCalls = 0;
    let secondCalls = 0;
    const firstHandler = () => { firstCalls += 1; };
    const secondHandler = () => { secondCalls += 1; };
    let firstAudio;
    let secondAudio;

    try {
        firstAudio = new AudioManager();
        secondAudio = new AudioManager();
        const firstInitHandler = firstAudio._onInitInteraction;
        const secondInitHandler = secondAudio._onInitInteraction;

        firstAudio._addWindowListener('audio-cleanup-probe', firstHandler);
        secondAudio._addWindowListener('audio-cleanup-probe', secondHandler);
        mockWindow.addEventListener('audio-cleanup-probe', firstHandler, false);

        assert.equal(mockWindow.count('audio-cleanup-probe', firstHandler, true), 1);
        assert.equal(mockWindow.count('audio-cleanup-probe', firstHandler, false), 1);
        mockWindow.dispatchEvent({ type: 'audio-cleanup-probe' });
        assert.equal(firstCalls, 2, 'the same callback is registered once for each capture phase');
        assert.equal(secondCalls, 1, 'the other manager owns an independent capture listener');

        firstAudio.dispose();
        firstAudio.dispose();

        assert.equal(mockWindow.count('audio-cleanup-probe', firstHandler, true), 0,
            'dispose removes the registered capture listener');
        assert.equal(mockWindow.count('audio-cleanup-probe', firstHandler, false), 1,
            'dispose leaves an unrelated bubble listener with the same callback intact');
        assert.equal(mockWindow.count('audio-cleanup-probe', secondHandler, true), 1,
            'dispose does not remove another AudioManager listener');
        assert.equal(mockWindow.count('pointerdown', firstInitHandler, true), 0,
            'normal init listeners are still removed with their registered capture option');
        assert.equal(mockWindow.count('pointerdown', secondInitHandler, true), 1,
            'the other manager’s init listeners remain owned by that manager');

        mockWindow.dispatchEvent({ type: 'audio-cleanup-probe' });
        assert.equal(firstCalls, 3, 'only the preserved bubble listener fires after dispose');
        assert.equal(secondCalls, 2, 'the second manager listener still fires after the first disposes');
    } finally {
        firstAudio?.dispose();
        secondAudio?.dispose();
        if (typeof originalWindow === 'undefined') delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
