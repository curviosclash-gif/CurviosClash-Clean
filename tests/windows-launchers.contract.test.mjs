import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMSPEC = process.env.ComSpec || 'cmd.exe';

function read(relativePath) {
    return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function spawnBatch(batchPath, argumentLine, options) {
    const command = `call "${batchPath}"${argumentLine ? ` ${argumentLine}` : ''}`;
    return spawnSync(COMSPEC, ['/d', '/c', command], {
        ...options,
        windowsVerbatimArguments: true,
    });
}

test('package launcher validates, builds and runs only the packaged Windows app', () => {
    const source = read('START_CURVIOSCLASH.cmd');

    assert.match(source, /call :package_is_valid/);
    for (const requiredPath of [
        'resources\\app.asar',
        'resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe',
        'resources\\dist-app\\index.html',
        'resources\\server\\lan-signaling.js',
        'resources\\package.json',
    ]) {
        assert.ok(source.includes(requiredPath), `package validation is missing ${requiredPath}`);
    }
    assert.match(source, /call npm run app:package/);
    assert.match(source, /"%PACKAGE_EXE%" %\*/);
    assert.match(source, /exit \/b %EXIT_CODE%/);
    assert.doesNotMatch(source, /npm --prefix electron run start/);
});

test('development and Settings launchers keep package and source paths explicit', () => {
    const development = read('start_development.bat');
    const settings = read('start_settings.bat');

    assert.match(development, /cd \/d "%ROOT%"/);
    assert.match(development, /where node/);
    assert.match(development, /where npm/);
    assert.match(development, /node_modules\\vite\\bin\\vite\.js/);
    assert.match(development, /electron\\node_modules\\electron\\dist\\electron\.exe/);
    assert.match(development, /call "%ROOT%install\.bat" --no-pause/);
    assert.ok(
        development.indexOf('call npm run build:app')
            < development.indexOf('call npm --prefix electron run start -- %*'),
        'development renderer must be built before Electron starts'
    );
    assert.doesNotMatch(development, /release\\win-unpacked/);

    assert.match(settings, /START_CURVIOSCLASH\.cmd" --settings-studio %\*/);
    assert.match(settings, /if \/i "%~1"=="--development"/);
    assert.match(settings, /if exist "%~dp0release\\win-unpacked\.tmp" goto :incomplete_package/);
    assert.match(settings, /start_development\.bat" --settings-studio/);
});

test('editor launcher owns one fixed endpoint and waits for the matching server', () => {
    const batch = read('start_editor.bat');
    const localAlias = read('start_editor_local.bat');
    const helper = read('scripts/start-editor.ps1');

    assert.match(batch, /scripts\\start-editor\.ps1" %\*/);
    assert.match(localAlias, /call "%~dp0start_editor\.bat" %\*/);
    assert.match(helper, /\[string\]\$HostName = "127\.0\.0\.1"/);
    assert.match(helper, /\[int\]\$Port = 5173/);
    assert.match(helper, /--strictPort/);
    assert.match(helper, /Test-TcpPort/);
    assert.match(helper, /Port \$Port ist bereits durch einen anderen Dienst belegt/);
    assert.match(helper, /Es wird kein zweiter Server gestartet/);

    const readinessCheck = helper.lastIndexOf('if (Test-EditorEndpoint)');
    assert.ok(readinessCheck >= 0, 'editor readiness check is missing');
    assert.ok(
        helper.indexOf('Open-Editor', readinessCheck) > readinessCheck,
        'browser must open only after the editor endpoint is reachable'
    );
});

test('installer locks all dependency trees and legacy launchers only forward', () => {
    const install = read('install.bat');
    const server = read('server.ps1');

    assert.match(install, /call npm ci/);
    assert.match(install, /call npm --prefix electron ci/);
    assert.match(install, /call npm --prefix server ci/);
    assert.match(install, /electron\\node_modules\\electron\\install\.js/);
    assert.match(install, /electron\\node_modules\\ffmpeg-static\\install\.js/);
    assert.doesNotMatch(install, /call npm(?: --prefix \S+)? install/);
    assert.match(server, /\$exitCode = 1/);
    assert.match(server, /exit \$exitCode/);

    for (const [alias, target] of [
        ['start_desktop.bat', 'start_development.bat'],
        ['start_electron.bat', 'start_development.bat'],
        ['start_editor_local.bat', 'start_editor.bat'],
    ]) {
        const source = read(alias);
        assert.match(source, new RegExp(`call "%~dp0${target.replace('.', '\\.')}" %\\*`));
        assert.equal((source.match(/\bcall\b/g) || []).length, 1, `${alias} must remain a single redirect`);
    }

    const browser = read('start_game.bat');
    assert.match(browser, /server\.ps1" %\*/);
    assert.doesNotMatch(browser, /npm run dev|pause/i);
});

test('batch launchers resolve the repository from both repository and foreign working directories', (t) => {
    assert.equal(process.platform, 'win32');
    assert.equal(existsSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')), true);
    assert.equal(existsSync(path.join(ROOT, 'electron', 'node_modules', 'electron', 'dist', 'electron.exe')), true);

    const fixture = mkdtempSync(path.join(os.tmpdir(), 'curvios-launcher-contract-'));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const logPath = path.join(fixture, 'npm.log');
    writeFileSync(path.join(fixture, 'npm.cmd'), [
        '@echo off',
        'echo cwd=%CD%>>"%LAUNCHER_LOG%"',
        'echo args=%*>>"%LAUNCHER_LOG%"',
        'exit /b 0',
        '',
    ].join('\r\n'));

    const env = {
        ...process.env,
        LAUNCHER_LOG: logPath,
        PATH: `${fixture};${process.env.PATH}`,
    };
    const cases = [
        ['start_development.bat', '--contract-probe'],
        ['start_desktop.bat', '--contract-probe'],
        ['start_electron.bat', '--contract-probe'],
        ['start_settings.bat', '--development'],
    ];

    for (const cwd of [ROOT, fixture]) {
        for (const [launcher, args] of cases) {
            execFileSync(COMSPEC, ['/d', '/c', `call "${path.join(ROOT, launcher)}" ${args}`], {
                cwd,
                env,
                stdio: 'pipe',
                windowsVerbatimArguments: true,
            });
        }
    }

    const calls = readFileSync(logPath, 'utf8');
    const cwdLines = calls.split(/\r?\n/).filter((line) => line.startsWith('cwd='));
    assert.ok(cwdLines.length > 0);
    assert.deepEqual(new Set(cwdLines), new Set([`cwd=${ROOT}`]));

    const installRoot = path.join(fixture, 'install-root');
    mkdirSync(installRoot, { recursive: true });
    copyFileSync(path.join(ROOT, 'install.bat'), path.join(installRoot, 'install.bat'));
    for (const relativePath of [
        'node_modules/vite/bin/vite.js',
        'electron/node_modules/electron/dist/electron.exe',
        'electron/node_modules/electron-builder/package.json',
        'electron/node_modules/ffmpeg-static/ffmpeg.exe',
        'server/node_modules/ws/package.json',
    ]) {
        const filePath = path.join(installRoot, relativePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, 'contract fixture');
    }
    writeFileSync(logPath, '');
    for (const cwd of [installRoot, fixture]) {
        execFileSync(COMSPEC, ['/d', '/c', `call "${path.join(installRoot, 'install.bat')}" --no-pause`], {
            cwd,
            env,
            stdio: 'pipe',
            windowsVerbatimArguments: true,
        });
    }
    const installCwdLines = readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('cwd='));
    assert.deepEqual(new Set(installCwdLines), new Set([`cwd=${installRoot}`]));
});

test('missing Node.js produces clear non-zero failures without changing the installation', (t) => {
    assert.equal(process.platform, 'win32');
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'curvios-launcher-prereq-'));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    copyFileSync(path.join(ROOT, 'START_CURVIOSCLASH.cmd'), path.join(fixture, 'START_CURVIOSCLASH.cmd'));

    const env = { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') };
    for (const [launcher, cwd] of [
        [path.join(ROOT, 'start_development.bat'), fixture],
        [path.join(ROOT, 'install.bat'), fixture],
        [path.join(fixture, 'START_CURVIOSCLASH.cmd'), ROOT],
    ]) {
        const result = spawnSync(COMSPEC, ['/d', '/c', `call "${launcher}" --no-pause`], {
            cwd,
            env,
            encoding: 'utf8',
            windowsVerbatimArguments: true,
        });
        assert.equal(result.status, 1, `${launcher} should fail without Node.js`);
        assert.match(`${result.stdout}\n${result.stderr}`, /Node\.js wurde nicht gefunden/);
    }
});

test('launcher failures preserve dependency, build and packaged process exit codes', (t) => {
    assert.equal(process.platform, 'win32');
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'curvios-launcher-exit-'));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const npmFixturePath = path.join(fixture, 'npm.cmd');
    const npmFixture = [
        '@echo off',
        'if "%~1"=="ci" exit /b 7',
        'if "%~1"=="run" if "%~2"=="build:app" exit /b 9',
        'if "%~1"=="run" if "%~2"=="app:package" exit /b 11',
        'exit /b 0',
        '',
    ].join('\r\n');
    writeFileSync(npmFixturePath, npmFixture);
    const env = { ...process.env, PATH: `${fixture};${process.env.PATH}` };

    const install = spawnBatch(path.join(ROOT, 'install.bat'), '--no-pause', {
        cwd: fixture,
        env,
        encoding: 'utf8',
    });
    assert.equal(install.status, 7);
    assert.match(install.stdout, /Root-Abhaengigkeiten konnten nicht installiert werden/);

    writeFileSync(npmFixturePath, '@echo off\r\nexit /b -4048\r\n');
    const negativeInstall = spawnBatch(path.join(ROOT, 'install.bat'), '--no-pause', {
        cwd: fixture,
        env,
        encoding: 'utf8',
    });
    assert.notEqual(negativeInstall.status, 0);
    assert.match(negativeInstall.stdout, /Root-Abhaengigkeiten konnten nicht installiert werden/);
    writeFileSync(npmFixturePath, npmFixture);

    const development = spawnBatch(path.join(ROOT, 'start_development.bat'), '', {
        cwd: fixture,
        env,
        encoding: 'utf8',
    });
    assert.equal(development.status, 9);
    assert.match(development.stdout, /Desktop-Renderer konnte nicht gebaut werden/);

    copyFileSync(path.join(ROOT, 'START_CURVIOSCLASH.cmd'), path.join(fixture, 'START_CURVIOSCLASH.cmd'));
    for (const relativePath of [
        'node_modules/vite/bin/vite.js',
        'electron/node_modules/electron/dist/electron.exe',
        'electron/node_modules/.bin/electron-builder.cmd',
        'electron/node_modules/ffmpeg-static/ffmpeg.exe',
        'server/node_modules/ws/package.json',
    ]) {
        const filePath = path.join(fixture, relativePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, 'contract fixture');
    }
    const packageBuild = spawnBatch(path.join(fixture, 'START_CURVIOSCLASH.cmd'), '', {
        cwd: ROOT,
        env,
        encoding: 'utf8',
    });
    assert.equal(packageBuild.status, 11);
    assert.match(packageBuild.stdout, /Windows-Paketversion konnte nicht gebaut werden/);

    for (const relativePath of [
        'release/win-unpacked/resources/app.asar',
        'release/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe',
        'release/win-unpacked/resources/dist-app/index.html',
        'release/win-unpacked/resources/server/lan-signaling.js',
        'release/win-unpacked/resources/package.json',
    ]) {
        const filePath = path.join(fixture, relativePath);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, 'contract fixture');
    }
    copyFileSync(COMSPEC, path.join(fixture, 'release', 'win-unpacked', 'CurviosClash.exe'));
    const packagedProcess = spawnBatch(
        path.join(fixture, 'START_CURVIOSCLASH.cmd'),
        '/d /c "exit 13"',
        { cwd: ROOT, env, encoding: 'utf8' }
    );
    assert.equal(packagedProcess.status, 13);
    assert.match(packagedProcess.stdout, /Paketversion wurde mit Exitcode 13 beendet/);
});
