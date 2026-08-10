import { mkdtempSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readCoverageRatchet, runCoverageRatchet } from './check-coverage-ratchet.mjs';

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

// Node kennt nur eine globale Schwelle fuer den gesamten Include-Satz. Eine einzige
// Zahl ueber alle Bereiche wuerde entweder src/shared/contracts absenken oder die
// schwaecheren Bereiche gar nicht erst zulassen, deshalb pruefen die Grenzen je
// Bereich nach dem Lauf gegen scripts/architecture/coverage-ratchet.json.
export function buildCoverageArgs(areaNames, summaryPath) {
    return [
        '--experimental-test-coverage',
        ...areaNames.map((areaName) => `--test-coverage-include=${areaName}/**/*.js`),
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        '--test-reporter=./scripts/coverage-summary-reporter.mjs',
        `--test-reporter-destination=${summaryPath}`,
    ];
}

export function runContractTests(argv = process.argv.slice(2)) {
    const mode = argv.find((value) => !String(value).startsWith('-')) || 'fast';
    const coverageEnabled = argv.includes('--coverage');
    const selectedTests = selectNodeTestFiles(collectNodeTestFileNames('tests'), mode);
    const summaryPath = path.join(mkdtempSync(path.join(tmpdir(), 'curvios-coverage-')), 'summary.json');
    const testArgs = coverageEnabled
        ? buildCoverageArgs(Object.keys(readCoverageRatchet().areas), summaryPath)
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
    const testStatus = result.status ?? 1;
    if (!coverageEnabled) return testStatus;

    // Der Ratchet laeuft auch bei roten Tests, damit ein Coverage-Einbruch nicht erst
    // beim naechsten gruenen Lauf auffaellt. Der Testfehler bleibt der Rueckgabewert.
    const ratchetStatus = runCoverageRatchet(summaryPath);
    return testStatus || ratchetStatus;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exit(runContractTests());
    } catch (error) {
        console.error(error?.message || error);
        process.exit(2);
    }
}
