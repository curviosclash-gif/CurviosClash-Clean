import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { exportGameRepository } from './export-game-repo.mjs';

function option(name, fallback = '') {
    const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
    return inline ? inline.slice(name.length + 3) : fallback;
}

function run(command, args, cwd) {
    const useShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
    const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit', shell: useShell });
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(' ')} failed with exit ${result.status}: ${result.error?.message || 'no process error'}`
    );
}

async function digestTree(root) {
    const entries = [];
    async function visit(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(entryPath);
            else entries.push(entryPath);
        }
    }
    await visit(root);
    const manifest = [];
    for (const filePath of entries.sort()) {
        const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
        const hash = createHash('sha256').update(await readFile(filePath)).digest('hex');
        manifest.push(`${hash}  ${relativePath}`);
    }
    return createHash('sha256').update(manifest.join('\n')).digest('hex');
}

const commit = option('commit', 'HEAD');
const baseOutput = path.resolve(option('output', path.join('tmp', `game-export-check-${Date.now()}`)));
const firstOutput = path.join(baseOutput, 'first');
const secondOutput = path.join(baseOutput, 'second');
assert.equal(existsSync(baseOutput), false, `Export check output already exists: ${baseOutput}`);
await mkdir(baseOutput, { recursive: true });
const first = await exportGameRepository({ commit, outputDirectory: firstOutput });
await exportGameRepository({ commit, outputDirectory: secondOutput });
assert.equal(await digestTree(firstOutput), await digestTree(secondOutput), 'Game export is not reproducible.');

run(process.execPath, ['scripts/check-game-repository.mjs'], firstOutput);
if (!process.argv.includes('--skip-build')) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npm, ['ci'], firstOutput);
    run(npm, ['--prefix', 'electron', 'ci', '--ignore-scripts'], firstOutput);
    run(process.execPath, ['electron/node_modules/electron/install.js'], firstOutput);
    const ffmpegEnvironment = { ...process.env, npm_config_arch: 'x64' };
    const ffmpegInstall = spawnSync(process.execPath, ['electron/node_modules/ffmpeg-static/install.js'], {
        cwd: firstOutput,
        env: ffmpegEnvironment,
        stdio: 'inherit',
    });
    assert.equal(ffmpegInstall.status, 0, 'Pinned FFmpeg install failed.');
    run(process.execPath, ['scripts/verify-ffmpeg-binary.mjs'], firstOutput);
    run(npm, ['run', 'test:contract'], firstOutput);
    run(npm, ['run', 'build:game'], firstOutput);
}

console.log(JSON.stringify({
    sourceCommit: first.sourceCommit,
    outputDirectory: baseOutput,
    reproducibility: 'ok',
    fullBuild: process.argv.includes('--skip-build') ? 'skipped' : 'ok',
}));
