import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] || '.');
const forbiddenPathPattern = /(?:^|\/)(?:\.opencode|android-classic|editor|prototypes|tools|dev\/training|src\/dev|tuning-console|vehicle-lab)(?:\/|$)/i;
const forbiddenProductSourcePattern = /(?:^|\/)(?:AuthoringTelemetry|MenuDeveloperStateSync|MenuTelemetryDashboard|MenuTelemetryHeatmap)[^/]*\.js$/i;
const forbiddenImportPattern = /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:\/(?:editor|prototypes|vehicle-lab)\/|\/dev\/training\/|\/src\/dev\/|(?:^|\/)tuning(?:[-/]))[^'"]*['"]/i;

async function listFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('dist') || entry.name === 'release') continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(entryPath));
        else files.push(entryPath);
    }
    return files;
}

assert.equal(existsSync(path.join(root, '.game-export.json')), true, 'Game export metadata is missing.');
const files = await listFiles(root);
const relativePaths = files.map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'));
const forbiddenPath = relativePaths.find((relativePath) => forbiddenPathPattern.test(relativePath));
assert.equal(forbiddenPath, undefined, `Forbidden game repository path: ${forbiddenPath}`);
const forbiddenProductSource = relativePaths.find((relativePath) => forbiddenProductSourcePattern.test(relativePath));
assert.equal(forbiddenProductSource, undefined, `Forbidden developer source in game repository: ${forbiddenProductSource}`);

for (const filePath of files.filter((candidate) => /\.(?:cjs|js|mjs)$/i.test(candidate))) {
    const source = await readFile(filePath, 'utf8');
    assert.doesNotMatch(source, forbiddenImportPattern, `Forbidden game import in ${path.relative(root, filePath)}`);
}

const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await readFile(path.join(root, 'electron/package.json'), 'utf8'));
assert.equal(rootPackage.version, electronPackage.version, 'Root and Electron versions differ.');
assert.deepEqual(
    new Set(relativePaths.filter((relativePath) => /(?:^|\/)vite\.config\./.test(relativePath))),
    new Set(['vite.config.js']),
    'Game repository must contain one production Vite config.'
);
console.log(JSON.stringify({ root, checkedFiles: files.length, repositoryBoundary: 'ok' }));
