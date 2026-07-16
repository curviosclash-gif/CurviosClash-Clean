function createSecureWindowWebPreferences({
    preload,
    sandbox = true,
    backgroundThrottling = false,
} = {}) {
    return Object.freeze({
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: sandbox === true,
        backgroundThrottling: backgroundThrottling === true,
    });
}

module.exports = { createSecureWindowWebPreferences };
