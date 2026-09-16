import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readCoverageRatchet, runCoverageRatchet } from './check-coverage-ratchet.mjs';
import { resolvePlaywrightRunLockPath } from './playwright-run-lock.mjs';

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

// Ohne Zeitlimit kann ein einzelner haengender Test den ganzen Lauf blockieren; ohne
// Obergrenze fuer die Parallelitaet nimmt der Lauf alle Kerne und kippt die
// lastempfindlichen Tests, sobald daneben ein Cluster oder ein Build laeuft.
export const CONTRACT_TEST_TIMEOUT_MS = 120000;
export const CONTRACT_CONCURRENCY_HEADROOM = 2;

export function resolveContractTestArgs(env = process.env, cpuCount = cpus().length) {
    const override = Number.parseInt(String(env?.CURVIOS_TEST_CONCURRENCY ?? ''), 10);
    const detectedCores = Number.isFinite(cpuCount) && cpuCount > 0 ? cpuCount : CONTRACT_CONCURRENCY_HEADROOM;
    const concurrency = Number.isInteger(override) && override > 0
        ? override
        : Math.max(2, detectedCores - CONTRACT_CONCURRENCY_HEADROOM);
    // --test-force-exit: a test file whose server socket or timer stays open after its last
    // test would otherwise keep the child alive forever (seen: signaling-connection-limit,
    // four hours at zero CPU). The per-test timeout alone does not end that process.
    return [
        `--test-timeout=${CONTRACT_TEST_TIMEOUT_MS}`,
        `--test-concurrency=${concurrency}`,
        '--test-force-exit',
    ];
}

// Lastempfindliche Tests (Council-Benchmark, Online-Handoff) messen echte Zeit. Unter
// Fremdlast darf nur ihr Budget wachsen, nie die Zusage selbst - deshalb ist ein
// Faktor unter 1 nicht zulaessig.
export function resolveTestTimeScale(env = process.env) {
    const rawScale = Number.parseFloat(String(env?.CURVIOS_TEST_TIME_SCALE ?? ''));
    if (!Number.isFinite(rawScale) || rawScale < 1) return 1;
    return rawScale;
}

export const CONTRACT_LOAD_TIME_SCALE = 3;

// An Electron run on the same machine (the Playwright lock is held) is exactly the load that
// tipped the online handoff from 0.4 s to 9 s. When nobody set a scale by hand, the runner
// stretches the budgets itself instead of relying on every agent to remember the variable.
export function resolveAutoTimeScaleEnv(env = process.env, playwrightLockHeld = false) {
    if (String(env?.CURVIOS_TEST_TIME_SCALE ?? '').trim()) return {};
    return playwrightLockHeld ? { CURVIOS_TEST_TIME_SCALE: String(CONTRACT_LOAD_TIME_SCALE) } : {};
}

export function resolveContractSummaryPath(timestamp = new Date().toISOString().replace(/[:.]/g, '-')) {
    return path.resolve('tmp', 'contract', timestamp, 'summary.json');
}

export function buildContractSummaryReporterArgs(summaryPath) {
    return [
        '--test-reporter=./scripts/contract-summary-reporter.mjs',
        `--test-reporter-destination=${summaryPath}`,
    ];
}

export function formatContractSummaryLine(summary, summaryPath) {
    const pass = Number(summary?.pass) || 0;
    const fail = Number(summary?.fail) || 0;
    const skipped = Number(summary?.skipped) || 0;
    const durationMs = Math.round(Number(summary?.duration_ms) || 0);
    return `[contract:summary] pass=${pass} fail=${fail} skipped=${skipped} durationMs=${durationMs} summary=${summaryPath}`;
}

function readContractSummary(summaryPath) {
    try {
        const parsed = JSON.parse(readFileSync(summaryPath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function runContractTests(argv = process.argv.slice(2)) {
    const mode = argv.find((value) => !String(value).startsWith('-')) || 'fast';
    const coverageEnabled = argv.includes('--coverage');
    const selectedTests = selectNodeTestFiles(collectNodeTestFileNames('tests'), mode);
    const summaryPath = path.join(mkdtempSync(path.join(tmpdir(), 'curvios-coverage-')), 'summary.json');
    const contractSummaryPath = resolveContractSummaryPath();
    mkdirSync(path.dirname(contractSummaryPath), { recursive: true });
    const autoScale = resolveAutoTimeScaleEnv(process.env, existsSync(resolvePlaywrightRunLockPath(process.env)));
    const childEnv = { ...process.env, ...autoScale };
    if (autoScale.CURVIOS_TEST_TIME_SCALE) {
        console.log(`[contract] playwright lock is held by another run; CURVIOS_TEST_TIME_SCALE=${autoScale.CURVIOS_TEST_TIME_SCALE}`);
    }
    const reporterArgs = coverageEnabled
        ? buildCoverageArgs(Object.keys(readCoverageRatchet().areas), summaryPath)
        : ['--test-reporter=spec', '--test-reporter-destination=stdout'];

    const result = spawnSync(process.execPath, [
        ...reporterArgs,
        ...buildContractSummaryReporterArgs(contractSummaryPath),
        ...resolveContractTestArgs(),
        '--test',
        ...selectedTests.map((fileName) => path.join('tests', fileName)),
    ], {
        stdio: 'inherit',
        env: childEnv,
    });

    if (result.error) throw result.error;
    const testStatus = result.status ?? 1;
    // Die Zusammenfassung ist bewusst die letzte Zeile des Laufs, damit sie sich ohne
    // Parsen der Spec-Ausgabe lesen laesst.
    const summaryLine = formatContractSummaryLine(readContractSummary(contractSummaryPath), contractSummaryPath);
    if (!coverageEnabled) {
        console.log(summaryLine);
        return testStatus;
    }

    // Der Ratchet laeuft auch bei roten Tests, damit ein Coverage-Einbruch nicht erst
    // beim naechsten gruenen Lauf auffaellt. Der Testfehler bleibt der Rueckgabewert.
    const ratchetStatus = runCoverageRatchet(summaryPath);
    console.log(summaryLine);
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
