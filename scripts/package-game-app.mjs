import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function readArch() {
    const inline = process.argv.find((argument) => argument.startsWith('--arch='));
    if (inline) return inline.slice('--arch='.length).toLowerCase();
    const index = process.argv.indexOf('--arch');
    return String(index >= 0 ? process.argv[index + 1] || '' : '').toLowerCase();
}

function run(command, args, cwd = process.cwd()) {
    const result = spawnSync(command, args, {
        cwd,
        env: process.env,
        stdio: 'inherit',
        shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
    });
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed with exit ${result.status}`);
}

const architecture = readArch();
assert.ok(['x64', 'arm64'].includes(architecture), 'Use --arch=x64 or --arch=arm64.');
assert.equal(
    existsSync(path.resolve('.game-export.json')),
    true,
    'Offline installers must be built from a committed game export, not from the full source repository.'
);

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:game']);
run(process.execPath, ['scripts/verify-ffmpeg-binary.mjs']);
run(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron-builder', '--config', 'game-builder.yml', '--win', 'nsis', `--${architecture}`],
    path.resolve('electron')
);

const expectedInstaller = path.resolve(
    'release',
    `CurviosClash-Setup-${JSON.parse(readFileSync('package.json', 'utf8')).version}-${architecture}.exe`
);
assert.equal(existsSync(expectedInstaller), true, `Expected installer is missing: ${expectedInstaller}`);
run(process.execPath, ['scripts/check-game-package.mjs', architecture]);
console.log(JSON.stringify({ architecture, installer: expectedInstaller }));
