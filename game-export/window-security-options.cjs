const path = require('node:path');

function createSecureWindowWebPreferences(options = {}) {
    const preload = options.preload ? path.resolve(options.preload) : undefined;
    return Object.freeze({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: options.backgroundThrottling !== false,
        ...(preload ? { preload } : {}),
    });
}

module.exports = Object.freeze({ createSecureWindowWebPreferences });
