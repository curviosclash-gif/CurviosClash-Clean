'use strict';

const UNTRUSTED_IPC_SENDER_CODE = 'ERR_CURVIOS_UNTRUSTED_IPC_SENDER';

function isTrustedWindowSender(event, windowRef) {
    if (!event || !windowRef || windowRef.isDestroyed?.()) {
        return false;
    }
    const webContents = windowRef.webContents;
    return Boolean(
        webContents
        && event.sender === webContents
        && event.senderFrame === webContents.mainFrame
    );
}

function assertTrustedWindowSender(event, windowRef) {
    if (isTrustedWindowSender(event, windowRef)) {
        return;
    }
    const error = new Error('Desktop capability request came from an unknown renderer.');
    error.code = UNTRUSTED_IPC_SENDER_CODE;
    throw error;
}

module.exports = {
    UNTRUSTED_IPC_SENDER_CODE,
    assertTrustedWindowSender,
    isTrustedWindowSender,
};
