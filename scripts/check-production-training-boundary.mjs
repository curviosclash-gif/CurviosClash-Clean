import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const outputDirectory = path.resolve(process.cwd(), process.argv[2] || 'dist-app');
const indexPath = path.join(outputDirectory, 'index.html');

function listFiles(directory) {
    if (!existsSync(directory)) return [];
    const files = [];
    for (const entry of readdirSync(directory)) {
        const entryPath = path.join(directory, entry);
        if (statSync(entryPath).isDirectory()) files.push(...listFiles(entryPath));
        else files.push(entryPath);
    }
    return files;
}

assert.equal(existsSync(indexPath), true, `Production renderer is missing: ${indexPath}`);
const indexHtml = readFileSync(indexPath, 'utf8');
assert.doesNotMatch(indexHtml, /developer-training-|Training-Interface|Training Reset|Run Batch|Run Eval|Run Gate/i);

const outputFiles = listFiles(outputDirectory);
const forbiddenAsset = outputFiles.find((filePath) => (
    /(?:^|[\\/])assets[\\/](?:training|trainer|validation)-[^\\/]+\.js$/i.test(filePath)
));
assert.equal(forbiddenAsset, undefined, `Developer training asset reached production: ${forbiddenAsset}`);

const forbiddenBundleMarker = /DeveloperTrainingController|TrainingAutomationRunner|TrainingGateEvaluator|WebSocketTrainerBridge|MatchKernelTrainingPayload|training-agent/;
for (const filePath of outputFiles.filter((candidate) => candidate.endsWith('.js'))) {
    assert.doesNotMatch(
        readFileSync(filePath, 'utf8'),
        forbiddenBundleMarker,
        `Developer training implementation reached production: ${filePath}`
    );
}

console.log(JSON.stringify({
    outputDirectory,
    checkedFiles: outputFiles.length,
    developerTrainingBoundary: 'ok',
}));
