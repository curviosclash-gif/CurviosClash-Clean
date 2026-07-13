const path = require('node:path');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');

const CHROMIUM_CACHE_DIRS = Object.freeze(['Cache', 'Code Cache', 'GPUCache']);
const SESSION_HEALTH_FILE_NAME = 'session-health.json';
const SESSION_HEALTH_SCHEMA_VERSION = 1;

function safeReadJson(filePath) {
    try {
        const raw = readFileSync(filePath, 'utf-8');
        if (!raw || !raw.trim()) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function safeWriteJson(filePath, payload) {
    try {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
        return true;
    } catch {
        return false;
    }
}

function safeClearChromiumCaches(sessionDataPath) {
    const cleared = [];
    for (const dirName of CHROMIUM_CACHE_DIRS) {
        const dirPath = path.join(sessionDataPath, dirName);
        try {
            rmSync(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 40 });
            cleared.push(dirName);
        } catch {
            // Keep startup resilient; cache regeneration is best effort.
        }
    }
    return cleared;
}

function configureStoragePaths({ app, sharedUserDataDirName, sessionDataDirName }) {
    const sharedUserDataPath = path.join(app.getPath('appData'), sharedUserDataDirName);
    const sessionDataPath = path.join(sharedUserDataPath, sessionDataDirName);
    app.setPath('userData', sharedUserDataPath);
    app.setPath('sessionData', sessionDataPath);
    return { sharedUserDataPath, sessionDataPath };
}

function initSessionDataSelfHeal({ sessionDataPath, processLabel }) {
    const healthFilePath = path.join(sessionDataPath, SESSION_HEALTH_FILE_NAME);
    const previousHealth = safeReadJson(healthFilePath);
    const shouldHeal = previousHealth?.lastExitClean === false;
    const clearedCacheDirs = shouldHeal ? safeClearChromiumCaches(sessionDataPath) : [];
    const startedAt = Date.now();
    const baseState = {
        schemaVersion: SESSION_HEALTH_SCHEMA_VERSION,
        processLabel: String(processLabel || 'unknown'),
    };

    safeWriteJson(healthFilePath, {
        ...baseState,
        lastStartAt: startedAt,
        lastExitClean: false,
        lastHealAt: shouldHeal ? startedAt : (previousHealth?.lastHealAt || null),
        lastHealedCacheDirs: clearedCacheDirs,
    });

    let closed = false;
    const markCleanExit = () => {
        if (closed) {
            return;
        }
        closed = true;
        safeWriteJson(healthFilePath, {
            ...baseState,
            lastStartAt: startedAt,
            lastExitAt: Date.now(),
            lastExitClean: true,
            lastHealAt: shouldHeal ? startedAt : (previousHealth?.lastHealAt || null),
            lastHealedCacheDirs: clearedCacheDirs,
        });
    };

    return {
        healed: shouldHeal,
        clearedCacheDirs,
        markCleanExit,
    };
}

module.exports = {
    configureStoragePaths,
    initSessionDataSelfHeal,
};
