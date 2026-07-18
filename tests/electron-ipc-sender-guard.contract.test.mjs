import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    UNTRUSTED_IPC_SENDER_CODE,
    assertTrustedWindowSender,
    isTrustedWindowSender,
} = require('../electron/ipc-sender-guard.cjs');

function createWindowFixture() {
    const mainFrame = { id: 'main-frame' };
    const webContents = { mainFrame };
    const windowRef = {
        webContents,
        isDestroyed: () => false,
    };
    return { mainFrame, webContents, windowRef };
}

test('Electron IPC sender guard accepts only the window main frame', () => {
    const { mainFrame, webContents, windowRef } = createWindowFixture();
    const event = { sender: webContents, senderFrame: mainFrame };

    assert.equal(isTrustedWindowSender(event, windowRef), true);
    assert.doesNotThrow(() => assertTrustedWindowSender(event, windowRef));
});

test('Electron IPC sender guard rejects other windows, subframes and destroyed windows', () => {
    const { mainFrame, webContents, windowRef } = createWindowFixture();
    const rejectedEvents = [
        { sender: {}, senderFrame: mainFrame },
        { sender: webContents, senderFrame: { id: 'subframe' } },
        null,
    ];

    for (const event of rejectedEvents) {
        assert.equal(isTrustedWindowSender(event, windowRef), false);
        assert.throws(
            () => assertTrustedWindowSender(event, windowRef),
            (error) => error?.code === UNTRUSTED_IPC_SENDER_CODE
        );
    }

    assert.equal(isTrustedWindowSender(
        { sender: webContents, senderFrame: mainFrame },
        { ...windowRef, isDestroyed: () => true }
    ), false);
});

test('Electron main window runs its preload in the Chromium sandbox', () => {
    const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.doesNotMatch(mainSource, /sandbox:\s*false/);
    assert.match(mainSource, /createSecureWindowWebPreferences\(\{[\s\S]*preload:/);
});

test('Windows packaging keeps executable metadata editing and environment signing available', () => {
    const packageJson = JSON.parse(readFileSync(
        new URL('../electron/package.json', import.meta.url),
        'utf8'
    ));

    assert.equal(packageJson.build?.win?.signAndEditExecutable, true);
    assert.equal(Object.hasOwn(packageJson.build?.win || {}, 'certificateFile'), false);
    assert.equal(Object.hasOwn(packageJson.build?.win || {}, 'certificatePassword'), false);
});
