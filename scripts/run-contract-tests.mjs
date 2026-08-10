import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distDependentTests = new Set([
    'electron-renderer-dist-drift.contract.test.mjs',
]);

// Diese Unterordner tragen absichtlich *.test.mjs, die nicht zur Produktsuite gehoeren
// (Council-Benchmark-Vorlagen mit eingebauten Fehlern). Alles andere unterhalb von
// tests/ wird eingesammelt, damit ein Test in einem Unterordner nicht stillschweigend
// ausfaellt.
const fixtureDirectories = new Set([
    'council-test-loop',
]);

export function collectNodeTestFileNames(rootDirectory, readDirectory = readdirSync) {
    const collected = [];

    const walk = (relativeDirectory) => {
        const absoluteDirectory = relativeDirectory
            ? path.join(rootDirectory, relativeDirectory)
            : rootDirectory;
        for (const entry of readDirectory(absoluteDirectory, { withFileTypes: true })) {
            const relativeEntry = relativeDirectory
                ? `${relativeDirectory}/${entry.name}`
                : entry.name;
            if (entry.isDirectory()) {
                if (fixtureDirectories.has(entry.name)) continue;
                walk(relativeEntry);
                continue;
            }
            if (entry.name.endsWith('.test.mjs')) collected.push(relativeEntry);
        }
    };

    walk('');
    return collected.sort();
}

export function selectNodeTestFiles(fileNames, mode = 'fast') {
    if (mode !== 'fast' && mode !== 'dist') {
        throw new Error(`Unknown contract-test mode: ${mode}`);
    }
    return fileNames
        .filter((fileName) => fileName.endsWith('.test.mjs'))
        .filter((fileName) => {
            const baseName = String(fileName).split('/').pop();
            return mode === 'dist'
                ? distDependentTests.has(baseName)
                : !distDependentTests.has(baseName);
        })
        .sort();
}

export function runContractTests(argv = process.argv.slice(2)) {
    const mode = argv.find((value) => !String(value).startsWith('-')) || 'fast';
    const coverageEnabled = argv.includes('--coverage');
    const selectedTests = selectNodeTestFiles(collectNodeTestFileNames('tests'), mode);
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
