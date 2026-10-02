import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import {
    createElectronRuntimeSetupPlan,
    isMainModule,
    isNonEmptyFile,
    runElectronRuntimeSetup,
} from '../scripts/install-electron-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runtimePaths(platform) {
    const electronBinary = platform === 'win32'
        ? 'electron.exe'
        : platform === 'darwin'
            ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
            : 'electron';
    const ffmpegBinary = `ffmpeg${platform === 'win32' ? '.exe' : ''}`;
    return [
        path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist', electronBinary),
        path.join(ROOT, 'electron', 'node_modules', 'ffmpeg-static', ffmpegBinary),
    ];
}

test('app setup explicitly bootstraps both runtimes after the locked Electron install', () => {
    const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(
        packageJson.scripts['app:setup'],
        'npm --prefix electron ci && node scripts/install-electron-runtime.mjs'
    );

    const plan = createElectronRuntimeSetupPlan({
        root: ROOT,
        platform: 'win32',
        fileIsUsable: () => false,
    });
    assert.deepEqual(plan.commands.map((step) => step.command), [process.execPath, 'icacls', process.execPath]);
    assert.deepEqual(plan.commands.map((step) => step.args[0]), [
        path.join(ROOT, 'electron', 'node_modules', 'electron', 'install.js'),
        path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist'),
        path.join(ROOT, 'electron', 'node_modules', 'ffmpeg-static', 'install.js'),
    ]);
    assert.deepEqual(plan.requiredPaths, runtimePaths('win32'));
});

test('runtime setup resolves Electron and FFmpeg binaries for each supported CI platform', () => {
    const windows = createElectronRuntimeSetupPlan({ root: ROOT, platform: 'win32', fileIsUsable: () => false });
    const linux = createElectronRuntimeSetupPlan({ root: ROOT, platform: 'linux', fileIsUsable: () => false });
    const macos = createElectronRuntimeSetupPlan({ root: ROOT, platform: 'darwin', fileIsUsable: () => false });

    assert.deepEqual(windows.commands[0], linux.commands[0]);
    assert.deepEqual(windows.commands[2], linux.commands[1]);
    assert.equal(windows.commands[1].label, 'Electron runtime integrity level');
    assert.deepEqual(linux.commands, macos.commands);
    assert.equal(windows.commands[1].command, 'icacls');
    assert.deepEqual(windows.requiredPaths, runtimePaths('win32'));
    assert.deepEqual(linux.requiredPaths, runtimePaths('linux'));
    assert.deepEqual(macos.requiredPaths, runtimePaths('darwin'));
});

test('runtime setup skips present downloads and keeps the Windows integrity step', () => {
    const windows = createElectronRuntimeSetupPlan({ root: ROOT, platform: 'win32', fileIsUsable: () => true });
    const linux = createElectronRuntimeSetupPlan({ root: ROOT, platform: 'linux', fileIsUsable: () => true });

    assert.equal(windows.commands.length, 1);
    assert.equal(windows.commands[0].label, 'Electron runtime integrity level');
    assert.deepEqual(linux.commands, []);
});

test('runtime setup stops on an installer failure and preserves its exit code', () => {
    const calls = [];
    const result = runElectronRuntimeSetup({
        root: ROOT,
        platform: 'linux',
        fileIsUsable: () => false,
        runCommand(command, args) {
            calls.push({ command, args });
            return { status: 23, error: null };
        },
        log() {},
    });

    assert.equal(result.code, 23);
    assert.match(result.error, /Electron runtime failed/);
    assert.equal(calls.length, 1);
});

test('runtime setup reports missing binaries after successful installer commands', () => {
    const result = runElectronRuntimeSetup({
        root: ROOT,
        platform: 'linux',
        fileIsUsable: () => false,
        runCommand: () => ({ status: 0, error: null }),
        log() {},
    });

    assert.equal(result.code, 1);
    assert.match(result.error, /node_modules[\\/]electron[\\/]dist[\\/]electron/);
    assert.match(result.error, /node_modules[\\/]ffmpeg-static[\\/]ffmpeg/);
});

test('runtime setup runs the Electron ACL command and validates both binaries', () => {
    const installed = new Set();
    const [electronExecutable, ffmpegExecutable] = runtimePaths('win32');
    const calls = [];
    const result = runElectronRuntimeSetup({
        root: ROOT,
        platform: 'win32',
        fileIsUsable: (filePath) => installed.has(filePath),
        runCommand(command, args) {
            calls.push({ command, args });
            if (args[0]?.endsWith(path.join('electron', 'install.js'))) installed.add(electronExecutable);
            if (args[0]?.endsWith(path.join('ffmpeg-static', 'install.js'))) installed.add(ffmpegExecutable);
            return { status: 0, error: null };
        },
        log() {},
    });

    assert.deepEqual(calls.map(({ command }) => command), [process.execPath, 'icacls', process.execPath]);
    assert.equal(result.code, 0);
    assert.equal(result.error, null);
});

test('runtime files must be non-empty regular files', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'curvios-runtime-fixture-'));
    try {
        const nonEmpty = path.join(fixtureRoot, 'present-runtime');
        const empty = path.join(fixtureRoot, 'empty-runtime');
        const directory = path.join(fixtureRoot, 'runtime-directory');
        writeFileSync(nonEmpty, 'fixture binary');
        writeFileSync(empty, '');
        mkdirSync(directory);

        assert.equal(isNonEmptyFile(nonEmpty), true);
        assert.equal(isNonEmptyFile(empty), false);
        assert.equal(isNonEmptyFile(directory), false);
        assert.equal(isNonEmptyFile(path.join(fixtureRoot, 'missing')), false);
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});

test('the setup CLI entry check resolves an alias directory to the real module path', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'curvios-runtime-cli-alias-'));
    try {
        const actualDirectory = path.join(fixtureRoot, 'actual');
        const aliasDirectory = path.join(fixtureRoot, 'alias');
        const actualEntry = path.join(actualDirectory, 'entry.mjs');
        const aliasEntry = path.join(aliasDirectory, 'entry.mjs');
        mkdirSync(actualDirectory);
        writeFileSync(actualEntry, [
            `import { isMainModule } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts', 'install-electron-runtime.mjs')).href)};`,
            "process.stdout.write(isMainModule(process.argv[1], import.meta.url) ? 'main' : 'not-main');",
        ].join('\n'));
        symlinkSync(actualDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');

        const result = spawnSync(process.execPath, [aliasEntry], {
            cwd: fixtureRoot,
            encoding: 'utf8',
            windowsHide: true,
        });

        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, 'main');
        assert.equal(isMainModule(undefined, pathToFileURL(actualEntry).href), false);
    } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
