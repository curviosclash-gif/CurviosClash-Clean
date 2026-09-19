import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RATCHET_PATH = 'scripts/architecture/coverage-ratchet.json';
const METRICS = [
    { key: 'lines', covered: 'coveredLineCount', total: 'totalLineCount' },
    { key: 'branches', covered: 'coveredBranchCount', total: 'totalBranchCount' },
    { key: 'functions', covered: 'coveredFunctionCount', total: 'totalFunctionCount' },
];

export function readCoverageRatchet(rootDir = process.cwd()) {
    const ratchet = JSON.parse(readFileSync(path.join(rootDir, RATCHET_PATH), 'utf8'));
    if (!ratchet.areas || typeof ratchet.areas !== 'object') {
        throw new Error(`Missing areas object in ${RATCHET_PATH}.`);
    }
    return ratchet;
}

export function toRelativePosixPath(absolutePath, workingDirectory) {
    return path.relative(workingDirectory, absolutePath).split(path.sep).join('/');
}

// Ein Bereich gewinnt eine Datei nur, wenn kein spezifischerer Bereich sie ebenfalls
// beansprucht. Sonst verschluckt "src/entities" die eigene Untergrenze von
// "src/entities/systems" und ein Einbruch dort bliebe unsichtbar.
export function resolveArea(relativePath, areaNames) {
    let winner = null;
    for (const areaName of areaNames) {
        if (relativePath !== areaName && !relativePath.startsWith(`${areaName}/`)) continue;
        if (winner === null || areaName.length > winner.length) winner = areaName;
    }
    return winner;
}

export function aggregateAreas(summary, areaNames) {
    const aggregated = new Map();
    for (const areaName of areaNames) {
        aggregated.set(areaName, {
            files: [],
            coveredLineCount: 0, totalLineCount: 0,
            coveredBranchCount: 0, totalBranchCount: 0,
            coveredFunctionCount: 0, totalFunctionCount: 0,
        });
    }

    for (const file of summary.files || []) {
        const relativePath = toRelativePosixPath(file.path, summary.workingDirectory);
        const areaName = resolveArea(relativePath, areaNames);
        if (!areaName) continue;
        const entry = aggregated.get(areaName);
        entry.files.push({ path: relativePath, linePercent: file.coveredLinePercent });
        for (const metric of METRICS) {
            entry[metric.covered] += file[metric.covered];
            entry[metric.total] += file[metric.total];
        }
    }

    return aggregated;
}

// Ein Bereich ohne zaehlbare Einheiten hat 100 % — sonst wuerde ein Ordner ohne
// Verzweigungen den Ratchet mit einer Division durch null zum Kippen bringen.
export function percentOf(covered, total) {
    if (!Number.isFinite(total) || total <= 0) return 100;
    return (covered / total) * 100;
}

export function evaluateCoverageRatchet(summary, ratchet) {
    const areaNames = Object.keys(ratchet.areas);
    const aggregated = aggregateAreas(summary, areaNames);
    const results = [];

    for (const areaName of areaNames) {
        const entry = aggregated.get(areaName);
        const floors = ratchet.areas[areaName];
        const metrics = {};
        let failed = false;

        for (const metric of METRICS) {
            const floor = Number(floors?.[metric.key]);
            if (!Number.isFinite(floor)) {
                throw new Error(`Missing numeric ${metric.key} floor for area ${areaName} in ${RATCHET_PATH}.`);
            }
            const actual = percentOf(entry[metric.covered], entry[metric.total]);
            metrics[metric.key] = { actual, floor };
            if (actual + 1e-9 < floor) failed = true;
        }

        results.push({ area: areaName, fileCount: entry.files.length, metrics, failed, files: entry.files });
    }

    return results;
}

export function formatAreaLine(result) {
    const parts = METRICS.map((metric) => {
        const { actual, floor } = result.metrics[metric.key];
        return `${metric.key} ${actual.toFixed(2)}/${floor}`;
    });
    return `${result.area}: ${result.fileCount} files, ${parts.join(', ')}`;
}

export function runCoverageRatchet(summaryPath, rootDir = process.cwd()) {
    const raw = readFileSync(summaryPath, 'utf8').trim();
    if (!raw) throw new Error(`Empty coverage summary at ${summaryPath}.`);
    const payload = JSON.parse(raw);
    const summary = payload?.coverage || payload;
    if (!summary?.workingDirectory || !Array.isArray(summary?.files)) {
        throw new Error(`Missing coverage data in ${summaryPath}.`);
    }
    const ratchet = readCoverageRatchet(rootDir);
    const results = evaluateCoverageRatchet(summary, ratchet);

    const failures = results.filter((result) => result.failed);
    for (const failure of failures) {
        console.error(`Coverage ratchet failed: ${formatAreaLine(failure)}.`);
        const worst = [...failure.files].sort((a, b) => a.linePercent - b.linePercent).slice(0, 10);
        for (const file of worst) {
            console.error(`- ${file.path} ${file.linePercent.toFixed(2)}% lines`);
        }
    }
    if (failures.length > 0) {
        console.error('Coverage may rise, not fall. Lower a floor only on an explicit request.');
        return 1;
    }

    console.log(`Coverage ratchet passed:\n${results.map((result) => `  ${formatAreaLine(result)}`).join('\n')}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const summaryPath = process.argv[2];
    if (!summaryPath) {
        console.error('Usage: node scripts/check-coverage-ratchet.mjs <coverage-summary.json>');
        process.exit(2);
    }
    try {
        process.exit(runCoverageRatchet(summaryPath));
    } catch (error) {
        console.error(error?.message || error);
        process.exit(2);
    }
}
