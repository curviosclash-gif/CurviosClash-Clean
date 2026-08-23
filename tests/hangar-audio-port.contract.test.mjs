import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createHangarAudioPort } from '../src/composition/core-ui/CoreHangarAudioPort.js';

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('the hangar window reaches audio through the composition port, not through core', () => {
    const app = readSource('../src/ui/hangar/HangarWindowApp.js');

    // Ein direkter Import aus core reisst die Schichtgrenze ui -> core und
    // faerbt den Architektur-Guard fuer jede Aufgabe im Projekt rot.
    assert.equal(app.includes("from '../../core/"), false);
    assert.ok(app.includes("from '../../composition/core-ui/CoreHangarAudioPort.js'"));
});

test('no user interface source imports the audio runtime directly', () => {
    for (const relativePath of [
        '../src/ui/hangar/HangarWindowApp.js',
        '../src/ui/hangar/ArcadeHangarWorkshop.js',
        '../src/ui/hangar/ArcadeHangarWorkshopRenderer.js',
    ]) {
        assert.equal(readSource(relativePath).includes('core/Audio.js'), false, relativePath);
    }
});

/**
 * Die Klang-Runtime haengt sich an das Browserfenster. Fuer den Test genuegt
 * ein schmaler Ersatz, der nur mitschreibt, was angemeldet und wieder
 * abgemeldet wird.
 */
function withWindowStub(run) {
    const listeners = [];
    const original = globalThis.window;
    globalThis.window = {
        addEventListener: (type, listener) => listeners.push({ type, listener }),
        removeEventListener: (type, listener) => {
            const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
            if (index >= 0) listeners.splice(index, 1);
        },
    };
    try {
        return run(listeners);
    } finally {
        if (original === undefined) delete globalThis.window;
        else globalThis.window = original;
    }
}

test('the port hands back a ready-to-use audio object', () => {
    withWindowStub((listeners) => {
        const audio = createHangarAudioPort({ master: 0.5 });

        assert.equal(typeof audio.setMusicState, 'function');
        assert.equal(typeof audio.play, 'function');
        assert.equal(typeof audio.dispose, 'function');
        assert.ok(listeners.length > 0, 'die Klang-Runtime wartet auf die erste Eingabe');

        audio.dispose();
        assert.deepEqual(listeners, [], 'dispose meldet alle Zuhoerer wieder ab');
    });
});

test('the port survives a profile without any audio settings', () => {
    withWindowStub(() => {
        const audio = createHangarAudioPort(undefined, { musicState: '' });
        assert.equal(typeof audio.dispose, 'function');
        audio.dispose();
    });
});
