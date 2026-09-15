const path = require('node:path');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');

const CHROMIUM_CACHE_DIRS = Object.freeze(['Cache', 'Code Cache', 'GPUCache']);
// Testlaeufe duerfen nicht in das echte Spielerprofil unter %APPDATA% schreiben. Ein
// absoluter Pfad in dieser Variable verschiebt die komplette Profil-, Session- und
// Override-Ablage; ohne sie bleibt das Verhalten der ausgelieferten App unveraendert.
const USER_DATA_ROOT_ENV_KEY = 'CURVIOS_USER_DATA_ROOT';
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

function resolveAppDataRoot(app, env = process.env) {
    const overrideRoot = String(env?.[USER_DATA_ROOT_ENV_KEY] || '').trim();
    if (overrideRoot && path.isAbsolute(overrideRoot)) {
        return overrideRoot;
    }
    return app.getPath('appData');
}

function configureStoragePaths({
    app,
    sharedUserDataDirName,
    sessionDataDirName,
    userDataDirName = '',
    appDataPath = resolveAppDataRoot(app),
}) {
    const sharedUserDataPath = path.join(appDataPath, sharedUserDataDirName);
    const userDataPath = userDataDirName
        ? path.join(sharedUserDataPath, userDataDirName)
        : sharedUserDataPath;
    const sessionDataPath = path.join(sharedUserDataPath, sessionDataDirName);
    for (const storagePath of new Set([sharedUserDataPath, userDataPath, sessionDataPath])) {
        mkdirSync(storagePath, { recursive: true });
    }
    app.setPath('userData', userDataPath);
    app.setPath('sessionData', sessionDataPath);
    return { sharedUserDataPath, userDataPath, sessionDataPath };
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
    USER_DATA_ROOT_ENV_KEY,
    configureStoragePaths,
    initSessionDataSelfHeal,
    resolveAppDataRoot,
};
