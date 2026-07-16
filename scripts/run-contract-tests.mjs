import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distDependentTests = new Set([
    'electron-renderer-dist-drift.contract.test.mjs',
]);

export function selectNodeTestFiles(fileNames, mode = 'fast') {
    if (mode !== 'fast' && mode !== 'dist') {
        throw new Error(`Unknown contract-test mode: ${mode}`);
    }
    return fileNames
        .filter((fileName) => fileName.endsWith('.test.mjs'))
        .filter((fileName) => mode === 'dist'
            ? distDependentTests.has(fileName)
            : !distDependentTests.has(fileName))
        .sort();
}

export function runContractTests(argv = process.argv.slice(2)) {
    const mode = argv.find((value) => !String(value).startsWith('-')) || 'fast';
    const coverageEnabled = argv.includes('--coverage');
    const selectedTests = selectNodeTestFiles(readdirSync('tests'), mode);
    const testArgs = coverageEnabled
        ? [
            '--experimental-test-coverage',
            '--test-coverage-include=src/shared/contracts/**/*.js',
            '--test-coverage-lines=70',
            '--test-coverage-branches=60',
            '--test-coverage-functions=60',
        ]
        : [];

    const result = spawnSync(process.execPath, [
        ...testArgs,
        '--test',
        ...selectedTests.map((fileName) => path.join('tests', fileName)),
    ], {
        stdio: 'inherit',
        env: process.env,
    });

    if (result.error) throw result.error;
    return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exit(runContractTests());
    } catch (error) {
        console.error(error?.message || error);
        process.exit(2);
    }
}
