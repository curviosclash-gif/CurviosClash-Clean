import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    configureStoragePaths,
    resolveAppDataRoot,
    USER_DATA_ROOT_ENV_KEY,
} = require('../electron/session-data-runtime.cjs');

function createFakeApp(appDataPath) {
    const paths = {};
    return {
        paths,
        getPath(pathName) {
            if (pathName === 'appData') return appDataPath;
            return paths[pathName] || '';
        },
        setPath(pathName, value) {
            paths[pathName] = value;
        },
    };
}

function withTempRoots(run) {
    const appDataPath = mkdtempSync(path.join(tmpdir(), 'curvios-appdata-'));
    const overrideRoot = mkdtempSync(path.join(tmpdir(), 'curvios-userdata-'));
    try {
        run({ appDataPath, overrideRoot });
    } finally {
        rmSync(appDataPath, { recursive: true, force: true, maxRetries: 2 });
        rmSync(overrideRoot, { recursive: true, force: true, maxRetries: 2 });
    }
}

test('user data root env key stays the documented name', () => {
    assert.equal(USER_DATA_ROOT_ENV_KEY, 'CURVIOS_USER_DATA_ROOT');
});

test('resolveAppDataRoot falls back to the Electron appData path', () => {
    const app = createFakeApp(path.join(tmpdir(), 'curvios-appdata-fallback'));
    assert.equal(resolveAppDataRoot(app, {}), app.getPath('appData'));
    assert.equal(resolveAppDataRoot(app, { [USER_DATA_ROOT_ENV_KEY]: '   ' }), app.getPath('appData'));
});

test('resolveAppDataRoot only accepts an absolute override root', () => {
    const app = createFakeApp(path.join(tmpdir(), 'curvios-appdata-absolute'));
    const absoluteRoot = path.join(tmpdir(), 'curvios-userdata-absolute');
    assert.equal(resolveAppDataRoot(app, { [USER_DATA_ROOT_ENV_KEY]: absoluteRoot }), absoluteRoot);
    assert.equal(
        resolveAppDataRoot(app, { [USER_DATA_ROOT_ENV_KEY]: path.join('tmp', 'playwright') }),
        app.getPath('appData')
    );
});

test('configureStoragePaths keeps the appData layout without an override root', () => {
    withTempRoots(({ appDataPath }) => {
        const app = createFakeApp(appDataPath);
        const configured = configureStoragePaths({
            app,
            sharedUserDataDirName: 'curviosclash-app',
            sessionDataDirName: 'session-main',
        });

        assert.equal(configured.sharedUserDataPath, path.join(appDataPath, 'curviosclash-app'));
        assert.equal(configured.userDataPath, configured.sharedUserDataPath);
        assert.equal(configured.sessionDataPath, path.join(appDataPath, 'curviosclash-app', 'session-main'));
        assert.equal(app.paths.userData, configured.userDataPath);
        assert.equal(app.paths.sessionData, configured.sessionDataPath);
        assert.ok(existsSync(configured.sessionDataPath));
    });
});

test('configureStoragePaths moves every storage path under the override root', () => {
    withTempRoots(({ appDataPath, overrideRoot }) => {
        const app = createFakeApp(appDataPath);
        const previous = process.env[USER_DATA_ROOT_ENV_KEY];
        process.env[USER_DATA_ROOT_ENV_KEY] = overrideRoot;
        try {
            const configured = configureStoragePaths({
                app,
                sharedUserDataDirName: 'curviosclash-app',
                userDataDirName: 'profile-settings-studio',
                sessionDataDirName: 'session-settings-studio',
            });

            assert.equal(configured.sharedUserDataPath, path.join(overrideRoot, 'curviosclash-app'));
            assert.equal(
                configured.userDataPath,
                path.join(overrideRoot, 'curviosclash-app', 'profile-settings-studio')
            );
            assert.equal(
                configured.sessionDataPath,
                path.join(overrideRoot, 'curviosclash-app', 'session-settings-studio')
            );
            assert.equal(app.paths.userData, configured.userDataPath);
            assert.ok(existsSync(configured.userDataPath));
            assert.ok(!existsSync(path.join(appDataPath, 'curviosclash-app')));
        } finally {
            if (previous === undefined) {
                delete process.env[USER_DATA_ROOT_ENV_KEY];
            } else {
                process.env[USER_DATA_ROOT_ENV_KEY] = previous;
            }
        }
    });
});

test('configureStoragePaths accepts an injected appData path for tests', () => {
    withTempRoots(({ appDataPath, overrideRoot }) => {
        const app = createFakeApp(appDataPath);
        const configured = configureStoragePaths({
            app,
            sharedUserDataDirName: 'curviosclash-app',
            sessionDataDirName: 'session-main',
            appDataPath: overrideRoot,
        });

        assert.equal(configured.sharedUserDataPath, path.join(overrideRoot, 'curviosclash-app'));
        assert.ok(!existsSync(path.join(appDataPath, 'curviosclash-app')));
    });
});

test('electron main processes resolve the shared data root through the override', () => {
    for (const relativePath of ['../electron/main.cjs', '../electron/settings-studio/main.cjs']) {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
        assert.ok(
            source.includes('resolveAppDataRoot'),
            `${relativePath} must resolve the shared data root through resolveAppDataRoot`
        );
        assert.ok(
            !/getPath\('appData'\)/.test(source),
            `${relativePath} must not read app.getPath('appData') directly`
        );
    }
});

test('the desktop harness pins the Electron profile to a per-run directory', () => {
    const source = readFileSync(new URL('./helpers.desktop.js', import.meta.url), 'utf8');
    assert.ok(source.includes('CURVIOS_USER_DATA_ROOT'), 'helpers.desktop.js must set CURVIOS_USER_DATA_ROOT');
    assert.ok(source.includes('PW_FRESH_PROFILE'), 'helpers.desktop.js must support PW_FRESH_PROFILE');
    assert.ok(
        source.includes("'tmp', 'playwright'") || source.includes('tmp/playwright'),
        'helpers.desktop.js must place the profile under tmp/playwright'
    );
});

test('the cluster runner only removes profile roots below tmp/playwright', async () => {
    const {
        resolveClusterUserDataRoot,
        resolveRemovableUserDataRoot,
    } = await import('../scripts/playwright-user-data-root.mjs');
    const repoRoot = path.resolve('.');

    assert.equal(
        resolveClusterUserDataRoot(repoRoot, 'desktop-e2e-clusters-editor'),
        path.join(repoRoot, 'tmp', 'playwright', 'desktop-e2e-clusters-editor', 'user-data')
    );
    assert.equal(
        resolveClusterUserDataRoot(repoRoot, ''),
        path.join(repoRoot, 'tmp', 'playwright', 'local', 'user-data')
    );

    assert.equal(
        resolveRemovableUserDataRoot(path.join(repoRoot, 'tmp', 'playwright', 'run-a', 'user-data'), repoRoot),
        path.join(repoRoot, 'tmp', 'playwright', 'run-a', 'user-data')
    );
    assert.equal(resolveRemovableUserDataRoot(path.join(repoRoot, 'tmp', 'playwright'), repoRoot), null);
    assert.equal(resolveRemovableUserDataRoot(path.join(repoRoot, 'src'), repoRoot), null);
    assert.equal(resolveRemovableUserDataRoot(path.join(tmpdir(), 'user-data'), repoRoot), null);
    assert.equal(resolveRemovableUserDataRoot('', repoRoot), null);
    assert.equal(
        resolveRemovableUserDataRoot(path.join(repoRoot, 'tmp', 'playwright', '..', 'other'), repoRoot),
        null
    );
});
