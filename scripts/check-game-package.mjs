import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const architecture = String(process.argv[2] || '').toLowerCase();
assert.ok(['x64', 'arm64'].includes(architecture), 'Package check requires x64 or arm64.');
const unpackedDirectory = path.resolve('release', `win-${architecture}-unpacked`);
const legacyUnpackedDirectory = path.resolve('release', 'win-unpacked');
const appDirectory = existsSync(unpackedDirectory) ? unpackedDirectory : legacyUnpackedDirectory;
const executablePath = path.join(appDirectory, 'CurviosClash.exe');
const resourcesDirectory = path.join(appDirectory, 'resources');
const asarPath = path.join(resourcesDirectory, 'app.asar');
for (const requiredPath of [
    executablePath,
    asarPath,
    path.join(resourcesDirectory, 'dist-app', 'index.html'),
    path.join(resourcesDirectory, 'dist-app', 'hangar.html'),
    path.join(resourcesDirectory, 'server', 'lan-signaling.js'),
    path.join(resourcesDirectory, 'src', 'four-player-planar', 'FourPlayerPlanarContract.js'),
    path.join(resourcesDirectory, 'src', 'product', 'GameDistributionToolingAdapter.js'),
    path.join(resourcesDirectory, 'src', 'shared', 'telemetry', 'TelemetryPreferencesStore.js'),
    path.join(resourcesDirectory, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
]) {
    assert.equal(existsSync(requiredPath), true, `Packaged game resource is missing: ${requiredPath}`);
}

const asarCommand = path.resolve('electron/node_modules/@electron/asar/bin/asar.js');
const asarList = spawnSync(process.execPath, [asarCommand, 'list', asarPath], { encoding: 'utf8' });
assert.equal(asarList.status, 0, asarList.stderr || 'Unable to inspect app.asar.');
const asarEntries = asarList.stdout.split(/\r?\n/).filter(Boolean);
const forbiddenAsarPath = asarEntries.find((entry) => /(?:editor(?:[-/]|$)|tuning|vehicle-lab|dev\/training|mobile-classic|mobile-arcade)/i.test(entry));
assert.equal(forbiddenAsarPath, undefined, `Forbidden game asar entry: ${forbiddenAsarPath}`);

async function listFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory)) {
        const entryPath = path.join(directory, entry);
        if ((await stat(entryPath)).isDirectory()) files.push(...await listFiles(entryPath));
        else files.push(entryPath);
    }
    return files;
}

const resourceFiles = await listFiles(resourcesDirectory);
const relativePaths = resourceFiles.map((filePath) => path.relative(resourcesDirectory, filePath).replace(/\\/g, '/'));
const forbiddenResource = relativePaths.find((entry) => (
    /(?:^|\/)(?:(?:editor|vehicle-lab|training|mobile-classic|mobile-arcade)(?:\/|$)|editor-[^/]*\.(?:cjs|js|mjs)$)/i.test(entry)
    || /(?:AuthoringTelemetry|MenuDeveloperStateSync|MenuTelemetryDashboard)/i.test(entry)
));
assert.equal(forbiddenResource, undefined, `Forbidden packaged resource: ${forbiddenResource}`);

const bytes = readFileSync(executablePath);
const peOffset = bytes.readInt32LE(0x3c);
const machine = bytes.readUInt16LE(peOffset + 4);
assert.equal(machine, architecture === 'arm64' ? 0xaa64 : 0x8664, 'Packaged executable architecture mismatch.');

for (const filePath of resourceFiles.filter((candidate) => /dist-app[\\/]assets[\\/].*\.js$/i.test(candidate))) {
    assert.doesNotMatch(
        await readFile(filePath, 'utf8'),
        /TuningRuntimeIpcBridge|developer-tuning-console|AuthoringTelemetrySession|TrainingAutomationRunner/,
        `Forbidden implementation reached renderer bundle: ${filePath}`
    );
}
console.log(JSON.stringify({ architecture, appDirectory, packageBoundary: 'ok', checkedResources: resourceFiles.length }));
