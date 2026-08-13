import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const outputDirectory = path.resolve(process.cwd(), process.argv[2] || 'dist-game');
const allowedHtmlEntries = new Set(['hangar.html', 'index.html']);
const forbiddenPathPattern = /(?:^|[\\/])(?:editor|vehicle-lab|training|tuning-console)(?:[\\/.-]|$)|developer-ui/i;
const forbiddenBundlePattern = /TuningRuntimeIpcBridge|developer-tuning-console|AuthoringTelemetrySession|TrainingAutomationRunner/;

async function listFiles(directory) {
    const files = [];
    for (const entry of await readdir(directory)) {
        const entryPath = path.join(directory, entry);
        if ((await stat(entryPath)).isDirectory()) files.push(...await listFiles(entryPath));
        else files.push(entryPath);
    }
    return files;
}

assert.equal(existsSync(outputDirectory), true, `Game renderer output is missing: ${outputDirectory}`);
const outputFiles = await listFiles(outputDirectory);
const relativePaths = outputFiles.map((filePath) => path.relative(outputDirectory, filePath).replace(/\\/g, '/'));
const htmlEntries = relativePaths.filter((relativePath) => !relativePath.includes('/') && relativePath.endsWith('.html'));
assert.deepEqual(new Set(htmlEntries), allowedHtmlEntries, `Unexpected game HTML entries: ${htmlEntries.join(', ')}`);

const forbiddenPath = relativePaths.find((relativePath) => forbiddenPathPattern.test(relativePath));
assert.equal(forbiddenPath, undefined, `Forbidden game-build path: ${forbiddenPath}`);

for (const filePath of outputFiles.filter((candidate) => candidate.endsWith('.js'))) {
    assert.doesNotMatch(
        await readFile(filePath, 'utf8'),
        forbiddenBundlePattern,
        `Forbidden developer implementation reached game build: ${path.relative(outputDirectory, filePath)}`
    );
}

console.log(JSON.stringify({
    outputDirectory,
    htmlEntries: [...allowedHtmlEntries],
    checkedFiles: outputFiles.length,
    gameBoundary: 'ok',
}));
