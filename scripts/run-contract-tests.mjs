import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const mode = process.argv[2] || 'fast';
const distDependentTests = new Set([
    'electron-renderer-dist-drift.contract.test.mjs',
]);
const contractTests = readdirSync('tests')
    .filter((fileName) => fileName.endsWith('.contract.test.mjs'))
    .sort();

const selectedTests = mode === 'dist'
    ? contractTests.filter((fileName) => distDependentTests.has(fileName))
    : contractTests.filter((fileName) => !distDependentTests.has(fileName));

if (mode === 'fast') {
    selectedTests.push('observation-bridge-policy-runtime.test.mjs');
} else if (mode !== 'dist') {
    console.error(`Unknown contract-test mode: ${mode}`);
    process.exit(2);
}

const result = spawnSync(process.execPath, [
    '--test',
    ...selectedTests.map((fileName) => path.join('tests', fileName)),
], {
    stdio: 'inherit',
    env: process.env,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
