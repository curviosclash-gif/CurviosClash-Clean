import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadJsonFile } from '../editor/js/ui/EditorSessionControls.js';

for (const state of ['completed', 'cancelled', 'interrupted', 'browser']) {
    test(`project download preserves completion semantics: ${state}`, async () => {
        const previousWindow = globalThis.window;
        const previousDocument = globalThis.document;
        let listener;
        let unsubscribed = false;
        globalThis.window = {
            setTimeout, clearTimeout,
            __CURVIOS_EDITOR_DISK__: state === 'browser' ? undefined : {
                onDownloadCompleted(callback) { listener = callback; return () => { unsubscribed = true; }; },
            },
        };
        globalThis.document = {
            createElement() {
                return { click() {
                    listener?.({ url: 'blob:another-export', state: 'completed' });
                    queueMicrotask(() => listener?.({ url: this.href, state }));
                } };
            },
        };
        try {
            const promise = downloadJsonFile('{}', 'draft.json');
            if (state === 'browser') assert.equal(await promise, null);
            else if (state === 'completed') assert.equal((await promise).state, state);
            else await assert.rejects(promise, /abgebrochen/);
            assert.equal(unsubscribed, state !== 'browser');
        } finally {
            if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
            if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
        }
    });
}
