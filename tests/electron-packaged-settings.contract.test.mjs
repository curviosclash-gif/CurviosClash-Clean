import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    SETTINGS_STUDIO_FLAG,
    isElectronRuntime,
    resolveDesktopMainEntry,
} = require('../electron/entry.cjs');
const { configureStoragePaths } = require('../electron/session-data-runtime.cjs');

test('packaged Electron entry routes the explicit Settings Studio switch', () => {
    assert.equal(SETTINGS_STUDIO_FLAG, '--settings-studio');
    assert.equal(resolveDesktopMainEntry(['CurviosClash.exe']), './main.cjs');
    assert.equal(
        resolveDesktopMainEntry(['CurviosClash.exe', '--settings-studio']),
        './settings-studio/main.cjs'
    );
});

test('packaged Electron entry auto-starts only inside Electron', () => {
    assert.equal(isElectronRuntime({ versions: { electron: '43.1.0' } }), true);
    assert.equal(isElectronRuntime({ versions: { node: process.versions.node } }), false);
});

test('main game and Settings Studio use independent lock/profile and session paths', (t) => {
    const appDataPath = mkdtempSync(path.join(os.tmpdir(), 'curvios-electron-paths-'));
    t.after(() => rmSync(appDataPath, { recursive: true, force: true }));
    const createFakeApp = () => {
        const paths = { appData: appDataPath };
        return {
            getPath(name) {
                return paths[name];
            },
            setPath(name, value) {
                paths[name] = value;
            },
            paths,
        };
    };

    const gameApp = createFakeApp();
    const gamePaths = configureStoragePaths({
        app: gameApp,
        sharedUserDataDirName: 'curviosclash-app',
        sessionDataDirName: 'session-main',
    });
    assert.equal(gamePaths.userDataPath, gamePaths.sharedUserDataPath);
    assert.equal(gameApp.paths.userData, gamePaths.sharedUserDataPath);
    assert.equal(gameApp.paths.sessionData, gamePaths.sessionDataPath);

    const studioApp = createFakeApp();
    const studioPaths = configureStoragePaths({
        app: studioApp,
        sharedUserDataDirName: 'curviosclash-app',
        userDataDirName: 'profile-settings-studio',
        sessionDataDirName: 'session-settings-studio',
    });
    assert.equal(studioPaths.sharedUserDataPath, gamePaths.sharedUserDataPath);
    assert.notEqual(studioPaths.userDataPath, studioPaths.sharedUserDataPath);
    assert.notEqual(studioPaths.userDataPath, gamePaths.userDataPath);
    assert.notEqual(studioPaths.sessionDataPath, gamePaths.sessionDataPath);
});

test('storage paths are created before Electron receives a fresh isolated profile', (t) => {
    const appDataPath = mkdtempSync(path.join(os.tmpdir(), 'curvios-electron-profile-'));
    t.after(() => rmSync(appDataPath, { recursive: true, force: true }));
    const paths = { appData: appDataPath };
    const app = {
        getPath(name) {
            return paths[name];
        },
        setPath(name, value) {
            assert.equal(existsSync(value), true, `${name} must exist before app.setPath`);
            paths[name] = value;
        },
    };

    const configured = configureStoragePaths({
        app,
        sharedUserDataDirName: 'curviosclash-app',
        userDataDirName: 'profile-settings-studio',
        sessionDataDirName: 'session-settings-studio',
    });

    assert.equal(existsSync(configured.sharedUserDataPath), true);
    assert.equal(existsSync(configured.userDataPath), true);
    assert.equal(existsSync(configured.sessionDataPath), true);
});

test('both Electron entries configure their lock namespace before requesting the lock', () => {
    for (const relativePath of ['../electron/main.cjs', '../electron/settings-studio/main.cjs']) {
        const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
        assert.ok(
            source.indexOf('configureStoragePaths({') < source.indexOf('requestSingleInstanceLock()'),
            `${relativePath} must configure userData before requesting the single-instance lock`
        );
    }

    const studioSource = readFileSync(
        new URL('../electron/settings-studio/main.cjs', import.meta.url),
        'utf8'
    );
    assert.match(studioSource, /userDataDirName:\s*SETTINGS_STUDIO_USER_DATA_DIR_NAME/);
    assert.match(studioSource, /app:\s*settingsDataApp/);
});

test('Windows package uses the original project icon and keeps env-only signing', () => {
    const packageJson = JSON.parse(readFileSync(
        new URL('../electron/package.json', import.meta.url),
        'utf8'
    ));
    assert.equal(packageJson.main, 'entry.cjs');
    assert.equal(packageJson.author, 'CurviosClash Project');
    assert.equal(packageJson.build?.win?.icon, '../assets/branding/curviosclash-icon.ico');
    assert.equal(packageJson.build?.win?.signAndEditExecutable, true);
    assert.equal(Object.hasOwn(packageJson.build?.win || {}, 'certificateFile'), false);
    assert.equal(Object.hasOwn(packageJson.build?.win || {}, 'certificatePassword'), false);

    const ico = readFileSync(new URL('../assets/branding/curviosclash-icon.ico', import.meta.url));
    assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
    assert.equal(ico.readUInt16LE(4), 7);

    const provenance = readFileSync(
        new URL('../assets/branding/README.md', import.meta.url),
        'utf8'
    );
    assert.match(provenance, /no external image, font, logo, model/i);
    assert.match(provenance, /Next-repository asset was\s+used/i);
});

test('Windows start paths forward CLI switches to packaged and development entries', () => {
    const startScript = readFileSync(new URL('../START_CURVIOSCLASH.cmd', import.meta.url), 'utf8');
    const developmentScript = readFileSync(new URL('../start_development.bat', import.meta.url), 'utf8');
    const launcher = readFileSync(new URL('../electron/launch.cjs', import.meta.url), 'utf8');
    assert.match(startScript, /"%PACKAGE_EXE%" %\*/);
    assert.match(developmentScript, /npm --prefix electron run start -- %\*/);
    assert.match(launcher, /process\.argv\.slice\(2\)/);
});
